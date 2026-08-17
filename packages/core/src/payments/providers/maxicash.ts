/**
 * PAY-12 -- MaxiCash.
 *
 * Hosted payentry page. MaxiCash takes the amount in CENTS as a string and
 * echoes `reference` back, which is how the return is matched to an order.
 */
import type {
  PaymentProvider, GatewayConfig, CheckoutOrder, CheckoutSession, PaymentOutcome,
} from '../provider.ts';
import { pickKey } from '../provider.ts';
import { toMinorUnits } from '../money.ts';

const host = (test: boolean) =>
  test ? 'https://api-testbed.maxicashapp.com' : 'https://api.maxicashapp.com';

export const maxicashProvider: PaymentProvider = {
  identifier: 'maxicash',

  async createCheckout(order: CheckoutOrder, config: GatewayConfig): Promise<CheckoutSession> {
    const merchantId = pickKey(config, 'maxicash_merchant_id') || pickKey(config, 'merchant_id');
    const merchantPassword = pickKey(config, 'maxicash_merchant_password')
      || pickKey(config, 'merchant_password');
    if (!merchantId || !merchantPassword) {
      throw new Error('MaxiCash credentials are not configured.');
    }

    // The hosted page is reached by form POST, so hand the client the fields
    // rather than a URL it can simply follow.
    return {
      redirectUrl: host(config.testMode) + '/payentry',
      providerRef: order.reference.slice(0, 64),
      clientPayload: {
        method: 'POST',
        action: host(config.testMode) + '/payentry',
        fields: {
          PayType: 'MaxiCash',
          Amount: String(toMinorUnits(order.total, order.currency)),
          Currency: order.currency.toUpperCase(),
          Telephone: '',
          Email: order.userEmail,
          MerchantID: merchantId,
          MerchantPassword: merchantPassword,
          Language: 'en',
          Reference: order.reference.slice(0, 64),
          accepturl: order.successUrl + '?reference=' + order.reference + '&provider=maxicash',
          cancelurl: order.cancelUrl,
          declineurl: order.cancelUrl,
        },
      },
    };
  },

  async verify(reference, providerRef, _config, query): Promise<PaymentOutcome> {
    // MaxiCash posts the outcome back on the accept URL.
    const status = (query?.Status ?? query?.status ?? '').toLowerCase();
    const echoed = query?.Reference ?? query?.reference;
    if (echoed && echoed !== reference) {
      return { status: 'failed', reason: 'MaxiCash response does not match this order.' };
    }
    if (status === 'success' || status === 'completed') {
      return { status: 'paid', providerRef, transaction: { reference: echoed ?? reference } };
    }
    if (!status) return { status: 'pending', providerRef };
    return { status: 'failed', reason: 'MaxiCash status=' + status };
  },
};
