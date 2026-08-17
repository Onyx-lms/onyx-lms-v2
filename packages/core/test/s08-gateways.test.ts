import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, createHash } from 'node:crypto';
import { paystackProvider } from '../src/payments/providers/paystack.ts';
import { flutterwaveProvider } from '../src/payments/providers/flutterwave.ts';
import { dokuProvider, dokuDigest, dokuSignature } from '../src/payments/providers/doku.ts';
import { registeredProviders, hasProvider } from '../src/payments/provider.ts';
import '../src/payments/index.ts';

const cfg = (keys: Record<string, string>) => ({
  identifier: 'x', title: 'X', testMode: true, keys, currency: 'USD',
});

test('PAY-08..13 every gateway is registered under its identifier', () => {
  for (const id of ['stripe', 'paypal', 'razorpay', 'paystack',
    'flutterwave', 'sslcommerz', 'doku', 'aamarpay', 'maxicash']) {
    assert.equal(hasProvider(id), true, id + ' should be registered');
  }
  assert.equal(registeredProviders().length, 9,
    'nine of the ten Laravel gateways; Paytm is not implemented');
});

test('PAY-08 Paystack verifies its HMAC-SHA512 webhook signature', async () => {
  const secret = 'sk_test_paystack';
  const payload = JSON.stringify({
    event: 'charge.success',
    data: { reference: 'ps_ref', metadata: { reference: 'our-ref' } },
  });
  const sig = createHmac('sha512', secret).update(payload).digest('hex');

  const parsed = await paystackProvider.parseWebhook!(
    { rawBody: payload, headers: { 'x-paystack-signature': sig } },
    cfg({ paystack_secret: secret }));
  assert.equal(parsed?.reference, 'our-ref');
  assert.equal(parsed?.outcome.status, 'paid');
});

test('PAY-08 Paystack rejects a forged signature', async () => {
  const payload = JSON.stringify({ event: 'charge.success', data: {} });
  await assert.rejects(() => paystackProvider.parseWebhook!(
    { rawBody: payload, headers: { 'x-paystack-signature': 'deadbeef' } },
    cfg({ paystack_secret: 'sk_test_paystack' })));
});

test('PAY-08 Paystack ignores events that are not charge.success', async () => {
  const secret = 'sk_test_paystack';
  const payload = JSON.stringify({ event: 'charge.failed', data: {} });
  const sig = createHmac('sha512', secret).update(payload).digest('hex');
  const parsed = await paystackProvider.parseWebhook!(
    { rawBody: payload, headers: { 'x-paystack-signature': sig } },
    cfg({ paystack_secret: secret }));
  assert.equal(parsed, null);
});

test('PAY-09 Flutterwave compares the verif-hash verbatim', async () => {
  const hash = 'my-flutterwave-secret-hash';
  const payload = JSON.stringify({
    data: { status: 'successful', tx_ref: 'tx_1', meta: { reference: 'our-ref' } },
  });
  const parsed = await flutterwaveProvider.parseWebhook!(
    { rawBody: payload, headers: { 'verif-hash': hash } }, cfg({ flutterwave_hash: hash }));
  assert.equal(parsed?.reference, 'our-ref');

  await assert.rejects(() => flutterwaveProvider.parseWebhook!(
    { rawBody: payload, headers: { 'verif-hash': 'wrong-hash-entirely!!!!' } },
    cfg({ flutterwave_hash: hash })));
});

test('PAY-09 Flutterwave ignores an unsuccessful transaction', async () => {
  const hash = 'h';
  const payload = JSON.stringify({ data: { status: 'failed', tx_ref: 'tx_1' } });
  const parsed = await flutterwaveProvider.parseWebhook!(
    { rawBody: payload, headers: { 'verif-hash': hash } }, cfg({ flutterwave_hash: hash }));
  assert.equal(parsed, null);
});

