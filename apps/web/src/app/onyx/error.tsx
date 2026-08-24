'use client';

import Link from 'next/link';
import { useEffect } from 'react';

/**
 * When a page under `/onyx` throws.
 *
 * What this replaces is Next's own production screen: "Application error: a
 * server-side exception has occurred while loading …", a digest, and nothing
 * else -- no way back, no indication of whether the thing is broken or the
 * person is. It is what every unhandled read rendered as.
 *
 * A genuine fault still throws (and should: `onyxApiRecord` only converts a
 * 404, so a database that is down is not quietly reported as "not found").
 * What changes is that the person gets a page: what happened, a button that
 * retries the render, and a way out of it.
 *
 * The digest is kept and shown small. It is the only handle a support
 * conversation has on which of the day's errors this one was, and asking
 * somebody to read a screenshot of a grey wall to find it is worse than
 * printing it.
 */
export default function OnyxError({ error, reset }: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Server-side digests are already in the platform log; this is the browser
    // half, so a client-thrown error is not invisible.
    console.error('[onyx] page error', error);
  }, [error]);

  return (
    <main className="grid min-h-[70vh] place-items-center px-6 py-16">
      <div className="w-full max-w-md text-center">
        <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-rose-50
                         text-rose-700">
          <svg viewBox="0 0 24 24" aria-hidden="true" className="h-6 w-6" fill="none"
            stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 4.5 21 19.5H3z" /><path d="M12 10v4" /><path d="M12 17v.1" />
          </svg>
        </span>
        <h1 className="mt-4 text-[22px] font-extrabold tracking-tight">
          This page could not be loaded
        </h1>
        <p className="mx-auto mt-2 max-w-sm text-[14px] leading-relaxed text-muted">
          Something went wrong on our side, not yours. Nothing you were doing has been lost —
          try again, and if it keeps happening the reference below is what to quote.
        </p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
          <button type="button" onClick={reset}
            className="inline-flex min-h-[42px] items-center rounded-xl bg-brand-600 px-4
                       text-[14.5px] font-bold text-white hover:bg-brand-700">
            Try again
          </button>
          <Link href="/onyx/dashboard"
            className="inline-flex min-h-[42px] items-center rounded-xl border border-line px-4
                       text-[14.5px] font-semibold hover:bg-canvas">
            Go to your dashboard
          </Link>
        </div>
        {error.digest ? (
          <p className="mt-5 font-mono text-[11.5px] text-faint">
            Reference {error.digest}
          </p>
        ) : null}
      </div>
    </main>
  );
}
