'use client';

import { useState } from 'react';

/**
 * BC-04 -- fetches a signed, short-lived URL at click time rather than
 * embedding one in the HTML. A link in the page would outlive the session and
 * could be shared with someone who never bought the workshop.
 */
export function ResourceLink({ id, title, kind }: {
  id: number; title: string | null; kind: string | null;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  return (
    <>
      <button className="text-brand-700 hover:underline disabled:opacity-60" disabled={busy}
        onClick={async () => {
          setBusy(true); setError('');
          const res = await fetch('/api/proxy/bootcamp-resources/' + id + '/download');
          const body = await res.json().catch(() => ({}));
          setBusy(false);
          if (!res.ok || !body.data?.url) {
            setError(body.message ?? 'That file is not available.');
            return;
          }
          window.open(body.data.url, '_blank', 'noopener');
        }}>
        {title}
        <span className="ml-2 text-xs text-slate-400">
          {kind === 'record' ? 'recording' : 'resource'}
        </span>
      </button>
      {error && <span className="ml-2 text-xs text-red-600">{error}</span>}
    </>
  );
}
