/**
 * PAY-02 -- Stripe.
 *
 * Uses the REST API over fetch rather than the SDK: one less dependency, and
 * the two things that actually matter -- idempotency keys and webhook signature
 * verification -- are explicit rather than hidden.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import type {
  PaymentProvider, GatewayConfig, CheckoutOrder, CheckoutSession,
  PaymentOutcome, WebhookRequest,
} from '../provider.ts';
import { pickKey } from '../provider.ts';
import { toMinorUnits } from '../money.ts';

const API = 'https://api.stripe.com/v1';

async function stripeCall(
  path: string, secret: string, body?: Record<string, string>, idempotencyKey?: string,
): Promise<Record<string, unknown>> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${secret}`,
    'Content-Type': 'application/x-www-form-urlencoded',
  };
  // Retrying a checkout must never create a second charge.
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;

  const res = await fetch(API + path, {
    method: body ? 'POST' : 'GET',
    headers,
    body: body ? new URLSearchParams(body).toString() : undefined,
  });
  const json = (await res.json()) as Record<string, unknown>;
  if (!res.ok) {
    const err = json.error as { message?: string } | undefined;
    throw new Error(`Stripe ${path} failed: ${err?.message ?? res.status}`);
  }
  return json;
}

export const stripeProvider: PaymentProvider = {
  identifier: 'stripe',

  async createCheckout(order: CheckoutOrder, config: GatewayConfig): Promise<CheckoutSession> {
    const secret = pickKey(config, 'stripe_secret') || pickKey(config, 'secret_key');
    if (!secret) throw new Error('Stripe secret key is not configured.');

    const form: Record<string, string> = {
      mode: 'payment',
      success_url: `${order.successUrl}?reference=${order.reference}&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: order.cancelUrl,
      client_reference_id: order.reference,
      customer_email: order.userEmail,
      'metadata[reference]': order.reference,
      'metadata[user_id]': String(order.userId),
    };

    // One line item per course, then discount and tax as their own lines, so
    // the Stripe receipt matches the invoice we store.
    order.items.forEach((item, i) => {
      form[`line_items[${i}][price_data][currency]`] = order.currency.toLowerCase();
      form[`line_items[${i}][price_data][product_data][name]`] = item.title;
      form[`line_items[${i}][price_data][unit_amount]`] =
        String(toMinorUnits(item.price, order.currency));
      form[`line_items[${i}][quantity]`] = '1';
    });

    let next = order.items.length;
    if (order.tax > 0) {
      form[`line_items[${next}][price_data][currency]`] = order.currency.toLowerCase();
      form[`line_items[${next}][price_data][product_data][name]`] = 'Tax';
      form[`line_items[${next}][price_data][unit_amount]`] =
        String(toMinorUnits(order.tax, order.currency));
      form[`line_items[${next}][quantity]`] = '1';
      next += 1;
    }
    if (order.discount > 0) {
      // Stripe rejects negative line items, so the discount rides as a coupon.
      const coupon = await stripeCall('/coupons', secret, {
        amount_off: String(toMinorUnits(order.discount, order.currency)),
        currency: order.currency.toLowerCase(),
        duration: 'once',
      }, `coupon-${order.reference}`);
      form['discounts[0][coupon]'] = String(coupon.id);
    }

    const session = await stripeCall('/checkout/sessions', secret, form, order.reference);
    return {
      redirectUrl: String(session.url),
      providerRef: String(session.id),
    };
  },

  async verify(reference, providerRef, config): Promise<PaymentOutcome> {
    const secret = pickKey(config, 'stripe_secret') || pickKey(config, 'secret_key');
    const session = await stripeCall(`/checkout/sessions/${providerRef}`, secret);

    // Never trust the redirect alone: confirm the session belongs to this order.
    if (String(session.client_reference_id ?? '') !== reference) {
      return { status: 'failed', reason: 'Session does not match this order.' };
    }
    if (session.payment_status === 'paid') {
      return {
        status: 'paid',
        providerRef,
        transaction: {
          session_id: providerRef,
          payment_intent: session.payment_intent ?? null,
          amount_total: session.amount_total ?? null,
          currency: session.currency ?? null,
        },
      };
    }
    if (session.status === 'open') return { status: 'pending', providerRef };
    return { status: 'failed', reason: `Stripe payment_status=${session.payment_status}` };
  },

  async parseWebhook(req: WebhookRequest, config: GatewayConfig) {
    const signingSecret = pickKey(config, 'stripe_webhook_secret')
      || pickKey(config, 'webhook_secret');
    if (!signingSecret) return null;

    const header = req.headers['stripe-signature'];
    const sig = Array.isArray(header) ? header[0] : header;
    if (!sig || !verifyStripeSignature(req.rawBody, sig, signingSecret)) {
      throw new Error('Invalid Stripe webhook signature.');
    }

    const event = JSON.parse(req.rawBody) as { type: string; data: { object: Record<string, unknown> } };
    if (event.type !== 'checkout.session.completed') return null;

    const session = event.data.object;
    const reference = String(session.client_reference_id ?? '');
    if (!reference) return null;

    return {
      reference,
      outcome: session.payment_status === 'paid'
        ? {
            status: 'paid' as const,
            providerRef: String(session.id),
            transaction: { session_id: session.id, payment_intent: session.payment_intent ?? null },
          }
        : { status: 'pending' as const, providerRef: String(session.id) },
    };
  },
};

/**
 * Stripe signs `timestamp.payload` with HMAC-SHA256 and sends
 * `t=<ts>,v1=<sig>`. The timestamp window is what stops a captured webhook
 * being replayed later.
 */
export function verifyStripeSignature(
  payload: string, header: string, secret: string, toleranceSeconds = 300,
): boolean {
  const parts = Object.fromEntries(
    header.split(',').map((p) => p.split('=', 2) as [string, string]));
  const timestamp = Number(parts.t);
  if (!Number.isFinite(timestamp)) return false;
  if (Math.abs(Date.now() / 1000 - timestamp) > toleranceSeconds) return false;

  const expected = createHmac('sha256', secret)
    .update(`${timestamp}.${payload}`).digest('hex');
  const given = parts.v1 ?? '';
  const a = Buffer.from(expected);
  const b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}
