import { dayTime, longWhen, daysBetween, INSTITUTION_TZ } from '@/lib/onyx-time';

/**
 * An instant, printed in the institution's zone.
 *
 * **The bug this exists for.** Almost every screen formatted a stored instant
 * with `toLocaleString(undefined, …)` inside a Server Component. `undefined`
 * means "whatever zone the runtime is in", and the runtime is a Vercel function
 * running in UTC — so an examination stored at 08:05Z was shown to a learner in
 * India as "Tue, Aug 25, 08:05 AM" when it starts at 13:35 their time. Five and
 * a half hours is not a cosmetic error on an exam timetable; it is a candidate
 * arriving after their paper has closed.
 *
 * Not a client component, deliberately. The zone is fixed (see
 * `INSTITUTION_TZ`), so the server and the browser produce the same characters:
 * there is nothing to hydrate, nothing to suppress, and no flash of one time
 * being replaced by another. A reader-zone version would need all three.
 */
export function LocalTime({ iso, className }: {
  iso: string | null | undefined;
  className?: string;
}) {
  if (!iso) return <span className={className}>No date</span>;
  if (!Number.isFinite(Date.parse(iso))) return <span className={className}>No date</span>;
  return (
    <time dateTime={iso} className={className} title={longWhen(iso) + ' · ' + INSTITUTION_TZ}>
      {dayTime(iso)}
    </time>
  );
}

const MIN = 60_000;

/** "1 h 38 min" rather than "98 minutes": the shape a clock is read in. */
function gap(ms: number): string {
  const mins = Math.max(0, Math.round(ms / MIN));
  if (mins < 60) return mins + ' min';
  return Math.floor(mins / 60) + ' h ' + String(mins % 60).padStart(2, '0') + ' min';
}

/**
 * Where a sitting sits in the day.
 *
 * Both halves of this were wrong on a server running in UTC: the clock time,
 * and — less obviously — the calendar day the relative words are counted from.
 * `setHours(0,0,0,0)` zeroes the clock in the runtime's zone, so a sitting at
 * 20:05Z fell on the day BEFORE the one its readers in India were living in,
 * and "Today" appeared on the wrong day. `daysBetween` counts from the
 * institution's midnight instead.
 */
export function ExamWhen({ startsAt, durationMinutes, cancelled = false, completed = false }: {
  startsAt: string | null | undefined;
  durationMinutes: number;
  cancelled?: boolean;
  completed?: boolean;
}) {
  const start = startsAt ? Date.parse(startsAt) : NaN;
  if (!Number.isFinite(start)) return <div className="font-semibold">No date</div>;

  const now = Date.now();
  const end = start + durationMinutes * MIN;
  const at = <LocalTime iso={startsAt} />;

  if (cancelled) {
    return (
      <>
        <div className="font-semibold">Cancelled</div>
        <div className="text-[12.5px] text-muted">{at}</div>
      </>
    );
  }
  if (now >= start && now < end) {
    return (
      <>
        <div className="font-semibold">Ends in {gap(end - now)}</div>
        <div className="text-[12.5px] text-muted">started {gap(now - start)} ago</div>
      </>
    );
  }
  if (now >= end || completed) {
    // Positive while the sitting is still ahead, negative once it has passed.
    const until = daysBetween(now, start);
    if (until > 0) {
      return (
        <>
          <div className="font-semibold">{at}</div>
          <div className="text-[12.5px] text-muted">marks released before the sitting</div>
        </>
      );
    }
    const ago = -until;
    return (
      <>
        <div className="font-semibold">
          {ago === 0 ? 'Today' : ago === 1 ? 'Yesterday'
            : ago <= 13 ? ago + ' days ago' : Math.round(ago / 7) + ' weeks ago'}
        </div>
        <div className="text-[12.5px] text-muted">sat {at}</div>
      </>
    );
  }
  const d = daysBetween(now, start);
  return (
    <>
      <div className="font-semibold">
        {d === 0 ? 'Today' : d === 1 ? 'Tomorrow'
          : d <= 13 ? 'In ' + d + ' days' : 'In ' + Math.round(d / 7) + ' weeks'}
      </div>
      <div className="text-[12.5px] text-muted">{at}</div>
    </>
  );
}
