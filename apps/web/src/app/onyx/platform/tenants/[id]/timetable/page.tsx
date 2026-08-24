import Link from 'next/link';
import type { Metadata } from 'next';
import { requirePlatformSession } from '@/lib/onyx-platform-session';
import { attempt, Unavailable } from '@/lib/onyx-platform-tenant';
import { weekOf, dayKey, minutesOfDay } from '@/lib/onyx-week';
import { Card, Icon, Pill, SectionHead } from '@/components/onyx-ui';

export const metadata: Metadata = { title: 'Timetable' };

interface ExamRow {
  id: number; course_id: number | null; assessment_id: number | null;
  title: string; starts_at: string; duration_minutes: number | null;
  max_marks: number | null; status: string;
  course: { id: number; code: string; title: string } | null;
}
interface PaperRow {
  id: number; course_id: number | null; title: string;
  opens_at: string | null; closes_at: string | null; duration_minutes: number;
  status: string;
  course: { id: number; code: string; title: string } | null;
}
interface ExamWeek { exams: ExamRow[]; assessments: PaperRow[] }

/** A block on the grid: one sitting, positioned by its real minutes. */
interface Block {
  id: number; weekday: number; fromMin: number; toMin: number;
  subject: string; name: string; href: string;
  draft: boolean; cancelled: boolean;
}

const HOUR_PX = 64;
const hhmm = (min: number) =>
  String(Math.floor(min / 60)).padStart(2, '0') + ':' + String(min % 60).padStart(2, '0');

/**
 * The examination week, as the console needs to read it.
 *
 * This page used to be the institution's own operational table: recurring
 * class slots, with a room and a lecturer against each, and a "rooms in use"
 * figure at the top. That is the view of somebody allocating rooms, and an
 * operator does not allocate rooms. What they want is the week a candidate
 * would see — which in this product is examinations and papers, not lectures.
 *
 * So: a grid, the same shape a learner reads, carrying the three things that
 * identify a sitting and nothing else — the subject, the examination's name,
 * and when it runs. No rooms, no lecturers, no seat numbers.
 *
 * **The height means what a reader assumes it means.** A block is positioned
 * and sized from actual minutes, so a ninety-minute paper is visibly longer
 * than a fifty-minute one and a gap in the day looks like a gap. The hour axis
 * is continuous between the earliest start and the latest finish, because a
 * timetable is read for its gaps as much as for its appointments.
 */
