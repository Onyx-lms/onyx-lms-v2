'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { formatDate } from './blog-card';

export interface Comment {
  id: number;
  user_id: number | null;
  parent_id: number | null;
  comment: string | null;
  created_at: string | null;
  user?: { id: number; name: string | null } | null;
  replies?: Comment[];
}

/**
 * R-06 -- comments and the like button.
 *
 * Every call goes through /api/proxy, which attaches the bearer token
 * server-side; the token never reaches this component.
 */
export function BlogEngagement({ blogId, comments, likes, liked, viewerId, isAdmin }: {
  blogId: number;
  comments: Comment[];
  likes: number;
  liked: boolean;
  viewerId: number | null;
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [count, setCount] = useState(likes);
  const [mine, setMine] = useState(liked);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [replyTo, setReplyTo] = useState<number | null>(null);

  async function send(path: string, method: string, body?: unknown) {
    setBusy(true); setError('');
    const res = await fetch('/api/proxy' + path, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const payload = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) setError(payload.message ?? 'Something went wrong.');
    return { ok: res.ok, payload };
  }

  async function toggleLike() {
    if (!viewerId) { router.push('/login/store'); return; }
    const { ok, payload } = await send(`/blogs/${blogId}/like`, 'POST');
    if (ok) { setCount(payload.data.count); setMine(payload.data.liked); }
  }

  async function submit(form: HTMLFormElement, parentId: number) {
    const text = new FormData(form).get('comment');
    if (typeof text !== 'string' || !text.trim()) return;
    const { ok } = await send(`/blogs/${blogId}/comments`, 'POST',
      { comment: text, parent_id: parentId });
    if (ok) { form.reset(); setReplyTo(null); router.refresh(); }
  }

  const canManage = (c: Comment) => isAdmin || (viewerId !== null && c.user_id === viewerId);

  return (
    <section className="mt-10 border-t border-slate-200 pt-6">
      <div className="flex items-center gap-3">
        <button onClick={toggleLike} disabled={busy}
          className={mine ? 'btn-primary' : 'rounded-md border border-slate-300 px-4 py-2 text-sm hover:bg-slate-50'}>
          {mine ? 'Liked' : 'Like'} ({count})
        </button>
        <span className="text-sm text-slate-500">
          {comments.length} {comments.length === 1 ? 'comment' : 'comments'}
        </span>
      </div>

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

      {viewerId ? (
        <form className="mt-6" onSubmit={(e) => { e.preventDefault(); void submit(e.currentTarget, 0); }}>
          <textarea name="comment" rows={3} required
            placeholder="Add a comment"
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
          <button className="btn-primary mt-2" disabled={busy} type="submit">Post comment</button>
        </form>
      ) : (
        <p className="mt-6 text-sm text-slate-500">
          <a href="/login/store" className="text-brand-700 underline">Sign in</a> to join the discussion.
        </p>
      )}

      <ul className="mt-8 space-y-6">
        {comments.map((c) => (
          <li key={c.id}>
            <CommentBody comment={c} />
            <div className="mt-1 flex gap-3 text-xs">
              {viewerId && (
                <button className="text-brand-700 hover:underline"
                  onClick={() => setReplyTo(replyTo === c.id ? null : c.id)}>
                  Reply
                </button>
              )}
              {canManage(c) && (
                <button className="text-red-600 hover:underline" disabled={busy}
                  onClick={async () => {
                    const { ok } = await send(`/blog-comments/${c.id}`, 'DELETE');
                    if (ok) router.refresh();
                  }}>
                  Delete
                </button>
              )}
            </div>

            {replyTo === c.id && (
              <form className="mt-2 pl-6"
                onSubmit={(e) => { e.preventDefault(); void submit(e.currentTarget, c.id); }}>
                <textarea name="comment" rows={2} required
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
                <button className="btn-primary mt-2" disabled={busy} type="submit">Reply</button>
              </form>
            )}

            {(c.replies ?? []).length > 0 && (
              <ul className="mt-3 space-y-3 border-l-2 border-slate-100 pl-4">
                {(c.replies ?? []).map((r) => (
                  <li key={r.id}>
                    <CommentBody comment={r} />
                    {canManage(r) && (
                      <button className="mt-1 text-xs text-red-600 hover:underline" disabled={busy}
                        onClick={async () => {
                          const { ok } = await send(`/blog-comments/${r.id}`, 'DELETE');
                          if (ok) router.refresh();
                        }}>
                        Delete
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function CommentBody({ comment }: { comment: Comment }) {
  return (
    <div>
      <p className="text-sm font-medium text-slate-800">
        {comment.user?.name ?? 'Deleted user'}
        <span className="ml-2 text-xs font-normal text-slate-400">
          {formatDate(comment.created_at)}
        </span>
      </p>
      <p className="mt-1 whitespace-pre-line text-sm text-slate-700">{comment.comment}</p>
    </div>
  );
}