test('PAY-13 Doku digest is base64 SHA-256 of the exact body', () => {
  const body = '{"a":1}';
  assert.equal(dokuDigest(body), createHash('sha256').update(body).digest('base64'));
});

test('PAY-13 Doku signature covers the canonical header block', () => {
  const sig = dokuSignature({
    clientId: 'CID', requestId: 'RID', timestamp: '2026-01-01T00:00:00Z',
    targetPath: '/checkout/v1/payment', digest: 'DIG', secret: 'SEC',
  });
  const expected = 'HMACSHA256=' + createHmac('sha256', 'SEC').update(
    'Client-Id:CID\nRequest-Id:RID\nRequest-Timestamp:2026-01-01T00:00:00Z'
    + '\nRequest-Target:/checkout/v1/payment\nDigest:DIG').digest('base64');
  assert.equal(sig, expected);
  // Any field change must change the signature.
  assert.notEqual(sig, dokuSignature({
    clientId: 'CID', requestId: 'RID2', timestamp: '2026-01-01T00:00:00Z',
    targetPath: '/checkout/v1/payment', digest: 'DIG', secret: 'SEC',
  }));
});

test('PAY-13 Doku accepts a correctly signed notification', async () => {
  const secret = 'doku-secret';
  const payload = JSON.stringify({
    transaction: { status: 'SUCCESS' }, order: { invoice_number: 'our-ref' },
  });
  const headers = {
    'client-id': 'CID', 'request-id': 'RID', 'request-timestamp': '2026-01-01T00:00:00Z',
    'request-target': '/payments/notifications',
    signature: dokuSignature({
      clientId: 'CID', requestId: 'RID', timestamp: '2026-01-01T00:00:00Z',
      targetPath: '/payments/notifications', digest: dokuDigest(payload), secret,
    }),
  };
  const parsed = await dokuProvider.parseWebhook!({ rawBody: payload, headers },
    cfg({ doku_client_id: 'CID', doku_secret: secret }));
  assert.equal(parsed?.reference, 'our-ref');
  assert.equal(parsed?.outcome.status, 'paid');
});

test('PAY-13 Doku rejects a tampered body', async () => {
  const secret = 'doku-secret';
  const original = JSON.stringify({ transaction: { status: 'SUCCESS' }, order: { invoice_number: 'a' } });
  const headers = {
    'request-id': 'RID', 'request-timestamp': '2026-01-01T00:00:00Z',
    'request-target': '/payments/notifications',
    signature: dokuSignature({
      clientId: 'CID', requestId: 'RID', timestamp: '2026-01-01T00:00:00Z',
      targetPath: '/payments/notifications', digest: dokuDigest(original), secret,
    }),
  };
  const tampered = JSON.stringify({ transaction: { status: 'SUCCESS' }, order: { invoice_number: 'b' } });
  await assert.rejects(() => dokuProvider.parseWebhook!({ rawBody: tampered, headers },
    cfg({ doku_client_id: 'CID', doku_secret: secret })));
});

test('PAY-13 Doku treats the redirect as pending -- the webhook grants access', async () => {
  const outcome = await dokuProvider.verify('ref', 'pref', cfg({}));
  assert.equal(outcome.status, 'pending');
});

test('PAY-12 MaxiCash matches the echoed reference before granting', async () => {
  const { maxicashProvider } = await import('../src/payments/providers/maxicash.ts');
  const paid = await maxicashProvider.verify('our-ref', 'pref', cfg({}),
    { Status: 'success', Reference: 'our-ref' });
  assert.equal(paid.status, 'paid');

  // A response carrying somebody else's reference must never grant access.
  const mismatched = await maxicashProvider.verify('our-ref', 'pref', cfg({}),
    { Status: 'success', Reference: 'someone-elses-ref' });
  assert.equal(mismatched.status, 'failed');

  const pending = await maxicashProvider.verify('our-ref', 'pref', cfg({}), {});
  assert.equal(pending.status, 'pending');
});
