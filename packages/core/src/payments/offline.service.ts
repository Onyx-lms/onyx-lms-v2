/**
 * PAY-15 -- offline / manual bank payments.
 *
 * A student submits proof of a bank transfer; an admin accepts or declines it.
 * Accepting runs the SAME fulfilment path as a card payment, so revenue split,
 * invoicing and enrolment cannot drift between the two routes.
 *
 * status: 0 = pending, 1 = accepted, 2 = declined (Laravel's convention).
 */
import type { Db } from '../db/client.ts';
import { HttpError } from '../http/errors.ts';
import { phpJsonEncode, phpJsonDecode } from '../json/php-json.ts';
import type { SettingsService } from '../settings/settings.service.ts';
import type { CartService } from '../enrollment/cart.service.ts';
import type { PaymentService } from './payment.service.ts';
import { computeTotals } from './money.ts';
import { signOrder } from './order-token.ts';
import { bootcampPrice, type BootcampPurchaseService } from '../bootcamp/purchase.service.ts';
import type { TeamMemberService } from '../team/team-member.service.ts';

export const OFFLINE_PENDING = 0;
export const OFFLINE_ACCEPTED = 1;
export const OFFLINE_DECLINED = 2;

export interface OfflineSubmission {
  phone_on?: string | null;
  bank_no?: string | null;
  doc?: string | null;
  coupon?: string | null;
}

export class OfflinePaymentService {
  #db: Db;
  #settings: SettingsService;
  #cart: CartService;
  #payments: PaymentService;
  #secret: string;

  // Optional so the course path keeps working without the bootcamp module.
  #bootcampPurchases: BootcampPurchaseService | null = null;
  #teamMembers: TeamMemberService | null = null;

  constructor(db: Db, settings: SettingsService, cart: CartService,
              payments: PaymentService, secret = process.env.SUPABASE_JWT_SECRET ?? '',
              bootcampPurchases?: BootcampPurchaseService,
              teamMembers?: TeamMemberService) {
    this.#db = db;
    this.#settings = settings;
    this.#cart = cart;
    this.#payments = payments;
    this.#secret = secret;
    this.#bootcampPurchases = bootcampPurchases ?? null;
    this.#teamMembers = teamMembers ?? null;
  }

  /** Snapshots the cart into a pending request. Amounts come from the server. */
  async submit(userId: number, input: OfflineSubmission) {
    const cart = await this.#cart.summary(userId, input.coupon ?? undefined);
    if (cart.items.length === 0) throw new HttpError(422, 'Your cart is empty.');

    const taxRate = Number((await this.#settings.get('tax')) ?? 0);
    const totals = computeTotals(cart.subtotal, cart.discount, taxRate);

    const { data: existing } = await this.#db.from('offline_payments')
      .select('id').eq('user_id', userId).eq('status', OFFLINE_PENDING).maybeSingle();
    if (existing) {
      throw new HttpError(422, 'You already have a payment awaiting review.');
    }

    const now = new Date().toISOString();
    const { data, error } = await this.#db.from('offline_payments').insert({
      user_id: userId,
      // items is varchar(255): a JSON array of ids fits, a fuller snapshot would not.
      items: phpJsonEncode(cart.items.map((i) => Number(i.id))),
      item_type: 'course',
      tax: totals.tax,
      total_amount: totals.subtotal,
      payable_amount: totals.total,
      coupon: input.coupon ?? null,
      phone_on: input.phone_on ?? null,
      bank_no: input.bank_no ?? null,
      doc: input.doc ?? null,
      status: OFFLINE_PENDING,
      created_at: now,
      updated_at: now,
    }).select('id, status, payable_amount').maybeSingle();
    if (error) throw new HttpError(500, `Could not submit the payment: ${error.message}`);
    return data;
  }

