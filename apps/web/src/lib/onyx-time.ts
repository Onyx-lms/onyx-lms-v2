/**
 * One time zone, named once, for every date this product prints.
 *
 * **The bug this exists to end.** Almost every screen formatted a stored
 * instant with `toLocaleString(undefined, …)` inside a Server Component.
 * `undefined` means "whatever zone the runtime is in", and the runtime is a
 * Vercel function running in UTC — so an examination stored at 08:05Z was shown
 * to a learner in India as "08:05 AM" when it starts at 13:35 their time. Five
 * and a half hours is not a cosmetic error on an exam timetable; it is a
 * candidate arriving after their paper has closed.
 *
 * The zone is FIXED at Asia/Kolkata rather than taken from the reader's
 * browser, and that is a deliberate choice, not a shortcut:
 *
 *   * A campus timetable is in the institution's time. An examination at 13:35
 *     in Hyderabad is at 13:35 for everybody sitting it, including the one
 *     candidate whose laptop is still set to the timezone of a holiday.
 *   * A fixed zone renders identically on the server and in the browser, so
 *     there is no hydration mismatch to suppress and no flash of one time being
 *     replaced by another.
 *   * It is verifiable. "What does this screen say" has one answer that a test
 *     can assert, rather than one per reader.
 *
 * If this product is ever sold outside India, this constant is the single place
 * that has to become a per-institution column — every caller already goes
 * through it.
 */
export const INSTITUTION_TZ = 'Asia/Kolkata';

/**
 * The locale, pinned for the same reason as the zone.
 *
 * `en-IN` gives day-before-month, which is what every reader of this product
 * expects. Left to the runtime it was `en-US` on the server, so the same date
 * read "8/25/2026" to one reader and "25/8/2026" to another.
 */
export const INSTITUTION_LOCALE = 'en-IN';

/** Options with the zone already applied. */
export const inTz = (opts: Intl.DateTimeFormatOptions = {}): Intl.DateTimeFormatOptions => ({
  ...opts, timeZone: INSTITUTION_TZ,
});

const fmt = (value: string | number | Date | null | undefined,
  opts: Intl.DateTimeFormatOptions, fallback: string): string => {
  if (value === null || value === undefined || value === '') return fallback;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return fallback;
  return d.toLocaleString(INSTITUTION_LOCALE, inTz(opts));
};

