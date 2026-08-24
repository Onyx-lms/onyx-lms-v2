import Link from 'next/link';
import { Card, Icon } from '@/components/onyx-ui';

/**
 * What is still missing from a profile, and why it matters that it is.
 *
 * The profile page opened with an identity card and then four editors, and
 * nowhere did it say whether the thing was finished. A half-written profile
 * looks exactly like a complete one until somebody scrolls the whole page and
 * counts the empty boxes themselves -- and the fields most often left empty
 * are the ones that do the work: a headline and a bio are what a placement
 * officer reads, and they are the two nobody is ever prompted to write.
 *
 * So: a count, a track, and the specific things left, each linking to where it
 * is written. Completed items are listed too rather than disappearing, because
 * a checklist that empties as you go gives no sense of progress at the end --
 * and because seeing "photo, added" confirms the thing you did actually saved.
 *
 * Every item is genuinely optional. This is a nudge, never a gate: nothing in
 * the product refuses to work because a bio is empty, and the copy is careful
 * not to imply otherwise.
 */
export interface ProfileTask {
  key: string;
  label: string;
  /** Why a reader would care, in one clause. Shown only while it is undone. */
  why: string;
  done: boolean;
  /** An in-page anchor, so "add it" lands on the field rather than the page. */
  href: string;
}

export function ProfileProgress({ tasks }: { tasks: ProfileTask[] }) {
  const done = tasks.filter((t) => t.done);
  const left = tasks.filter((t) => !t.done);
  // Rounded, but never to a misleading 100: a profile with one thing left says
  // 96, not "100" with a task still on the list under it.
  const raw = tasks.length ? (done.length / tasks.length) * 100 : 100;
  const percent = left.length ? Math.min(99, Math.round(raw)) : 100;
  const complete = left.length === 0;

  return (
    <Card className="p-4 sm:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="text-[15px] font-extrabold text-ink">
          {complete ? 'Your profile is complete' : 'Finish your profile'}
        </h2>
        <p className="text-[13px] tabular-nums text-muted">
          <span className="font-bold text-ink">{percent}%</span>
          {complete ? null : ' · ' + left.length
            + (left.length === 1 ? ' thing left' : ' things left')}
        </p>
      </div>

      <div
        role="progressbar"
        aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}
        aria-label={'Profile ' + percent + ' per cent complete'}
        className="mt-2.5 h-2 overflow-hidden rounded-full bg-slate-100"
      >
        <span
          className={'block h-full rounded-full transition-[width] duration-500 '
            + (complete ? 'bg-green-600' : 'bg-brand-600')}
          style={{ width: Math.max(2, percent) + '%' }}
        />
      </div>

      <p className="mt-2.5 text-[12.5px] leading-relaxed text-muted">
        {complete
          ? 'Nothing is missing. Everything below is yours to change whenever you like.'
          : 'None of this is required — but a profile with these filled in is the one a '
            + 'placement officer or an employer can actually read.'}
      </p>

      {left.length ? (
        <ul className="mt-3 space-y-1.5">
          {left.map((t) => (
            <li key={t.key}>
              <Link
                href={t.href}
                className="flex items-start gap-2.5 rounded-xl border border-line px-3 py-2.5
                           hover:border-brand-300 hover:bg-brand-50/40"
              >
                {/* An empty ring, not an unticked checkbox: this is not a
                    control, and something that looks clickable-as-a-checkbox
                    invites a click that does nothing. */}
                <span aria-hidden="true"
                  className="mt-0.5 h-4 w-4 shrink-0 rounded-full border-2 border-slate-300" />
                <span className="min-w-0 flex-1">
                  <span className="block text-[13.5px] font-semibold text-ink">{t.label}</span>
                  <span className="block text-[12.5px] leading-relaxed text-muted">{t.why}</span>
                </span>
                <Icon name="chevron" aria-hidden="true"
                  className="mt-1 h-4 w-4 shrink-0 text-muted" />
              </Link>
            </li>
          ))}
        </ul>
      ) : null}

      {done.length ? (
        <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
          {done.map((t) => (
            <li key={t.key}
              className="flex items-center gap-1.5 text-[12.5px] text-muted">
              <Icon name="check" aria-hidden="true" className="h-3.5 w-3.5 text-green-600" />
              {t.label}
            </li>
          ))}
        </ul>
      ) : null}
    </Card>
  );
}
