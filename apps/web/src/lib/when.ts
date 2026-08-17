/**
 * One way to write a date, on the server and in the browser.
 *
 * `new Date(x).toLocaleString()` looks harmless and is the single largest
 * source of hydration failures in this app. With no locale and no time zone it
 * resolves both from the *environment*, and a server-rendered page has a
 * different environment from the browser that hydrates it: Node runs with an
 * ICU default of `en-US` at `TZ=UTC`, a phone in Bengaluru is `en-IN` at IST.
 * So the server writes "Aug 14, 05:37 PM", the client writes "14 Aug, 07:29 pm",
 * React finds text that does not match, and production emits minified error
 * #418. Two symptoms the QA audit filed separately -- the hydration error and
 * "two date formats in the same inbox" -- are this one cause.
 *
 * Hydration repairs also move focus and re-announce content, so this is an
 * accessibility bug as much as a correctness one.
 *
 * The fix is to stop asking the environment. Both values are pinned, so a
 * timestamp renders identically wherever it is rendered.
 *
 * **The institution's clock, not the reader's.** A timetable saying 09:00 must
 * mean 09:00 at the institution -- for a learner travelling, or staff marking
 * from another country, "9am your time" is a different lecture. That is why
 * this is a deliberate product decision rather than a technical default, and
 * why high-stakes surfaces should print the zone alongside (see `zoneLabel`).
 *
 * Overridable per deployment: an institution outside India sets
 * `NEXT_PUBLIC_ONYX_LOCALE` and `NEXT_PUBLIC_ONYX_TIME_ZONE`. They must be
 * `NEXT_PUBLIC_` -- the browser half of a hydrated page has to read the same
 * values the server did, or this file reintroduces the bug it exists to fix.
 */

export const LOCALE = process.env.NEXT_PUBLIC_ONYX_LOCALE || 'en-IN';
export const TIME_ZONE = process.env.NEXT_PUBLIC_ONYX_TIME_ZONE || 'Asia/Kolkata';

/** Short zone name for the places where being wrong by hours matters. */
export function zoneLabel(): string {
  try {
    const parts = new Intl.DateTimeFormat(LOCALE, { timeZone: TIME_ZONE, timeZoneName: 'short' })
      .formatToParts(new Date(0));
    return parts.find((p) => p.type === 'timeZoneName')?.value ?? TIME_ZONE;
  } catch {
    return TIME_ZONE;
  }
}

function parse(value: string | number | Date | null | undefined): Date | null {
  if (value === null || value === undefined || value === '') return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

const fmt = (opts: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat(LOCALE, { timeZone: TIME_ZONE, ...opts });

// Built once. `Intl.DateTimeFormat` construction is the expensive part, and
// these render inside lists.
const DATE = fmt({ day: 'numeric', month: 'short', year: 'numeric' });
const DATE_SHORT = fmt({ day: 'numeric', month: 'short' });
const TIME = fmt({ hour: '2-digit', minute: '2-digit' });
const DATE_TIME = fmt({ day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const DATE_TIME_FULL = fmt({
  day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
});

/** "14 Aug 2026". The em dash, not an empty string, so a gap is visible. */
export const formatDate = (v: string | number | Date | null | undefined) => {
  const d = parse(v); return d ? DATE.format(d) : '—';
};

/** "14 Aug" -- for lists where the year is obvious from context. */
export const formatDateShort = (v: string | number | Date | null | undefined) => {
  const d = parse(v); return d ? DATE_SHORT.format(d) : '—';
};

/** "17:29" */
export const formatTime = (v: string | number | Date | null | undefined) => {
  const d = parse(v); return d ? TIME.format(d) : '—';
};

/** "14 Aug, 17:29" */
export const formatDateTime = (v: string | number | Date | null | undefined) => {
  const d = parse(v); return d ? DATE_TIME.format(d) : '—';
};

/** "14 Aug 2026, 17:29" -- receipts, credentials, anything auditable. */
export const formatDateTimeFull = (v: string | number | Date | null | undefined) => {
  const d = parse(v); return d ? DATE_TIME_FULL.format(d) : '—';
};
