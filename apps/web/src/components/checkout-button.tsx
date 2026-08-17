'use client';

import { useState } from 'react';

interface Gateway { identifier: string; title: string | null; test_mode: boolean }

/**
 * PAY-01 -- gateway picker plus checkout.
 *
 * The browser only chooses a gateway. Prices, discount and tax are recomputed
 * server-side from the cart, so nothing here can change what is charged.
 */
export function CheckoutButton({ gateways, coupon }: { gateways: Gateway[]; coupon: string }) {
  const [gateway, setGateway] = useState(gateways[0]?.identifier ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  if (gateways.length === 0) {
    return (
      <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
        No payment method is enabled. An administrator can turn one on under
        payment settings.
      </div>
    );
  }

  async function checkout() {
    setBusy(true); setError('');
    const res = await fetch('/api/proxy/payment/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gateway, ...(coupon ? { coupon } : {}) }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) { setBusy(false); setError(body.message ?? 'Could not start checkout.'); return; }

    // Razorpay opens its own widget; everything else redirects.
    if (body.data.clientPayload) {
      sessionStorage.setItem('onyx_checkout', JSON.stringify({
        reference: body.data.reference, providerRef: body.data.providerRef,
      }));
    }
    window.location.href = body.data.redirectUrl;
  }

  return (
    <div className="mt-4 border-t border-slate-200 pt-4">
      <label htmlFor="gateway" className="block text-sm font-medium">Pay with</label>
      <select id="gateway" value={gateway} onChange={(e) => setGateway(e.target.value)}
        className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
        {gateways.map((g) => (
          <option key={g.identifier} value={g.identifier}>
            {g.title ?? g.identifier}{g.test_mode ? ' (test mode)' : ''}
          </option>
        ))}
      </select>

      <button onClick={checkout} disabled={busy || !gateway}
        className="btn-primary mt-3 w-full disabled:opacity-60">
        {busy ? 'Starting checkout' : 'Checkout'}
      </button>
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
    </div>
  );
}
