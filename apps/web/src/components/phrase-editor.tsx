'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export interface Phrase { id: number; phrase: string; translated: string | null }

/**
 * SET-06 -- the phrase editor.
 *
 * Only the rows actually edited are sent, so a page of 50 does not rewrite 50
 * records every save.
 */
export function PhraseEditor({ languageId, rows, total, page, perPage, search }: {
  languageId: number;
  rows: Phrase[];
  total: number;
  page: number;
  perPage: number;
  search: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [edited, setEdited] = useState<Record<string, string>>({});
  const lastPage = Math.max(1, Math.ceil(total / perPage));

  const link = (p: number) => {
    const q = new URLSearchParams();
    if (search) q.set('search', search);
    q.set('page', String(p));
    return '/admin/languages/' + languageId + '?' + q.toString();
  };

  return (
    <div className="space-y-4">
      <form action={'/admin/languages/' + languageId} className="flex max-w-md gap-2">
        <input name="search" defaultValue={search} placeholder="Search phrases"
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
        <button className="btn-primary" type="submit">Search</button>
      </form>

      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-2">Phrase</th>
              <th className="px-4 py-2">Translation</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="px-4 py-2 align-top text-slate-600">{r.phrase}</td>
                <td className="px-4 py-2">
                  <input defaultValue={r.translated ?? ''}
                    onChange={(e) =>
                      setEdited((prev) => ({ ...prev, [r.id]: e.target.value }))}
                    className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button className="btn-primary" disabled={busy || Object.keys(edited).length === 0}
          onClick={async () => {
            setBusy(true); setMessage('');
            const res = await fetch(
              '/api/proxy/admin/languages/' + languageId + '/phrases', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ phrases: edited }),
              });
            const body = await res.json().catch(() => ({}));
            setBusy(false);
            if (!res.ok) { setMessage(body.message ?? 'Could not save.'); return; }
            setMessage('Saved ' + (body.data?.written ?? 0) + ' translations.');
            setEdited({});
            router.refresh();
          }}>
          {busy ? 'Saving...' : 'Save changes'}
        </button>
        <span className="text-sm text-slate-500">
          {Object.keys(edited).length} edited - {total} phrases
        </span>
        {message && <span className="text-sm text-slate-600">{message}</span>}
      </div>

      {lastPage > 1 && (
        <nav className="flex flex-wrap gap-2 text-sm">
          {Array.from({ length: lastPage }, (_, i) => i + 1).slice(0, 25).map((p) => (
            <a key={p} href={link(p)}
              className={p === page
                ? 'rounded bg-brand-600 px-3 py-1 text-white'
                : 'rounded border border-slate-300 px-3 py-1 hover:bg-slate-50'}>
              {p}
            </a>
          ))}
        </nav>
      )}
    </div>
  );
}
