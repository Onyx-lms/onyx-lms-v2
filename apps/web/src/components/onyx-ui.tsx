/**
 * The Onyx design system.
 *
 * One place for the primitives every Onyx screen is built from, so a change
 * to a card or a stat tile lands on all 36 of them at once rather than being
 * re-typed per page. Everything here is a server component unless it needs
 * state -- these are all presentational, so none of them do.
 *
 * The colour rules the tokens encode (see tailwind.config.ts) matter here:
 * `accent-500` is the logo orange at 3.17:1 on white, which fails AA for
 * text. It is used below for fills, rings and large numerals only; anywhere
 * orange has to carry words, it is `accent-700` at 5.71:1.
 */
import Link from 'next/link';
// Re-exported so every existing `from './onyx-ui'` import keeps working;
// it lives in lib/ because node --test cannot strip JSX out of this file.
export { percentText } from '@/lib/percent';
import { percentText } from '@/lib/percent';

/* ------------------------------------------------------------------ icons */

/**
 * One sprite, one stroke weight, one 24px grid.
 *
 * The alternative -- reaching for whatever Unicode glyph is closest (◎ ▣ ◇ ₹)
 * -- was what the first prototype did, and it read as exactly what it was:
 * placeholder. Optical weight has to be consistent or the whole product looks
 * unfinished, and that consistency has to live in one file.
 */