/** "25 Aug 2026, 1:35 pm" — the default a list of dated things wants. */
export const dateTime = (v: string | number | Date | null | undefined, fallback = '—') =>
  fmt(v, { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' },
    fallback);

/** "Tue, 25 Aug, 1:35 pm" — with the weekday, for a timetable. */
export const dayTime = (v: string | number | Date | null | undefined, fallback = '—') =>
  fmt(v, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' },
    fallback);

/** "25 Aug 2026" */
export const dateOnly = (v: string | number | Date | null | undefined, fallback = '—') =>
  fmt(v, { day: 'numeric', month: 'short', year: 'numeric' }, fallback);

/** "1:35 pm" */
export const timeOnly = (v: string | number | Date | null | undefined, fallback = '—') =>
  fmt(v, { hour: 'numeric', minute: '2-digit' }, fallback);

/** "Tuesday, 25 August 2026 at 1:35 pm" — one record's own page. */
export const longWhen = (v: string | number | Date | null | undefined, fallback = '—') =>
  fmt(v, {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
  }, fallback);

/**
 * The calendar day an instant falls on, IN THE INSTITUTION'S ZONE.
 *
 * `new Date(x).setHours(0,0,0,0)` uses the runtime's zone, so on a server in
 * UTC a sitting at 20:05Z fell on the wrong side of midnight for a reader in
 * India and was labelled "Today" on the day after it happened. Relative words
 * are counted from this, never from the runtime's own midnight.
 */
export function dayNumber(value: string | number | Date): number {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return NaN;
  // en-CA gives ISO-ordered YYYY-MM-DD, which subtracts cleanly as a date.
  const [y, m, day] = d.toLocaleDateString('en-CA', inTz()).split('-').map(Number);
  return Math.round(Date.UTC(y!, m! - 1, day!) / 86_400_000);
}

/** Calendar days between two instants, in the institution's zone. */
export const daysBetween = (from: string | number | Date, to: string | number | Date) =>
  dayNumber(to) - dayNumber(from);

/** A `datetime-local` input's value for a stored instant, in institution time. */
/**
 * What day it is HERE, rather than wherever the runtime happens to be.
 *
 * **The bug this exists to end**, and it is the twin of the one at the top of
 * this file. Formatting an instant went through `INSTITUTION_TZ` and was
 * right; the day ARITHMETIC did not. `new Date().getDay()` asks the runtime,
 * and the runtime is a Vercel function in UTC -- so between midnight and 05:30
 * IST the product was a day behind. At 01:55 on Thursday 27 August the
 * timetable headlined "TODAY · WEDNESDAY" and highlighted the 26th, while the
 * audit log on the same deployment correctly said Thursday.
 *
 * That is five and a half hours of every day, every day, for every Indian
 * institution: a lecturer opening the timetable before dawn is shown
 * yesterday's classes, and a learner's streak counts the wrong square.
 *
 * These read the parts back out of `Intl` in the institution's zone rather
 * than doing offset arithmetic, because an offset is a thing that changes and
 * a zone database is a thing that is maintained.
 */

/** Year, month and day as the institution sees them right now. */
export function partsInTz(at: Date = new Date()): { y: number; m: number; d: number } {
  const f = new Intl.DateTimeFormat('en-CA', inTz({
    year: 'numeric', month: '2-digit', day: '2-digit',
  }));
  const [y, m, d] = f.format(at).split('-').map(Number);
  return { y: y!, m: m!, d: d! };
}

/**
 * The weekday, 0 = Sunday, as JavaScript numbers it -- but in the
 * institution's zone.
 *
 * A drop-in for `new Date().getDay()`, which is exactly how it is meant to be
 * used: every caller of that was wrong for the same reason.
 */
export function weekdayInTz(at: Date = new Date()): number {
  const name = new Intl.DateTimeFormat('en-US', inTz({ weekday: 'short' })).format(at);
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(name);
}

/** Monday = 1 … Sunday = 7, which is how the timetable numbers its columns. */
export function isoWeekdayInTz(at: Date = new Date()): number {
  return ((weekdayInTz(at) + 6) % 7) + 1;
}

/** Today as `YYYY-MM-DD`, in the institution's zone rather than in UTC. */
export function todayInTz(at: Date = new Date()): string {
  const { y, m, d } = partsInTz(at);
  return String(y) + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0');
}

export function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  // sv-SE formats as "2026-08-25 13:35", one space away from what the input
  // wants — and unlike hand-rolled padding it gets the zone shift right.
  return d.toLocaleString('sv-SE', inTz({
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  })).replace(' ', 'T').slice(0, 16);
}

/**
 * What a `datetime-local` value means as an instant, read as institution time.
 *
 * `new Date('2026-08-25T13:35')` is parsed in the RUNTIME's zone, so a browser
 * set to anything other than IST would store the wrong instant for a time typed
 * into a form headed "IST". This pins it: the offset is measured for that exact
 * date, so it stays correct across any future change to India's offset.
 */
export function fromLocalInput(value: string): string | null {
  if (!value) return null;
  const naive = Date.parse(value + ':00Z');
  if (!Number.isFinite(naive)) return null;
  // How far the institution's zone is from UTC at that moment.
  const probe = new Date(naive);
  const asTz = new Date(probe.toLocaleString('en-US', inTz()));
  const asUtc = new Date(probe.toLocaleString('en-US', { timeZone: 'UTC' }));
  return new Date(naive - (asTz.getTime() - asUtc.getTime())).toISOString();
}
