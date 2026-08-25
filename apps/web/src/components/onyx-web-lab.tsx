'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { WebEditor } from '@/components/onyx-web-editor';
import { startingFiles, type WebFile, type WebFiles } from '@/lib/onyx-web-preview';

/**
 * Practising a web problem: build the page, watch it, hand it in.
 *
 * The Code Lab twin of `OnyxCodeLab`, and separate from it for the reason the
 * two problems are separate: that one has a language picker, a Run against
 * visible cases, and a verdict to wait for. This has none of those, because
 * there is nothing to run and nothing to wait for — the page renders as it is
 * typed, and handing in is a decision to keep it, not a request to be judged.
 *
 * So the copy says so plainly. A learner who presses Hand it in and gets
 * neither a tick nor a cross should be told that is the whole story, rather
 * than left refreshing for a result that is never coming.
 */
export function OnyxWebLab({ problem }: {
  problem: {
    id: number;
    starter_code?: Record<string, string> | null;
    preview_entry?: string;
  };
}) {
  const router = useRouter();
  const [files, setFiles] = useState<Record<WebFile, string>>(
    () => startingFiles(problem.starter_code as WebFiles | null));
  const [kept, setKept] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const hand = () => start(async () => {
    setError(null);
    const res = await fetch('/api/proxy/onyx/problems/' + problem.id + '/submit-web', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ files }),
    });
    const body = await res.json().catch(() => ({ ok: false }));
    if (!body.ok) { setError(body.message ?? 'That did not work.'); return; }
    setKept(Number(body.data?.id) || null);
    router.refresh();
  });

  return (
    <div className="space-y-3">
      {error ? (
        <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </p>
      ) : null}

      <WebEditor
        value={files}
        entry={problem.preview_entry}
        onChange={setFiles}
        onRun={hand}
        busy={pending}
        note={'There are no test cases on a web problem — what you build is looked at by a '
          + 'person. Handing in keeps this version of your three files; you can keep '
          + 'working and hand in again.'}
      />

      {kept ? (
        <p className="rounded-xl border border-emerald-300 bg-emerald-50 px-3 py-2 text-[13px]
                      text-emerald-900">
          Kept. Your page is saved as it stands and your lecturer can open it. Nothing is
          scored — carry on and hand in again whenever you want to.
        </p>
      ) : null}
    </div>
  );
}
