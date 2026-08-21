import { payWithRazorpay } from '@/components/onyx-razorpay';

/**
 * Finishing a checkout, whichever kind of gateway started it.
 *
 * `POST /api/onyx/invoices/:id/checkout` and `POST /api/onyx/courses/:id/checkout`
 * return the same shape, and there are exactly two ways a payment gets made
 * from it. Both callers used to guess at which, and both guessed differently,
 * so this is the one place that decides.
 *
 * The order matters, and it used to be the other way round. A widget-rendering
 * provider ALSO returns a `redirect_url`, but its value is a page on our own
 * site rather than a payment page -- navigating there skips the charge and
 * lands on a confirm that can only report "pending". Widget first, redirect
 * only when there is no widget.
 */

export interface CheckoutSessionPayload {
  reference?: string;
  redirect_url?: string | null;
  provider_ref?: string | null;
  client_payload?: Record<string, unknown> | null;
}

export type CheckoutEnd =
  /** The provider confirmed it. Re-read whatever the page states. */
  | { status: 'captured' }
  /** Taken, not yet confirmed by the bank. Not a failure and not a success. */
  | { status: 'pending' }
  /** They closed the window. Nobody has been charged and nobody has erred. */
  | { status: 'dismissed' }
  /** The browser is leaving for the gateway's own domain; nothing follows. */
  | { status: 'redirected' }
  | { status: 'failed'; message: string };

export async function completeCheckout(data: CheckoutSessionPayload): Promise<CheckoutEnd> {
  if (data.client_payload) {
    let result;
    try {
      result = await payWithRazorpay(data.client_payload);
    } catch (err) {
      return {
        status: 'failed',
        message: err instanceof Error ? err.message : 'Could not open the payment window.',
      };
    }
    if (!result) return { status: 'dismissed' };

    // Asked of OUR server, which asks the provider. What came back from a
    // payment window is a claim, not evidence -- the signature these two
    // values carry is what turns it into one, which is why they are forwarded
    // rather than dropped.
    const res = await fetch('/api/proxy/onyx/payments/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        reference: data.reference,
        provider_ref: result.razorpay_order_id ?? data.provider_ref ?? '',
        query: {
          razorpay_payment_id: result.razorpay_payment_id ?? '',
          razorpay_signature: result.razorpay_signature ?? '',
        },
      }),
    });
    const body = await res.json().catch(() => ({ ok: false }));
    if (!body.ok) {
      return { status: 'failed', message: body.message ?? 'We could not confirm that payment.' };
    }
    return body.data?.status === 'captured' ? { status: 'captured' } : { status: 'pending' };
  }

  if (data.redirect_url) {
    // A full navigation, not a router push: the destination is the gateway's
    // own domain, and the return trip is a fresh load of our page.
    window.location.href = data.redirect_url;
    return { status: 'redirected' };
  }

  return {
    status: 'failed',
    message: 'That gateway needs to be completed on its own page, and did not supply one. '
      + 'Tell the finance office.',
  };
}
