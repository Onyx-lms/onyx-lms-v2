'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export interface Term { id: number; name: string; slug: string; status: number | null }
export interface Offer {
  id: number; price: number | null; description: string | null; status: number | null;
  category: { id: number; name: string } | null;
  subject: { id: number; name: string } | null;
}
export interface Slot {
  id: number; start_time: number | null; end_time: number | null;
  duration: number | null; price: number | null; booking_id: number | null;
}

async function call(path: string, init: RequestInit) {
  const res = await fetch('/api/proxy' + path, init);
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok, body };
}

/** TB-01 -- admin taxonomy rows. */
export function TaxonomyAdmin({ kind, rows }: { kind: 'categories' | 'subjects'; rows: Term[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  return (
    <section className="card p-4">
      <h2 className="text-sm font-semibold capitalize">{kind}</h2>
      <form className="mt-3 flex gap-2" onSubmit={async (e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const name = String(new FormData(form).get('name') ?? '');
        setBusy(true); setMessage('');
        const { ok, body } = await call('/admin/tutor/' + kind, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name }),
        });
        setBusy(false);
        if (!ok) { setMessage(body.message ?? 'Could not add it.'); return; }
        form.reset(); router.refresh();
      }}>
        <input name="name" required maxLength={255} placeholder={'New ' + kind.slice(0, -1)}
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
        <button className="btn-primary px-3 text-sm" disabled={busy} type="submit">Add</button>
      </form>

      <ul className="mt-3 divide-y divide-slate-100 text-sm">
        {rows.map((r) => (
          <li key={r.id} className="flex items-center justify-between py-2">
            <span className={r.status ? '' : 'text-slate-400'}>
              {r.name}{r.status ? '' : ' (hidden)'}
            </span>
            <span className="flex gap-2 text-xs">
              <button className="btn-ghost px-2 py-1" disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  await call('/admin/tutor/' + kind + '/' + r.id + '/status', { method: 'POST' });
                  setBusy(false); router.refresh();
                }}>
                {r.status ? 'Hide' : 'Show'}
              </button>
              <button className="btn-ghost px-2 py-1 text-red-600" disabled={busy}
                onClick={async () => {
                  if (!confirm('Delete it?')) return;
                  setBusy(true);
                  const { ok, body } = await call('/admin/tutor/' + kind + '/' + r.id,
                    { method: 'DELETE' });
                  setBusy(false);
                  if (!ok) { setMessage(body.message ?? 'Could not delete it.'); return; }
                  router.refresh();
                }}>
                Delete
              </button>
            </span>
          </li>
        ))}
      </ul>
      {message && <p className="mt-3 text-sm text-red-600">{message}</p>}
    </section>
  );
}