export const ICONS = {
  home: <><path d="M3 10.5 12 3l9 7.5" /><path d="M5.5 9.5V20h13V9.5" /><path d="M9.5 20v-6h5v6" /></>,
  book: <><path d="M4 4.5h6a3 3 0 0 1 3 3V20a2.5 2.5 0 0 0-2.5-2.5H4z" /><path d="M20 4.5h-6a3 3 0 0 0-3 3V20a2.5 2.5 0 0 1 2.5-2.5H20z" /></>,
  code: <><path d="m8.5 8.5-4 3.5 4 3.5" /><path d="m15.5 8.5 4 3.5-4 3.5" /><path d="m13.5 5-3 14" /></>,
  layers: <><path d="m12 3 9 5-9 5-9-5z" /><path d="m3 13 9 5 9-5" /></>,
  edit: <><path d="M4 20h4l10-10a2.8 2.8 0 0 0-4-4L4 16z" /><path d="m13.5 6.5 4 4" /></>,
  award: <><circle cx="12" cy="9" r="5.5" /><path d="m8.5 13.5-1.5 7 5-2.5 5 2.5-1.5-7" /></>,
  trophy: <><path d="M7 4h10v5a5 5 0 0 1-10 0z" /><path d="M7 6H4.5v1.5a3 3 0 0 0 3 3" /><path d="M17 6h2.5v1.5a3 3 0 0 1-3 3" /><path d="M12 14v3.5" /><path d="M8.5 20.5h7" /><path d="M10 17.5h4v3h-4z" /></>,
  calendar: <><rect x="3.5" y="5" width="17" height="15.5" rx="2.5" /><path d="M3.5 10h17" /><path d="M8 3v4M16 3v4" /></>,
  wallet: <><rect x="3" y="6" width="18" height="13" rx="2.5" /><path d="M3 10h18" /><circle cx="16.5" cy="14.5" r="1.3" /></>,
  help: <><circle cx="12" cy="12" r="9" /><path d="M9.6 9.4a2.5 2.5 0 1 1 3.4 2.3c-.7.3-1 .9-1 1.6v.4" /><path d="M12 17.2v.1" /></>,
  briefcase: <><rect x="3" y="7.5" width="18" height="12" rx="2.5" /><path d="M9 7.5V6a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v1.5" /><path d="M3 12.5h18" /></>,
  mic: <><rect x="9.5" y="3" width="5" height="10" rx="2.5" /><path d="M6 11a6 6 0 0 0 12 0" /><path d="M12 17v4" /></>,
  user: <><circle cx="12" cy="8.5" r="3.8" /><path d="M4.8 20a7.2 7.2 0 0 1 14.4 0" /></>,
  users: <><circle cx="9" cy="8.5" r="3.4" /><path d="M2.5 20a6.6 6.6 0 0 1 13 0" /><path d="M16 5.4a3.4 3.4 0 0 1 0 6.3" /><path d="M17.5 14.2A6.6 6.6 0 0 1 21.5 20" /></>,
  menu: <><path d="M4 7h16M4 12h16M4 17h16" /></>,
  bell: <><path d="M18 9a6 6 0 1 0-12 0c0 5-2 6-2 6h16s-2-1-2-6" /><path d="M10.3 20a2 2 0 0 0 3.4 0" /></>,
  play: <><path d="M8 5.5v13l11-6.5z" fill="currentColor" stroke="none" /></>,
  chevron: <><path d="m9.5 5.5 7 6.5-7 6.5" /></>,
  dots: <><circle cx="5.5" cy="12" r="1.6" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" /><circle cx="18.5" cy="12" r="1.6" fill="currentColor" stroke="none" /></>,
  check: <><path d="m5 12.5 4.5 4.5L19 7.5" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5.3l3.4 2" /></>,
  chart: <><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></>,
  flag: <><path d="M5.5 21V4.5h13l-2.5 4 2.5 4h-13" /></>,
  shield: <><path d="M12 3l7.5 3v5.5c0 4.4-3 8.2-7.5 9.5-4.5-1.3-7.5-5.1-7.5-9.5V6z" /></>,
  building: <><rect x="4" y="3.5" width="16" height="17" rx="2" /><path d="M9 8h2M13 8h2M9 12h2M13 12h2" /><path d="M10 20.5v-4h4v4" /></>,
  save: <><path d="M5 4h11l3 3v13H5z" /><path d="M8 4v5h8V4" /><path d="M8 20v-6h8v6" /></>,
  camera: <><path d="M4 8.5h3l1.5-2h7l1.5 2h3v11H4z" /><circle cx="12" cy="14" r="3.5" /></>,
  trash: <><path d="M5 7h14" /><path d="M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7" /><path d="M7 7l1 13h8l1-13" /></>,
  search: <><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4.5 4.5" /></>,
  filter: <><path d="M3.5 6h17l-6.5 7.5V20l-4-2v-4.5z" /></>,
  plus: <><path d="M12 5v14M5 12h14" /></>,
  download: <><path d="M12 4v11" /><path d="m7.5 10.5 4.5 4.5 4.5-4.5" /><path d="M4.5 19.5h15" /></>,
  upload: <><path d="M12 20V9" /><path d="m7.5 13.5 4.5-4.5 4.5 4.5" /><path d="M4.5 4.5h15" /></>,
  mail: <><rect x="3" y="5.5" width="18" height="13" rx="2.5" /><path d="m3.5 7 8.5 6 8.5-6" /></>,
  lock: <><rect x="5" y="10.5" width="14" height="9.5" rx="2.5" /><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" /></>,
  eye: <><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" /><circle cx="12" cy="12" r="3" /></>,
  alert: <><path d="M12 4.5 21 19.5H3z" /><path d="M12 10v4" /><path d="M12 17v.1" /></>,
  x: <><path d="M6 6l12 12M18 6 6 18" /></>,
  arrow: <><path d="M4 12h15" /><path d="m14 7 5 5-5 5" /></>,
  external: <><path d="M14 4h6v6" /><path d="m20 4-8.5 8.5" /><path d="M18 14v5.5a1.5 1.5 0 0 1-1.5 1.5h-12A1.5 1.5 0 0 1 3 19.5v-12A1.5 1.5 0 0 1 4.5 6H10" /></>,
  star: <><path d="m12 4 2.4 5 5.6.8-4 3.9 1 5.5-5-2.7-5 2.7 1-5.5-4-3.9 5.6-.8z" /></>,
  message: <><path d="M20.5 12.5a7.5 7.5 0 0 1-10.9 6.7L4 20.5l1.4-5.4A7.5 7.5 0 1 1 20.5 12.5z" /></>,
  video: <><rect x="3" y="6" width="12.5" height="12" rx="2.5" /><path d="m15.5 11 5.5-3v8l-5.5-3z" /></>,
  grid: <><rect x="3.5" y="3.5" width="7" height="7" rx="1.8" /><rect x="13.5" y="3.5" width="7" height="7" rx="1.8" /><rect x="3.5" y="13.5" width="7" height="7" rx="1.8" /><rect x="13.5" y="13.5" width="7" height="7" rx="1.8" /></>,
  list: <><path d="M8 6.5h12M8 12h12M8 17.5h12" /><path d="M4 6.5v.1M4 12v.1M4 17.5v.1" /></>,
  refresh: <><path d="M20 12a8 8 0 1 1-2.5-5.8" /><path d="M20 4v5h-5" /></>,
  card: <><rect x="2.5" y="5.5" width="19" height="13" rx="2.5" /><path d="M2.5 10h19" /></>,
  file: <><path d="M13 3.5H7A1.5 1.5 0 0 0 5.5 5v14A1.5 1.5 0 0 0 7 20.5h10a1.5 1.5 0 0 0 1.5-1.5V9z" /><path d="M13 3.5V9h5.5" /></>,
  target: <><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="4.5" /><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 13.5a7.6 7.6 0 0 0 0-3l2-1.5-2-3.5-2.4 1a7.6 7.6 0 0 0-2.6-1.5L14 2.5h-4l-.4 2.5a7.6 7.6 0 0 0-2.6 1.5l-2.4-1-2 3.5 2 1.5a7.6 7.6 0 0 0 0 3l-2 1.5 2 3.5 2.4-1a7.6 7.6 0 0 0 2.6 1.5l.4 2.5h4l.4-2.5a7.6 7.6 0 0 0 2.6-1.5l2.4 1 2-3.5z" /></>,
} as const;

