'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { formatDate } from '@/lib/when';

export interface Language {
  id: number; name: string; direction: string; phrase_count: number;
}
export interface Campaign {
  id: number; subject: string | null; description: string | null; created_at: string | null;
}
export interface Subscriber { id: number; email: string | null; created_at: string | null }
export interface Application {
  id: number; phone: string | null; description: string | null; document: string | null;
  status: number | null; created_at: string | null;
  user: { id: number; name: string | null; email: string | null } | null;
}

async function call(path: string, init: RequestInit) {
  const res = await fetch('/api/proxy' + path, init);
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok, body };
}

/** SET-06 -- add, retype and remove a language. */
export function LanguageList({ rows }: { rows: Language[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  return (
    <section className="card p-4">
      <h2 className="text-sm font-semibold">Languages</h2>
      <form className="mt-3 flex flex-wrap gap-2" onSubmit={async (e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const f = new FormData(form);
        setBusy(true); setMessage('');
        const { ok, body } = await call('/admin/languages', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: String(f.get('name') ?? ''),
            direction: String(f.get('direction') ?? 'ltr'),
          }),
        });
        setBusy(false);
        if (!ok) { setMessage(body.message ?? 'Could not add it.'); return; }
        form.reset(); router.refresh();
      }}>
        <input name="name" required placeholder="Language name"
          className="grow rounded-md border border-slate-300 px-3 py-2 text-sm" />
        <select name="direction"
          className="rounded-md border border-slate-300 px-3 py-2 text-sm">
          <option value="ltr">Left to right</option>
          <option value="rtl">Right to left</option>
        </select>
        <button className="btn-primary px-3 text-sm" disabled={busy} type="submit">Add</button>
      </form>

      <ul className="mt-3 divide-y divide-slate-100 text-sm">
        {rows.map((l) => (
          <li key={l.id} className="flex items-center justify-between py-2">
            <span>
              {l.name}
              <span className="block text-xs text-slate-500">
                {l.direction} - {l.phrase_count} phrases
              </span>
            </span>
            <span className="flex gap-2 text-xs">
              <a className="btn-ghost px-2 py-1" href={'/admin/languages/' + l.id}>Translate</a>
              <button className="btn-ghost px-2 py-1" disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  await call('/admin/languages/' + l.id + '/direction', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ direction: l.direction === 'rtl' ? 'ltr' : 'rtl' }),
                  });
                  setBusy(false); router.refresh();
                }}>
                Flip direction
              </button>
              <button className="btn-ghost px-2 py-1 text-red-600" disabled={busy}
                onClick={async () => {
                  if (!confirm('Delete ' + l.name + ' and its phrases?')) return;
                  setBusy(true);
                  const { ok, body } = await call('/admin/languages/' + l.id, { method: 'DELETE' });
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

/** SET-07 -- campaigns and the subscriber list. */
export function NewsletterPanel({ campaigns, subscribers }: {
  campaigns: Campaign[]; subscribers: Subscriber[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <section className="card p-4">
        <h2 className="text-sm font-semibold">Campaigns</h2>
        <form className="mt-3 space-y-2" onSubmit={async (e) => {
          e.preventDefault();
          const form = e.currentTarget;
          const f = new FormData(form);
          setBusy(true); setMessage('');
          const { ok, body } = await call('/admin/newsletters', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              subject: String(f.get('subject') ?? ''),
              description: String(f.get('description') ?? ''),
            }),
          });
          setBusy(false);
          if (!ok) { setMessage(body.message ?? 'Could not save it.'); return; }
          form.reset(); router.refresh();
        }}>
          <input name="subject" required maxLength={255} placeholder="Subject"
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
          <textarea name="description" rows={4} placeholder="Body (HTML allowed)"
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
          <button className="btn-primary" disabled={busy} type="submit">Save campaign</button>
        </form>

        <ul className="mt-4 divide-y divide-slate-100 text-sm">
          {campaigns.map((c) => (
            <li key={c.id} className="flex items-center justify-between py-2">
              <span className="font-medium">{c.subject}</span>
              <span className="flex gap-2 text-xs">
                <button className="btn-ghost px-2 py-1" disabled={busy}
                  onClick={async () => {
                    if (!confirm('Send this to every subscriber?')) return;
                    setBusy(true);
                    const { ok, body } = await call('/admin/newsletters/' + c.id + '/send', {
                      method: 'POST', headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ include_users: false }),
                    });
                    setBusy(false);
                    const d = body.data ?? {};
                    // A partial send is the normal case, so report both numbers.
                    setMessage(ok
                      ? 'Sent to ' + d.sent + ' of ' + d.recipients
                        + (d.failed ? ' (' + d.failed + ' failed)' : '')
                      : body.message ?? 'Could not send it.');
                  }}>
                  Send
                </button>
                <button className="btn-ghost px-2 py-1 text-red-600" disabled={busy}
                  onClick={async () => {
                    if (!confirm('Delete this campaign?')) return;
                    setBusy(true);
                    await call('/admin/newsletters/' + c.id, { method: 'DELETE' });
                    setBusy(false); router.refresh();
                  }}>
                  Delete
                </button>
              </span>
            </li>
          ))}
        </ul>
        {message && <p className="mt-3 text-sm text-slate-600">{message}</p>}
      </section>

      <section className="card p-4">
        <h2 className="text-sm font-semibold">
          Subscribers
          <span className="ml-2 text-xs font-normal text-slate-500">{subscribers.length}</span>
        </h2>
        {subscribers.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">Nobody has subscribed yet.</p>
        ) : (
          <ul className="mt-3 divide-y divide-slate-100 text-sm">
            {subscribers.map((s) => (
              <li key={s.id} className="flex items-center justify-between py-2">
                <span>{s.email}</span>
                <button className="btn-ghost px-2 py-1 text-xs text-red-600" disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    await call('/admin/newsletter-subscribers/' + s.id, { method: 'DELETE' });
                    setBusy(false); router.refresh();
                  }}>
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/** SET-09 -- the instructor application queue. */
export function ApplicationQueue({ rows }: { rows: Application[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  if (rows.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-slate-300 p-10 text-center text-sm text-slate-500">
        No applications.
      </p>
    );
  }
  return (
    <>
      <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
        {rows.map((a) => (
          <li key={a.id} className="px-4 py-3 text-sm">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="font-medium">
                  {a.user?.name ?? 'Applicant'}
                  <span className="ml-2 text-xs font-normal text-slate-500">{a.user?.email}</span>
                </div>
                <p className="mt-1 whitespace-pre-line text-slate-700">{a.description}</p>
                <p className="mt-1 text-xs text-slate-500">
                  {a.phone}
                  {a.created_at ? ' - ' + formatDate(a.created_at) : ''}
                </p>
              </div>
              <span className="flex shrink-0 gap-2 text-xs">
                {a.document && (
                  <button className="btn-ghost px-2 py-1" disabled={busy}
                    onClick={async () => {
                      // The document is private, so the link is signed on demand
                      // rather than embedded in the page.
                      setBusy(true);
                      const { ok, body } = await call(
                        '/admin/instructor-applications/' + a.id + '/document', {});
                      setBusy(false);
                      if (!ok || !body.data?.url) {
                        setMessage(body.message ?? 'File does not exists');
                        return;
                      }
                      window.open(body.data.url, '_blank', 'noopener');
                    }}>
                    Document
                  </button>
                )}
                {a.status ? (
                  <span className="rounded-full bg-green-100 px-2 py-0.5 text-green-700">
                    Approved
                  </span>
                ) : (
                  <button className="btn-primary px-3 py-1" disabled={busy}
                    onClick={async () => {
                      if (!confirm('Approve and promote them to instructor?')) return;
                      setBusy(true);
                      const { ok, body } = await call(
                        '/admin/instructor-applications/' + a.id + '/approve',
                        { method: 'POST' });
                      setBusy(false);
                      if (!ok) { setMessage(body.message ?? 'Could not approve it.'); return; }
                      router.refresh();
                    }}>
                    Approve
                  </button>
                )}
                <button className="btn-ghost px-2 py-1 text-red-600" disabled={busy}
                  onClick={async () => {
                    if (!confirm('Delete this application?')) return;
                    setBusy(true);
                    await call('/admin/instructor-applications/' + a.id, { method: 'DELETE' });
                    setBusy(false); router.refresh();
                  }}>
                  Delete
                </button>
              </span>
            </div>
          </li>
        ))}
      </ul>
      {message && <p className="mt-3 text-sm text-red-600">{message}</p>}
    </>
  );
}
