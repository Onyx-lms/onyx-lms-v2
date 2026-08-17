'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/** PAY-15 -- the student side of a bank transfer. */
export function OfflinePaymentForm({ coupon }: { coupon: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [level, setLevel] = useState<'error' | 'success'>('success');

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true); setMessage('');
    const f = new FormData(e.currentTarget);
    const res = await fetch('/api/proxy/payment/offline', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        phone_on: String(f.get('phone_on') ?? ''),
        bank_no: String(f.get('bank_no') ?? ''),
        doc: String(f.get('doc') ?? ''),
        ...(coupon ? { coupon } : {}),
      }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    setLevel(res.ok ? 'success' : 'error');
    setMessage(body.message ?? (res.ok ? 'Submitted.' : 'Could not submit.'));
    if (res.ok) { setOpen(false); router.refresh(); }
  }

  if (!open) {
    return (
      <div className="mt-3 text-center">
        <button onClick={() => setOpen(true)} className="text-xs text-slate-600 hover:text-brand-600">
          Or pay by bank transfer
        </button>
        {message && (
          <p className={`mt-2 text-xs ${level === 'error' ? 'text-red-600' : 'text-green-700'}`}>
            {message}
          </p>
        )}
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="mt-4 space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-4">
      <p className="text-xs text-slate-600">
        Transfer the total to our bank account, then record the details here. An
        administrator will review it and enrol you.
      </p>
      <div>
        <label className="block text-sm font-medium">Your phone number</label>
        <input name="phone_on" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
      </div>
      <div>
        <label className="block text-sm font-medium">Bank account / transaction number</label>
        <input name="bank_no" required
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
      </div>
      <div>
        <label className="block text-sm font-medium">Proof (uploaded file path)</label>
        <input name="doc" placeholder="uploads/proof.png"
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
      </div>
      <div className="flex gap-2">
        <button className="btn-primary" disabled={busy}>{busy ? 'Submitting' : 'Submit for review'}</button>
        <button type="button" className="btn-ghost" onClick={() => setOpen(false)}>Cancel</button>
      </div>
      {message && (
        <p className={`text-sm ${level === 'error' ? 'text-red-600' : 'text-green-700'}`}>{message}</p>
      )}
    </form>
  );
}