export type IconName = keyof typeof ICONS;

export function Icon({ name, className = 'h-[19px] w-[19px]' }: {
  name: IconName; className?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24" aria-hidden="true" focusable="false"
      className={'shrink-0 ' + className}
      fill="none" stroke="currentColor" strokeWidth={1.7}
      strokeLinecap="round" strokeLinejoin="round"
    >
      {ICONS[name]}
    </svg>
  );
}

/* --------------------------------------------------------------- surfaces */

export function Card({ children, className = '', as: As = 'div' }: {
  children: React.ReactNode; className?: string; as?: 'div' | 'section' | 'li';
}) {
  return (
    <As className={'rounded-2xl border border-line bg-white shadow-card ' + className}>
      {children}
    </As>
  );
}

/** A section label + optional action, at the one size used everywhere. */
/**
 * The way back out of a detail screen.
 *
 * Every screen under /onyx that opens a single record -- a course, a paper, an
 * exam, a bank, a drive -- was reached from a list, and six of the nine had no
 * way back to it. The browser's own button is not the answer: a learner who
 * arrived from the dashboard, or from a link somebody sent them, has no history
 * to go back through, and on a phone the browser chrome is hidden while
 * scrolling. A link that names its destination also says where you are, which
 * a chevron alone does not.
 *
 * Rendered above the page title rather than beside it, so it reads as the level
 * above rather than as an action on this record.
 */
export function BackLink({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href}
      className="mb-3 inline-flex min-h-[36px] items-center gap-1.5 text-[13px] font-semibold
                 text-muted hover:text-brand-700 hover:underline">
      <Icon name="chevron" className="h-3.5 w-3.5 rotate-180" />
      {label}
    </Link>
  );
}

