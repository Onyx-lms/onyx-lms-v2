/**
 * PAY-04 -- Razorpay.
 *
 * Razorpay renders its own checkout widget in the browser, so createCheckout
 * returns the order payload rather than a redirect URL. Confirmation is a
 * signature check over `order_id|payment_id`, which the client cannot forge.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import type {
  PaymentProvider, GatewayConfig, CheckoutOrder, CheckoutSession,
  PaymentOutcome, WebhookRequest,
} from '../provider.ts';
import { pickKey } from '../provider.ts';
import { toMinorUnits } from '../money.ts';

const API = 'https://api.razorpay.com/v1';

function auth(config: GatewayConfig): { keyId: string; keySecret: string; basic: string } {
  const keyId = pickKey(config, 'razorpay_key') || pickKey(config, 'key_id');
  const keySecret = pickKey(config, 'razorpay_secret') || pickKey(config, 'key_secret');
  return {
    keyId, keySecret,
    basic: 'Basic ' + Buffer.from(`${keyId}:${keySecret}`).toString('base64'),
  };
}

export const razorpayProvider: PaymentProvider = {
  identifier: 'razorpay',

  async createCheckout(order: CheckoutOrder, config: GatewayConfig): Promise<CheckoutSession> {
    const { keyId, basic } = auth(config);
    if (!keyId) throw new Error('Razorpay key is not configured.');

    const res = await fetch(`${API}/orders`, {
      method: 'POST',
      headers: { Authorization: basic, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        amount: toMinorUnits(order.total, order.currency),
        currency: order.currency.toUpperCase(),
        // Razorpay caps receipt at 40 chars.
        receipt: order.reference.slice(0, 40),
        notes: { reference: order.reference, user_id: String(order.userId) },
      }),
    });
    const json = (await res.json()) as Record<string, unknown>;
    if (!res.ok) {
      const err = json.error as { description?: string } | undefined;
      throw new Error(`Razorpay order failed: ${err?.description ?? res.status}`);
    }

    return {
      // The widget opens client-side, so there is nowhere to redirect to.
      redirectUrl: `${order.successUrl}?reference=${order.reference}&provider=razorpay`,
      providerRef: String(json.id),
      clientPayload: {
        key: keyId,
        order_id: json.id,
        amount: json.amount,
        currency: json.currency,
        name: 'Onyx LMS',
        prefill: {
          email: order.userEmail,
          // Razorpay's own key for it. Absent rather than empty when there is
          // no number, because an empty string is a value their form treats as
          // one the buyer typed.
          ...(order.userPhone ? { contact: order.userPhone } : {}),
        },
      },
    };
  },

  async verify(reference, providerRef, config, query): Promise<PaymentOutcome> {
    const { keySecret, basic } = auth(config);
    const paymentId = query?.razorpay_payment_id;
    const signature = query?.razorpay_signature;

    // The browser hands back order_id, payment_id and a signature. Verify it
    // before trusting anything -- otherwise anyone can claim a paid order.
    if (paymentId && signature) {
      const expected = createHmac('sha256', keySecret)
        .update(`${providerRef}|${paymentId}`).digest('hex');
      const a = Buffer.from(expected);
      const b = Buffer.from(signature);
      if (a.length !== b.length || !timingSafeEqual(a, b)) {
        return { status: 'failed', reason: 'Razorpay signature mismatch.' };
      }
    }

    // Then confirm with Razorpay directly rather than relying on the client.
    const res = await fetch(`${API}/orders/${providerRef}`, { headers: { Authorization: basic } });
    const order = (await res.json()) as Record<string, unknown>;
    if (!res.ok) return { status: 'failed', reason: 'Could not read the Razorpay order.' };

    if (order.status === 'paid') {
      return {
        status: 'paid',
        providerRef,
        transaction: { order_id: providerRef, payment_id: paymentId ?? null, amount: order.amount },
      };
    }
    return order.status === 'created'
      ? { status: 'pending', providerRef }
      : { status: 'failed', reason: `Razorpay order status=${order.status}` };
  },

  async parseWebhook(req: WebhookRequest, config: GatewayConfig) {
    const secret = pickKey(config, 'razorpay_webhook_secret') || pickKey(config, 'webhook_secret');
    if (!secret) return null;

    const header = req.headers['x-razorpay-signature'];
    const sig = Array.isArray(header) ? header[0] : header;
    if (!sig) throw new Error('Missing Razorpay webhook signature.');

    const expected = createHmac('sha256', secret).update(req.rawBody).digest('hex');
    const a = Buffer.from(expected);
    const b = Buffer.from(sig);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new Error('Invalid Razorpay webhook signature.');
    }

    const event = JSON.parse(req.rawBody) as {
      event: string;
      payload?: { order?: { entity?: Record<string, unknown> };
                  payment?: { entity?: Record<string, unknown> } };
    };
    if (event.event !== 'order.paid' && event.event !== 'payment.captured') return null;

    const orderEntity = event.payload?.order?.entity ?? {};
    const paymentEntity = event.payload?.payment?.entity ?? {};
    const notes = (orderEntity.notes ?? paymentEntity.notes ?? {}) as Record<string, string>;
    const reference = notes.reference ?? '';
    if (!reference) return null;

    return {
      reference,
      outcome: {
        status: 'paid' as const,
        providerRef: String(orderEntity.id ?? paymentEntity.order_id ?? ''),
        transaction: { order_id: orderEntity.id ?? null, payment_id: paymentEntity.id ?? null },
      },
    };
  },
};
