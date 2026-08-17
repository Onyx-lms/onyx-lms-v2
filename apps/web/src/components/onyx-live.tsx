'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Keeps a server-rendered page current while somebody is watching it.
 *
 * The invigilation console is the reason this exists. It is a server component,
 * so it rendered once and then sat there: an invigilator with the page open saw
 * the room exactly as it was when they loaded it, and a camera that dropped out
 * two minutes later never appeared. A live console that does not update is
 * worse than a static one, because it looks live.
 *
 * `router.refresh()` re-runs the server component and swaps the result in
 * without touching scroll position or focus, so a refresh underneath somebody's
 * cursor does not move what they were reading.
 *
 * Refreshing stops while the tab is hidden. Nobody is invigilating a tab they
 * cannot see, and polling in the background costs the database a query every
 * few seconds per open console for no one's benefit.
 */
export function LiveRefresh({ seconds = 15, label = 'This page' }: {
  seconds?: number;
  label?: string;
}) {
  const router = useRouter();
  const [on, setOn] = useState(true);
  const [at, setAt] = useState<string | null>(null);

  useEffect(() => {
    if (!on) return;
    const tick = () => {
      if (document.visibilityState !== 'visible') return;
      router.refresh();
      setAt(new Date().toLocaleTimeString());
    };
    const timer = setInterval(tick, Math.max(5, seconds) * 1000);
    return () => clearInterval(timer);
  }, [on, seconds, router]);

  return (
    <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-muted">
      <span>
        {label} {on ? 'updates every ' + seconds + ' seconds' : 'is not updating'}
        {at && on ? ' · last at ' + at : ''}
      </span>
      {/* Stoppable on purpose: an invigilator writing a note about attempt 14
          should not have the table reorder itself under them mid-sentence. */}
      <button
        type="button" onClick={() => setOn((v) => !v)}
        className="rounded-lg border border-line bg-white px-2.5 py-1 text-[12px]
                   font-semibold text-slate-700 hover:bg-brand-50"
      >
        {on ? 'Pause updates' : 'Resume updates'}
      </button>
    </div>
  );
}
