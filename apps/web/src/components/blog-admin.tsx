'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export interface BlogCategoryOption { id: number; title: string }

/**
 * R-04 / R-07 -- blog authoring for admins and instructors.
 *
 * The same component serves both: the server decides publish rights, so the
 * only difference here is the hint under the submit button.
 */
export function BlogAdmin({ mode = 'create', blogId, status, categories, canPublish }: {
  mode?: 'create' | 'row';
  blogId?: number;
  status?: number | null;
  categories?: BlogCategoryOption[];
  canPublish?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  if (mode === 'row') {
    return (
      <div className="flex justify-end gap-2 text-xs">
        {canPublish && (
          <button className="btn-ghost px-2 py-1" disabled={busy}
            onClick={async () => {
              setBusy(true);
              await fetch(`/api/proxy/admin/blogs/${blogId}/status`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: status ? 0 : 1 }),
              });
              setBusy(false); router.refresh();
            }}>
            {status ? 'Unpublish' : 'Publish'}
          </button>
        )}
        <button className="btn-ghost px-2 py-1 text-red-600" disabled={busy}
          onClick={async () => {
            if (!confirm('Delete this post?')) return;
            setBusy(true);
            await fetch(`/api/proxy/manage/blogs/${blogId}`, { method: 'DELETE' });
            setBusy(false); router.refresh();
          }}>
          Delete
        </button>
      </div>
    );
  }

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    setBusy(true); setMessage('');
    const f = new FormData(form);
    const category = String(f.get('category_id') ?? '');
    const res = await fetch('/api/proxy/manage/blogs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: String(f.get('title') ?? ''),
        description: String(f.get('description') ?? ''),
        keywords: String(f.get('keywords') ?? ''),
        category_id: category ? Number(category) : null,
        is_popular: f.get('is_popular') ? 1 : 0,
      }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) { setMessage(body.message ?? 'Could not create the post.'); return; }
    form.reset();
    setMessage(body.message ?? '');
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="card space-y-3 p-4">
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
            {(categories ?? []).map((c) => (
              <option key={c.id} value={c.id}>{c.title}</option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium">Body</label>
        <textarea name="description" rows={6}
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="block text-sm font-medium">Keywords</label>
          <input name="keywords" placeholder="comma, separated"
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        </div>
        <label className="flex items-end gap-2 text-sm">
          <input type="checkbox" name="is_popular" className="mb-2.5" />
          <span className="mb-2">Feature this post</span>
        </label>
      </div>

      <div className="flex items-center gap-3">
        <button className="btn-primary" disabled={busy} type="submit">
          {busy ? 'Saving...' : canPublish ? 'Publish post' : 'Submit for approval'}
        </button>
        {!canPublish && (
          <span className="text-xs text-slate-500">
            Instructor posts are reviewed by an admin before they appear.
          </span>
        )}
      </div>
      {message && <p className="text-sm text-slate-600">{message}</p>}
    </form>
  );
}
