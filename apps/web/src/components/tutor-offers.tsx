'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Offer, Slot, Term } from '@/components/tutoring-admin';

const when = (seconds: number | null) =>
  seconds ? new Date(Number(seconds) * 1000).toLocaleString() : '';

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

/** TB-02 / TB-03 -- what I teach, and when I am free. */
export function TutorOffers({ offers, slots, categories, subjects }: {
  offers: Offer[]; slots: Slot[]; categories: Term[]; subjects: Term[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [repeated, setRepeated] = useState(false);

  async function call(path: string, init: RequestInit) {
    setBusy(true); setMessage('');
    const res = await fetch('/api/proxy' + path, init);
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) { setMessage(body.message ?? 'Something went wrong.'); return null; }
    return body;
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <section className="card p-4">
        <h2 className="text-sm font-semibold">What I teach</h2>
        <form className="mt-3 space-y-2" onSubmit={async (e) => {
          e.preventDefault();
          const form = e.currentTarget;
          const f = new FormData(form);
          const done = await call('/tutor/me/subjects', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              category_id: Number(f.get('category_id')),
              subject_id: Number(f.get('subject_id')),
              price: Number(f.get('price') ?? 0),
              description: String(f.get('description') ?? '') || null,
            }),
          });
          if (done) { form.reset(); router.refresh(); }
        }}>
          <div className="grid gap-2 sm:grid-cols-2">
            <select name="category_id" required
              className="rounded-md border border-slate-300 px-3 py-2 text-sm">
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <select name="subject_id" required
              className="rounded-md border border-slate-300 px-3 py-2 text-sm">
              {subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <input name="price" type="number" min={0} step="0.01" required placeholder="Price"
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
          <textarea name="description" rows={2} placeholder="What you cover"
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
          <button className="btn-primary" disabled={busy} type="submit">Add subject</button>
        </form>

        <ul className="mt-4 divide-y divide-slate-100 text-sm">
          {offers.map((o) => (
            <li key={o.id} className="flex items-center justify-between py-2">
              <span>
                {o.subject?.name}
                <span className="block text-xs text-slate-500">
                  {o.category?.name} - {o.price}
                </span>
              </span>
              <button className="btn-ghost px-2 py-1 text-xs text-red-600" disabled={busy}
                onClick={async () => {
                  if (!confirm('Remove this subject?')) return;
                  if (await call('/tutor/me/subjects/' + o.id, { method: 'DELETE' })) {
                    router.refresh();
                  }
                }}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className="card p-4">
        <h2 className="text-sm font-semibold">My availability</h2>
        <form className="mt-3 space-y-2" onSubmit={async (e) => {
          e.preventDefault();
          const form = e.currentTarget;
          const f = new FormData(form);
          const done = await call('/tutor/me/schedules', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              category_id: Number(f.get('category_id')),
              subject_id: Number(f.get('subject_id')),
              // 1 is a single session, 0 is repeated, as the schema records it.
              tution_type: repeated ? 0 : 1,
              start_time: new Date(String(f.get('start_time'))).toISOString(),
              end_time: repeated && f.get('end_time')
                ? new Date(String(f.get('end_time'))).toISOString() : null,
              duration: Number(f.get('duration') ?? 60),
              days: repeated ? f.getAll('days').map(String) : undefined,
            }),
          });
          if (done) { form.reset(); router.refresh(); }
        }}>
          <div className="grid gap-2 sm:grid-cols-2">
            <select name="category_id" required
              className="rounded-md border border-slate-300 px-3 py-2 text-sm">
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <select name="subject_id" required
              className="rounded-md border border-slate-300 px-3 py-2 text-sm">
              {subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <input name="start_time" type="datetime-local" required
              className="rounded-md border border-slate-300 px-3 py-2 text-sm" />
            <input name="duration" type="number" min={5} defaultValue={60} required
              className="rounded-md border border-slate-300 px-3 py-2 text-sm" />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={repeated}
              onChange={(e) => setRepeated(e.target.checked)} />
            Repeat weekly
          </label>
          {repeated && (
            <div className="space-y-2">
              <input name="end_time" type="date" required
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
              <div className="flex flex-wrap gap-2 text-xs">
                {DAYS.map((d) => (
                  <label key={d} className="flex items-center gap-1 capitalize">
                    <input type="checkbox" name="days" value={d} /> {d.slice(0, 3)}
                  </label>
                ))}
              </div>
            </div>
          )}
          <button className="btn-primary" disabled={busy} type="submit">Add slots</button>
        </form>

        <ul className="mt-4 divide-y divide-slate-100 text-sm">
          {slots.map((s) => (
            <li key={s.id} className="flex items-center justify-between py-2">
              <span>
                {when(s.start_time)}
                <span className="block text-xs text-slate-500">
                  {s.duration} min{s.booking_id ? ' - booked' : ' - open'}
                </span>
              </span>
              {!s.booking_id && (
                <button className="btn-ghost px-2 py-1 text-xs text-red-600" disabled={busy}
                  onClick={async () => {
                    if (await call('/tutor/me/schedules/' + s.id, { method: 'DELETE' })) {
                      router.refresh();
                    }
                  }}>
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
      </section>

      {message && <p className="text-sm text-red-600 lg:col-span-2">{message}</p>}
    </div>
  );
}
