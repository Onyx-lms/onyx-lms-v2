'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export interface BootcampRow {
  id: number; title: string | null; slug: string | null;
  status: number | null; pending: number | null;
  is_paid: number | null; price: number | null;
  category?: { title: string } | null;
  instructor?: { name: string | null } | null;
}

export interface CategoryOption { id: number; title: string }

/** BC-02 -- create, publish and delete a workshop. */
export function BootcampAdmin({ mode = 'create', bootcamp, categories, canPublish }: {
  mode?: 'create' | 'row';
  bootcamp?: BootcampRow;
  categories?: CategoryOption[];
  canPublish?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  async function call(path: string, init: RequestInit) {
    setBusy(true); setMessage('');
    const res = await fetch('/api/proxy' + path, init);
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) { setMessage(body.message ?? 'Something went wrong.'); return null; }
    return body;
  }

  if (mode === 'row') {
    return (
      <div className="flex justify-end gap-2 text-xs">
        {canPublish && (
          <button className="btn-ghost px-2 py-1" disabled={busy}
            onClick={async () => {
              const done = await call('/admin/bootcamps/' + bootcamp!.id + '/status', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: bootcamp!.status ? 0 : 1 }),
              });
              if (done) router.refresh();
            }}>
            {bootcamp!.status ? 'Unpublish' : 'Publish'}
          </button>
        )}
        <button className="btn-ghost px-2 py-1" disabled={busy}
          onClick={async () => {
            if (await call('/manage/bootcamps/' + bootcamp!.id + '/duplicate', { method: 'POST' })) {
              router.refresh();
            }
          }}>
          Duplicate
        </button>
        <button className="btn-ghost px-2 py-1 text-red-600" disabled={busy}
          onClick={async () => {
            if (!confirm('Delete this workshop, its modules, classes and resources?')) return;
            if (await call('/manage/bootcamps/' + bootcamp!.id, { method: 'DELETE' })) {
              router.refresh();
            }
          }}>
          Delete
        </button>
        {message && <span className="text-red-600">{message}</span>}
      </div>
    );
  }

  return (
    <form className="card space-y-3 p-4"
      onSubmit={async (e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const f = new FormData(form);
        const paid = f.get('is_paid') ? 1 : 0;
        const discount = f.get('discount_flag') ? 1 : 0;
        const done = await call('/manage/bootcamps', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: String(f.get('title') ?? ''),
            category_id: f.get('category_id') ? Number(f.get('category_id')) : null,
            short_description: String(f.get('short_description') ?? '') || null,
            is_paid: paid,
            price: paid ? Number(f.get('price') ?? 0) : null,
            discount_flag: discount,
            // For a workshop this is the amount taken OFF, not the final price.
            discounted_price: discount ? Number(f.get('discounted_price') ?? 0) : null,
          }),
        });
        if (!done) return;
        form.reset();
        setMessage(done.message ?? '');
        router.refresh();
      }}>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="block text-sm font-medium">Title</label>
          <input name="title" required maxLength={255}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="block text-sm font-medium">Category</label>
          <select name="category_id"
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
            <option value="">None</option>
            {(categories ?? []).map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
          </select>
        </div>
      </div>
      <div>
        <label className="block text-sm font-medium">Summary</label>
        <textarea name="short_description" rows={2}
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="is_paid" /> Paid workshop
        </label>
        <div>
          <label className="block text-sm font-medium">Price</label>
          <input name="price" type="number" min={0} step="0.01" defaultValue={0}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="block text-sm font-medium">Discount off</label>
          <input name="discounted_price" type="number" min={0} step="0.01" defaultValue={0}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          <label className="mt-1 flex items-center gap-2 text-xs">
            <input type="checkbox" name="discount_flag" /> Apply discount
          </label>
        </div>
      </div>
      <button className="btn-primary" disabled={busy} type="submit">
        {busy ? 'Saving...' : canPublish ? 'Create workshop' : 'Submit for approval'}
      </button>
      {message && <p className="text-sm text-slate-600">{message}</p>}
    </form>
  );
}