  /**
   * BC-06 -- the paid workshop path. Laravel's BootcampPurchaseController wrote
   * an offline_payments row with item_type 'bootcamp' and the bootcamp id in
   * `items`, so that is what this does. Approval is handled by accept().
   */
  async submitBootcamp(userId: number, bootcampId: number, input: OfflineSubmission) {
    // Both parameters are numbers, so a swapped call site type-checks fine.
    // The 404 below is what catches it; the e2e test is what noticed.
    const { data: bootcamp } = await this.#db.from('bootcamps')
      .select('id, user_id, is_paid, price, discount_flag, discounted_price, status')
      .eq('id', bootcampId).maybeSingle();
    if (!bootcamp || bootcamp.status !== 1) throw new HttpError(404, 'Workshop not found.');
    if (Number(bootcamp.user_id) === userId) throw new HttpError(422, 'You own this item.');
    if (!bootcamp.is_paid) throw new HttpError(422, 'This workshop is free -- just enrol.');

    // Already owned. Laravel checked is_purchased_bootcamp() before building the
    // payment; without it a second request is accepted here and only fails
    // later, when an admin tries to approve it.
    if (await this.#bootcampPurchases?.hasPurchased(bootcampId, userId)) {
      throw new HttpError(422, 'Item is already purchased.');
    }

    const { data: existing } = await this.#db.from('offline_payments')
      .select('id').eq('user_id', userId).eq('status', OFFLINE_PENDING).maybeSingle();
    if (existing) throw new HttpError(422, 'Your request is in process.');

    // discounted_price is the amount OFF for a workshop, not the final price.
    const amount = bootcampPrice(bootcamp as never);
    const taxRate = Number((await this.#settings.get('tax')) ?? 0);
    const totals = computeTotals(amount, 0, taxRate);

    const now = new Date().toISOString();
    const { data, error } = await this.#db.from('offline_payments').insert({
      user_id: userId,
      items: phpJsonEncode([bootcampId]),
      item_type: 'bootcamp',
      tax: totals.tax,
      total_amount: totals.subtotal,
      payable_amount: totals.total,
      coupon: null,
      phone_on: input.phone_on ?? null,
      bank_no: input.bank_no ?? null,
      doc: input.doc ?? null,
      status: OFFLINE_PENDING,
      created_at: now, updated_at: now,
    }).select('id, status, payable_amount').maybeSingle();
    if (error) throw new HttpError(500, 'Could not submit the payment: ' + error.message);
    return data;
  }

  /**
   * TP-03 -- the paid classroom path, the same shape as submitBootcamp().
   * Laravel wrote item_type 'team_package' with the package id in `items`.
   */
  async submitTeamPackage(userId: number, packageId: number, input: OfflineSubmission) {
    if (!this.#teamMembers) {
      throw new HttpError(500, 'Classroom payments are not configured on this server.');
    }
    const { data: pkg } = await this.#db.from('team_training_packages')
      .select('id, user_id, pricing_type, price, status').eq('id', packageId).maybeSingle();
    if (!pkg || pkg.status !== 1) throw new HttpError(404, 'Package not found.');
    if (Number(pkg.user_id) === userId) throw new HttpError(422, 'You own this item.');
    if (pkg.pricing_type !== 1) throw new HttpError(422, 'This package is free -- just claim it.');
    if (await this.#teamMembers.hasPurchased(packageId, userId)) {
      throw new HttpError(422, 'Item is already purchased.');
    }

    const { data: existing } = await this.#db.from('offline_payments')
      .select('id').eq('user_id', userId).eq('status', OFFLINE_PENDING).maybeSingle();
    if (existing) throw new HttpError(422, 'Your request is in process.');

    const taxRate = Number((await this.#settings.get('tax')) ?? 0);
    const totals = computeTotals(Number(pkg.price ?? 0), 0, taxRate);

    const now = new Date().toISOString();
    const { data, error } = await this.#db.from('offline_payments').insert({
      user_id: userId,
      items: phpJsonEncode([packageId]),
      item_type: 'team_package',
      tax: totals.tax,
      total_amount: totals.subtotal,
      payable_amount: totals.total,
      coupon: null,
      phone_on: input.phone_on ?? null,
      bank_no: input.bank_no ?? null,
      doc: input.doc ?? null,
      status: OFFLINE_PENDING,
      created_at: now, updated_at: now,
    }).select('id, status, payable_amount').maybeSingle();
    if (error) throw new HttpError(500, 'Could not submit the payment: ' + error.message);
    return data;
  }

  async list(status?: number) {
    let query = this.#db.from('offline_payments')
      .select('id, user_id, items, item_type, tax, total_amount, payable_amount, coupon, phone_on, bank_no, doc, status, created_at')
      .order('id', { ascending: false });
    if (status !== undefined) query = query.eq('status', status);
    const { data } = await query;
    const rows = data ?? [];

    const userIds = [...new Set(rows.map((r) => r.user_id).filter(Boolean))] as number[];
    const { data: users } = userIds.length
      ? await this.#db.from('users').select('id, name, email').in('id', userIds)
      : { data: [] };
    const byId = new Map((users ?? []).map((u) => [u.id, u]));

    return rows.map((r) => ({
      ...r,
      course_ids: phpJsonDecode<number[]>(r.items, []),
      user: byId.get(r.user_id as number) ?? null,
    }));
  }

  async mine(userId: number) {
    const { data } = await this.#db.from('offline_payments')
      .select('id, payable_amount, status, coupon, created_at')
      .eq('user_id', userId).order('id', { ascending: false });
    return data ?? [];
  }

