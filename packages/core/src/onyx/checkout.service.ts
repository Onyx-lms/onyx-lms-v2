/**
 * CMP-03b -- paying an invoice online.
 *
 * "Gateway payment against invoices with idempotent fulfilment and
 * reconciliation reporting. Reuses the port's payment engine", against an
 * acceptance criterion of "a replayed webhook never double-credits an invoice".
 *
 * The ledger already satisfied that criterion and always did: `onyx_payments`
 * is UNIQUE on (tenant_id, gateway, reference), so a replay is a constraint
 * violation the service turns into a lookup. What did not exist was any way to
 * reach it -- no checkout, no webhook route, and a fees page a learner could
 * only read. This is that half.
 *
 * Three decisions carry the design.
 *
 * **The reference is the state.** A webhook arrives with no session, no cookie
 * and no token, so it cannot be tenant-scoped the way every other Onyx route
 * is -- and "read the tenant from the request body" is exactly the hole the
 * whole isolation model exists to prevent. Instead the reference we hand the
 * gateway is an HMAC-signed token carrying the tenant, the invoice, the payer
 * and the amount. What comes back either verifies against our secret or it is
 * not ours, and a forged one cannot name a tenant it was not issued for. This
 * is the same technique the port uses for its own checkout, for the same
 * reason.
 *
 * **The amount is ours, never the gateway's.** The token states what was owed
 * when checkout began, and settlement credits the amount the gateway confirms
 * only if it matches. A provider that reports a different figure is a
 * reconciliation problem for a human, not a number to write into a ledger.
 *
 * **Settlement is one path.** The redirect back and the webhook both end in
 * `settle()`, which calls `recordPayment` -- so the two racing (which they do,
 * routinely) is the replay case the unique constraint already handles, rather
 * than a second code path with its own idea of what "already paid" means.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { OnyxDb } from './db.ts';
import type { Role } from '@onyx/types';
import { HttpError } from '../http/errors.ts';
import type { AcademicsService } from './academics.service.ts';
import type { DomainsService } from './domains.service.ts';
import { increment } from './metrics.ts';
import {
  getProvider, hasProvider,
  type CheckoutOrder, type GatewayConfig, type PaymentOutcome, type WebhookRequest,
} from '../payments/provider.ts';
import type { FinanceService } from './finance.service.ts';

/**
 * A gateway row, credentials included.
 *
 * A literal rather than a concatenation: the database client infers the row's
 * shape from the string, and a computed one collapses it to an error type that
 * makes every field `unknown`. The credentials are stripped by whichever method
 * read them -- `gateways()` reduces `keys` to the names that are set, and
 * `#config()` hands them straight to a provider without them touching a
 * response.
 */
const GATEWAY_COLUMNS_WITH_KEYS =
  'id, tenant_id, identifier, title, currency, test_mode, status, created_at, updated_at, keys';

/** A gateway as an administrator sees it: configured, but never readable. */
export interface OnyxGatewaySummary {
  id: number;
  identifier: string;
  title: string;
  currency: string;
  test_mode: number;
  status: number;
  /** The names of the credentials that are set. Never a value. */
  configured_keys: string[];
}

/** A checkout older than this is stale, and its token stops verifying. */
const MAX_AGE_SECONDS = 60 * 60 * 2;

/**
 * What a signed reference settles.
 *
 * It was an invoice and only an invoice, because invoices were the only thing
 * Onyx charged for. A course sale writes to a different table -- migration
 * 0024's header explains why a course purchase is deliberately NOT run through
 * the fee ledger -- so the token had to learn to name its target.
 *
 * One token with a discriminator rather than a second sign/read pair. The HMAC
 * is the one piece of this system that must never have two implementations, and
 * a second reader would also force webhook() to decide which kind it held by
 * trying both and seeing which failed to parse.
 */
export type OnyxIntentKind = 'invoice' | 'course' | 'domain';