export default async function OnyxPlatformTimetablePage(
  { params, searchParams }: {
    params: Promise<{ id: string }>;
    searchParams?: Promise<{ week?: string }>;
  },
) {
  await requirePlatformSession();
  const { id } = await params;
  const tenantId = Number(id);
  const offset = Number((await searchParams)?.week ?? 0) || 0;
  const week = weekOf(offset);

  const data = await attempt<ExamWeek>(
    '/api/onyx/platform/tenants/' + encodeURIComponent(id) + '/exam-week'
    + '?from=' + encodeURIComponent(week.from)
    + '&to=' + encodeURIComponent(week.to));

  if (data === null) return <Unavailable what="timetable" />;

  const dayIndex = new Map(week.days.map((d, i) => [d.key, i]));
  // Today, in the institution's own day rather than the server's.
  const todayKey = dayKey(new Date());
  /** The column heading: the weekday's short name and its date. */
  const heading = (d: { key: string; date: Date }) => ({
    short: d.date.toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' }),
    dayOfMonth: d.date.getUTCDate(),
    isToday: d.key === todayKey,
  });

  const blocks: Block[] = (data.exams ?? [])
    .map((e) => {
      const weekday = dayIndex.get(dayKey(e.starts_at));
      if (weekday === undefined) return null;
      const from = minutesOfDay(e.starts_at);
      return {
        id: e.id,
        weekday,
        fromMin: from,
        toMin: from + Math.max(30, Number(e.duration_minutes || 60)),
        subject: e.course?.code ?? 'No course',
        name: e.title,
        href: '/onyx/platform/tenants/' + tenantId + '/examinations/' + e.id,
        draft: e.status === 'draft',
        cancelled: e.status === 'cancelled',
      };
    })
    .filter(Boolean) as Block[];

  /*
   * The hour axis, continuous.
   *
   * Rows of "hours something starts in" would put 09:00 next to 14:00 and make
   * a five-hour gap look like an hour. Padded to a plausible day so one
   * morning sitting does not draw a single band.
   */
  const firstHour = Math.min(8, ...blocks.map((b) => Math.floor(b.fromMin / 60)));
  const lastHour = Math.max(17, ...blocks.map((b) => Math.ceil(b.toMin / 60)));
  const hours = Array.from({ length: Math.max(1, lastHour - firstHour) },
    (_, i) => firstHour + i);

  /**
   * Everything on one day, side by side where it overlaps.
   *
   * Two sittings at the same hour is a clash, and a clash drawn as one box on
   * top of another is a clash nobody sees. Lanes are assigned greedily: a
   * block takes the first lane whose previous occupant has finished.
   */
  const layout = (day: number) => {
    const onDay = blocks.filter((b) => b.weekday === day)
      .sort((a, b) => a.fromMin - b.fromMin);
    const laneEnds: number[] = [];
    const placed = onDay.map((block) => {
      let lane = laneEnds.findIndex((end) => end <= block.fromMin);
      if (lane === -1) { lane = laneEnds.length; laneEnds.push(0); }
      laneEnds[lane] = block.toMin;
      return { block, lane };
    });
    return { placed, lanes: Math.max(1, laneEnds.length) };
  };

  // Papers with a closing date but no sitting of their own. They have no hour
  // to occupy, so they are listed rather than drawn -- a box whose height
  // means nothing is worse than a line of text.
  const windows = (data.assessments ?? [])
    .filter((a) => a.closes_at && !(data.exams ?? []).some((e) => e.assessment_id === a.id));

  const link = (n: number) => '/onyx/platform/tenants/' + tenantId + '/timetable?week=' + n;

  return (
    <div className="min-w-0 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[13px] font-semibold text-ink">{week.label}</p>
          <p className="text-[12.5px] text-muted">
            {blocks.length} sitting{blocks.length === 1 ? '' : 's'} this week
            {windows.length ? ' · ' + windows.length + ' paper window'
              + (windows.length === 1 ? '' : 's') : ''}
          </p>
        </div>
        <nav aria-label="Week" className="flex items-center gap-1.5">
          <Link href={link(offset - 1)}
            className="min-h-[34px] rounded-lg border border-line px-3 py-1.5 text-[13px]
                       font-semibold hover:bg-brand-50">
            <span aria-hidden>←</span> Previous
          </Link>
          <Link href={link(0)}
            className={'min-h-[34px] rounded-lg border px-3 py-1.5 text-[13px] font-semibold '
              + (offset === 0
                ? 'border-brand-600 bg-brand-600 text-white'
                : 'border-line hover:bg-brand-50')}>
            This week
          </Link>
          <Link href={link(offset + 1)}
            className="min-h-[34px] rounded-lg border border-line px-3 py-1.5 text-[13px]
                       font-semibold hover:bg-brand-50">
            Next <span aria-hidden>→</span>
          </Link>
        </nav>
      </div>

      {blocks.length === 0 ? (
        <Card className="p-8 text-center">
          <Icon name="calendar" className="mx-auto h-6 w-6 text-muted" />
          <p className="mt-2 text-[14px] font-semibold text-ink">Nothing is scheduled this week.</p>
          <p className="mx-auto mt-1 max-w-sm text-[13px] leading-relaxed text-muted">
            Examinations appear here on the day and at the hour they run.
          </p>
        </Card>
      ) : (
        <div tabIndex={0} role="region" aria-label="Examination timetable"
          className="overflow-x-auto rounded-2xl border border-line bg-white">
          <div className="min-w-[820px]">
            {/* The day headings, above the columns they label. */}
            <div className="grid border-b border-line"
              style={{ gridTemplateColumns: '56px repeat(7, minmax(0, 1fr))' }}>
              <div />
              {week.days.map((d) => {
                const h = heading(d);
                return (
                  <div key={d.key}
                    className={'border-l border-line px-2 py-2 text-center '
                      + (h.isToday ? 'bg-brand-50' : '')}>
                    <div className="text-[11px] font-bold uppercase tracking-wide text-muted">
                      {h.short}
                    </div>
                    <div className={'text-[13px] font-bold tabular-nums '
                      + (h.isToday ? 'text-brand-700' : 'text-ink')}>
                      {h.dayOfMonth}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="grid" style={{ gridTemplateColumns: '56px repeat(7, minmax(0, 1fr))' }}>
              {/* The hour axis. */}
              <div>
                {hours.map((h) => (
                  <div key={h} style={{ height: HOUR_PX }}
                    className="border-b border-line pr-2 pt-1 text-right font-mono text-[11px]
                               tabular-nums text-muted">
                    {String(h).padStart(2, '0')}:00
                  </div>
                ))}
              </div>

              {week.days.map((d, dayNumber) => {
                const { placed, lanes } = layout(dayNumber);
                return (
                  <div key={d.key}
                    className={'relative border-l border-line '
                      + (heading(d).isToday ? 'bg-brand-50/40' : '')}
                    style={{ height: hours.length * HOUR_PX }}>
                    {hours.map((h) => (
                      <div key={h} style={{ height: HOUR_PX }} className="border-b border-line" />
                    ))}

                    {placed.map(({ block, lane }) => {
                      const top = ((block.fromMin - firstHour * 60) / 60) * HOUR_PX;
                      const height = Math.max(34,
                        ((block.toMin - block.fromMin) / 60) * HOUR_PX - 3);
                      return (
                        <Link
                          key={block.id}
                          href={block.href}
                          style={{
                            top, height,
                            left: 'calc(' + (lane * 100 / lanes) + '% + 3px)',
                            width: 'calc(' + (100 / lanes) + '% - 6px)',
                          }}
                          title={block.subject + ' · ' + block.name + ' · '
                            + hhmm(block.fromMin) + '–' + hhmm(block.toMin)}
                          className={'absolute overflow-hidden rounded-lg border-l-[3px] px-2 py-1 '
                            + 'text-left shadow-sm transition hover:shadow-md '
                            + (block.cancelled
                              ? 'border-slate-400 bg-slate-100 text-slate-500'
                              : block.draft
                                ? 'border-slate-400 bg-slate-50'
                                // Red, and the loudest thing here: an
                                // examination is the one appointment nobody can
                                // turn up late to.
                                : 'border-red-600 bg-red-50')}
                        >
                          <div className="truncate font-mono text-[10.5px] font-bold
                                          uppercase tracking-wide text-red-800">
                            {block.subject}
                          </div>
                          {/* Wrapped, not truncated. Two sittings at the same
                              hour halve the column between them, and a name
                              cut to "Data S…" identifies nothing -- which is
                              the whole job of this box. Two lines fit in the
                              shortest block the grid draws. */}
                          <div className={'line-clamp-2 text-[12px] font-bold leading-tight '
                            + (block.cancelled ? 'line-through' : 'text-ink')}>
                            {block.name}
                          </div>
                          {/* The time is dropped from a short block rather
                              than squeezing the name out: the row it sits on
                              already says the hour. */}
                          {height >= 46 ? (
                            <div className="truncate font-mono text-[10.5px] tabular-nums
                                            text-muted">
                              {hhmm(block.fromMin)}–{hhmm(block.toMin)}
                            </div>
                          ) : null}
                          {block.draft && height >= 62 ? (
                            <div className="mt-0.5 text-[10px] font-bold uppercase text-slate-600">
                              Draft
                            </div>
                          ) : null}
                        </Link>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {windows.length ? (
        <section>
          <SectionHead title="Papers closing this week" />
          {/* Listed, not drawn. A paper open for a fortnight has no hour to
              occupy, and a box whose height means nothing is worse than a
              line of text. */}
          <ul className="divide-y divide-line rounded-xl border border-line">
            {windows.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-2.5 px-3.5 py-2.5">
                <Link href={'/onyx/platform/tenants/' + tenantId + '/assessments/' + a.id}
                  className="min-w-0 flex-1 truncate text-[13.5px] font-semibold hover:underline">
                  {a.title}
                </Link>
                <span className="font-mono text-[12px] text-muted">
                  {a.course?.code ?? 'No course'}
                </span>
                <span className="font-mono text-[12px] tabular-nums text-muted">
                  closes {new Date(a.closes_at!).toLocaleString('en-IN', {
                    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
                    hour12: false, timeZone: 'Asia/Kolkata',
                  })}
                </span>
                {a.status !== 'published' ? <Pill tone="neutral">{a.status}</Pill> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
