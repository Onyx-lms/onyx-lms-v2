/**
 * PAY-01 / PAY-05 / PAY-06 -- checkout orchestration and fulfilment.
 */
import type { Db } from '../db/client.ts';
import { HttpError } from '../http/errors.ts';
import { phpJsonDecode, phpJsonEncode } from '../json/php-json.ts';
import type { SettingsService } from '../settings/settings.service.ts';
import type { CartService } from '../enrollment/cart.service.ts';
import type { EnrollmentService } from '../enrollment/enrollment.service.ts';
import { getProvider, hasProvider, type GatewayConfig, type CheckoutOrder } from './provider.ts';
import { computeTotals, splitRevenue, allocateDiscount, round2 } from './money.ts';
import { signOrder, readOrder, referenceKey, type PendingOrder } from './order-token.ts';

export interface CheckoutResult {
  reference: string;
  redirectUrl: string;
  providerRef: string;
  clientPayload?: Record<string, unknown>;
  total: number;
  currency: string;
}

export interface FulfilResult {
  status: 'paid' | 'pending' | 'failed';
  invoice?: string;
  courseIds?: number[];
  alreadyFulfilled?: boolean;
  reason?: string;
}

/** Truncates to fit a varchar column without producing invalid UTF-16. */
function capped(value: string, max: number): string {
  return value.length <= max ? value : value.slice(0, max);
}