export interface OnyxPaymentIntent {
  tenantId: number;
  /** Absent on tokens written before course sales existed. See readIntent. */
  kind?: OnyxIntentKind;
  /** The invoice, or the course. */
  targetId: number;
  /**
   * Still written for invoice intents, and still read as a fallback.
   *
   * A token lives two hours. A deploy that stopped writing this would strand
   * every learner already mid-payment for that long, holding a reference this
   * build could no longer parse. It becomes dead weight two hours after the
   * first deploy that writes `targetId`, and deleting it then is one line
   * nobody has to coordinate.
   */
  invoiceId?: number;
  userId: string;
  gateway: string;
  amountMinor: number;
  currency: string;
  nonce: string;
  issuedAt: number;
}

/**
 * Signs an intent into the reference the gateway will echo back.
 *
 * Base64url with a detached HMAC, not encryption: none of this is secret, and
 * pretending otherwise would invite storing something that is. What the
 * signature buys is that the tenant and the amount cannot be edited in transit.
 */
export function signIntent(
  intent: Omit<OnyxPaymentIntent, 'nonce' | 'issuedAt'>, secret: string, now = Date.now(),
): string {
  const payload: OnyxPaymentIntent = {
    ...intent,
    nonce: randomBytes(9).toString('base64url'),
    issuedAt: Math.floor(now / 1000),
  };
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return body + '.' + createHmac('sha256', secret).update(body).digest('base64url');
}

/** Returns null for anything that is not a live token of ours. */
export function readIntent(
  reference: string, secret: string, now = Date.now(),
): OnyxPaymentIntent | null {
  const parts = (reference ?? '').split('.');
  if (parts.length !== 2) return null;
  const [body, sig] = parts as [string, string];

  const expected = Buffer.from(createHmac('sha256', secret).update(body).digest('base64url'));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;

  let intent: OnyxPaymentIntent;
  try {
    intent = JSON.parse(Buffer.from(body, 'base64url').toString()) as OnyxPaymentIntent;
  } catch {
    return null;
  }
  // A token from before course sales carries invoiceId and no targetId; one
  // written since carries both. Either shape must keep working.
  const targetId = intent?.targetId ?? intent?.invoiceId;
  if (!intent?.tenantId || !targetId || !intent.amountMinor) return null;
  intent.targetId = targetId;
  intent.kind = intent.kind ?? 'invoice';
  if (Math.floor(now / 1000) - intent.issuedAt > MAX_AGE_SECONDS) return null;
  return intent;
}

export class OnyxCheckoutService {
  #db: OnyxDb;
  #finance: FinanceService;
  #academics: AcademicsService | null = null;
  #domains: DomainsService | null = null;
  #secret: string;
  #baseUrl: string;
  #now: () => number;

  /**
   * `academics` is optional so every existing caller and test that builds this
   * with two collaborators keeps working. A deployment without it can still
   * settle invoices; a course sale asks for it and says so plainly if it is
   * missing, rather than failing somewhere further down.
   */
  constructor(
    db: OnyxDb, finance: FinanceService,
    opts: {
      secret: string; baseUrl?: string;
      academics?: AcademicsService; domains?: DomainsService;
    },
    now: () => number = Date.now,
  ) {
    this.#db = db;
    this.#finance = finance;
    this.#academics = opts.academics ?? null;
    this.#domains = opts.domains ?? null;
    this.#secret = opts.secret;
    this.#baseUrl = (opts.baseUrl ?? 'http://127.0.0.1:5173').replace(/\/+$/, '');
    this.#now = now;
  }

  // -------------------------------------------------------------------------
  // Gateway configuration -- the institution's own merchant account
  // -------------------------------------------------------------------------

  /** What an administrator sees. Never the keys, only whether they are set. */
  async gateways(tenantId: number): Promise<OnyxGatewaySummary[]> {
    const { data } = await this.#db.from('onyx_payment_gateways')
      .select(GATEWAY_COLUMNS_WITH_KEYS)
      .eq('tenant_id', tenantId).order('identifier');
    return (data ?? []).map((row) => {
      const r = row as unknown as Record<string, unknown> & { keys: Record<string, string> };
      return {
        id: Number(r.id),
        identifier: String(r.identifier),
        title: String(r.title),
        currency: String(r.currency),
        test_mode: Number(r.test_mode),
        status: Number(r.status),
        // The names of the credentials that are set, and not one value. An
        // administrator needs to know the live key is filled in; nobody needs
        // it read back to them, and a screen that can show it is a screen that
        // can leak it.
        configured_keys: Object.entries(r.keys ?? {})
          .filter(([, v]) => String(v ?? '').trim() !== '')
          .map(([k]) => k),
      };
    });
  }