  /** Accepting fulfils through PaymentService, so the books stay consistent. */
  async accept(id: number) {
    const { data: request } = await this.#db.from('offline_payments')
      .select('id, user_id, items, item_type, tax, total_amount, payable_amount, coupon, status')
      .eq('id', id).maybeSingle();
    if (!request) throw new HttpError(404, 'Data not found.');
    if (request.status !== OFFLINE_PENDING) {
      throw new HttpError(422, 'This payment has already been reviewed.');
    }

    // Neither a workshop nor a classroom is a cart of courses, so each
    // fulfils down its own path.
    if (request.item_type === 'bootcamp') {
      return this.#acceptBootcamp(id, request as never);
    }
    if (request.item_type === 'team_package') {
      return this.#acceptTeamPackage(id, request as never);
    }

    const courseIds = phpJsonDecode<number[]>(request.items, []);
    if (!courseIds.length) throw new HttpError(422, 'This request has no courses on it.');

    const { data: courses } = await this.#db.from('courses')
      .select('id, title, price, is_paid, discount_flag, discounted_price').in('id', courseIds);

    const items = (courses ?? []).map((c) => ({
      course_id: c.id,
      title: String(c.title ?? 'Course'),
      // Re-read the price now rather than trusting a snapshot from weeks ago.
      price: c.discount_flag && c.discounted_price != null
        ? Number(c.discounted_price) : Number(c.price ?? 0),
    }));

    const subtotal = items.reduce((s, i) => s + i.price, 0);
    const discount = Math.max(0, subtotal - Number(request.total_amount ?? subtotal));

    const order = {
      userId: request.user_id as number,
      gateway: 'offline',
      items,
      subtotal,
      discount,
      tax: Number(request.tax ?? 0),
      taxRate: 0,
      total: Number(request.payable_amount ?? subtotal),
      currency: (await this.#settings.get('system_currency')) ?? 'USD',
      couponCode: request.coupon ?? null,
    };
    const reference = signOrder(order, this.#secret);

    const already = await this.#payments.existingFulfilment(reference);
    if (already) {
      await this.#setStatus(id, OFFLINE_ACCEPTED);
      return { status: 'paid' as const, invoice: already, alreadyFulfilled: true };
    }

    const result = await this.#payments.fulfil(
      { ...order, nonce: String(id), issuedAt: Math.floor(Date.now() / 1000) },
      reference, { offline_payment_id: id });
    await this.#setStatus(id, OFFLINE_ACCEPTED);
    return result;
  }

  async #acceptBootcamp(id: number, request: {
    user_id: number; items: string; payable_amount: number | null; tax: number | null;
  }) {
    if (!this.#bootcampPurchases) {
      throw new HttpError(500, 'Workshop payments are not configured on this server.');
    }
    const [bootcampId] = phpJsonDecode<number[]>(request.items, []);
    if (!bootcampId) throw new HttpError(422, 'This request has no workshop on it.');

    // Already fulfilled: accepting twice must not sell the workshop twice.
    if (await this.#bootcampPurchases.hasPurchased(bootcampId, request.user_id)) {
      await this.#setStatus(id, OFFLINE_ACCEPTED);
      return { status: 'paid' as const, invoice: null, alreadyFulfilled: true };
    }

    const invoice = '#' + this.#bootcampPurchases.newInvoice();
    await this.#bootcampPurchases.record({
      bootcampId,
      userId: request.user_id,
      invoice,
      price: Number(request.payable_amount ?? 0),
      tax: Number(request.tax ?? 0),
      paymentMethod: 'offline',
    });
    await this.#setStatus(id, OFFLINE_ACCEPTED);
    return { status: 'paid' as const, invoice, alreadyFulfilled: false };
  }

  async #acceptTeamPackage(id: number, request: {
    user_id: number; items: string; payable_amount: number | null; tax: number | null;
  }) {
    if (!this.#teamMembers || !this.#bootcampPurchases) {
      throw new HttpError(500, 'Classroom payments are not configured on this server.');
    }
    const [packageId] = phpJsonDecode<number[]>(request.items, []);
    if (!packageId) throw new HttpError(422, 'This request has no package on it.');

    // Accepting twice must not sell the same classroom twice.
    if (await this.#teamMembers.hasPurchased(packageId, request.user_id)) {
      await this.#setStatus(id, OFFLINE_ACCEPTED);
      return { status: 'paid' as const, invoice: null, alreadyFulfilled: true };
    }

    const invoice = '#' + this.#bootcampPurchases.newInvoice();
    await this.#teamMembers.record({
      packageId,
      userId: request.user_id,
      invoice,
      price: Number(request.payable_amount ?? 0),
      tax: Number(request.tax ?? 0),
      paymentMethod: 'offline',
    });
    await this.#setStatus(id, OFFLINE_ACCEPTED);
    return { status: 'paid' as const, invoice, alreadyFulfilled: false };
  }

  async decline(id: number) {
    const { data } = await this.#db.from('offline_payments')
      .select('id, status').eq('id', id).maybeSingle();
    if (!data) throw new HttpError(404, 'Data not found.');
    if (data.status !== OFFLINE_PENDING) {
      throw new HttpError(422, 'This payment has already been reviewed.');
    }
    await this.#setStatus(id, OFFLINE_DECLINED);
  }

  async remove(id: number): Promise<void> {
    await this.#db.from('offline_payments').delete().eq('id', id);
  }

  async #setStatus(id: number, status: number): Promise<void> {
    await this.#db.from('offline_payments')
      .update({ status, updated_at: new Date().toISOString() }).eq('id', id);
  }
}
