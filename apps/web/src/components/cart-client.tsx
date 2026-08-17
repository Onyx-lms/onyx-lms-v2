'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/** Cart interactions: remove an item, or apply a coupon. */
export function CartClient({ mode, courseId, applied = '', error = '' }: {
  mode: 'remove' | 'coupon';
  courseId?: number;
  applied?: string;
  error?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState(applied);

  if (mode === 'remove') {
    return (
      <button
        className="text-xs text-red-600 hover:underline disabled:opacity-50"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          await fetch(`/api/proxy/cart/${courseId}`, { method: 'DELETE' });
          setBusy(false);
          router.refresh();
        }}
      >
        Remove
      </button>
    );
  }

  return (
    <form
      className="mt-4 border-t border-slate-200 pt-4"
      onSubmit={(e) => {
        e.preventDefault();
        // The coupon lives in the URL so the server render owns the totals --
        // the discount is never computed in the browser.
        router.push(code ? `/cart?coupon=${encodeURIComponent(code)}` : '/cart');
      }}
    >
      <label htmlFor="coupon" className="block text-sm font-medium">Coupon code</label>
      <div className="mt-1 flex gap-2">
        <input id="coupon" value={code} onChange={(e) => setCode(e.target.value)}
          placeholder="SAVE20"
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm uppercase" />
        <button className="btn-ghost">Apply</button>
      </div>
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
      {!error && applied && (
        <p className="mt-2 text-xs text-green-700">Coupon {applied} applied.</p>
      )}
    </form>
  );
}
