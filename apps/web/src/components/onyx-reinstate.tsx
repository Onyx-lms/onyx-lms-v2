'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Icon } from '@/components/onyx-ui';

/**
 * Let a candidate whose paper was stopped carry on from where they were.
 *
 * The counterpart to the rule that stops them. A paper handed in after three
 * departures is a judgement made by a counter, and a counter cannot tell
 * somebody switching to their email from somebody whose screen reader stole
 * focus three times, or whose laptop slept, or who was called out of the room
 * by an invigilator. This is the person who can tell the difference saying so.
 *
 * It asks once before acting, and the confirmation says exactly what will
 * happen — the same answers, the same minutes, the warnings starting again —
 * because "reinstate" is a word that could mean half a dozen things and an
 * invigilator pressing it is usually doing so with a candidate standing beside
 * them.
 *
 * `basePath` is what makes it work on both sides: an institution's own
 * invigilator reaches the attempt at `onyx/attempts/:id`, a platform operator
 * through the console's tenant-scoped guard. Same service call either way.
 */
export function ReinstateAttempt({ attemptId, name, basePath = 'onyx/attempts/', compact }: {
  attemptId: number;
  /** Who it is, so the confirmation is about a person rather than an id. */
  name?: string | null;
  basePath?: string;
  /** A row control rather than a panel button. */
  compact?: boolean;
}) {
  const router = useRouter();
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const go = () => start(async () => {
    setError(null);
    const res = await fetch('/api/proxy/' + basePath + attemptId + '/reinstate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    const body = await res.json().catch(() => ({ ok: false }));
    if (!body.ok) { setError(body.message ?? 'That did not work.'); return; }
    setAsking(false);
    router.refresh();
  });

  if (asking) {
    return (
      <div className="min-w-[18rem] space-y-2 text-left">
        <p className="text-[12.5px] leading-relaxed text-slate-700">
          {name ? name + ' will' : 'They will'} be able to carry on from exactly where they
          stopped — the same answers, and the minutes that were left on the clock when the
          paper was stopped. Their warnings start again from the first.
        </p>
        {error ? <p role="alert" className="text-[12.5px] text-red-700">{error}</p> : null}
        <div className="flex flex-wrap gap-1.5">
          <button type="button" disabled={pending} onClick={go}
            className="inline-flex min-h-[32px] items-center rounded-lg bg-emerald-700 px-3
                       text-[12.5px] font-bold text-white hover:bg-emerald-800
                       disabled:opacity-60">
            {pending ? 'Restoring…' : 'Let them carry on'}
          </button>
          <button type="button" disabled={pending} onClick={() => setAsking(false)}
            className="inline-flex min-h-[32px] items-center rounded-lg border border-line
                       px-3 text-[12.5px] font-semibold hover:bg-slate-50">
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <button type="button" onClick={() => setAsking(true)}
      className={compact
        ? 'inline-flex min-h-[30px] items-center gap-1 rounded-lg border border-emerald-300 '
          + 'px-2.5 text-[12.5px] font-semibold text-emerald-800 hover:bg-emerald-50'
        : 'inline-flex min-h-[36px] items-center gap-1.5 rounded-xl border border-emerald-300 '
          + 'bg-white px-3 text-[13px] font-semibold text-emerald-800 hover:bg-emerald-50'}>
      <Icon name="refresh" className="h-3.5 w-3.5" />
      Let them carry on
    </button>
  );
}

/**
 * "Stopped after three departures", where an invigilator will read it.
 *
 * Separate from the button because the fact and the action are wanted in
 * different places: a table row wants the fact in a cell and the button in the
 * last column, and a detail page wants them together.
 */
export function StoppedBadge({ at, breaches }: {
  at: string | null | undefined;
  breaches?: number;
}) {
  if (!at) return null;
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-2 py-0.5
                     text-[11.5px] font-semibold text-rose-800">
      <Icon name="alert" className="h-3 w-3" />
      Stopped{breaches ? ' after ' + breaches : ''}
    </span>
  );
}