export function SectionHead({ title, id, action }: {
  title: string; id?: string; action?: { href: string; label: string };
}) {
  return (
    <div className="mb-2.5 flex items-baseline justify-between gap-3">
      <h2 id={id} className="text-[11.5px] font-bold uppercase tracking-[.085em] text-muted">
        {title}
      </h2>
      {action ? (
        <Link href={action.href}
          className="inline-flex min-h-[28px] items-center px-0.5 text-[13px] font-semibold
                     text-brand-600 hover:underline">
          {action.label}
        </Link>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ atoms */

/**
 * A progress ring. Reads faster than a 100px track at small sizes and, unlike
 * a bar, does not need horizontal room it will not get on a phone.
 */
export function Ring({ percent, label, size = 46 }: {
  percent: number; label?: string; size?: number;
}) {
  // `p` drives the geometry; `shown` is what a person reads. See percentText.
  const p = Math.max(0, Math.min(100, Math.round(percent)));
  const shown = percentText(percent);
  return (
    <span
      role="img" aria-label={label ?? `${shown} percent complete`}
      className="relative shrink-0" style={{ width: size, height: size }}
    >
      <span className="absolute inset-0 rounded-full"
        style={{ background: `conic-gradient(#D87818 ${p}%, #D7E9EE 0)` }} />
      <span className="absolute rounded-full bg-white" style={{ inset: size * 0.11 }} />
      <span className="absolute inset-0 z-10 grid place-items-center text-[11.5px]
                       font-extrabold tabular-nums text-brand-700">
        {shown}%
      </span>
    </span>
  );
}

/** A horizontal meter. `tone="light"` for use on the dark resume card. */
export function Meter({ percent, label, tone = 'dark' }: {
  percent: number; label: string; tone?: 'dark' | 'light';
}) {
  const p = Math.max(0, Math.min(100, Math.round(percent)));
  return (
    <div
      role="progressbar" aria-valuenow={p} aria-valuemin={0} aria-valuemax={100}
      aria-label={label}
      className={'h-2.5 overflow-hidden rounded-full '
        + (tone === 'light' ? 'bg-white/20' : 'bg-brand-100')}
    >
      <span className="block h-full rounded-full bg-gradient-to-r from-[#F0A24A] to-accent-500"
        style={{ width: p + '%' }} />
    </div>
  );
}

export function StatTile({ label, value, note, delta }: {
  label: string; value: string | number; note?: string; delta?: number;
}) {
  return (
    // The label renders in sentence case and is uppercased by CSS, so a test
    // matching on "LESSONS" finds nothing. The testid is the stable handle.
    <Card className="p-3.5">
      <div data-testid={'stat-' + label.toLowerCase().replace(/\s+/g, '-')}
        className="text-[10.5px] font-bold uppercase tracking-[.08em] text-muted">{label}</div>
      <div className="mt-1.5 text-[26px] font-extrabold leading-none tabular-nums">{value}</div>
      {note || delta !== undefined ? (
        <div className="mt-1.5 text-xs text-muted">
          {delta !== undefined && delta !== 0 ? (
            <span className={'font-bold ' + (delta > 0 ? 'text-green-700' : 'text-red-700')}>
              {delta > 0 ? '▲' : '▼'} {Math.abs(delta)}{' '}
            </span>
          ) : null}
          {note}
        </div>
      ) : null}
    </Card>
  );
}

/**
 * A status pill. `tone` maps to meaning, never to decoration -- `late` is the
 * only red thing on a student's dashboard, so red always means the same.
 */
export function Pill({ children, tone = 'neutral' }: {
  children: React.ReactNode; tone?: 'neutral' | 'soon' | 'late' | 'good' | 'brand';
}) {
  const tones = {
    neutral: 'bg-slate-100 text-muted',
    soon:    'bg-accent-50 text-accent-700',
    late:    'bg-red-50 text-red-700',
    good:    'bg-green-50 text-green-700',
    brand:   'bg-brand-50 text-brand-700',
  } as const;
  return (
    <span className={'shrink-0 whitespace-nowrap rounded-full px-2.5 py-1 text-[12.5px] '
      + 'font-bold ' + tones[tone]}>
      {children}
    </span>
  );
}

/* ------------------------------------------------------------------ dates */

/**
 * Human, relative dates -- "Tomorrow", "in 5 days", "2 days late".
 *
 * The dashboard previously rendered `toLocaleString()`, i.e.
 * "8/17/2026, 12:00:00 AM". For the one thing a student scans a list for --
 * what is urgent -- that is the least readable format available, and it makes
 * lateness something you work out rather than something you see.
 */
export function relativeDue(due: string | null | undefined, now = Date.now()): {
  text: string; tone: 'neutral' | 'soon' | 'late';
} {
  if (!due) return { text: 'No due date', tone: 'neutral' };
  const t = Date.parse(due);
  if (!Number.isFinite(t)) return { text: 'No due date', tone: 'neutral' };

  const dayMs = 86_400_000;
  // Compare calendar days, not elapsed hours: something due at 09:00 tomorrow
  // is "Tomorrow" whether it is now 22:00 or 08:00, which is how a person
  // reading a timetable thinks about it.
  const startOf = (ms: number) => { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); };
  const days = Math.round((startOf(t) - startOf(now)) / dayMs);

  if (days < 0) {
    const n = Math.abs(days);
    return { text: n === 1 ? '1 day late' : `${n} days late`, tone: 'late' };
  }
  if (days === 0) return { text: 'Due today', tone: 'soon' };
  if (days === 1) return { text: 'Tomorrow', tone: 'soon' };
  if (days <= 7) return { text: `in ${days} days`, tone: days <= 3 ? 'soon' : 'neutral' };
  if (days <= 30) return { text: `in ${Math.round(days / 7)} weeks`, tone: 'neutral' };
  return { text: new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }),
    tone: 'neutral' };
}

/** Empty states, styled once so no screen invents its own. */
export function Empty({ children, icon }: { children: React.ReactNode; icon?: IconName }) {
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
      {icon ? <span className="text-muted"><Icon name={icon} className="h-7 w-7" /></span> : null}
      <p className="text-sm text-muted">{children}</p>
    </div>
  );
}

/* -------------------------------------------------------------- list rows */

/**
 * The row every list on this product is made of.
 *
 * The inner screens had all drifted to bare `<table>`s -- assessments, results,
 * practice, jobs, contests -- while the dashboard got cards, progress and
 * chips. A table is right when someone is comparing values down a column and
 * wrong when they are picking one thing to open, which is what all of those
 * screens actually are. The difference showed: a learner arriving at
 * Assessments saw four columns of grey text and no indication of what to do.
 *
 * So: a leading icon that says what kind of thing this is, a title that is the
 * link, one line of context under it, the state as a chip, and the action as a
 * button. Everything optional except the title, so one component covers a
 * problem, a paper, a job and a contest without any of them being bent to fit.
 */