  /** Only what a payer needs: which gateways they can actually pay through. */
  async enabledGateways(tenantId: number) {
    const { data } = await this.#db.from('onyx_payment_gateways')
      .select('identifier, title, currency').eq('tenant_id', tenantId).eq('status', 1)
      .order('identifier');
    return (data ?? []).filter((g) => hasProvider(String(g.identifier)));
  }

  async saveGateway(tenantId: number, input: {
    identifier: string; title?: string; keys?: Record<string, string>;
    currency?: string; test_mode?: boolean; status?: boolean;
  }) {
    const identifier = input.identifier.trim().toLowerCase();
    if (!hasProvider(identifier)) {
      throw new HttpError(422, 'There is no payment provider called "' + identifier + '".');
    }

    const { data: existing } = await this.#db.from('onyx_payment_gateways')
      .select('id, keys').eq('tenant_id', tenantId).eq('identifier', identifier).maybeSingle();

    // Merged, not replaced. An administrator editing the title should not have
    // to re-enter a secret key to avoid wiping it, and a form that submits
    // empty strings for the fields it did not show would do exactly that.
    const keys: Record<string, string> = { ...(existing?.keys ?? {}) };
    for (const [k, v] of Object.entries(input.keys ?? {})) {
      const value = String(v ?? '').trim();
      if (value) keys[k] = value;
    }

    const row = {
      tenant_id: tenantId,
      identifier,
      title: (input.title ?? identifier).trim(),
      keys: keys as never,
      currency: (input.currency ?? 'INR').trim().toUpperCase().slice(0, 3),
      test_mode: input.test_mode === false ? 0 : 1,
      status: input.status === false ? 0 : 1,
      updated_at: new Date(this.#now()).toISOString(),
    };

    if (existing) {
      await this.#db.from('onyx_payment_gateways').update(row).eq('id', Number(existing.id));
    } else {
      const { error } = await this.#db.from('onyx_payment_gateways').insert(row);
      if (error) throw new HttpError(500, 'Could not save the gateway: ' + error.message);
    }
    return (await this.gateways(tenantId)).find((g) => g.identifier === identifier)!;
  }

  // -------------------------------------------------------------------------
  // Checkout
  // -------------------------------------------------------------------------

  /**
   * Starts a payment for what is still owed on an invoice.
   *
   * The outstanding balance is computed here rather than taken from the
   * caller: a request that could name its own amount is a request that can pay
   * one rupee against a hundred-thousand-rupee invoice.
   */
  async begin(tenantId: number, invoiceId: number, viewer: { userId: string; role: Role }, input: {
    gateway: string; email?: string | null;
  }) {
    const invoice = await this.#finance.invoice(tenantId, invoiceId, viewer);
    if (invoice.status === 'void') throw new HttpError(409, 'That invoice has been voided.');

    const outstanding = Number(invoice.total_minor) - Number(invoice.paid_minor);
    if (outstanding <= 0) throw new HttpError(409, 'That invoice is already paid.');

    const config = await this.#config(tenantId, input.gateway);
    const provider = getProvider(config.identifier);

    const reference = signIntent({
      tenantId,
      kind: 'invoice',
      targetId: invoiceId,
      invoiceId,
      userId: String(invoice.user_id),
      gateway: config.identifier,
      amountMinor: outstanding,
      currency: String(invoice.currency),
    }, this.#secret, this.#now());

    // The port's providers speak major units and a course-shaped basket. An
    // invoice is one line as far as a gateway is concerned, so it is presented
    // as one -- `course_id: 0` is not a course, it is this contract's way of
    // saying "not a course sale", and nothing downstream reads it.
    const major = outstanding / 100;
    const order: CheckoutOrder = {
      reference,
      // CheckoutOrder is the port's own gateway-facing shape (still
      // bigint-keyed, out of scope for this migration) -- this is a display
      // value on the checkout page, not a claim compared against anything,
      // so a lossy cast here is acceptable in a way it would not be for the
      // OnyxPaymentIntent.userId above.
      userId: Number(invoice.user_id) || 0,
      userEmail: input.email ?? '',
      items: [{ course_id: 0, title: 'Invoice ' + invoice.number, price: major }],
      subtotal: major,
      discount: 0,
      tax: 0,
      total: major,
      currency: String(invoice.currency),
      // The reference travels back in the URL so the returning browser can ask
      // us to confirm. Not every provider posts a webhook -- `parseWebhook` is
      // optional in the contract -- and without this the redirect path would
      // have nothing to identify the payment it had just made.
      successUrl: this.#baseUrl + '/onyx/fees?paid=' + invoiceId
        + '&ref=' + encodeURIComponent(reference),
      cancelUrl: this.#baseUrl + '/onyx/fees?cancelled=' + invoiceId,
    };

    const session = await provider.createCheckout(order, config);
    return {
      reference,
      gateway: config.identifier,
      amount_minor: outstanding,
      currency: invoice.currency,
      redirect_url: session.redirectUrl,
      provider_ref: session.providerRef,
      client_payload: session.clientPayload ?? null,
    };
  }

  /**
   * Starts a payment for a locked course.
   *
   * The invoice twin of this computes what is owed rather than trusting the
   * caller, and the same rule applies harder here: the amount comes from the
   * course row, never from the request, or a nine-thousand-rupee course could
   * be bought for one.
   *
   * Everything it refuses, it refuses before signing anything -- an unpublished
   * course, a free one, and one the learner already owns. The last is not an
   * error the mock path has, because the mock is idempotent by construction;
   * here it matters, since sending somebody to a payment window for something
   * they have already bought is how you take money twice.
   */
  async beginCourse(tenantId: number, courseId: number, viewer: { userId: string }, input: {
    gateway: string; email?: string | null;
  }) {
    if (!this.#academics) {
      throw new HttpError(500, 'This deployment cannot sell a course.');
    }
    const course = await this.#academics.course(tenantId, courseId);
    if (Number(course.status) !== 1) throw new HttpError(403, 'This course is not open.');
    if (String(course.access) !== 'locked') {
      throw new HttpError(422, 'This course is not for sale -- it is free to start.');
    }
    const owned = await this.#academics.hasPurchased(tenantId, courseId, viewer.userId);
    if (owned) throw new HttpError(409, 'You already own this course.');

    const amountMinor = Number(course.price_minor);
    if (!amountMinor) throw new HttpError(422, 'This course has no price set.');

    const config = await this.#config(tenantId, input.gateway);
    const provider = getProvider(config.identifier);

    const reference = signIntent({
      tenantId,
      kind: 'course',
      targetId: courseId,
      userId: viewer.userId,
      gateway: config.identifier,
      amountMinor,
      currency: String(course.currency ?? 'INR'),
    }, this.#secret, this.#now());

    // The same minor-to-major seam begin() uses. The providers speak major
    // units and convert back themselves; a third convention here would be one
    // more place for a factor of a hundred to hide.
    const major = amountMinor / 100;
    const order: CheckoutOrder = {
      reference,
      userId: 0,
      userEmail: input.email ?? '',
      // A real course id at last: this field was built for one, and the invoice
      // path has always had to pass 0 to mean "not a course sale".
      items: [{ course_id: courseId, title: String(course.title), price: major }],
      subtotal: major,
      discount: 0,
      tax: 0,
      total: major,
      currency: String(course.currency ?? 'INR'),
      successUrl: this.#baseUrl + '/onyx/courses/' + courseId
        + '?paid=1&ref=' + encodeURIComponent(reference),
      cancelUrl: this.#baseUrl + '/onyx/courses/' + courseId + '?cancelled=1',
    };

    const session = await provider.createCheckout(order, config);
    return {
      reference,
      gateway: config.identifier,
      amount_minor: amountMinor,
      currency: String(course.currency ?? 'INR'),
      redirect_url: session.redirectUrl,
      provider_ref: session.providerRef,
      client_payload: session.clientPayload ?? null,
    };
  }

  /**
   * Starts a payment for a Live Class domain.
   *
   * The course twin of this refuses a course that is free, unpublished or
   * already owned, and the same three apply here for the same reasons. The
   * amount comes from the domain row and never from the request.
   *
   * What is different is what the payment BUYS: nothing, in the sense the rest
   * of this service means it. A domain has no outline to unlock -- settling
   * puts a name on a list an administrator reads and acts on off-product.
   * Migration 0030's header sets out why that is a registration rather than an
   * entitlement, and why the screen showing that list is half the feature.
   */
  async beginDomain(tenantId: number, domainId: number, viewer: { userId: string }, input: {
    gateway: string; email?: string | null;
  }) {
    if (!this.#domains) {
      throw new HttpError(500, 'This deployment cannot sell a Live Class.');
    }
    const domain = await this.#domains.domain(tenantId, domainId);
    if (Number(domain.status) !== 1) throw new HttpError(403, 'This is not open.');

    const already = await this.#domains.hasRegistered(tenantId, domainId, viewer.userId);
    if (already) throw new HttpError(409, 'You are already registered for this.');

    const amountMinor = Number(domain.price_minor);
    // A free domain never reaches a gateway. The route registers it directly,
    // and a zero-rupee order is a provider error rather than a purchase.
    if (!amountMinor) throw new HttpError(422, 'This one is free -- just register.');

    const config = await this.#config(tenantId, input.gateway);
    const provider = getProvider(config.identifier);

    const reference = signIntent({
      tenantId,
      kind: 'domain',
      targetId: domainId,
      userId: viewer.userId,
      gateway: config.identifier,
      amountMinor,
      currency: String(domain.currency ?? 'INR'),
    }, this.#secret, this.#now());

    // The same minor-to-major seam begin() and beginCourse() use. Providers
    // speak major units and convert back themselves; a third convention here
    // would be one more place for a factor of a hundred to hide.
    const major = amountMinor / 100;
    const order: CheckoutOrder = {
      reference,
      userId: 0,
      userEmail: input.email ?? '',
      // course_id is 0: this is not a course, and the field has meant "not a
      // course sale" with a zero since the invoice path was the only path.
      items: [{ course_id: 0, title: String(domain.title), price: major }],
      subtotal: major,
      discount: 0,
      tax: 0,
      total: major,
      currency: String(domain.currency ?? 'INR'),
      successUrl: this.#baseUrl + '/onyx/domains/' + domainId
        + '?paid=1&ref=' + encodeURIComponent(reference),
      cancelUrl: this.#baseUrl + '/onyx/domains/' + domainId + '?cancelled=1',
    };

    const session = await provider.createCheckout(order, config);
    return {
      reference,
      gateway: config.identifier,
      amount_minor: amountMinor,
      currency: String(domain.currency ?? 'INR'),
      redirect_url: session.redirectUrl,
      provider_ref: session.providerRef,
      client_payload: session.clientPayload ?? null,
    };
  }

  /**
   * The redirect back from the gateway.
   *
   * Asks the provider what actually happened rather than believing the query
   * string, because a browser that has just been to a payment page is the least
   * trustworthy narrator of whether it paid.
   */
  async confirm(
    reference: string, providerRef: string, query: Record<string, string> = {},
    caller?: { tenantId: number },
  ) {
    const intent = readIntent(reference, this.#secret, this.#now());
    if (!intent) throw new HttpError(422, 'That payment reference is not valid.');
    // A signed reference already names the invoice it settles, so a stranger
    // replaying one could not misdirect money -- but they have no business
    // touching another institution's ledger at all, and saying so here costs
    // one comparison.
    if (caller && caller.tenantId !== intent.tenantId) {
      throw new HttpError(404, 'That payment reference is not valid.');
    }

    const config = await this.#config(intent.tenantId, intent.gateway);
    const outcome = await getProvider(intent.gateway)
      .verify(reference, providerRef, config, query);
    return this.settle(intent, outcome);
  }

  /**
   * A webhook from the gateway.
   *
   * Returns `handled: false` rather than throwing when the body is not ours --
   * several providers post to a shared endpoint and a 500 would have them
   * retry something that will never succeed.
   */
  async webhook(gateway: string, req: WebhookRequest, tenantHint?: number) {
    const identifier = gateway.trim().toLowerCase();
    if (!hasProvider(identifier)) return { handled: false as const, reason: 'unknown_gateway' };
    const provider = getProvider(identifier);
    if (!provider.parseWebhook) return { handled: false as const, reason: 'no_webhook_support' };

    // A signature can only be checked against a tenant's own secret, and the
    // body has not been parsed yet -- so the reference in it is unavailable
    // until after verification, and verification needs the credentials. The way
    // out is the URL: the webhook a tenant registers with their provider
    // carries their tenant id, which selects the credentials to CHECK the
    // signature with. It grants nothing on its own -- a wrong or missing hint
    // simply fails to verify.
    const tenantId = tenantHint ?? null;
    if (!tenantId) return { handled: false as const, reason: 'no_tenant' };

    const config = await this.#config(tenantId, identifier).catch(() => null);
    if (!config) return { handled: false as const, reason: 'not_configured' };

    /*
     * A webhook that fails its signature check is refused, not thrown.
     *
     * Every other rejection on this path returns `handled: false` with a
     * reason, because the route above answers 200 either way and says why: a
     * gateway that receives an error RETRIES, and retrying is the wrong answer
     * to "I cannot verify this". `parseWebhook` was the one step that threw --
     * the Razorpay provider throws on a missing or invalid signature -- so an
     * unsigned request became a 500, and a gateway seeing 500s comes back
     * again, and again, on a schedule nobody here controls.
     *
     * Counted rather than merely swallowed. A handful of these is somebody
     * with a stale secret; a flood of them is somebody trying references
     * against a live endpoint, and the difference should be visible from
     * outside.
     */
    let parsed;
    try {
      parsed = await provider.parseWebhook(req, config);
    } catch {
      increment('onyx_payment_webhook_rejected_total', { gateway: identifier });
      return { handled: false as const, reason: 'bad_signature' };
    }
    if (!parsed) return { handled: false as const, reason: 'not_ours' };

    const intent = readIntent(parsed.reference, this.#secret, this.#now());
    if (!intent) return { handled: false as const, reason: 'bad_reference' };
    // The signed tenant wins over the URL. The hint chose which key verified
    // the signature; it does not get to decide whose ledger is credited.
    if (intent.tenantId !== tenantId) return { handled: false as const, reason: 'tenant_mismatch' };

    const settled = await this.settle(intent, parsed.outcome);
    return { handled: true as const, ...settled };
  }

  /**
   * Writes the outcome to the ledger. The only path that does.
   *
   * Idempotent because `recordPayment` is: the redirect and the webhook race
   * constantly, and the second one through finds the unique violation and
   * reports the original row instead of crediting again.
   */
  async settle(intent: OnyxPaymentIntent, outcome: PaymentOutcome) {
    if (outcome.status === 'failed') {
      // SCL-03: alert on any. A payment that fails silently is money a learner
      // believes they have paid.
      increment('onyx_payment_failures_total', { gateway: intent.gateway });
      return { status: 'failed' as const, reason: outcome.reason, payment: null, invoice: null };
    }
    if (outcome.status === 'pending') {
      return { status: 'pending' as const, payment: null, invoice: null };
    }

    if ((intent.kind ?? 'invoice') === 'course') return this.#settleCourse(intent, outcome);
    if (intent.kind === 'domain') return this.#settleDomain(intent, outcome);

    const result = await this.#finance.recordPayment(intent.tenantId, {
      invoice_id: Number(intent.invoiceId ?? intent.targetId),
      gateway: intent.gateway,
      // Keyed on the gateway's own transaction id, not on our reference: two
      // captures against one checkout are two payments, and a card retried
      // after a decline must not be silently swallowed as a replay.
      reference: outcome.providerRef,
      amount_minor: intent.amountMinor,
      method: 'online',
      raw: outcome.transaction,
      status: 'captured',
    });

    increment('onyx_payments_total',
      { gateway: intent.gateway, replayed: String(result.replayed) });
    return {
      status: 'captured' as const,
      replayed: result.replayed,
      payment: result.payment,
      invoice: result.invoice,
    };
  }

  /**
   * A captured course sale.
   *
   * Writes to onyx_course_purchases and raises no invoice. That is deliberate
   * and migration 0024's header gives the reason: a course bought outright is
   * not a debt anybody was in, and forcing it through the fee ledger would put
   * rows in an arrears report that nobody is in arrears on.
   *
   * Idempotent for the same reason the invoice branch is -- the redirect back
   * and the webhook race constantly, and whichever arrives second must find the
   * first one's row rather than charge again.
   */
  async #settleCourse(intent: OnyxPaymentIntent, outcome: PaymentOutcome) {
    if (outcome.status !== 'paid') {
      return { status: 'pending' as const, payment: null, invoice: null };
    }
    if (!this.#academics) {
      throw new HttpError(500, 'This deployment cannot settle a course purchase.');
    }

    const result = await this.#academics.recordPurchase(
      intent.tenantId, intent.targetId, intent.userId, {
        gateway: intent.gateway,
        // Keyed on the gateway's own transaction id, not on our reference, for
        // the reason the invoice branch gives: two captures against one
        // checkout are two payments.
        reference: outcome.providerRef,
        providerRef: outcome.providerRef,
        amountMinor: intent.amountMinor,
      });

    increment('onyx_payments_total',
      { gateway: intent.gateway, replayed: String(result.replayed) });
    return {
      status: 'captured' as const,
      replayed: result.replayed,
      purchase: result.purchase,
      payment: null,
      invoice: null,
    };
  }

  /**
   * A captured Live Class registration.
   *
   * Writes to onyx_domain_registrations and raises no invoice, for the reason
   * 0024's header gives about courses and 0030's repeats: this is not a debt
   * anybody was in, and forcing it through the fee ledger would put rows in an
   * arrears report nobody is in arrears on.
   */
  async #settleDomain(intent: OnyxPaymentIntent, outcome: PaymentOutcome) {
    if (outcome.status !== 'paid') {
      return { status: 'pending' as const, payment: null, invoice: null };
    }
    if (!this.#domains) {
      throw new HttpError(500, 'This deployment cannot settle a Live Class registration.');
    }

    const result = await this.#domains.register(
      intent.tenantId, intent.targetId, intent.userId, {
        gateway: intent.gateway,
        // Keyed on the gateway's own transaction id, not on our reference, for
        // the reason the invoice branch gives: two captures against one
        // checkout are two payments.
        reference: outcome.providerRef,
        providerRef: outcome.providerRef,
        amountMinor: intent.amountMinor,
      });

    increment('onyx_payments_total',
      { gateway: intent.gateway, replayed: String(result.replayed) });
    return {
      status: 'captured' as const,
      replayed: result.replayed,
      registration: result.registration,
      payment: null,
      invoice: null,
    };
  }

  // -------------------------------------------------------------------------

  /** Credentials for one gateway at one institution, in the provider's shape. */
  async #config(tenantId: number, identifier: string): Promise<GatewayConfig> {
    const key = identifier.trim().toLowerCase();
    const { data } = await this.#db.from('onyx_payment_gateways')
      .select(GATEWAY_COLUMNS_WITH_KEYS)
      .eq('tenant_id', tenantId).eq('identifier', key).maybeSingle();

    if (!data) throw new HttpError(422, 'This institution has not set up ' + key + '.');
    const row = data as unknown as Record<string, unknown> & { keys: Record<string, string> };
    if (Number(row.status) !== 1) throw new HttpError(422, key + ' is switched off here.');

    return {
      identifier: key,
      title: String(row.title),
      testMode: Number(row.test_mode) === 1,
      keys: row.keys ?? {},
      currency: String(row.currency),
    };
  }
}
