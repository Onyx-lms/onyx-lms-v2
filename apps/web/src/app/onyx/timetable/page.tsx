import Link from 'next/link';
import type { Metadata } from 'next';
import { OnyxShell } from '@/components/onyx-shell';
import { navFor } from '@/lib/onyx-nav';
import { requireOnyxSession, onyxApi, onyxApiSafe, type Me } from '@/lib/onyx-session';
import { WEEKDAYS, hhmm, type Room, type TimetableSlot } from '@/lib/onyx-campus';
import type { Course } from '@/lib/onyx-learn';
import {
  weekOf, dayKey, minutesOfDay, examBlock,
  type CalendarExam, type CalendarAssessment, type WeekBlock,
} from '@/lib/onyx-week';
import { formatTime } from '@/lib/when';
import { CreatePanel } from '@/components/onyx-create';
import { TimetableSlotDelete } from '@/components/onyx-manage';
import {
  Banner, Card, Empty, Icon, ListRow, Meter, Pill, RowList, SectionHead, StatTile,
} from '@/components/onyx-ui';

export const metadata: Metadata = { title: 'Timetable' };

const REGISTRY = ['admin'];

/** "09:00:00" to 540, so two times can be subtracted. */
const minutes = (time: string) => {
  const [h, m] = time.split(':');
  return Number(h ?? 0) * 60 + Number(m ?? 0);
};

/**
 * What kind of thing is happening in this cell.
 *
 * Taken from the room rather than invented: a lab session is a session held in
 * a lab, and `Room.kind` is the only signal the API gives for it. The tint is
 * the fast read; the room name beside it and the legend below are what carry
 * the meaning for anyone who cannot see the difference.
 */
function slotTone(kind: string | undefined, draft: boolean): string {
  if (draft) return 'border-slate-400 bg-slate-100';
  if (kind === 'lab') return 'border-accent-500 bg-accent-50';
  if (kind === 'hall') return 'border-red-500 bg-red-50';
  return 'border-brand-500 bg-brand-50';
}

/**
 * CMP-01b -- the grid, and the console that builds it.
 *
 * A learner or faculty member only ever receives the published rows: the API
 * filters that, not this page, so there is nothing here that could show a
 * draft by accident. An administrator sees drafts too, marked as such, because
 * building next term's timetable means looking at it before it is published.
 *
 * The rooms, the classes and the publish step are all here for the same
 * reason: this page used to tell a registrar to "publish from the registry
 * console" and there was no such console anywhere in the product.
 */
