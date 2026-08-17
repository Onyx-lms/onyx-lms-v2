'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export interface TopicOption { id: number; title: string | null }

/** R-08 -- topic and article management. */
export function KnowledgeBaseAdmin({ mode, topics, topicId, articleId }: {
  mode: 'topic-create' | 'article-create' | 'topic-row' | 'article-row';
  topics?: TopicOption[];
  topicId?: number;
  articleId?: number;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  async function call(path: string, init: RequestInit) {
    setBusy(true); setMessage('');
    const res = await fetch('/api/proxy' + path, init);
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) setMessage(body.message ?? 'Something went wrong.');
    return res.ok;
  }

  if (mode === 'topic-row' || mode === 'article-row') {
    const isTopic = mode === 'topic-row';
    return (
      <button className="btn-ghost px-2 py-1 text-xs text-red-600" disabled={busy}
        onClick={async () => {
          const warning = isTopic
            ? 'Delete this topic and all of its articles?'
            : 'Delete this article?';
          if (!confirm(warning)) return;
          const path = isTopic
            ? `/admin/knowledge-base/topics/${topicId}`
            : `/admin/knowledge-base/articles/${articleId}`;
          if (await call(path, { method: 'DELETE' })) router.refresh();
        }}>
        Delete
      </button>
    );
  }

  if (mode === 'topic-create') {
    return (
      <form className="card flex flex-wrap items-end gap-3 p-4"
        onSubmit={async (e) => {
          e.preventDefault();
          const form = e.currentTarget;
          const title = String(new FormData(form).get('title') ?? '');
          if (await call('/admin/knowledge-base/topics', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title }),
          })) { form.reset(); router.refresh(); }
        }}>
        <div className="grow">
          <label className="block text-sm font-medium">New topic</label>
          <input name="title" required maxLength={255} placeholder="Getting started"
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        </div>
        <button className="btn-primary" disabled={busy} type="submit">Add topic</button>
        {message && <p className="w-full text-sm text-red-600">{message}</p>}
      </form>
    );
  }

  return (
    <form className="card space-y-3 p-4"
      onSubmit={async (e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const f = new FormData(form);
        if (await call('/admin/knowledge-base/articles', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            knowledge_base_id: Number(f.get('knowledge_base_id')),
            topic_name: String(f.get('topic_name') ?? ''),
            description: String(f.get('description') ?? ''),
          }),
        })) { form.reset(); router.refresh(); }
      }}>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="block text-sm font-medium">Topic</label>
          <select name="knowledge_base_id" required
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
            {(topics ?? []).map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium">Article title</label>
          <input name="topic_name" required maxLength={255}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        </div>
      </div>
      <div>
        <label className="block text-sm font-medium">Body</label>
        <textarea name="description" rows={5}
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
      </div>
      <button className="btn-primary" disabled={busy} type="submit">Add article</button>
      {message && <p className="text-sm text-red-600">{message}</p>}
    </form>
  );
}
