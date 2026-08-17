/**
 * PAY-10 -- SSLCommerz.
 *
 * Form-encoded session API, then a validation call on return. SSLCommerz POSTs
 * back to the success URL, so val_id must be validated server-side before
 * anything is granted -- the POST body alone proves nothing.
 */
import type {
  PaymentProvider, GatewayConfig, CheckoutOrder, CheckoutSession, PaymentOutcome,
} from '../provider.ts';
import { pickKey } from '../provider.ts';
import { round2 } from '../money.ts';

const host = (test: boolean) =>
  test ? 'https://sandbox.sslcommerz.com' : 'https://securepay.sslcommerz.com';

export const sslcommerzProvider: PaymentProvider = {
  identifier: 'sslcommerz',

  async createCheckout(order: CheckoutOrder, config: GatewayConfig): Promise<CheckoutSession> {
    const storeId = pickKey(config, 'sslcommerz_store_id') || pickKey(config, 'store_id');
    const storePass = pickKey(config, 'sslcommerz_store_password') || pickKey(config, 'store_password');
    if (!storeId || !storePass) throw new Error('SSLCommerz credentials are not configured.');

    const form = new URLSearchParams({
      store_id: storeId,
      store_passwd: storePass,
      total_amount: String(round2(order.total)),
      currency: order.currency.toUpperCase(),
      tran_id: order.reference.slice(0, 30),
      success_url: order.successUrl + '?reference=' + order.reference + '&provider=sslcommerz',
      fail_url: order.cancelUrl,
      cancel_url: order.cancelUrl,
      cus_email: order.userEmail,
      cus_name: 'Customer',
      cus_phone: 'N/A',
      product_name: order.items.map((i) => i.title).join(', ').slice(0, 255),
      product_category: 'course',
      product_profile: 'non-physical-goods',
      value_a: order.reference,
    });

    const res = await fetch(host(config.testMode) + '/gwprocess/v3/api.php', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    });
    const json = (await res.json()) as
      { status?: string; GatewayPageURL?: string; failedreason?: string; sessionkey?: string };
    if (json.status !== 'SUCCESS' || !json.GatewayPageURL) {
      throw new Error('SSLCommerz session failed: ' + (json.failedreason ?? json.status));
    }
    return { redirectUrl: json.GatewayPageURL, providerRef: String(json.sessionkey ?? '') };
  },

  async verify(reference, providerRef, config, query): Promise<PaymentOutcome> {
    const storeId = pickKey(config, 'sslcommerz_store_id') || pickKey(config, 'store_id');
    const storePass = pickKey(config, 'sslcommerz_store_password') || pickKey(config, 'store_password');

    const valId = query?.val_id;
    if (!valId) return { status: 'pending', providerRef };

    const url = host(config.testMode) + '/validator/api/validationserverAPI.php'
      + '?val_id=' + encodeURIComponent(valId)
      + '&store_id=' + encodeURIComponent(storeId)
      + '&store_passwd=' + encodeURIComponent(storePass)
      + '&format=json';
    const res = await fetch(url);
    const json = (await res.json()) as { status?: string; value_a?: string; tran_id?: string };
    if (!res.ok) return { status: 'failed', reason: 'SSLCommerz validation failed.' };

    // The gateway echoes our reference in value_a; a mismatch is not our order.
    if (json.value_a && json.value_a !== reference) {
      return { status: 'failed', reason: 'SSLCommerz response does not match this order.' };
    }
    if (json.status === 'VALID' || json.status === 'VALIDATED') {
      return { status: 'paid', providerRef, transaction: { val_id: valId, tran_id: json.tran_id } };
    }
    return { status: 'failed', reason: 'SSLCommerz status=' + json.status };
  },
};