export default async function OnyxTimetablePage(
  { searchParams }: { searchParams: Promise<{ scope?: string; week?: string }> },
) {
  await requireOnyxSession();
  const me = await onyxApi<Me>('/api/onyx/me');
  const registry = REGISTRY.includes(me.role);
  // Who may look past their own week. Matches the API exactly -- a learner is
  // scoped to their enrolments there whatever this page asks for.
  const staff = registry || me.role === 'faculty';
  // Registry already gets the whole institution's grid regardless -- the
  // toggle exists for everyone else, whose default is now their own classes.
  const { scope, week } = await searchParams;
  /*
   * CMP-01c. The grid needs a real week now.
   *
   * Recurring classes never needed one -- a day number and two wall-clock
   * times repeat for ever. Examinations and papers happen on a DATE, so the
   * page has to know which seven days it is showing before it can place them.
   */
  const offset = Number.isFinite(Number(week)) ? Math.trunc(Number(week)) : 0;
  const shownWeek = weekOf(offset);
  // A learner never sees everything, whatever the query string says -- the
  // API is the enforcement, this only decides what to draw.
  const showingAll = registry || (staff && scope === 'all');

  const [slots, calendar, rooms, courses, semesters, batches, members] = await Promise.all([
    onyxApi<TimetableSlot[]>('/api/onyx/timetable'
      + (staff && scope === 'all' ? '?scope=all' : '')),
    // What this institution actually sits: the examinations and papers of the
    // week on screen. Scoped by the API exactly as the grid above is.
    onyxApiSafe<{ exams: CalendarExam[]; assessments: CalendarAssessment[] }>(
      '/api/onyx/calendar?from=' + encodeURIComponent(shownWeek.from)
      + '&to=' + encodeURIComponent(shownWeek.to)
      + (staff && scope === 'all' ? '&scope=all' : '')),
    onyxApiSafe<Room[]>('/api/onyx/rooms'),
    onyxApiSafe<Course[]>('/api/onyx/courses'),
    registry ? onyxApiSafe<{ id: number; name: string }[]>('/api/onyx/semesters') : null,
    registry ? onyxApiSafe<{ id: number; name: string }[]>('/api/onyx/batches') : null,
    registry
      ? onyxApiSafe<{ user_id: number; role: string; user: { name: string } | null }[]>(
        '/api/onyx/members')
      : null,
  ]);

  // Rows read as "Discrete Mathematics in Lab 2", not as a pair of ids. The
  // ids are the database's business, not the registrar's.
  const courseName = new Map((courses ?? []).map((c) => [c.id, c.code + ' — ' + c.title]));
  const roomName = new Map((rooms ?? []).map((r) => [r.id, r.code + ' — ' + r.name]));
  const roomShort = new Map((rooms ?? []).map((r) => [r.id, r.code]));
  const roomKind = new Map((rooms ?? []).map((r) => [r.id, r.kind]));
  const teachers = (members ?? []).filter((m) => m.role === 'faculty');

  const idOptions = <T extends { id: number }>(rows: T[] | null, label: (r: T) => string) =>
    (rows ?? []).map((r) => ({ value: String(r.id), label: label(r) }));

  // The teaching week, always drawn in full.
  //
  // This used to be "the days that actually have something on them", which
  // sounds economical and is why the grid read as a list: with three sessions
  // on three days you got three columns and no sense of a week at all, and a
  // free Wednesday -- the thing a person scans a timetable to find -- simply
  // was not there to see. Monday to Friday always; Saturday and Sunday only if
  // something is genuinely scheduled on them.
  const scheduled = new Set(slots.map((s) => s.day_of_week));
  /*
   * CMP-01c -- the week, as this institution actually experiences it.
   *
   * Examinations become blocks: a sitting has a real start and a real length,
   * so the height of the box means what a reader assumes it means.
   *
   * Papers do NOT become blocks, and that is deliberate. An assessment is a
   * WINDOW -- `opens_at` to `closes_at`, often days wide -- while
   * `duration_minutes` is how long one sitting takes. Drawing a sixty-minute
   * box at `opens_at` would tell somebody the paper happens at nine on Monday
   * when in fact they have until Friday. They are shown as what they are: a
   * deadline, on the day they close.
   */
  const byDay = new Map(shownWeek.days.map((d) => [d.key, d.weekday]));
  const examBlocks: WeekBlock[] = (calendar?.exams ?? [])
    .map((e) => examBlock(e, e.course_id ? courseName.get(e.course_id) : undefined))
    .map((b) => ({ ...b, weekday: byDay.get(b.dayKey) ?? 0 }))
    .filter((b) => b.weekday > 0);

  /** Papers closing this week, in the day column they are due in. */
  const dueByDay = new Map<number, CalendarAssessment[]>();
  for (const a of calendar?.assessments ?? []) {
    if (!a.closes_at) continue;
    const on = byDay.get(dayKey(a.closes_at));
    if (!on) continue;
    dueByDay.set(on, [...(dueByDay.get(on) ?? []), a]);
  }

  const days = [1, 2, 3, 4, 5, 6, 7].filter((d) => d <= 5
    || scheduled.has(d)
    // A Saturday examination is exactly the kind of thing that must not be
    // hidden because the teaching week is Monday to Friday.
    || examBlocks.some((b) => b.weekday === d)
    || dueByDay.has(d));

  // The rows were "the hours anything starts in", so 09:00 and 14:00 sat
  // adjacent and a five-hour gap looked like an hour. A timetable is read for
  // its gaps as much as its sessions, so the axis is continuous: every hour
  // from the earliest start to the latest finish, and nothing between them
  // omitted. Padded to a plausible teaching day when the week is thin, so one
  // 09:00 lecture does not produce a single-band strip.
  // Examinations count towards the axis too, or an eight o'clock sitting would
  // be drawn above the top of the grid it is supposed to sit in.
  const starts = [
    ...slots.map((s) => Math.floor(minutes(s.starts_at) / 60)),
    ...examBlocks.map((b) => Math.floor(b.fromMin / 60)),
  ];
  const ends = [
    ...slots.map((s) => Math.ceil(minutes(s.ends_at) / 60)),
    ...examBlocks.map((b) => Math.ceil(b.toMin / 60)),
  ];
  const firstHour = Math.min(9, ...(starts.length ? starts : [9]));
  const lastHour = Math.max(17, ...(ends.length ? ends : [17]));
  const hours = Array.from({ length: lastHour - firstHour }, (_, i) => firstHour + i);

  /**
   * Where a session sits on the day column, and how tall it is.
   *
   * The old grid dropped every session into the band of its start hour, so a
   * two-hour lab and a fifty-minute seminar drew the same box: the one thing a
   * timetable is for -- how long am I in this room -- was the one thing it did
   * not show. Position and height come from the actual minutes.
   */
  const HOUR_PX = 68;
  const place = (block: WeekBlock) => {
    const from = block.fromMin - firstHour * 60;
    const span = Math.max(20, block.toMin - block.fromMin);
    return { top: (from / 60) * HOUR_PX, height: (span / 60) * HOUR_PX };
  };

  /**
   * A recurring class, in the same shape as a dated examination.
   *
   * Both go through one lane assignment for a reason that is the whole point
   * of this page: an examination scheduled on top of a lecture is a clash, and
   * two separately-laid-out systems would have drawn one box over the other
   * and shown nobody anything. `examinations.service.ts` does not check
   * against the timetable when scheduling a sitting, so this grid is currently
   * the only place that collision is visible at all.
   */
  const classBlocks: WeekBlock[] = slots.map((slot) => ({
    id: 'slot-' + slot.id,
    kind: 'class' as const,
    dayKey: '',
    weekday: slot.day_of_week,
    fromMin: minutes(slot.starts_at),
    toMin: minutes(slot.ends_at),
    title: courseName.get(slot.course_id) ?? 'Course #' + slot.course_id,
    meta: [roomShort.get(slot.room_id) ?? 'Room #' + slot.room_id],
    draft: slot.status === 'draft',
    tone: slotTone(roomKind.get(slot.room_id), slot.status === 'draft'),
  }));

  /**
   * Everything on one day, laid out side by side where it overlaps.
   *
   * A clash that renders as one box hiding another is a clash nobody sees.
   * Lanes are assigned greedily: a block takes the first lane whose last
   * occupant has already finished.
   */
  const layout = (day: number) => {
    const sittings = examBlocks.filter((b) => b.weekday === day && !b.muted);

    /*
     * For as long as an examination runs, the examination is what is happening.
     *
     * A paper is sixty or ninety minutes and a candidate is in it for all of
     * them -- they are not also in the lecture the recurring timetable says is
     * on. Drawing both side by side halves the width of the one appointment
     * that matters and invites somebody to read the wrong one.
     *
     * So a class that overlaps a sitting is taken off the grid, and the
     * examination is told what it displaced rather than the class vanishing
     * without explanation. A CANCELLED sitting displaces nothing: the class it
     * was going to replace is back on.
     */
    const displaced = new Map<string, string[]>();
    const classesOnDay = classBlocks.filter((b) => b.weekday === day).filter((c) => {
      const over = sittings.find((e) => c.fromMin < e.toMin && e.fromMin < c.toMin);
      if (!over) return true;
      displaced.set(over.id, [...(displaced.get(over.id) ?? []), c.title]);
      return false;
    });

    const onDay = [...classesOnDay, ...sittings,
      ...examBlocks.filter((b) => b.weekday === day && b.muted)]
      .map((b) => {
        const took = displaced.get(b.id);
        return took?.length
          ? { ...b, meta: [...b.meta, 'replaces ' + took.join(', ')] }
          : b;
      })
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



  const drafts = slots.filter((s) => s.status === 'draft');
  const contactMinutes = slots.reduce((n, s) => n + (minutes(s.ends_at) - minutes(s.starts_at)), 0);
  const roomsUsed = new Set(slots.map((s) => s.room_id)).size;

  // Room pressure is a capacity question, not a time one, so it gets its own
  // numbers. Scaled against the busiest room this week -- the API carries no
  // notion of how many hours a room is available for.
  const roomLoad = [...new Map((rooms ?? []).map((r) => [r.id, r])).values()]
    .map((r) => ({
      room: r,
      mins: slots.filter((s) => s.room_id === r.id)
        .reduce((n, s) => n + (minutes(s.ends_at) - minutes(s.starts_at)), 0),
    }))
    .filter((r) => r.mins > 0)
    .sort((a, b) => b.mins - a.mins);
  const busiest = roomLoad[0]?.mins ?? 0;

  // 0 is Sunday in JavaScript; day_of_week is 1 for Monday.
  const todayNum = ((new Date().getDay() + 6) % 7) + 1;
  const today = slots.filter((s) => s.day_of_week === todayNum)
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at));

  return (
    <OnyxShell
      me={me}
      nav={navFor(me.role)}
      title="Timetable"
      subtitle={registry
        ? 'Drafts are marked. Publish once every clash is clear.'
        : showingAll ? 'Every published session at this institution.'
          : (me.role === 'faculty' ? 'The classes you teach.' : 'The courses you are enrolled in.')}
    >
      {/* Staff only. The switch used to be offered to everybody, so a learner
          could open the whole institution's grid -- who teaches what, when,
          and in which room. That is a view of the estate, not a schedule, and
          the API refuses it now regardless of what the page renders; the link
          is removed so it is not offered and then denied. Registry already
          sees everything, so the toggle is for the roles in between. */}
      {staff && !registry ? (
        <div className="mb-4 flex items-center gap-1.5 text-[13px] font-semibold">
          <Link href="/onyx/timetable"
            className={showingAll ? 'text-muted hover:text-brand-700 hover:underline'
              : 'text-brand-700 underline'}>
            My timetable
          </Link>
          <span aria-hidden className="text-faint">·</span>
          <Link href="/onyx/timetable?scope=all"
            className={showingAll ? 'text-brand-700 underline'
              : 'text-muted hover:text-brand-700 hover:underline'}>
            Everyone&rsquo;s timetable
          </Link>
        </div>
      ) : null}

      {/* Published rows are already on every learner's phone. The only thing
          worth a banner is the ones that are not. */}
      {registry && drafts.length > 0 ? (
        <div className="mb-4">
          <Banner tone="warn" icon="alert">
            <strong className="font-bold">
              {drafts.length} session{drafts.length === 1 ? ' is' : 's are'} still
              {drafts.length === 1 ? ' a draft' : ' drafts'}.
            </strong>{' '}
            They are on nobody&apos;s timetable until the semester is published again.
          </Banner>
        </div>
      ) : null}

      {registry ? (
        <div className="mb-6 flex flex-wrap items-start gap-3">
          <CreatePanel
            title="New room" cta="Add a room" icon="building" compact
            endpoint="rooms"
            fields={[
              { name: 'code', label: 'Code', required: true, placeholder: 'LT1' },
              { name: 'name', label: 'Name', required: true, placeholder: 'Lecture Theatre 1' },
              { name: 'capacity', label: 'Seats', type: 'number', min: 0, max: 5000,
                fallback: 60 },
              { name: 'kind', label: 'Kind', type: 'select', fallback: 'lecture',
                options: ['lecture', 'lab', 'seminar', 'hall']
                  .map((k) => ({ value: k, label: k })) },
              { name: 'building', label: 'Building', placeholder: 'Main block' },
            ]}
          />
          <CreatePanel
            title="Schedule a class" cta="Schedule a class" icon="calendar"
            rules={[{ kind: 'before', field: 'starts_at', than: 'ends_at', orEqual: true,
              message: 'That class ends before it starts.' }]} compact
            endpoint="timetable"
            // CMP-01b: the POST refuses a clash and names it. This says so
            // while the registrar can still change the answer, which is the
            // difference between one form and forty.
            watch="timetable-clash"
            fields={[
              { name: 'semester_id', label: 'Semester', type: 'select', required: true,
                numeric: true, options: idOptions(semesters, (s) => s.name) },
              { name: 'course_id', label: 'Course', type: 'select', required: true,
                numeric: true, options: idOptions(courses, (c) => c.code + ' — ' + c.title) },
              { name: 'batch_id', label: 'Batch', type: 'select', required: true,
                numeric: true, options: idOptions(batches, (b) => b.name) },
              { name: 'room_id', label: 'Room', type: 'select', required: true,
                numeric: true, options: idOptions(rooms, (r) => r.code + ' — ' + r.name) },
              { name: 'faculty_id', label: 'Teacher', type: 'select', required: true,
                // A uuid, so NOT numeric: CreatePanel runs Number() over a
                // numeric field and a uuid becomes NaN, which JSON sends as
                // null and the route refuses. `day_of_week` below IS a number
                // and keeps the flag -- the two sit next to each other, which
                // is how this one survived.
                wide: true,
                options: teachers.map((m) => ({ value: String(m.user_id),
                  label: m.user?.name ?? 'User ' + m.user_id })) },
              { name: 'day_of_week', label: 'Day', type: 'select', required: true,
                numeric: true,
                options: WEEKDAYS.map((d, i) => ({ value: String(i + 1), label: d })) },
              { name: 'starts_at', label: 'From', type: 'time', required: true },
              { name: 'ends_at', label: 'To', type: 'time', required: true,
                help: 'A clash — the room, the teacher or the batch — is refused and named.' },
            ]}
          />
          {/* The count is on the button, and it asks first.
              This looks like every other create panel -- one dropdown, one
              button -- and makes every draft row for the term visible to every
              learner at once. The page already knew how many that was and put
              the number nowhere near the control. */}
          <CreatePanel
            title="Publish the timetable"
            cta={drafts.length
              ? 'Publish ' + drafts.length + ' session' + (drafts.length === 1 ? '' : 's')
              : 'Publish a semester'}
            icon="check" compact
            confirm={drafts.length
              ? 'Publish ' + drafts.length + ' session'
                + (drafts.length === 1 ? '' : 's') + ' to every learner on this timetable?'
              : undefined}
            endpoint="timetable/publish"
            fields={[
              { name: 'semester_id', label: 'Semester', type: 'select', required: true,
                numeric: true, wide: true, options: idOptions(semesters, (s) => s.name),
                help: 'Every draft row for that semester becomes visible to learners at once.' },
            ]}
          />
        </div>
      ) : null}

      {/*
        * The week picker sits ABOVE the empty check, not inside it.
        *
        * It used to live with the grid, so moving to a week with nothing on
        * it rendered the empty card and took the navigation away with it --
        * you could step forward into a quiet week and have no way back.
        * A control for changing what you are looking at cannot be part of
        * what you are looking at.
        */}
      <div className="mb-2.5 flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="text-[11.5px] font-bold uppercase tracking-[.085em] text-muted">
          {shownWeek.label}
        </h2>
        {/*
          * Real weeks, so there is somewhere to go.
          *
          * The grid used to show one recurring pattern with no notion of
          * WHICH week, which is fine for a lecture that repeats for ever
          * and useless for a sitting that happens once. Plain links rather
          * than a client component: this page is server-rendered and a
          * week is a URL.
          */}
        <nav aria-label="Week" className="flex items-center gap-1.5 text-[12.5px]">
          <Link href={'/onyx/timetable?week=' + (offset - 1)
            + (scope === 'all' ? '&scope=all' : '')}
            className="rounded-lg border border-line px-2.5 py-1 font-semibold
                       hover:bg-brand-50">
            ← Previous
          </Link>
          {offset !== 0 ? (
            <Link href={'/onyx/timetable' + (scope === 'all' ? '?scope=all' : '')}
              className="rounded-lg border border-line px-2.5 py-1 font-semibold
                         hover:bg-brand-50">
              This week
            </Link>
          ) : null}
          <Link href={'/onyx/timetable?week=' + (offset + 1)
            + (scope === 'all' ? '&scope=all' : '')}
            className="rounded-lg border border-line px-2.5 py-1 font-semibold
                       hover:bg-brand-50">
            Next →
          </Link>
        </nav>
      </div>

      {slots.length === 0 && !examBlocks.length && !dueByDay.size ? (
        <Card>
          <Empty icon="calendar">
            {registry
              ? 'Nothing on this week — no examinations, no papers due, no classes. '
                + 'Schedule an examination, or add a room and a class against it.'
              : 'Nothing on this week. Examinations and papers appear here as soon as '
                + 'they are scheduled.'}
          </Empty>
        </Card>
      ) : (
        <>
          <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {/*
              * Examinations and papers first.
              *
              * This page counted lectures and contact hours, which is what a
              * registrar building a timetable wants and not what anybody opens
              * it to find out. What a learner needs from a week is what they
              * have to sit and what is due, so those are the first two
              * numbers now and the estate is the last.
              */}
            <StatTile label="Examinations" value={examBlocks.length}
              note="sitting this week" />
            <StatTile label="Papers due"
              value={[...dueByDay.values()].reduce((n, a) => n + a.length, 0)}
              note="closing this week" />
            <StatTile label="Classes" value={slots.length}
              note={Math.round(contactMinutes / 60) + ' contact hours'} />
            <StatTile label={registry ? 'Drafts' : 'Rooms in use'}
              value={registry ? drafts.length : roomsUsed}
              note={registry ? 'not visible to learners yet' : (rooms ?? []).length + ' on the books'} />
          </div>


          <div className="mb-7 min-w-0 overflow-hidden rounded-2xl border border-line bg-white
                          shadow-card">
            {/* The grid scrolls inside this box, never the page: a week of
                five columns cannot be read at 320px, and squeezing it there
                produces five unreadable slivers instead of two legible ones.
                Sideways is the right axis to give up, and only here.
                tabIndex makes that scroll reachable without a trackpad. */}
            <div className="overflow-x-auto" tabIndex={0} role="region"
              aria-label="The week's timetable. Scrolls sideways.">
              <div
                className="grid"
                style={{
                  gridTemplateColumns: '62px repeat(' + days.length + ', minmax(158px, 1fr))',
                  minWidth: 62 + days.length * 158,
                }}
              >
                {/* `relative` is load-bearing: `sr-only` is absolutely
                    positioned, and with no positioned ancestor it takes its
                    static position far along this sideways-scrolling grid and
                    drags the page's own scroll width out with it. */}
                <div className="relative border-b border-line bg-slate-50 px-2 py-2">
                  <span className="sr-only">Time</span>
                </div>
                {days.map((d) => {
                  const on = shownWeek.days.find((x) => x.weekday === d);
                  const due = dueByDay.get(d) ?? [];
                  return (
                    <div key={'h' + d}
                      className="border-b border-l border-line bg-slate-50 px-3 py-2">
                      <p className="text-[11px] font-bold uppercase tracking-[.06em] text-muted">
                        {WEEKDAYS[d - 1] ?? 'Day ' + d}
                        {/* `text-faint` here measured 4.02:1 on the header's
                            own background -- under the 4.5 minimum, and axe
                            caught it once per day column. `text-muted` is the
                            same intent and clears it at 5.20. */}
                        {on ? <span className="ml-1.5 font-semibold normal-case tracking-normal
                                               text-muted">{on.label}</span> : null}
                      </p>
                      {/*
                        * Papers due, as a band at the top of the day rather
                        * than a box inside it.
                        *
                        * An assessment is a WINDOW -- often days wide -- while
                        * its duration is how long one sitting takes. A
                        * sixty-minute box at the hour it opens would say the
                        * paper happens at nine on Monday when the truth is
                        * "any time before Friday". A deadline is what it
                        * actually is, so a deadline is what it looks like.
                        */}
                      {due.map((a) => (
                        <Link key={'due' + a.id} href={'/onyx/assessments/' + a.id}
                          className="mt-1.5 block truncate rounded-md border-l-[3px]
                                     border-accent-500 bg-accent-50 px-1.5 py-1 text-[11px]
                                     font-semibold leading-tight text-accent-900
                                     hover:brightness-95">
                          <span className="sr-only">Assessment due: </span>
                          {a.title}
                          <span className="ml-1 font-normal tabular-nums text-accent-800">
                            due {a.closes_at ? formatTime(a.closes_at) : ''}
                          </span>
                        </Link>
                      ))}
                    </div>
                  );
                })}

                {/* The time axis and the day columns are drawn separately.
                    A CSS grid of hour cells can only put a session in the band
                    it starts in; laying each day out as one continuous column
                    is what lets a session be as tall as it is long, and lets
                    two overlapping ones sit side by side instead of one hiding
                    the other. */}
                <div className="relative border-b border-line"
                  style={{ height: hours.length * HOUR_PX }}>
                  {hours.map((h, i) => (
                    <div key={'t' + h}
                      className="absolute right-0 w-full border-t border-line pr-2 pt-1
                                 text-right text-[11.5px] font-bold tabular-nums text-muted"
                      style={{ top: i * HOUR_PX, height: HOUR_PX }}>
                      {String(h).padStart(2, '0')}:00
                    </div>
                  ))}
                </div>

                {days.map((d) => {
                  const { placed, lanes } = layout(d);
                  return (
                    <div key={'col' + d}
                      className="relative border-b border-l border-line"
                      style={{ height: hours.length * HOUR_PX }}>
                      {/* The hour lines, so a session can be read against the
                          axis rather than guessed from its position. */}
                      {hours.map((h, i) => (
                        <div key={'l' + d + h}
                          className="absolute inset-x-0 border-t border-line"
                          style={{ top: i * HOUR_PX }} />
                      ))}

                      {placed.map(({ block, lane }) => {
                        const box = place(block);
                        const width = 100 / lanes;
                        const mins = block.toMin - block.fromMin;
                        const at = (m: number) => String(Math.floor(m / 60)).padStart(2, '0')
                          + ':' + String(m % 60).padStart(2, '0');
                        const body = (
                          <>
                            {/* The day and time come from the block itself:
                                the column header is a sibling div, not a table
                                header, so a screen reader gets nothing from it. */}
                            <span className="sr-only">
                              {block.kind === 'exam' ? 'Examination. ' : ''}
                              {WEEKDAYS[d - 1] ?? 'Day ' + d}, {at(block.fromMin)} to{' '}
                              {at(block.toMin)}:{' '}
                            </span>
                            <span className="block truncate text-[12.5px] font-bold leading-tight">
                              {block.title}
                            </span>
                            <span className="mt-0.5 block truncate text-[11.5px] leading-tight
                                             text-muted">
                              <span className="tabular-nums">
                                {at(block.fromMin)}&ndash;{at(block.toMin)}
                              </span>
                              {block.meta.length ? ' · ' + block.meta.join(' · ') : ''}
                            </span>
                            {/* Only where the box is tall enough to hold it --
                                a fifty-minute session has room for two lines,
                                not four. */}
                            {box.height >= 60 ? (
                              <span className="mt-0.5 block text-[11px] tabular-nums text-muted">
                                {mins >= 60
                                  ? Math.round((mins / 60) * 10) / 10 + ' hours'
                                  : mins + ' minutes'}
                              </span>
                            ) : null}
                            {registry && box.height >= 76 && block.kind === 'class' ? (
                              <span className={'mt-0.5 block text-[10.5px] font-bold uppercase '
                                + 'tracking-[.07em] '
                                + (block.draft ? 'text-accent-700' : 'text-muted')}>
                                {block.draft ? 'draft' : 'published'}
                              </span>
                            ) : null}
                          </>
                        );
                        const style = {
                          top: box.top + 2,
                          height: Math.max(26, box.height - 4),
                          left: 'calc(' + (lane * width) + '% + 4px)',
                          width: 'calc(' + width + '% - 8px)',
                        };
                        const className = 'absolute overflow-hidden rounded-lg border-l-[3px] '
                          + 'px-2 py-1 ' + block.tone
                          + (block.muted ? ' line-through' : '');

                        // An examination opens; a class is not a link to
                        // anywhere, so it stays a div rather than pretending.
                        return block.href ? (
                          <Link key={block.id} href={block.href}
                            className={className + ' hover:brightness-95'} style={style}>
                            {body}
                          </Link>
                        ) : (
                          <div key={block.id} className={className} style={style}>
                            {body}
                            {registry ? (
                              <TimetableSlotDelete
                                slotId={Number(String(block.id).replace('slot-', ''))} />
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Every swatch carries its word. Nobody has to tell the teal from
                the orange to read this legend. */}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-line
                            bg-slate-50 px-4 py-2.5 text-[12px] text-muted">
              {[
                { c: 'bg-red-600', t: 'Examination' },
                { c: 'bg-accent-500', t: 'Paper due' },
                { c: 'bg-brand-500', t: 'Class' },
                ...(registry ? [{ c: 'bg-slate-400', t: 'Draft or cancelled' }] : []),
              ].map((l) => (
                <span key={l.t} className="inline-flex items-center gap-1.5">
                  <span aria-hidden className={'h-2.5 w-2.5 rounded-[3px] ' + l.c} />
                  {l.t}
                </span>
              ))}
              <span className="ml-auto tabular-nums">
                {slots.length} session{slots.length === 1 ? '' : 's'} ·{' '}
                {Math.round(contactMinutes / 60)} contact hours
              </span>
            </div>
          </div>

          <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1fr)_310px]">
            <div className="min-w-0">
              <SectionHead title={'Today · ' + (WEEKDAYS[todayNum - 1] ?? '')} />
              {today.length === 0 ? (
                <Card>
                  <Empty icon="calendar">Nothing is scheduled for today.</Empty>
                </Card>
              ) : (
                <RowList label="Today's sessions">
                  {today.map((s) => (
                    <ListRow
                      key={s.id}
                      icon={roomKind.get(s.room_id) === 'lab' ? 'code' : 'book'}
                      tone={s.status === 'draft' ? 'neutral' : 'brand'}
                      title={courseName.get(s.course_id) ?? 'Course #' + s.course_id}
                      meta={
                        <span className="tabular-nums">
                          {hhmm(s.starts_at)}&ndash;{hhmm(s.ends_at)}
                        </span>
                      }
                      chips={
                        <>
                          <Pill tone="neutral">
                            {roomName.get(s.room_id) ?? 'Room #' + s.room_id}
                          </Pill>
                          {registry && s.status === 'draft'
                            ? <Pill tone="soon">draft</Pill> : null}
                        </>
                      }
                    />
                  ))}
                </RowList>
              )}
            </div>

            <aside className="min-w-0">
              {roomLoad.length > 0 ? (
                <>
                  <SectionHead title="Room pressure" />
                  <Card className="mb-6 p-4">
                    <ul className="space-y-3">
                      {roomLoad.slice(0, 6).map(({ room, mins }) => (
                        <li key={room.id}>
                          <div className="flex items-baseline justify-between gap-3">
                            <span className="min-w-0 truncate text-[13px] font-bold">
                              {room.code} · {room.name}
                            </span>
                            <span className="shrink-0 text-[12.5px] tabular-nums text-muted">
                              {Math.round(mins / 60)} h
                            </span>
                          </div>
                          <div className="mt-1.5">
                            <Meter percent={busiest ? (mins / busiest) * 100 : 0}
                              label={room.code + ' is booked for '
                                + Math.round(mins / 60) + ' hours a week'} />
                          </div>
                        </li>
                      ))}
                    </ul>
                    <p className="mt-3 flex items-start gap-2 border-t border-line pt-3
                                  text-[12px] text-muted">
                      <Icon name="alert" className="mt-px h-[14px] w-[14px] shrink-0" />
                      Bars are scaled against the busiest room this week, not against an
                      opening-hours figure — the API does not carry one.
                    </p>
                  </Card>
                </>
              ) : null}

              {registry && drafts.length > 0 ? (
                <>
                  <SectionHead title="Unpublished drafts" />
                  <Card className="p-4">
                    <ul className="space-y-2.5 text-[12.5px]">
                      {drafts.slice(0, 8).map((s) => (
                        <li key={s.id}>
                          <span className="font-bold">
                            {courseName.get(s.course_id) ?? 'Course #' + s.course_id}
                          </span>
                          <span className="mt-0.5 block text-muted">
                            {WEEKDAYS[s.day_of_week - 1] ?? 'Day ' + s.day_of_week}{' '}
                            <span className="tabular-nums">{hhmm(s.starts_at)}</span>
                            {' · '}
                            {roomName.get(s.room_id) ?? 'Room #' + s.room_id}
                          </span>
                        </li>
                      ))}
                    </ul>
                    {drafts.length > 8 ? (
                      <p className="mt-3 text-[12px] text-muted">
                        and {drafts.length - 8} more.
                      </p>
                    ) : null}
                  </Card>
                </>
              ) : null}
            </aside>
          </div>
        </>
      )}
    </OnyxShell>
  );
}
