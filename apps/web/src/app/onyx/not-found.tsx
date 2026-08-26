import Link from 'next/link';
import { Icon } from '@/components/onyx-ui';

/**
 * Something that is not there.
 *
 * Reached two ways: a URL under `/onyx` with no page behind it, and -- far more
 * often -- `onyxApiRecord` answering a 404 from the API, which is what a stale
 * link, a mistyped id, or an id belonging to another institution produces.
 * Every one of those used to render Next's production error screen: a grey
 * "Application error: a server-side exception has occurred" and a digest,
 * which says nothing a person can act on and looks like the product broke.
 *
 * No shell around it, deliberately. The shell needs `/api/onyx/me`, and this
 * page has to render for somebody whose session is fine and whose id is not,
 * for somebody who is signed out, and for a path that never existed. A page
 * whose error state can itself fail is not an error state.
 *
 * A `div`, not a `main`. The root layout's StorefrontChrome owns the one
 * `<main id="main">` that the skip link targets, so rendering another one here
 * put two main landmarks on the page -- and screen-reader landmark navigation
 * lands on whichever comes first, which is the outer one wrapping the whole
 * document. The pages that render no shell already carry this note; this was
 * the one that did not.
 */
export default function OnyxNotFound() {
  return (
    <div className="grid min-h-[70vh] place-items-center px-6 py-16">
      <div className="w-full max-w-md text-center">
        <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-brand-50
                         text-brand-700">
          <Icon name="search" className="h-6 w-6" />
        </span>
        <h1 className="mt-4 text-[22px] font-extrabold tracking-tight">Nothing here</h1>
        <p className="mx-auto mt-2 max-w-sm text-[14px] leading-relaxed text-muted">
          This page, or the record it was for, does not exist — or it belongs to an
          institution this account is not part of. Links go stale, and ids get pasted
          from the wrong place.
        </p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
          <Link href="/onyx/dashboard"
            className="inline-flex min-h-[42px] items-center rounded-xl bg-brand-600 px-4
                       text-[14.5px] font-bold text-white hover:bg-brand-700">
            Go to your dashboard
          </Link>
          <Link href="/onyx/login"
            className="inline-flex min-h-[42px] items-center rounded-xl border border-line px-4
                       text-[14.5px] font-semibold hover:bg-canvas">
            Sign in
          </Link>
        </div>
      </div>
    </div>
  );
}
