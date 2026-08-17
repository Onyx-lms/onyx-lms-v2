'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function NewCourseButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function create(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true); setError('');
    const form = new FormData(e.currentTarget);
    const res = await fetch('/api/proxy/authoring/courses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: String(form.get('title') ?? ''),
        short_description: String(form.get('short_description') ?? ''),
        is_paid: 0,
      }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) { setError(body.message ?? 'Could not create the course.'); return; }
    router.push(`/instructor/courses/${body.data.id}`);
  }

  if (!open) return <button className="btn-primary" onClick={() => setOpen(true)}>New course</button>;

  return (
    <form onSubmit={create} className="card w-full max-w-md space-y-3 p-4">
      <div>
        <label htmlFor="title" className="block text-sm font-medium">Course title</label>
        <input id="title" name="title" required
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
      </div>
      <div>
        <label htmlFor="short_description" className="block text-sm font-medium">Short description</label>
        <input id="short_description" name="short_description"
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
      </div>
      <div className="flex gap-2">
        <button className="btn-primary" disabled={busy}>{busy ? 'Creating' : 'Create'}</button>
        <button type="button" className="btn-ghost" onClick={() => setOpen(false)}>Cancel</button>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </form>
  );
}