export function ListRow({ icon, title, href, meta, chips, action, trailing, tone }: {
  icon?: IconName;
  title: string;
  href?: string;
  /** One line under the title. Context, never a repeat of it. */
  meta?: React.ReactNode;
  chips?: React.ReactNode;
  action?: { href: string; label: string };
  /** A number or ring that belongs on the right, before the action. */
  trailing?: React.ReactNode;
  /** Colours the leading icon. Meaning only -- see Pill. */
  tone?: 'neutral' | 'brand' | 'good' | 'late';
}) {
  const tones = {
    neutral: 'bg-slate-100 text-muted',
    brand: 'bg-brand-50 text-brand-700',
    good: 'bg-green-50 text-green-700',
    late: 'bg-red-50 text-red-700',
  } as const;

  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3.5
                   transition-colors hover:bg-brand-50/40 sm:flex-nowrap">
      {icon ? (
        <span className={'grid h-10 w-10 shrink-0 place-items-center rounded-xl '
          + tones[tone ?? 'neutral']}>
          <Icon name={icon} className="h-[18px] w-[18px]" />
        </span>
      ) : null}

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {href ? (
            // The whole title is the target, not a "view" link at the end of
            // the row -- a five-pixel word is a poor thing to ask a thumb for.
            <Link href={href} className="truncate text-[15px] font-semibold hover:underline">
              {title}
            </Link>
          ) : (
            <span className="truncate text-[15px] font-semibold">{title}</span>
          )}
          {chips}
        </div>
        {meta ? <div className="mt-0.5 text-[13px] text-muted">{meta}</div> : null}
      </div>

      {trailing ? <div className="shrink-0 text-right">{trailing}</div> : null}
      {action ? <ActionLink href={action.href} label={action.label} /> : null}
    </li>
  );
}

/** The list rows sit in. One border, one divider rule, one radius. */
export function RowList({ children, label }: {
  children: React.ReactNode; label?: string;
}) {
  return (
    <ul aria-label={label}
      className="divide-y divide-line overflow-hidden rounded-2xl border border-line
                 bg-white shadow-card">
      {children}
    </ul>
  );
}

/**
 * The one primary action on a row or a card.
 *
 * A link rather than a button because every one of them navigates; styled as a
 * button because that is what it does for the person reading it.
 */
export function ActionLink({ href, label, tone = 'brand' }: {
  href: string; label: string; tone?: 'brand' | 'quiet';
}) {
  const tones = {
    brand: 'bg-brand-600 text-white hover:bg-brand-700',
    quiet: 'border border-line text-slate-700 hover:bg-brand-50',
  } as const;
  return (
    <Link href={href}
      className={'inline-flex min-h-[38px] shrink-0 items-center gap-1.5 rounded-2xl px-3.5 '
        + 'text-[13px] font-bold ' + tones[tone]}>
      {label}
    </Link>
  );
}

/** A responsive grid of cards. Two up on a tablet, three on a desktop. */
export function CardGrid({ children, min = '17rem' }: {
  children: React.ReactNode; min?: string;
}) {
  return (
    <div className="grid gap-3.5"
      style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(min(' + min + ', 100%), 1fr))' }}>
      {children}
    </div>
  );
}

/* ------------------------------------------------------------ data tables */

/**
 * The table an operator console is made of.
 *
 * The learner screens moved off tables because a learner is picking one thing
 * to open. An administrator is doing the opposite -- scanning forty rows and
 * comparing a column -- and for that a table is not a fallback, it is the right
 * instrument. What the admin screens were missing was not a different shape but
 * the same care: the audit log, the roster and the institution list each drew
 * their own header row, their own borders and their own empty state.
 *
 * So this is one surface, one header treatment, one divider, one empty state.
 * `<DataTable>` renders the chrome; the caller writes the `<tr>`s, because a
 * column-config abstraction would have to grow a way to express every cell any
 * of these screens needs and would earn nothing for it.
 *
 * `caption` is not decoration: it is what a screen reader announces before it
 * starts reading rows, and a table without one is a grid of numbers with no
 * name. It is visually hidden and always required.
 */