/** Str::random(20) -- same shape Laravel wrote into payment_histories.invoice. */
function randomInvoice(): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (let i = 0; i < 20; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

export class PaymentService {
  #db: Db;
  #settings: SettingsService;
  #cart: CartService;
  #enrollment: EnrollmentService;
  #secret: string;

  constructor(db: Db, settings: SettingsService, cart: CartService,
              enrollment: EnrollmentService, secret = process.env.SUPABASE_JWT_SECRET ?? '') {
    this.#db = db;
    this.#settings = settings;
    this.#cart = cart;
    this.#enrollment = enrollment;
    this.#secret = secret;
  }

  /** Enabled gateways, safe for the browser -- credentials never included. */
  async availableGateways() {
    const { data } = await this.#db.from('payment_gateways')
      .select('id, identifier, title, description, status, test_mode').eq('status', 1);
    return (data ?? [])
      .filter((g) => g.identifier && hasProvider(g.identifier))
      .map((g) => ({
        identifier: g.identifier, title: g.title,
        description: g.description, test_mode: Boolean(g.test_mode),
      }));
  }

  async #gatewayConfig(identifier: string): Promise<GatewayConfig> {
    const { data } = await this.#db.from('payment_gateways')
      .select('identifier, title, keys, status, test_mode')
      .eq('identifier', identifier).maybeSingle();
    if (!data) throw new HttpError(404, 'Payment method is not available.');
    if (!data.status) throw new HttpError(422, 'Payment method is disabled.');
    return {
      identifier,
      title: data.title ?? identifier,
      testMode: Boolean(data.test_mode),
      keys: phpJsonDecode<Record<string, string>>(data.keys, {}),
      currency: (await this.#settings.get('system_currency')) ?? 'USD',
    };
  }

  /** Builds the order from the CART. Prices are never taken from the client. */
  async createCheckout(userId: number, userEmail: string, gateway: string,
                       couponCode: string | undefined,
                       urls: { successUrl: string; cancelUrl: string }): Promise<CheckoutResult> {
    const config = await this.#gatewayConfig(gateway);
    const cart = await this.#cart.summary(userId, couponCode);
    if (cart.items.length === 0) throw new HttpError(422, 'Your cart is empty.');

    const taxRate = Number((await this.#settings.get('tax')) ?? 0);
    const totals = computeTotals(cart.subtotal, cart.discount, taxRate);
    if (totals.total <= 0) throw new HttpError(422, 'Payable amount cannot be less than 1');

    const items = cart.items.map((i) => ({
      course_id: Number(i.id),
      title: String(i.title ?? 'Course'),
      price: Number(i.effective_price ?? 0),
    }));

    const reference = signOrder({
      userId, gateway, items,
      subtotal: totals.subtotal, discount: totals.discount,
      tax: totals.tax, taxRate: totals.taxRate, total: totals.total,
      currency: config.currency, couponCode: cart.coupon?.code ?? null,
    }, this.#secret);

    const order: CheckoutOrder = {
      reference, userId, userEmail, items,
      subtotal: totals.subtotal, discount: totals.discount,
      tax: totals.tax, total: totals.total, currency: config.currency,
      successUrl: urls.successUrl, cancelUrl: urls.cancelUrl,
    };

    const session = await getProvider(gateway).createCheckout(order, config);
    return {
      reference,
      redirectUrl: session.redirectUrl,
      providerRef: session.providerRef,
      ...(session.clientPayload ? { clientPayload: session.clientPayload } : {}),
      total: totals.total,
      currency: config.currency,
    };
  }

  /** Confirms with the provider, then fulfils exactly once. */
  async completeCheckout(reference: string, providerRef: string,
                         query?: Record<string, string>): Promise<FulfilResult> {
    const order = readOrder(reference, this.#secret);
    if (!order) throw new HttpError(422, 'This payment reference is invalid or has expired.');

    const already = await this.existingFulfilment(reference);
    if (already) {
      return { status: 'paid', invoice: already, alreadyFulfilled: true,
               courseIds: order.items.map((i) => i.course_id) };
    }

    const config = await this.#gatewayConfig(order.gateway);
    const outcome = await getProvider(order.gateway).verify(reference, providerRef, config, query);
    if (outcome.status !== 'paid') {
      return outcome.status === 'failed'
        ? { status: 'failed', reason: outcome.reason }
        : { status: 'pending' };
    }
    return this.fulfil(order, reference, outcome.transaction);
  }

  /** Idempotency key: the reference is stored in payment_histories.session_id. */
  async existingFulfilment(reference: string): Promise<string | null> {
    /*
     * NOT `.maybeSingle()`, and the reason is the whole point of this method.
     *
     * `fulfil` writes ONE payment_histories row PER ITEM -- a two-course order
     * is two rows carrying the same session_id -- and nothing makes session_id
     * unique. PostgREST answers `.maybeSingle()` over more than one row with an
     * error, so on any multi-item order this read came back null and the guard
     * reported "not fulfilled yet" about an order that had been. A replayed
     * webhook or a re-opened return URL would then fulfil it a second time:
     * enrolled twice, charged into the ledger twice, the revenue split written
     * twice.
     *
     * Single-item orders worked, which is why it survived. The unit test double
     * returned the first of several rather than failing, which is why the tests
     * agreed.
     *
     * The invoice is the same on every row of one order, so the first is the
     * answer.
     */
    const { data } = await this.#db.from('payment_histories')
      .select('invoice').eq('session_id', referenceKey(reference)).limit(1);
    return (data ?? [])[0]?.invoice ?? null;
  }

  /**
   * Writes payment_histories, enrols, clears the cart.
   *
   * The per-item revenue split uses the ITEM's own net amount. Laravel computed
   * it inside the loop from `payable_amount` -- the whole order total -- so a
   * two-item cart booked the entire order value as revenue twice.
   */
  async fulfil(order: PendingOrder, reference: string,
               transaction: Record<string, unknown>): Promise<FulfilResult> {
    const invoice = randomInvoice();
    const now = new Date().toISOString();
    const sharePercent = Number((await this.#settings.get('instructor_revenue')) ?? 0);

    const prices = order.items.map((i) => i.price);
    const discountPerItem = allocateDiscount(prices, order.discount);
    const netPerItem = prices.map((p, i) => round2(p - discountPerItem[i]!));
    const taxPerItem = allocateDiscount(netPerItem, order.tax);

    const creators = await this.creatorRoles(order.items.map((i) => i.course_id));

    for (let i = 0; i < order.items.length; i++) {
      const item = order.items[i]!;
      const split = splitRevenue(netPerItem[i]!, sharePercent,
        creators.get(item.course_id) === 'admin');

      const { error } = await this.#db.from('payment_histories').insert({
        user_id: order.userId,
        course_id: item.course_id,
        payment_type: order.gateway,
        amount: item.price,
        admin_revenue: split.adminRevenue,
        instructor_revenue: split.instructorRevenue,
        tax: taxPerItem[i] ?? 0,
        coupon: order.couponCode,
        invoice,
        instructor_payment_status: 0,
        // transaction_id is varchar(255); keep the payload inside it.
        transaction_id: capped(phpJsonEncode(transaction), 255),
        session_id: referenceKey(reference),
        created_at: now,
        updated_at: now,
      });
      if (error) throw new HttpError(500, `Could not record the payment: ${error.message}`);

      await this.#enrollment.enroll(item.course_id, order.userId, 'paid');
      await this.#cart.remove(order.userId, item.course_id);
    }

    return { status: 'paid', invoice, courseIds: order.items.map((i) => i.course_id) };
  }

  async creatorRoles(courseIds: number[]): Promise<Map<number, string>> {
    const out = new Map<number, string>();
    if (!courseIds.length) return out;
    const { data: courses } = await this.#db.from('courses')
      .select('id, user_id').in('id', courseIds);
    const userIds = [...new Set((courses ?? []).map((c) => c.user_id).filter(Boolean))] as number[];
    if (!userIds.length) return out;
    const { data: users } = await this.#db.from('users').select('id, role').in('id', userIds);
    const roleById = new Map((users ?? []).map((u) => [u.id, u.role]));
    for (const c of courses ?? []) {
      out.set(c.id, roleById.get(c.user_id as number) ?? 'instructor');
    }
    return out;
  }

  /** Handles an out-of-band webhook. Same fulfilment path, same idempotency. */
  async handleWebhook(gateway: string, rawBody: string,
                      headers: Record<string, string | string[] | undefined>): Promise<FulfilResult> {
    const provider = getProvider(gateway);
    if (!provider.parseWebhook) return { status: 'pending' };

    const config = await this.#gatewayConfig(gateway);
    const parsed = await provider.parseWebhook({ rawBody, headers }, config);
    if (!parsed) return { status: 'pending' };

    const order = readOrder(parsed.reference, this.#secret);
    if (!order) return { status: 'failed', reason: 'Unknown or expired reference.' };

    const already = await this.existingFulfilment(parsed.reference);
    if (already) return { status: 'paid', invoice: already, alreadyFulfilled: true };

    if (parsed.outcome.status !== 'paid') return { status: parsed.outcome.status };
    return this.fulfil(order, parsed.reference, parsed.outcome.transaction);
  }

  /** PAY-06 -- one invoice covers the whole order. */
  async invoice(invoiceNumber: string, userId: number) {
    const { data } = await this.#db.from('payment_histories')
      .select('id, user_id, course_id, payment_type, amount, tax, coupon, invoice, created_at')
      .eq('invoice', invoiceNumber);
    const rows = data ?? [];
    if (!rows.length) throw new HttpError(404, 'Invoice not found.');
    if (rows.some((r) => r.user_id !== userId)) {
      throw new HttpError(403, 'This action is unauthorized.');
    }

    const courseIds = rows.map((r) => r.course_id).filter(Boolean) as number[];
    const { data: courses } = await this.#db.from('courses')
      .select('id, title, slug').in('id', courseIds);
    const byId = new Map((courses ?? []).map((c) => [c.id, c]));

    const subtotal = round2(rows.reduce((s, r) => s + Number(r.amount ?? 0), 0));
    const tax = round2(rows.reduce((s, r) => s + Number(r.tax ?? 0), 0));

    return {
      invoice: invoiceNumber,
      issued_at: rows[0]!.created_at,
      payment_type: rows[0]!.payment_type,
      coupon: rows[0]!.coupon,
      items: rows.map((r) => ({
        course: byId.get(r.course_id as number) ?? null,
        amount: Number(r.amount ?? 0),
        tax: Number(r.tax ?? 0),
      })),
      subtotal, tax, total: round2(subtotal + tax),
    };
  }

  async purchaseHistory(userId: number) {
    const { data } = await this.#db.from('payment_histories')
      .select('id, course_id, payment_type, amount, tax, coupon, invoice, created_at')
      .eq('user_id', userId).order('id', { ascending: false });
    const rows = data ?? [];
    const courseIds = [...new Set(rows.map((r) => r.course_id).filter(Boolean))] as number[];
    const { data: courses } = courseIds.length
      ? await this.#db.from('courses').select('id, title, slug').in('id', courseIds)
      : { data: [] };
    const byId = new Map((courses ?? []).map((c) => [c.id, c]));
    return rows.map((r) => ({ ...r, course: byId.get(r.course_id as number) ?? null }));
  }
}
