'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export interface UserOption { id: number; name: string | null; email: string | null }

/** R-03 -- admin-curated testimonials for the home page. */
export function TestimonialAdmin({ mode = 'create', testimonialId, users }: {
  mode?: 'create' | 'row';
  testimonialId?: number;
  users?: UserOption[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  if (mode === 'row') {
    return (
      <button className="btn-ghost px-2 py-1 text-xs text-red-600" disabled={busy}
        onClick={async () => {
          if (!confirm('Delete this testimonial?')) return;
          setBusy(true);
          await fetch(`/api/proxy/admin/testimonials/${testimonialId}`, { method: 'DELETE' });
          setBusy(false); router.refresh();
        }}>
        Delete
      </button>
    );
  }

  return (
    <form className="card space-y-3 p-4"
      onSubmit={async (e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const f = new FormData(form);
        setBusy(true); setMessage('');
        const res = await fetch('/api/proxy/admin/testimonials', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            user_id: Number(f.get('user_id')),
            rating: Number(f.get('rating')),
            review: String(f.get('review') ?? ''),
          }),
        });
        const body = await res.json().catch(() => ({}));
        setBusy(false);
        if (!res.ok) { setMessage(body.message ?? 'Could not save the testimonial.'); return; }
        form.reset(); router.refresh();
      }}>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="block text-sm font-medium">Person</label>
          <select name="user_id" required
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
            {(users ?? []).map((u) => (
              <option key={u.id} value={u.id}>{u.name ?? u.email}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium">Rating</label>
          <select name="rating" required defaultValue="5"
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
            {[5, 4, 3, 2, 1].map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </div>
      </div>
      <div>
        <label className="block text-sm font-medium">Quote</label>
        <textarea name="review" rows={3} required maxLength={5000}
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
      </div>
      <button className="btn-primary" disabled={busy} type="submit">Add testimonial</button>
      {message && <p className="text-sm text-red-600">{message}</p>}
    </form>
  );
}
