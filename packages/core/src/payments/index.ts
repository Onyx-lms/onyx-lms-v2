/** Registers the built-in providers. Import once at API boot. */
import { registerProvider } from './provider.ts';
import { stripeProvider } from './providers/stripe.ts';
import { paypalProvider } from './providers/paypal.ts';
import { razorpayProvider } from './providers/razorpay.ts';
import { paystackProvider } from './providers/paystack.ts';
import { flutterwaveProvider } from './providers/flutterwave.ts';
import { sslcommerzProvider } from './providers/sslcommerz.ts';
import { dokuProvider } from './providers/doku.ts';
import { aamarpayProvider } from './providers/aamarpay.ts';
import { maxicashProvider } from './providers/maxicash.ts';

registerProvider(stripeProvider);
registerProvider(paypalProvider);
registerProvider(razorpayProvider);
registerProvider(paystackProvider);
registerProvider(flutterwaveProvider);
registerProvider(sslcommerzProvider);
registerProvider(dokuProvider);
registerProvider(aamarpayProvider);
registerProvider(maxicashProvider);

export * from './provider.ts';
export * from './money.ts';
export * from './order-token.ts';
export * from './payment.service.ts';
export { verifyStripeSignature } from './providers/stripe.ts';
export { dokuDigest, dokuSignature, dokuTimestamp } from './providers/doku.ts';
export * from './offline.service.ts';
