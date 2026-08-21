'use client';

/**
 * Razorpay Checkout, loaded once per page.
 *
 * Razorpay does not redirect. `createCheckout` returns a `clientPayload` and
 * expects a script on the page to open a modal over it, and the value the
 * provider calls `redirectUrl` is a page on OUR site -- navigating there skips
 * the payment entirely and lands on a confirm that reports "pending", which is
 * exactly what happened before this file existed.
 *
 * Not `next/script`: the script has to be loadable from inside a dialog that
 * may never open, and awaited at the moment somebody presses Buy. A memoised
 * promise is the thing that actually needs to happen, and `next/script` is
 * awkward to drive from there.
 */

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => { open(): void };
  }
}

const SRC = 'https://checkout.razorpay.com/v1/checkout.js';

/**
 * Module-level, so two Buy buttons on one catalogue page share one load.
 *
 * Reset to null when it fails, so a flaky connection is retryable rather than
 * poisoning every later attempt for the life of the tab -- a cached rejected
 * promise is a button that never works again until a reload.
 */
let loading: Promise<void> | null = null;

export function loadRazorpay(): Promise<void> {
  if (typeof window === 'undefined') return Promise.reject(new Error('No browser here.'));
  if (window.Razorpay) return Promise.resolve();
  if (loading) return loading;

  loading = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-razorpay]');
    const script = existing ?? document.createElement('script');
    script.src = SRC;
    script.async = true;
    script.dataset.razorpay = 'true';
    script.addEventListener('load', () => resolve(), { once: true });
    script.addEventListener('error', () => {
      loading = null;
      script.remove();
      reject(new Error('The payment window could not be loaded. Check your connection.'));
    }, { once: true });
    if (!existing) document.head.appendChild(script);
  });
  return loading;
}

export interface RazorpayResult {
  razorpay_payment_id?: string;
  razorpay_order_id?: string;
  razorpay_signature?: string;
}

/**
 * Opens the payment window and resolves with what Razorpay hands back, or with
 * null when the person closes it without paying.
 *
 * Dismissal is not an error. Somebody who changes their mind has not failed at
 * anything, and telling them they have is the sort of thing that makes a
 * checkout feel hostile.
 */
export async function payWithRazorpay(
  clientPayload: Record<string, unknown>,
): Promise<RazorpayResult | null> {
  await loadRazorpay();
  const Ctor = window.Razorpay;
  if (!Ctor) throw new Error('The payment window could not be opened.');

  return new Promise<RazorpayResult | null>((resolve) => {
    let settled = false;
    const done = (value: RazorpayResult | null) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const rzp = new Ctor({
      ...clientPayload,
      handler: (result: RazorpayResult) => done(result),
      modal: { ondismiss: () => done(null) },
    });
    rzp.open();
  });
}
