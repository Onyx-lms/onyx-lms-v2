'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * CMP-03b -- the browser coming back from a gateway.
 *
 * Two things settle a payment and they race: the gateway's webhook, and this.
 * That is fine and deliberate -- both end in the same `recordPayment`, and the
 * second one through finds the unique constraint and reports the original row
 * rather than crediting twice. Having both matters because `parseWebhook` is
 * optional in the provider contract: for a gateway that does not post one, this
 * is the only thing that would ever settle the invoice.
 *
 * It runs once. A refresh of the success page should not be a second attempt at
 * anything, and a React strict-mode double-invoke certainly should not.
 *
 * It forwards the WHOLE query string, not just the reference. A gateway sends
 * its verdict back in those parameters, and several providers -- Razorpay among
 * them -- check a signature over them before they will call a payment paid.
 * Sending only the reference meant that check was quietly skipped and the
 * provider fell back to re-reading its own order, which in the seconds after a
 * payment usually still says "created": a real payment reported as pending, to
 * somebody who had just been charged. The parameters are not trusted here --
 * they go to the provider, which is the only thing that can say what they mean.
 */

/**
 * The gateway's own transaction id, wherever it put it.
 *
 * There is no shared name for this across providers, so the known ones are
 * listed rather than guessed at. An empty string is a fine answer: `verify`
 * treats a missing reference as "ask the provider directly".
 */
function providerRefFrom(query: Record<string, string>): string {
  return query.provider_ref || query.razorpay_order_id || query.order_id
    || query.orderId || query.txnid || '';
}
export function ConfirmPayment({ reference }: { reference: string }) {
  const router = useRouter();
  const asked = useRef(false);
  const [state, setState] = useState<'working' | 'done' | 'pending' | 'failed'>('working');

  useEffect(() => {
    if (asked.current) return;
    asked.current = true;

    void (async () => {
      // Read here rather than threaded down from the page: a gateway appends
      // parameters this product never named, so an allow-list on the server
      // component would drop exactly the ones a signature is computed over.
      const query: Record<string, string> = {};
      for (const [k, v] of new URLSearchParams(window.location.search)) query[k] = v;

      const res = await fetch('/api/proxy/onyx/payments/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reference, provider_ref: providerRefFrom(query), query }),
      });
      const body = await res.json().catch(() => ({ ok: false }));
      if (!body.ok) { setState('failed'); return; }
      const status = body.data?.status;
      setState(status === 'captured' ? 'done' : status === 'pending' ? 'pending' : 'failed');
      // The table on this page is server-rendered from the ledger, so it is
      // only right once the ledger is.
      if (status === 'captured') router.refresh();
    })();
  }, [reference, router]);

  if (state === 'working') {
    return (
      <p className="mb-4 rounded-2xl border border-line bg-slate-50 px-4 py-3 text-sm"
        aria-live="polite">
        Confirming your payment with the bank…
      </p>
    );
  }
  if (state === 'done') {
    return (
      <p className="mb-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm"
        aria-live="polite">
        Payment received. Your invoice below is up to date.
      </p>
    );
  }
  if (state === 'pending') {
    return (
      <p className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm"
        aria-live="polite">
        Your bank has not confirmed this yet. It usually takes a minute — nothing has been
        lost, and this page will show it once they do.
      </p>
    );
  }
  return (
    <p className="mb-4 rounded-2xl border border-line bg-slate-50 px-4 py-3 text-sm"
      aria-live="polite">
      We could not confirm that payment. If your bank shows it as taken, the finance office
      can reconcile it — nothing is lost, and you have not been charged twice.
    </p>
  );
}
