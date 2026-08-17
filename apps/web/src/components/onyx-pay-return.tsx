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
 */
export function ConfirmPayment({ reference }: { reference: string }) {
  const router = useRouter();
  const asked = useRef(false);
  const [state, setState] = useState<'working' | 'done' | 'pending' | 'failed'>('working');

  useEffect(() => {
    if (asked.current) return;
    asked.current = true;

    void (async () => {
      const res = await fetch('/api/proxy/onyx/payments/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reference }),
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
