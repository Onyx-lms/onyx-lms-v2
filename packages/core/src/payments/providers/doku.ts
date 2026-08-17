/**
 * PAY-13 -- Doku.
 *
 * Doku signs requests with a hand-rolled scheme: a SHA-256 digest of the body,
 * then an HMAC-SHA256 over a canonical header block. The Laravel version built
 * this inline in the controller; here it is a function that can be tested.
 */
import { createHash, createHmac, timingSafeEqual, randomUUID } from 'node:crypto';
import type {
  PaymentProvider, GatewayConfig, CheckoutOrder, CheckoutSession,
  PaymentOutcome, WebhookRequest,
} from '../provider.ts';
import { pickKey } from '../provider.ts';
import { round2 } from '../money.ts';

const host = (test: boolean) =>
  test ? 'https://api-sandbox.doku.com' : 'https://api.doku.com';

export function dokuDigest(body: string): string {
  return createHash('sha256').update(body).digest('base64');
}

/** The canonical block Doku signs. Order and newlines are significant. */
export function dokuSignature(opts: {
  clientId: string; requestId: string; timestamp: string;
  targetPath: string; digest: string; secret: string;
}): string {
  const component = [
    'Client-Id:' + opts.clientId,
    'Request-Id:' + opts.requestId,
    'Request-Timestamp:' + opts.timestamp,
    'Request-Target:' + opts.targetPath,
    'Digest:' + opts.digest,
  ].join('\n');
  return 'HMACSHA256=' + createHmac('sha256', opts.secret).update(component).digest('base64');
}

export function dokuTimestamp(now = new Date()): string {
  return now.toISOString().slice(0, 19) + 'Z';
}

export const dokuProvider: PaymentProvider = {
  identifier: 'doku',

  async createCheckout(order: CheckoutOrder, config: GatewayConfig): Promise<CheckoutSession> {
    const clientId = pickKey(config, 'doku_client_id') || pickKey(config, 'client_id');
    const secret = pickKey(config, 'doku_secret') || pickKey(config, 'secret_key');
    if (!clientId || !secret) throw new Error('Doku credentials are not configured.');

    const targetPath = '/checkout/v1/payment';
    const body = JSON.stringify({
      order: {
        amount: round2(order.total),
        invoice_number: order.reference.slice(0, 64),
        currency: order.currency.toUpperCase(),
        callback_url: order.successUrl + '?reference=' + order.reference + '&provider=doku',
        line_items: order.items.map((i) => ({ name: i.title, price: round2(i.price), quantity: 1 })),
      },
      payment: { payment_due_date: 60 },
      customer: { id: 'CUST-' + order.userId, email: order.userEmail },
    });

    const requestId = randomUUID();
    const timestamp = dokuTimestamp();
    const digest = dokuDigest(body);

    const res = await fetch(host(config.testMode) + targetPath, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Client-Id': clientId,
        'Request-Id': requestId,
        'Request-Timestamp': timestamp,
        Signature: dokuSignature({ clientId, requestId, timestamp, targetPath, digest, secret }),
      },
      body,
    });
    const json = (await res.json()) as { response?: { payment?: { url?: string; token_id?: string } } };
    const url = json.response?.payment?.url;
    if (!res.ok || !url) throw new Error('Doku checkout failed: ' + res.status);
    return { redirectUrl: url, providerRef: String(json.response?.payment?.token_id ?? requestId) };
  },

  async verify(_reference, providerRef): Promise<PaymentOutcome> {
    // Doku confirms out of band via its notification callback, so the redirect
    // landing is only ever "pending" here. The webhook does the granting.
    return { status: 'pending', providerRef };
  },

  async parseWebhook(req: WebhookRequest, config: GatewayConfig) {
    const clientId = pickKey(config, 'doku_client_id') || pickKey(config, 'client_id');
    const secret = pickKey(config, 'doku_secret') || pickKey(config, 'secret_key');
    if (!clientId || !secret) return null;

    const header = (name: string) => {
      const v = req.headers[name];
      return String(Array.isArray(v) ? v[0] : (v ?? ''));
    };

    const expected = dokuSignature({
      clientId,
      requestId: header('request-id'),
      timestamp: header('request-timestamp'),
      targetPath: header('request-target') || '/payments/notifications',
      digest: dokuDigest(req.rawBody),
      secret,
    });
    const given = header('signature');
    const a = Buffer.from(expected);
    const b = Buffer.from(given);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new Error('Invalid Doku webhook signature.');
    }

    const event = JSON.parse(req.rawBody) as {
      transaction?: { status?: string };
      order?: { invoice_number?: string };
    };
    if (event.transaction?.status !== 'SUCCESS') return null;
    const reference = event.order?.invoice_number ?? '';
    if (!reference) return null;

    return {
      reference,
      outcome: { status: 'paid' as const, providerRef: reference,
                 transaction: { invoice_number: reference } },
    };
  },
};
