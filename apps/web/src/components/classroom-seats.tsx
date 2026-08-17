'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export interface Member {
  id: number; member_id: number;
  member: { id: number; name: string | null; email: string | null } | null;
}

interface Candidate {
  id: number; name: string | null; email: string | null; already_member: boolean;
}

/** TP-04 -- fill and empty the seats of one classroom. */
export function ClassroomSeats({ packageId, members, seatsUsed, seatsTotal }: {
  packageId: number; members: Member[]; seatsUsed: number; seatsTotal: number;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [found, setFound] = useState<Candidate[]>([]);
  const full = seatsUsed >= seatsTotal;

  async function call(path: string, init: RequestInit) {
    setBusy(true); setMessage('');
    const res = await fetch('/api/proxy' + path, init);
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) { setMessage(body.message ?? 'Something went wrong.'); return false; }
    return true;
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <section className="card p-4">
        <h2 className="text-sm font-semibold">Add someone</h2>
        {full ? (
          <p className="mt-3 text-sm text-slate-500">
            Every seat is taken. Remove someone to free one up.
          </p>
        ) : (
          <form className="mt-3 flex gap-2" onSubmit={async (e) => {
            e.preventDefault();
            const term = String(new FormData(e.currentTarget).get('search') ?? '');
            if (!term.trim()) { setFound([]); return; }
            const res = await fetch('/api/proxy/my-team-packages/' + packageId
              + '/search?search=' + encodeURIComponent(term));
            setFound(res.ok ? ((await res.json()).data as Candidate[]) : []);
          }}>
            <input name="search" placeholder="Search by name or email"
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
            <button className="btn-ghost px-3 text-sm" type="submit">Find</button>
          </form>
        )}

        {found.length > 0 && (
          <ul className="mt-3 divide-y divide-slate-100 text-sm">
            {found.map((u) => (
              <li key={u.id} className="flex items-center justify-between py-2">
                <span>
                  {u.name ?? u.email}
                  <span className="block text-xs text-slate-500">{u.email}</span>
                </span>
                {u.already_member ? (
                  <span className="text-xs text-slate-400">Already in</span>
                ) : (
                  <button className="btn-ghost px-2 py-1 text-xs" disabled={busy || full}
                    onClick={async () => {
                      const done = await call('/my-team-packages/' + packageId + '/members', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ member_id: u.id }),
                      });
                      if (done) { setFound([]); router.refresh(); }
                    }}>
                    Add
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        {message && <p className="mt-3 text-sm text-red-600">{message}</p>}
      </section>

      <section className="card p-4">
        <h2 className="text-sm font-semibold">In this classroom</h2>
        {members.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">Nobody yet.</p>
        ) : (
          <ul className="mt-3 divide-y divide-slate-100 text-sm">
            {members.map((m) => (
              <li key={m.id} className="flex items-center justify-between py-2">
                <span>
                  {m.member?.name ?? 'Unknown'}
                  <span className="block text-xs text-slate-500">{m.member?.email}</span>
                </span>
                <button className="btn-ghost px-2 py-1 text-xs text-red-600" disabled={busy}
                  onClick={async () => {
                    if (!confirm('Remove them? They lose access granted by this package.')) return;
                    const done = await call(
                      '/my-team-packages/' + packageId + '/members/' + m.member_id,
                      { method: 'DELETE' });
                    if (done) router.refresh();
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