export function DataTable({ caption, head, children, empty, scroll = true }: {
  /** Announced to a screen reader before the rows. Never optional. */
  caption: string;
  /** The `<th>` cells. Wrapped in the header row for you. */
  head: React.ReactNode;
  children: React.ReactNode;
  /** Shown instead of the body when there is nothing. */
  empty?: React.ReactNode;
  /** Wide tables scroll inside their own box rather than the page. */
  scroll?: boolean;
}) {
  const table = (
    // `rows-linked` (globals.css) makes the whole row activate the link in its
    // first cell. It is applied here rather than per table because every table
    // in the product is built the same way -- destination in the first cell,
    // extra controls at the end -- and a row that opens only when you hit the
    // words is a target the width of the words. A table whose first cell has no
    // link is unaffected: the rule has nothing to match.
    <table className="rows-linked w-full text-sm">
      <caption className="sr-only">{caption}</caption>
      <thead>
        <tr className="border-b border-line bg-slate-50 text-left text-[11px] uppercase
                       tracking-[.06em] text-muted [&>th]:whitespace-nowrap
                       [&>th]:px-4 [&>th]:py-2.5 [&>th]:font-bold">
          {head}
        </tr>
      </thead>
      <tbody className="divide-y divide-line [&>tr>td]:px-4 [&>tr>td]:py-3
                        [&>tr:hover]:bg-brand-50/40">
        {children}
      </tbody>
    </table>
  );

  /*
   * Two things here are load-bearing, both found by measuring at 320px.
   *
   * The shell and the scroller are separate elements. They used to be one, with
   * `overflow-hidden` and `overflow-x-auto` set on it together — which is a
   * conflict resolved by whichever rule Tailwind happens to emit last, not by
   * intent, so the table sometimes clipped instead of scrolling.
   *
   * And `relative` is not decoration: <caption className="sr-only"> is
   * absolutely positioned, so without a positioned ancestor it resolves against
   * the initial containing block, lands at the wide table's far-right
   * coordinate in DOCUMENT space, and drags page scroll width past the viewport
   * while staying invisible. It cost three screens before it was traced.
   */
  return (
    <div className="relative min-w-0 overflow-hidden rounded-2xl border border-line
                    bg-white shadow-card">
      <div className={'relative min-w-0 ' + (scroll ? 'overflow-x-auto' : '')}>
        {table}
      </div>
      {empty}
    </div>
  );
}

/**
 * A row that is nothing but an empty state, spanning the table.
 *
 * Inside the tbody rather than after it, so the message sits where the rows
 * would be instead of below a table with a header and no content.
 */
export function EmptyRow({ colSpan, icon, children }: {
  colSpan: number; icon?: IconName; children: React.ReactNode;
}) {
  return (
    <tr className="hover:!bg-transparent">
      <td colSpan={colSpan} className="!p-0">
        <Empty icon={icon}>{children}</Empty>
      </td>
    </tr>
  );
}

/**
 * On or off, as a dot and a word.
 *
 * Colour alone cannot carry a state -- about one man in twelve would read the
 * red and the green as the same -- so the word is always there and the dot is
 * the thing that makes it scannable down a column.
 */
export function StatusDot({ on, onLabel = 'Active', offLabel = 'Suspended' }: {
  on: boolean; onLabel?: string; offLabel?: string;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-[13px] font-semibold">
      <span aria-hidden="true"
        className={'h-2 w-2 shrink-0 rounded-full ' + (on ? 'bg-green-600' : 'bg-red-600')} />
      <span className={on ? 'text-green-700' : 'text-red-700'}>{on ? onLabel : offLabel}</span>
    </span>
  );
}

/* ===================================================================== */
/* The primitives the screen designs added. Same rule as everything above:
   a change here lands on every screen at once rather than being re-typed. */
/* ===================================================================== */

/**
 * A four-state status, as a dot AND a word.
 *
 * `StatusDot` above only knows on/off. A session is running, an invigilator is
 * idle, a register is missing — three states, and the same reason applies:
 * colour alone cannot carry any of them.
 */
export function State({ tone, children }: {
  tone: 'on' | 'off' | 'idle' | 'live'; children: React.ReactNode;
}) {
  const tones = {
    on:   'text-green-700 [&>i]:bg-green-600',
    off:  'text-red-700 [&>i]:bg-red-600',
    idle: 'text-muted [&>i]:bg-faint',
    live: 'text-red-700 [&>i]:bg-red-600 [&>i]:animate-pulse',
  } as const;
  return (
    <span className={'inline-flex items-center gap-1.5 whitespace-nowrap text-[13px] '
      + 'font-semibold ' + tones[tone]}>
      <i aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full" />
      {children}
    </span>
  );
}

/**
 * A mark, banded by value.
 *
 * The band is the fast read and the number is the accurate one, so both are
 * always present — a colour-blind marker reading a column of these gets the
 * same information, just a beat slower.
 */
