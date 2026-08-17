/**
 * S07 -- checkout, confirmation, webhooks and invoices.
 */
import type { Router, ReqLike } from '../router.ts';
import { z } from 'zod';
import { validate, ok, requireAuth, hasProvider } from '@onyx/core';
import type { AppContext } from '../app-context.ts';

const asReq = (req: ReqLike) => ({
  headers: req.headers as Record<string, string | string[] | undefined>,
  cookies: (req as unknown as { cookies?: Record<string, string> }).cookies,
});

export function registerPaymentRoutes(app: Router, ctx: AppContext): void {
  app.get('/api/payment/gateways', async (req) => {
    requireAuth(asReq(req), ctx.jwtSecret);
    return ok(await ctx.payments.availableGateways());
  });

  app.post('/api/payment/checkout', async (req) => {
    const c = requireAuth(asReq(req), ctx.jwtSecret);
    const body = validate(z.object({
      gateway: z.string().min(1),
      coupon: z.string().optional(),
    }), req.body);

    const web = ctx.webOrigin;
    return ok(await ctx.payments.createCheckout(c.user_id, c.email, body.gateway, body.coupon, {
      successUrl: `${web}/checkout/success`,
      cancelUrl: `${web}/cart`,
    }), 'Redirecting to payment.');
  });

  /**
   * Called after the gateway redirects back. Verifies with the provider before
   * granting anything -- a browser landing on this URL proves nothing.
   */
  app.post('/api/payment/complete', async (req) => {
    requireAuth(asReq(req), ctx.jwtSecret);
    const body = validate(z.object({
      reference: z.string().min(1),
      provider_ref: z.string().default(''),
      query: z.record(z.string()).optional(),
    }), req.body);

    const result = await ctx.payments.completeCheckout(
      body.reference, body.provider_ref, body.query);

    const message = result.status === 'paid'
      ? (result.alreadyFulfilled ? 'This order was already completed.' : 'Course enrolled successfully.')
      : result.status === 'pending'
        ? 'Your payment is still processing.'
        : result.reason ?? 'Payment failed! Please try again.';
    return ok(result, message, result.status === 'paid' ? 'success' : 'warning');
  });

  /**
   * Gateway webhooks. Unauthenticated by nature -- the signature IS the auth,
   * which is why the raw body is required here.
   */
  /**
   * PAY-16 -- gateway webhooks.
   *
   * Unauthenticated by nature: the signature IS the authentication, which is
   * why the exact raw bytes are required.
   *
   * Status codes matter here, because they drive the gateway's retry loop:
   *   400  bad signature or malformed  -> do NOT retry, this is not from you
   *   500  our fulfilment failed       -> DO retry, the payment is real
   *   200  handled or deliberately ignored
   */
  app.post('/api/payment/webhook/:gateway', async (req, reply) => {
    const { gateway } = req.params as { gateway: string };
    if (!hasProvider(gateway)) {
      return reply.status(404).send({ ok: false, level: 'error',
        message: 'Unknown payment gateway.' });
    }

    const raw = (req as unknown as { rawBody?: string }).rawBody ?? '';
    if (!raw) {
      return reply.status(400).send({ ok: false, level: 'error',
        message: 'Empty webhook body.' });
    }

    let result;
    try {
      result = await ctx.payments.handleWebhook(
        gateway, raw, req.headers as Record<string, string | string[] | undefined>);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Webhook rejected.';
      // A signature failure is a rejection, not an outage: 400 stops the
      // gateway retrying a request we will never accept.
      if (/signature|hash/i.test(message)) {
        req.log.warn({ gateway, message }, 'webhook signature rejected');
        return reply.status(400).send({ ok: false, level: 'error', message });
      }
      // Anything else is our problem. Let it 500 so the gateway retries.
      req.log.error({ gateway, err }, 'webhook fulfilment failed');
      throw err;
    }

    if (result.status === 'failed') {
      // Logged for reconciliation: money may have moved without us fulfilling.
      req.log.error({ gateway, reason: result.reason }, 'webhook could not be fulfilled');
    }
    return ok(result);
  });
  app.get('/api/payment/history', async (req) => {
    const c = requireAuth(asReq(req), ctx.jwtSecret);
    return ok(await ctx.payments.purchaseHistory(c.user_id));
  });

  app.get('/api/payment/invoice/:invoice', async (req) => {
    const c = requireAuth(asReq(req), ctx.jwtSecret);
    const { invoice } = req.params as { invoice: string };
    return ok(await ctx.payments.invoice(invoice, c.user_id));
  });
}
