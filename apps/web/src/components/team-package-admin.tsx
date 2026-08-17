'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export interface PackageRow {
  id: number; title: string | null; slug: string | null;
  allocation: number | null; pricing_type: number | null; price: number | null;
  expiry_type: string | null; course_privacy: string | null; status: number | null;
  course?: { title: string | null } | null;
}

export interface CourseOption { id: number; title: string | null }

/** TP-01 -- create, publish, duplicate and delete a classroom package. */
export function TeamPackageAdmin({ mode = 'create', pkg, courses }: {
  mode?: 'create' | 'row';
  pkg?: PackageRow;
  courses?: CourseOption[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [paid, setPaid] = useState(true);
  const [limited, setLimited] = useState(false);

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
        <button className="btn-ghost px-2 py-1" disabled={busy}
          onClick={async () => {
            if (await call('/manage/team-packages/' + pkg!.id + '/status', { method: 'POST' })) {
              router.refresh();
            }
          }}>
          {pkg!.status ? 'Hide' : 'Publish'}
        </button>
        <button className="btn-ghost px-2 py-1" disabled={busy}
          onClick={async () => {
            if (await call('/manage/team-packages/' + pkg!.id + '/duplicate', { method: 'POST' })) {
              router.refresh();
            }
          }}>
          Duplicate
        </button>
        <button className="btn-ghost px-2 py-1 text-red-600" disabled={busy}
          onClick={async () => {
            if (!confirm('Delete this package?')) return;
            if (await call('/manage/team-packages/' + pkg!.id, { method: 'DELETE' })) {
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
        const features = String(f.get('features') ?? '')
          .split('\n').map((x) => x.trim()).filter(Boolean);
        const done = await call('/manage/team-packages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: String(f.get('title') ?? ''),
            course_id: Number(f.get('course_id')),
            course_privacy: String(f.get('course_privacy') ?? 'public'),
            allocation: Number(f.get('allocation') ?? 1),
            pricing_type: paid ? 1 : 0,
            price: paid ? Number(f.get('price') ?? 0) : 0,
            expiry_type: limited ? 'limited' : 'lifetime',
            start_date: limited ? String(f.get('start_date') ?? '') || null : null,
            expiry_date: limited ? String(f.get('expiry_date') ?? '') || null : null,
            features,
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
          <label className="block text-sm font-medium">Course</label>
          <select name="course_id" required
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
            {(courses ?? []).map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium">Seats</label>
          <input name="allocation" type="number" min={1} defaultValue={5} required
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="block text-sm font-medium">Visibility</label>
          <select name="course_privacy"
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
            <option value="public">Public - listed for anyone</option>
            <option value="private">Private - shared by link only</option>
          </select>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={paid} onChange={(e) => setPaid(e.target.checked)} />
            Paid package
          </label>
          {paid && (
            <input name="price" type="number" min={1} step="0.01" defaultValue={100} required
              className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          )}
        </div>
        <div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={limited}
              onChange={(e) => setLimited(e.target.checked)} />
            Limited term
          </label>
          {limited && (
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <input name="start_date" type="date" required
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
              <input name="expiry_date" type="date" required
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            </div>
          )}
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium">Features, one per line</label>
        <textarea name="features" rows={3}
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
      </div>

      <button className="btn-primary" disabled={busy} type="submit">
        {busy ? 'Saving...' : 'Create package'}
      </button>
      {message && <p className="text-sm text-slate-600">{message}</p>}
    </form>
  );
}
