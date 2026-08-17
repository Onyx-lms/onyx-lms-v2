'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

export function CheckoutConfirm({ params }: { params: Record<string, string> }) {
  const [state, setState] = useState<'working' | 'paid' | 'pending' | 'failed'>('working');
  const [message, setMessage] = useState('Confirming your payment...');
  const [invoice, setInvoice] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const reference = params.reference ?? '';
      // Stripe returns session_id; PayPal returns token; Razorpay posts its own.
      const providerRef = params.session_id ?? params.token ?? params.razorpay_order_id ?? '';

      if (!reference) {
        setState('failed');
        setMessage('This confirmation link is missing its payment reference.');
        return;
      }

      const res = await fetch('/api/proxy/payment/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reference, provider_ref: providerRef, query: params }),
      });
      const body = await res.json().catch(() => ({}));
      if (cancelled) return;

      const status = body?.data?.status ?? 'failed';
      setState(status === 'paid' ? 'paid' : status === 'pending' ? 'pending' : 'failed');
      setMessage(body.message ?? 'Something went wrong.');
      setInvoice(body?.data?.invoice ?? '');
    })();
    return () => { cancelled = true; };
  }, [params]);

  return (
    <div className="card p-8 text-center">
      {state === 'working' && <p className="text-sm text-slate-600">{message}</p>}

      {state === 'paid' && (
        <>
          <h1 className="text-2xl font-semibold text-green-700">Payment complete</h1>
          <p className="mt-2 text-sm text-slate-600">{message}</p>
          <div className="mt-6 flex justify-center gap-3">
            <Link href="/my-courses" className="btn-primary">Go to my courses</Link>
            {invoice && (
              <Link href={`/invoice/${invoice}`} className="btn-ghost">View invoice</Link>
            )}
          </div>
        </>
      )}

      {state === 'pending' && (
        <>
          <h1 className="text-xl font-semibold">Payment is processing</h1>
          <p className="mt-2 text-sm text-slate-600">{message}</p>
          <p className="mt-2 text-xs text-slate-500">
            You will get access as soon as the provider confirms. It is safe to close this page.
          </p>
        </>
      )}

      {state === 'failed' && (
        <>
          <h1 className="text-xl font-semibold text-red-700">Payment not completed</h1>
          <p className="mt-2 text-sm text-slate-600">{message}</p>
          <Link href="/cart" className="btn-primary mt-6">Back to cart</Link>
        </>
      )}
    </div>
  );
}
