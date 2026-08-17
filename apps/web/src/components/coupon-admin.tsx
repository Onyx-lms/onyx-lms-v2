'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function CouponAdmin({ mode = 'create', couponId }: {
  mode?: 'create' | 'row';
  couponId?: number;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [message, setMessage] = useState('');

  if (mode === 'row') {
    return (
      <div className="flex justify-end gap-2 text-xs">
        <button className="btn-ghost px-2 py-1" disabled={busy}
          onClick={async () => {
            setBusy(true);
            await fetch(`/api/proxy/admin/coupons/${couponId}/status`, { method: 'POST' });
            setBusy(false); router.refresh();
          }}>
          Toggle
        </button>
        <button className="btn-ghost px-2 py-1 text-red-600" disabled={busy}
          onClick={async () => {
            if (!confirm('Delete this coupon?')) return;
            setBusy(true);
            await fetch(`/api/proxy/admin/coupons/${couponId}`, { method: 'DELETE' });
            setBusy(false); router.refresh();
          }}>
          Delete
        </button>
      </div>
    );
  }

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true); setErrors({}); setMessage('');
    const f = new FormData(e.currentTarget);
    // The column stores a unix timestamp as text, so convert the date input.
    const expiry = String(Math.floor(new Date(String(f.get('expiry'))).getTime() / 1000));
    const res = await fetch('/api/proxy/admin/coupons', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: String(f.get('code') ?? ''),
        discount: Number(f.get('discount')),
        expiry,
      }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setErrors(body.errors ?? {});
      setMessage(body.message ?? 'Could not create the coupon.');
      return;
    }
    e.currentTarget.reset();
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="card flex flex-wrap items-end gap-3 p-4">
      <div>
        <label className="block text-sm font-medium">Code</label>
        <input name="code" required placeholder="SAVE20"
          className="mt-1 w-40 rounded-lg border border-slate-300 px-3 py-2 text-sm uppercase" />
        {errors.code && <p className="mt-1 text-xs text-red-600">{errors.code[0]}</p>}
      </div>
      <div>
        <label className="block text-sm font-medium">Discount %</label>
        <input name="discount" type="number" min={0} max={100} defaultValue={10} required
          className="mt-1 w-28 rounded-lg border border-slate-300 px-3 py-2 text-sm" />
      </div>
      <div>
        <label className="block text-sm font-medium">Expires</label>
        <input name="expiry" type="date" required
          className="mt-1 rounded-lg border border-slate-300 px-3 py-2 text-sm" />
      </div>
      <button className="btn-primary" disabled={busy}>{busy ? 'Creating' : 'Create coupon'}</button>
      {message && <p className="w-full text-sm text-red-600">{message}</p>}
    </form>
  );
}
