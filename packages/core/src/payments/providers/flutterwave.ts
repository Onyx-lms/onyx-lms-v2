/**
 * PAY-09 -- Flutterwave.
 */
import { timingSafeEqual } from 'node:crypto';
import type {
  PaymentProvider, GatewayConfig, CheckoutOrder, CheckoutSession,
  PaymentOutcome, WebhookRequest,
} from '../provider.ts';
import { pickKey } from '../provider.ts';
import { round2 } from '../money.ts';

export const flutterwaveProvider: PaymentProvider = {
  identifier: 'flutterwave',

  async createCheckout(order: CheckoutOrder, config: GatewayConfig): Promise<CheckoutSession> {
    const secret = pickKey(config, 'flutterwave_secret') || pickKey(config, 'secret_key');
    if (!secret) throw new Error('Flutterwave secret key is not configured.');

    const txRef = order.reference.slice(0, 100);
    const res = await fetch('https://api.flutterwave.com/v3/payments', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + secret, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tx_ref: txRef,
        amount: round2(order.total),
        currency: order.currency.toUpperCase(),
        redirect_url: order.successUrl + '?reference=' + order.reference + '&provider=flutterwave',
        customer: { email: order.userEmail },
        meta: { reference: order.reference, user_id: order.userId },
      }),
    });
    const json = (await res.json()) as { message?: string; data?: { link: string } };
    if (!res.ok || !json.data?.link) {
      throw new Error('Flutterwave payment failed: ' + (json.message ?? res.status));
    }
    return { redirectUrl: json.data.link, providerRef: txRef };
  },

  async verify(_reference, providerRef, config, query): Promise<PaymentOutcome> {
    const secret = pickKey(config, 'flutterwave_secret') || pickKey(config, 'secret_key');
    // Flutterwave puts transaction_id on the redirect; verification keys on it.
    const transactionId = query?.transaction_id;
    if (!transactionId) return { status: 'pending', providerRef };

    const res = await fetch(
      'https://api.flutterwave.com/v3/transactions/' + encodeURIComponent(transactionId) + '/verify',
      { headers: { Authorization: 'Bearer ' + secret } });
    const json = (await res.json()) as { data?: { status: string; tx_ref: string } };
    if (!res.ok || !json.data) return { status: 'failed', reason: 'Flutterwave verification failed.' };

    if (json.data.status === 'successful') {
      return { status: 'paid', providerRef: json.data.tx_ref,
               transaction: { transaction_id: transactionId, tx_ref: json.data.tx_ref } };
    }
    return { status: 'failed', reason: 'Flutterwave status=' + json.data.status };
  },

  async parseWebhook(req: WebhookRequest, config: GatewayConfig) {
    const hash = pickKey(config, 'flutterwave_hash') || pickKey(config, 'secret_hash');
    if (!hash) return null;

    const header = req.headers['verif-hash'];
    const given = Array.isArray(header) ? header[0] : header;
    // Flutterwave sends the configured secret hash verbatim, not an HMAC.
    const a = Buffer.from(hash);
    const b = Buffer.from(given ?? '');
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new Error('Invalid Flutterwave webhook hash.');
    }

    const event = JSON.parse(req.rawBody) as {
      data?: { status?: string; tx_ref?: string; meta?: { reference?: string } };
    };
    if (event.data?.status !== 'successful') return null;
    const reference = event.data?.meta?.reference ?? event.data?.tx_ref ?? '';
    if (!reference) return null;

    return {
      reference,
      outcome: { status: 'paid' as const, providerRef: String(event.data?.tx_ref ?? ''),
                 transaction: { tx_ref: event.data?.tx_ref ?? null } },
    };
  },
};
