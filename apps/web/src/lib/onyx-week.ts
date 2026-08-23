import { TIME_ZONE } from '@/lib/when';

/**
 * CMP-01c -- putting dated events on a weekly grid.
 *
 * The timetable grid was built for one coordinate system and now has to carry
 * two. `onyx_timetable_slots` is weekly recurrence: a day number, two
 * wall-clock times, no date and no time zone. Examinations and assessments are
 * absolute `timestamptz`. Placing the second on a grid built for the first
 * needs an actual week, which is what this file supplies and what the page
 * never used to need.
 *
 * **Everything here works in the institution's zone, not the server's.** A
 * sitting at 09:00 in Kolkata is 03:30 UTC, and asking a UTC `Date` which day
 * of the week that is gives the right answer for eighteen and a half hours a
 * day and the wrong one for the rest. `TIME_ZONE` is pinned for the same
 * reason `when.ts` pins it -- see that file's header on hydration.
 */

/** The parts of a timestamp, read in the institution's zone rather than UTC. */
function partsIn(at: Date): { y: number; m: number; d: number; hh: number; mm: number } {
  const f = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
  const got: Record<string, string> = {};
  for (const p of f.formatToParts(at)) got[p.type] = p.value;
  return {
    y: Number(got.year), m: Number(got.month), d: Number(got.day),
    // 24-hour formatting renders midnight as "24" in some engines.
    hh: Number(got.hour) % 24, mm: Number(got.minute),
  };
}

/** Minutes past midnight, in the institution's zone. */
export function minutesOfDay(at: string | Date): number {
  const p = partsIn(new Date(at));
  return p.hh * 60 + p.mm;
}

/** `YYYY-MM-DD` in the institution's zone -- the key a day column is found by. */
export function dayKey(at: string | Date): string {
  const p = partsIn(new Date(at));
  return String(p.y) + '-' + String(p.m).padStart(2, '0') + '-' + String(p.d).padStart(2, '0');
}

/**
 * The Monday-to-Sunday week containing `offset` weeks from today.
 *
 * Monday first because `onyx_timetable_slots.day_of_week` is 1=Monday (0008),
 * and a grid whose columns disagreed with the column that fills them would put
 * every recurring class on the wrong day.
 *
 * The bounds are returned as instants covering the whole week in the
 * institution's zone -- a query on `starts_at` has to span from local Monday
 * 00:00 to local Sunday 23:59, which is not the same as the UTC week.
 */
export function weekOf(offset: number, now = new Date()): {
  days: { key: string; date: Date; label: string; weekday: number }[];
  from: string;
  to: string;
  label: string;
} {
  const here = partsIn(now);
  // Midday, so a day never slides either side of a daylight-saving boundary
  // while we are only doing date arithmetic.
  const anchor = new Date(Date.UTC(here.y, here.m - 1, here.d, 12));
  const weekday = (anchor.getUTCDay() + 6) % 7;           // 0 = Monday
  anchor.setUTCDate(anchor.getUTCDate() - weekday + offset * 7);

  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(anchor);
    d.setUTCDate(d.getUTCDate() + i);
    return {
      key: String(d.getUTCFullYear()) + '-'
        + String(d.getUTCMonth() + 1).padStart(2, '0') + '-'
        + String(d.getUTCDate()).padStart(2, '0'),
      date: d,
      label: d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }),
      weekday: i + 1,                                     // 1 = Monday, to match the column
    };
  });

  const first = days[0]!.date;
  const last = days[6]!.date;
  return {
    days,
    // Generous by a day at each end rather than exact to the minute: the query
    // is filtered again by day key when the events are placed, and being one
    // hour short at a zone boundary would drop a real sitting.
    from: new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), first.getUTCDate() - 1))
      .toISOString(),
    to: new Date(Date.UTC(last.getUTCFullYear(), last.getUTCMonth(), last.getUTCDate() + 2))
      .toISOString(),
    label: first.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })
      + ' – '
      + last.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }),
  };
}

/** An examination or a class, as something the grid can position. */
export interface WeekBlock {
  id: string;
  kind: 'exam' | 'class';
  dayKey: string;
  weekday: number;
  fromMin: number;
  toMin: number;
  title: string;
  meta: string[];
  href?: string;
  /** A cancelled sitting is shown, struck through, rather than disappearing. */
  muted?: boolean;
  draft?: boolean;
  /** Tailwind classes for the box. Decided where the block is built, because
   *  that is the only place that knows what it came from. */
  tone: string;
}

export interface CalendarExam {
  id: number; course_id: number | null; title: string;
  starts_at: string; duration_minutes: number;
  max_marks: number; pass_marks: number; status: string;
  assessment_id?: number | null;
}

export interface CalendarAssessment {
  id: number; course_id: number | null; title: string;
  opens_at: string | null; closes_at: string | null;
  duration_minutes: number; attempts_allowed: number;
  pass_mark: number | null; status: string;
}

/**
 * An examination as a block on the grid.
 *
 * A sitting has a real start and a real length, so unlike an assessment window
 * it is honestly a box: this is the one kind of event where the height means
 * what a reader will assume it means.
 */
export function examBlock(exam: CalendarExam, courseName?: string): WeekBlock {
  const from = minutesOfDay(exam.starts_at);
  return {
    id: 'exam-' + exam.id,
    kind: 'exam',
    dayKey: dayKey(exam.starts_at),
    weekday: 0,                              // filled in by the page from dayKey
    fromMin: from,
    toMin: from + Math.max(20, Number(exam.duration_minutes || 60)),
    title: exam.title,
    meta: [
      courseName ?? null,
      exam.max_marks ? String(exam.max_marks) + ' marks' : null,
      exam.status === 'cancelled' ? 'Cancelled' : null,
    ].filter(Boolean) as string[],
    href: '/onyx/exams/' + exam.id,
    muted: exam.status === 'cancelled',
    draft: exam.status === 'draft',
    // Red, and the loudest thing on the grid. An examination is the one
    // appointment on this page somebody cannot turn up late to.
    tone: exam.status === 'cancelled'
      ? 'border-slate-400 bg-slate-100'
      : exam.status === 'draft'
        ? 'border-slate-400 bg-slate-100'
        : 'border-red-600 bg-red-50',
  };
}
