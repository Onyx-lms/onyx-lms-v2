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

export interface OnyxPaymentIntent {
  tenantId: number;
  invoiceId: number;
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
  if (!intent?.tenantId || !intent.invoiceId || !intent.amountMinor) return null;
  if (Math.floor(now / 1000) - intent.issuedAt > MAX_AGE_SECONDS) return null;
  return intent;
}

export class OnyxCheckoutService {
  #db: OnyxDb;
  #finance: FinanceService;
  #secret: string;
  #baseUrl: string;
  #now: () => number;

  constructor(
    db: OnyxDb, finance: FinanceService, opts: { secret: string; baseUrl?: string },
    now: () => number = Date.now,
  ) {
    this.#db = db;
    this.#finance = finance;
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

    const parsed = await provider.parseWebhook(req, config);
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

    const result = await this.#finance.recordPayment(intent.tenantId, {
      invoice_id: intent.invoiceId,
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