export function Score({ value, outOf, band }: {
  value: number | string; outOf?: number; band?: 'hi' | 'mid' | 'lo' | 'none';
}) {
  const pct = typeof value === 'number' && outOf ? (value / outOf) * 100 : null;
  const auto = band ?? (pct === null ? 'none' : pct >= 70 ? 'hi' : pct >= 40 ? 'mid' : 'lo');
  const tones = {
    hi:   'bg-green-50 text-green-700',
    mid:  'bg-accent-50 text-accent-700',
    lo:   'bg-red-50 text-red-700',
    none: 'bg-slate-100 text-muted',
  } as const;
  return (
    <span className={'inline-grid min-w-[42px] place-items-center rounded-[9px] px-2 py-0.5 '
      + 'text-[13px] font-extrabold tabular-nums ' + tones[auto]}>
      {value}{outOf ? <span className="font-bold opacity-70">/{outOf}</span> : null}
    </span>
  );
}

/** A page-level message. Tone maps to meaning, never to decoration. */
export function Banner({ tone = 'info', icon, action, children }: {
  tone?: 'info' | 'warn' | 'late' | 'good';
  icon?: IconName; action?: React.ReactNode; children: React.ReactNode;
}) {
  const tones = {
    info: 'border-blue-200 bg-blue-50 text-blue-900',
    warn: 'border-yellow-200 bg-yellow-50 text-yellow-900',
    late: 'border-red-200 bg-red-50 text-red-900',
    good: 'border-green-200 bg-green-50 text-green-900',
  } as const;
  return (
    <div className={'flex items-start gap-3 rounded-2xl border px-4 py-3 text-sm ' + tones[tone]}>
      {icon ? <Icon name={icon} className="mt-0.5 h-[18px] w-[18px] shrink-0" /> : null}
      <div className="min-w-0 flex-1">{children}</div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

/**
 * Segmented filters that carry their own counts.
 *
 * The count belongs in the label: it tells you what is behind a filter before
 * you spend a click finding out it was empty.
 */
export function Segmented({ items }: {
  items: { label: string; href: string; count?: number; active?: boolean }[];
}) {
  return (
    <div className="inline-flex flex-wrap gap-0.5 rounded-[13px] bg-slate-100 p-[3px]">
      {items.map((i) => (
        <Link key={i.href + i.label} href={i.href}
          aria-current={i.active ? 'page' : undefined}
          className={'whitespace-nowrap rounded-[10px] px-3 py-1.5 text-[13px] font-semibold '
            + (i.active ? 'bg-white text-ink shadow-card' : 'text-muted hover:text-ink')}>
          {i.label}
          {i.count !== undefined
            ? <span className="ml-1 tabular-nums opacity-60">{i.count}</span> : null}
        </Link>
      ))}
    </div>
  );
}

/** The strip above a table: search, filters, then the actions. */
export function Toolbar({ children }: { children: React.ReactNode }) {
  return <div className="mb-3 flex flex-wrap items-center gap-2">{children}</div>;
}

export function SearchBox({ placeholder = 'Search…', name = 'search', defaultValue }: {
  placeholder?: string; name?: string; defaultValue?: string;
}) {
  return (
    <label className="flex h-10 max-w-[340px] flex-1 basis-[220px] items-center gap-2
                      rounded-xl border border-line bg-white px-3">
      <Icon name="search" className="h-4 w-4 shrink-0 text-muted" />
      <span className="sr-only">{placeholder}</span>
      <input name={name} defaultValue={defaultValue} placeholder={placeholder}
        className="min-w-0 flex-1 border-0 bg-transparent text-sm outline-none" />
    </label>
  );
}

/**
 * A lifecycle, shown as the thing it is.
 *
 * Draft > Published > Closed > Marked > Released is a sequence, and a status
 * chip alone throws away where in that sequence you are and what comes next.
 */
export function Stepper({ steps }: {
  steps: { label: string; state: 'done' | 'current' | 'todo' }[];
}) {
  const tones = {
    done:    'bg-green-50 text-green-700',
    current: 'bg-brand-600 text-white',
    todo:    'bg-slate-100 text-muted',
  } as const;
  return (
    <ol className="flex flex-wrap items-center gap-1 text-[13px]">
      {steps.map((s, i) => (
        <li key={s.label} className="flex items-center gap-1">
          <span className={'inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 '
            + 'font-semibold ' + tones[s.state]}>
            {s.state === 'done' ? <Icon name="check" className="h-3.5 w-3.5" /> : null}
            {s.label}
          </span>
          {i < steps.length - 1
            ? <Icon name="chevron" className="h-3 w-3 text-faint" /> : null}
        </li>
      ))}
    </ol>
  );
}

/**
 * A total split into where it sits — the shape Stripe uses for collections.
 *
 * Four disconnected tiles cannot answer "how much of it is late"; one bar with
 * its breakdown underneath can, and the bar and the rows share an order.
 */
export function StackBar({ parts }: { parts: { value: number; className: string }[] }) {
  const total = parts.reduce((n, p) => n + p.value, 0) || 1;
  return (
    <div className="flex h-2.5 overflow-hidden rounded-full bg-line">
      {parts.map((p, i) => (
        <span key={i} className={p.className} style={{ width: (p.value / total) * 100 + '%' }} />
      ))}
    </div>
  );
}

export function Buckets({ rows }: {
  rows: { label: string; dotClass: string; count?: React.ReactNode; amount: React.ReactNode }[];
}) {
  return (
    <ul className="mt-3 divide-y divide-line">
      {rows.map((r) => (
        <li key={r.label} className="flex items-center gap-2.5 py-2.5 text-[13.5px]">
          <span aria-hidden className={'h-2.5 w-2.5 shrink-0 rounded-full ' + r.dotClass} />
          <span className="min-w-0 flex-1">{r.label}</span>
          {r.count !== undefined
            ? <span className="tabular-nums text-muted">{r.count}</span> : null}
          <span className="min-w-[84px] text-right font-bold tabular-nums">{r.amount}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * The dark band a learner lands on.
 *
 * Progress alone says where you are, not what to do — so the action names the
 * next thing rather than saying "continue" and making you click to find out.
 */
export function Hero({ eyebrow, title, sub, actions, children }: {
  eyebrow?: string; title: React.ReactNode; sub?: React.ReactNode;
  actions?: React.ReactNode; children?: React.ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-2xl bg-gradient-to-br from-brand-700 to-brand-900
                        p-5 text-white shadow-lift sm:p-6">
      <div className="flex flex-wrap items-start gap-4">
        <div className="min-w-0">
          {eyebrow ? (
            <p className="text-[11px] font-bold uppercase tracking-[.11em] text-white/70">
              {eyebrow}
            </p>
          ) : null}
          <h2 className="mt-1 text-[19px] font-extrabold leading-snug sm:text-[22px]">{title}</h2>
          {sub ? <p className="mt-1 text-sm text-white/80">{sub}</p> : null}
        </div>
        {actions ? <div className="ml-auto flex shrink-0 flex-wrap gap-2">{actions}</div> : null}
      </div>
      {children ? <div className="mt-4">{children}</div> : null}
    </section>
  );
}

/**
 * The theatre frame a video lesson sits in.
 *
 * Video wants black behind it, not a white card — and the controls that sit on
 * that black have to be light-on-dark or they vanish.
 */
export function Theatre({ label, meta, children, actions }: {
  label?: React.ReactNode; meta?: React.ReactNode;
  children: React.ReactNode; actions?: React.ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-2xl bg-ink shadow-lift">
      {(label || meta) ? (
        <div className="flex items-center gap-3 px-4 py-2.5 text-[12.5px] font-semibold text-white/75">
          <span className="flex min-w-0 items-center gap-2 truncate">{label}</span>
          <span className="ml-auto flex shrink-0 items-center gap-2">{meta}</span>
        </div>
      ) : null}
      <div className="px-2 pb-2 sm:px-3 sm:pb-3">{children}</div>
      {actions ? (
        <div className="flex flex-wrap items-center gap-2.5 px-3 pb-3 text-[13px]">{actions}</div>
      ) : null}
    </div>
  );
}

/** A read-only code panel. */
export function CodeBlock({ filename, children }: {
  filename?: string; children: React.ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-xl bg-[#0B1F28] font-mono text-[12.8px] leading-relaxed text-slate-300">
      {filename ? (
        <div className="flex items-center gap-2 border-b border-white/10 bg-[#0A1A22] px-3 py-2
                        text-[12px] font-semibold text-white/70">
          <span aria-hidden className="flex gap-1.5">
            <i className="h-2.5 w-2.5 rounded-full bg-white/20" />
            <i className="h-2.5 w-2.5 rounded-full bg-white/20" />
            <i className="h-2.5 w-2.5 rounded-full bg-white/20" />
          </span>
          {filename}
        </div>
      ) : null}
      <pre className="overflow-x-auto px-3.5 py-3"><code>{children}</code></pre>
    </div>
  );
}
