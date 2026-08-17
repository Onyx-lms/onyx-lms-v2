import Link from 'next/link';
import type { Metadata } from 'next';
import { OnyxBrand } from '@/components/onyx-brand';
import { Card, Icon } from '@/components/onyx-ui';

export const metadata: Metadata = { title: 'Not available' };

/**
 * The wall, and the two ways off it.
 *
 * A shield rather than a cross, and teal rather than red: the account did
 * nothing wrong, a boundary held. Red would read as an error the person is
 * expected to go and fix. No shell either -- rebuilding the whole navigation
 * around a refusal invites another go at the same door.
 */
export default function OnyxDenied() {
  return (
    // A plain div: the Onyx root layout already provides `<main id="main">`,
    // which is what the skip link targets.
    <div className="mx-auto w-full max-w-[520px] px-4 pb-10 pt-12">
      <div className="mb-6 flex justify-center">
        <OnyxBrand />
      </div>

      <Card className="p-6 sm:p-7">
        <div className="grid place-items-center">
          <span className="grid h-14 w-14 place-items-center rounded-xl2 bg-brand-50
                           text-brand-700">
            <Icon name="shield" className="h-7 w-7" />
          </span>
        </div>

        <h1 className="mt-3.5 text-center text-[22px] font-extrabold tracking-tight">
          That page is not part of your role here
        </h1>
        <p className="mx-auto mt-1.5 max-w-[42ch] text-center text-sm text-muted">
          Nothing is wrong with your account. The page you followed belongs to a
          different job at this institution.
        </p>

        <hr className="my-5 border-line" />

        {/* Membership of a second institution is the one case where this refusal
            is a misunderstanding rather than a rule. Worth saying; not worth
            switching anybody automatically, which would move them without
            asking. The switcher itself lives in the shell. */}
        <div className="flex items-start gap-3 text-sm text-muted">
          <Icon name="building" className="mt-0.5 h-[18px] w-[18px]" />
          <p className="min-w-0 flex-1">
            If you also belong to another institution, switching may change what you
            can reach &mdash; your role is set separately at each one.
          </p>
        </div>
      </Card>

      {/* Two exits and no third. Going back is what most people want; asking
          for access is what the rest want, and without it the only remaining
          move is an email to somebody they have to go and find. */}
      <div className="mt-4 grid gap-2.5 sm:grid-cols-2">
        <Link href="/onyx/dashboard"
          className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-2xl
                     bg-brand-600 px-4 text-sm font-bold text-white hover:bg-brand-700">
          <Icon name="home" className="h-4 w-4" />
          Back to the dashboard
        </Link>
        <Link href="/onyx/support"
          className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-2xl
                     border border-line bg-white px-4 text-sm font-bold text-slate-700
                     hover:bg-brand-50">
          <Icon name="mail" className="h-4 w-4" />
          Ask for access
        </Link>
      </div>

      <p className="mt-4 text-center text-xs text-muted">
        Asking for access raises a question with the administrators at your institution,
        naming the page you were trying to reach. Nothing is sent automatically.
      </p>
    </div>
  );
}
