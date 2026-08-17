/**
 * PAY-11 -- Aamarpay.
 *
 * Form-post redirect, then a trxcheck lookup on return. The opt_a field carries
 * our reference so the callback can be tied back to an order.
 */
import type {
  PaymentProvider, GatewayConfig, CheckoutOrder, CheckoutSession, PaymentOutcome,
} from '../provider.ts';
import { pickKey } from '../provider.ts';
import { round2 } from '../money.ts';

const host = (test: boolean) =>
  test ? 'https://sandbox.aamarpay.com' : 'https://secure.aamarpay.com';

export const aamarpayProvider: PaymentProvider = {
  identifier: 'aamarpay',

  async createCheckout(order: CheckoutOrder, config: GatewayConfig): Promise<CheckoutSession> {
    const storeId = pickKey(config, 'aamarpay_store_id') || pickKey(config, 'store_id');
    const signature = pickKey(config, 'aamarpay_signature_key') || pickKey(config, 'signature_key');
    if (!storeId || !signature) throw new Error('Aamarpay credentials are not configured.');

    const tranId = order.reference.slice(0, 40);
    const res = await fetch(host(config.testMode) + '/jsonpost.php', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        store_id: storeId,
        signature_key: signature,
        tran_id: tranId,
        amount: String(round2(order.total)),
        currency: order.currency.toUpperCase(),
        desc: order.items.map((i) => i.title).join(', ').slice(0, 200),
        cus_name: 'Customer',
        cus_email: order.userEmail,
        cus_phone: 'N/A',
        success_url: order.successUrl + '?reference=' + order.reference + '&provider=aamarpay',
        fail_url: order.cancelUrl,
        cancel_url: order.cancelUrl,
        opt_a: order.reference,
        type: 'json',
      }),
    });
    const json = (await res.json()) as { payment_url?: string; result?: string };
    if (!json.payment_url) throw new Error('Aamarpay session failed: ' + (json.result ?? res.status));
    // The response is a path when relative, absolute otherwise.
    const url = json.payment_url.startsWith('http')
      ? json.payment_url : host(config.testMode) + json.payment_url;
    return { redirectUrl: url, providerRef: tranId };
  },

  async verify(reference, providerRef, config): Promise<PaymentOutcome> {
    const storeId = pickKey(config, 'aamarpay_store_id') || pickKey(config, 'store_id');
    const signature = pickKey(config, 'aamarpay_signature_key') || pickKey(config, 'signature_key');

    const url = host(config.testMode) + '/api/v1/trxcheck/request.php'
      + '?request_id=' + encodeURIComponent(providerRef)
      + '&store_id=' + encodeURIComponent(storeId)
      + '&signature_key=' + encodeURIComponent(signature)
      + '&type=json';
    const res = await fetch(url);
    const json = (await res.json()) as { pay_status?: string; opt_a?: string; mer_txnid?: string };
    if (!res.ok) return { status: 'failed', reason: 'Aamarpay lookup failed.' };

    if (json.opt_a && json.opt_a !== reference) {
      return { status: 'failed', reason: 'Aamarpay response does not match this order.' };
    }
    if (json.pay_status === 'Successful') {
      return { status: 'paid', providerRef, transaction: { mer_txnid: json.mer_txnid ?? providerRef } };
    }
    return json.pay_status === 'Processing'
      ? { status: 'pending', providerRef }
      : { status: 'failed', reason: 'Aamarpay pay_status=' + json.pay_status };
  },
};
