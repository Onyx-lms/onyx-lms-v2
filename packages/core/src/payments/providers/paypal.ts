/**
 * PAY-03 -- PayPal (Orders v2).
 *
 * Two-step: create an order, redirect to approval, then CAPTURE on return.
 * Nothing is charged until the capture succeeds, so the redirect landing alone
 * must never be treated as payment.
 */
import type {
  PaymentProvider, GatewayConfig, CheckoutOrder, CheckoutSession,
  PaymentOutcome, WebhookRequest,
} from '../provider.ts';
import { pickKey } from '../provider.ts';
import { round2 } from '../money.ts';

const LIVE = 'https://api-m.paypal.com';
const SANDBOX = 'https://api-m.sandbox.paypal.com';

function baseUrl(config: GatewayConfig): string {
  return config.testMode ? SANDBOX : LIVE;
}

async function accessToken(config: GatewayConfig): Promise<string> {
  const clientId = pickKey(config, 'paypal_client_id') || pickKey(config, 'client_id');
  const secret = pickKey(config, 'paypal_secret') || pickKey(config, 'client_secret');
  if (!clientId || !secret) throw new Error('PayPal credentials are not configured.');

  const res = await fetch(`${baseUrl(config)}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${clientId}:${secret}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  const json = (await res.json()) as { access_token?: string; error_description?: string };
  if (!res.ok || !json.access_token) {
    throw new Error(`PayPal auth failed: ${json.error_description ?? res.status}`);
  }
  return json.access_token;
}

export const paypalProvider: PaymentProvider = {
  identifier: 'paypal',

  async createCheckout(order: CheckoutOrder, config: GatewayConfig): Promise<CheckoutSession> {
    const token = await accessToken(config);
    const currency = order.currency.toUpperCase();

    const res = await fetch(`${baseUrl(config)}/v2/checkout/orders`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        // Same reference twice must not create a second PayPal order.
        'PayPal-Request-Id': order.reference,
      },
      body: JSON.stringify({
        intent: 'CAPTURE',
        purchase_units: [{
          reference_id: order.reference,
          custom_id: order.reference,
          amount: {
            currency_code: currency,
            value: round2(order.total).toFixed(2),
            breakdown: {
              item_total: { currency_code: currency, value: round2(order.subtotal).toFixed(2) },
              discount: { currency_code: currency, value: round2(order.discount).toFixed(2) },
              tax_total: { currency_code: currency, value: round2(order.tax).toFixed(2) },
            },
          },
          items: order.items.map((i) => ({
            name: i.title.slice(0, 127),
            quantity: '1',
            unit_amount: { currency_code: currency, value: round2(i.price).toFixed(2) },
          })),
        }],
        application_context: {
          return_url: `${order.successUrl}?reference=${order.reference}&provider=paypal`,
          cancel_url: order.cancelUrl,
          user_action: 'PAY_NOW',
        },
      }),
    });

    const json = (await res.json()) as Record<string, unknown>;
    if (!res.ok) throw new Error(`PayPal order failed: ${JSON.stringify(json).slice(0, 200)}`);

    const links = (json.links ?? []) as { rel: string; href: string }[];
    const approve = links.find((l) => l.rel === 'approve' || l.rel === 'payer-action');
    if (!approve) throw new Error('PayPal did not return an approval link.');

    return { redirectUrl: approve.href, providerRef: String(json.id) };
  },

  async verify(reference, providerRef, config): Promise<PaymentOutcome> {
    const token = await accessToken(config);

    const res = await fetch(`${baseUrl(config)}/v2/checkout/orders/${providerRef}/capture`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        // Capture is the charge. Replaying the return URL must not double-bill.
        'PayPal-Request-Id': `capture-${reference}`,
      },
    });
    const json = (await res.json()) as Record<string, unknown>;

    // ORDER_ALREADY_CAPTURED means a previous attempt succeeded; read it back.
    if (!res.ok) {
      const name = String((json as { name?: string }).name ?? '');
      if (name === 'UNPROCESSABLE_ENTITY' || name === 'ORDER_ALREADY_CAPTURED') {
        const look = await fetch(`${baseUrl(config)}/v2/checkout/orders/${providerRef}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const existing = (await look.json()) as Record<string, unknown>;
        if (existing.status === 'COMPLETED') {
          return { status: 'paid', providerRef, transaction: { order_id: providerRef } };
        }
      }
      return { status: 'failed', reason: `PayPal capture failed: ${name || res.status}` };
    }

    const units = (json.purchase_units ?? []) as { reference_id?: string; custom_id?: string }[];
    const matches = units.some((u) => u.reference_id === reference || u.custom_id === reference);
    if (!matches) return { status: 'failed', reason: 'PayPal order does not match this reference.' };

    if (json.status === 'COMPLETED') {
      return { status: 'paid', providerRef, transaction: { order_id: providerRef, capture: json.id } };
    }
    return { status: 'pending', providerRef };
  },

  async parseWebhook(req: WebhookRequest) {
    // PayPal webhook verification requires a round trip to their verify
    // endpoint with the webhook id. Until that id is configured we do not
    // pretend to have verified anything -- the capture-on-return path is
    // authoritative and already confirms with PayPal directly.
    const event = JSON.parse(req.rawBody) as { event_type?: string; resource?: Record<string, unknown> };
    if (event.event_type !== 'CHECKOUT.ORDER.APPROVED') return null;
    return null;
  },
};
