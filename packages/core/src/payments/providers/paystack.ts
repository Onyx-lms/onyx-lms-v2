/**
 * PAY-08 -- Paystack.
 *
 * Initialise then verify: create a transaction, redirect, confirm server-side
 * on return. The redirect itself is never treated as proof of payment.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import type {
  PaymentProvider, GatewayConfig, CheckoutOrder, CheckoutSession,
  PaymentOutcome, WebhookRequest,
} from '../provider.ts';
import { pickKey } from '../provider.ts';
import { toMinorUnits } from '../money.ts';

export const paystackProvider: PaymentProvider = {
  identifier: 'paystack',

  async createCheckout(order: CheckoutOrder, config: GatewayConfig): Promise<CheckoutSession> {
    const secret = pickKey(config, 'paystack_secret') || pickKey(config, 'secret_key');
    if (!secret) throw new Error('Paystack secret key is not configured.');

    const res = await fetch('https://api.paystack.co/transaction/initialize', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + secret, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: order.userEmail,
        amount: toMinorUnits(order.total, order.currency),
        currency: order.currency.toUpperCase(),
        // Paystack restricts the reference charset and length.
        reference: order.reference.slice(0, 100).replace(/[^a-zA-Z0-9._=-]/g, ''),
        callback_url: order.successUrl + '?reference=' + order.reference + '&provider=paystack',
        metadata: { reference: order.reference, user_id: order.userId },
      }),
    });
    const json = (await res.json()) as { status?: boolean; message?: string;
      data?: { authorization_url: string; reference: string } };
    if (!res.ok || !json.status || !json.data) {
      throw new Error('Paystack initialise failed: ' + (json.message ?? res.status));
    }
    return { redirectUrl: json.data.authorization_url, providerRef: json.data.reference };
  },

  async verify(_reference, providerRef, config): Promise<PaymentOutcome> {
    const secret = pickKey(config, 'paystack_secret') || pickKey(config, 'secret_key');
    const res = await fetch(
      'https://api.paystack.co/transaction/verify/' + encodeURIComponent(providerRef),
      { headers: { Authorization: 'Bearer ' + secret } });
    const json = (await res.json()) as { data?: { status: string; amount: number } };
    if (!res.ok || !json.data) return { status: 'failed', reason: 'Paystack verification failed.' };

    if (json.data.status === 'success') {
      return { status: 'paid', providerRef,
               transaction: { reference: providerRef, amount: json.data.amount } };
    }
    return json.data.status === 'ongoing' || json.data.status === 'pending'
      ? { status: 'pending', providerRef }
      : { status: 'failed', reason: 'Paystack status=' + json.data.status };
  },

  async parseWebhook(req: WebhookRequest, config: GatewayConfig) {
    const secret = pickKey(config, 'paystack_secret') || pickKey(config, 'secret_key');
    if (!secret) return null;

    const header = req.headers['x-paystack-signature'];
    const sig = Array.isArray(header) ? header[0] : header;
    // Paystack signs the raw body with HMAC-SHA512 keyed on the SECRET key.
    const expected = createHmac('sha512', secret).update(req.rawBody).digest('hex');
    const a = Buffer.from(expected);
    const b = Buffer.from(sig ?? '');
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new Error('Invalid Paystack webhook signature.');
    }

    const event = JSON.parse(req.rawBody) as {
      event?: string;
      data?: { reference?: string; metadata?: { reference?: string } };
    };
    if (event.event !== 'charge.success') return null;
    const reference = event.data?.metadata?.reference ?? '';
    if (!reference) return null;

    return {
      reference,
      outcome: { status: 'paid' as const, providerRef: String(event.data?.reference ?? ''),
                 transaction: { reference: event.data?.reference ?? null } },
    };
  },
};
