import Link from 'next/link';
import type { Metadata } from 'next';
import { OnyxShell } from '@/components/onyx-shell';
import { navFor } from '@/lib/onyx-nav';
import { requireOnyxSession, onyxApi, onyxApiSafe, type Me } from '@/lib/onyx-session';
import { WEEKDAYS, hhmm, type Room, type TimetableSlot } from '@/lib/onyx-campus';
import type { Course } from '@/lib/onyx-learn';
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
  { searchParams }: { searchParams: Promise<{ scope?: string }> },
) {
  await requireOnyxSession();
  const me = await onyxApi<Me>('/api/onyx/me');
  const registry = REGISTRY.includes(me.role);
  // Registry already gets the whole institution's grid regardless -- the
  // toggle exists for everyone else, whose default is now their own classes.
  const { scope } = await searchParams;
  const showingAll = registry || scope === 'all';

  const [slots, rooms, courses, semesters, batches, members] = await Promise.all([
    onyxApi<TimetableSlot[]>('/api/onyx/timetable' + (scope === 'all' ? '?scope=all' : '')),
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

  // The columns are the days that actually have something on them. A week of
  // seven where three are empty is three columns of nothing bought with the
  // width that made the other four unreadable.
  const days = [...new Set(slots.map((s) => s.day_of_week))].sort((a, b) => a - b);
  // The rows are the hours anything starts in, so a timetable that runs
  // 09:00–13:00 does not draw eleven empty bands to reach 20:00.
  const hours = [...new Set(slots.map((s) => Number(s.starts_at.slice(0, 2))))]
    .sort((a, b) => a - b);

  const at = (day: number, hour: number) => slots
    .filter((s) => s.day_of_week === day && Number(s.starts_at.slice(0, 2)) === hour)
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at));

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
      {/* Scoped to your own classes by default -- everyone used to get the
          whole institution's grid and had to pick their own sessions out of
          it. Registry already sees everything, so the toggle is only worth
          showing to everyone else. */}
      {!registry ? (
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
            title="Schedule a class" cta="Schedule a class" icon="calendar" compact
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
                numeric: true, wide: true,
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
          <CreatePanel
            title="Publish the timetable" cta="Publish a semester" icon="check" compact
            endpoint="timetable/publish"
            fields={[
              { name: 'semester_id', label: 'Semester', type: 'select', required: true,
                numeric: true, wide: true, options: idOptions(semesters, (s) => s.name),
                help: 'Every draft row for that semester becomes visible to learners at once.' },
            ]}
          />
        </div>
      ) : null}

      {slots.length === 0 ? (
        <Card>
          <Empty icon="calendar">
            {registry
              ? 'Nothing scheduled yet. Add a room, then schedule a class against it.'
              : 'Nothing published yet.'}
          </Empty>
        </Card>
      ) : (
        <>
          <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatTile label="Sessions" value={slots.length} note="on the week's grid" />
            <StatTile label="Contact hours" value={Math.round(contactMinutes / 60)}
              note="scheduled across the week" />
            <StatTile label="Rooms in use" value={roomsUsed}
              note={(rooms ?? []).length + ' on the books'} />
            <StatTile label={registry ? 'Drafts' : 'Days taught'}
              value={registry ? drafts.length : days.length}
              note={registry ? 'not visible to learners yet' : 'with something on them'} />
          </div>

          <SectionHead title="The week" />
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
                {days.map((d) => (
                  <div key={'h' + d}
                    className="border-b border-l border-line bg-slate-50 px-3 py-2 text-[11px]
                               font-bold uppercase tracking-[.06em] text-muted">
                    {WEEKDAYS[d - 1] ?? 'Day ' + d}
                  </div>
                ))}

                {hours.map((h) => (
                  <div key={'row' + h} className="contents">
                    <div className="border-b border-line px-2 py-2 text-right text-[11.5px]
                                    font-bold tabular-nums text-muted">
                      {String(h).padStart(2, '0')}:00
                    </div>
                    {days.map((d) => (
                      <div key={'c' + d + '-' + h}
                        className="min-h-[64px] space-y-1.5 border-b border-l border-line p-1.5">
                        {at(d, h).map((s) => {
                          const draft = s.status === 'draft';
                          return (
                            <div key={s.id}
                              className={'relative rounded-lg border-l-[3px] px-2 py-1.5 '
                                + slotTone(roomKind.get(s.room_id), draft)}>
                              {/* The column header is a sibling div, not a
                                  table header, so a screen reader gets the day
                                  and the time from the event itself. */}
                              <span className="sr-only">
                                {WEEKDAYS[d - 1] ?? 'Day ' + d}, {hhmm(s.starts_at)} to{' '}
                                {hhmm(s.ends_at)}:{' '}
                              </span>
                              <span className="block text-[12.5px] font-bold leading-tight">
                                {courseName.get(s.course_id) ?? 'Course #' + s.course_id}
                              </span>
                              <span className="mt-0.5 block text-[11.5px] leading-tight text-muted">
                                {roomShort.get(s.room_id) ?? 'Room #' + s.room_id}
                                {' · '}
                                <span className="tabular-nums">
                                  {hhmm(s.starts_at)}&ndash;{hhmm(s.ends_at)}
                                </span>
                              </span>
                              {registry ? (
                                <span className={'mt-1 block text-[10.5px] font-bold uppercase '
                                  + 'tracking-[.07em] '
                                  + (draft ? 'text-accent-700' : 'text-muted')}>
                                  {draft ? 'draft' : 'published'}
                                </span>
                              ) : null}
                              {registry ? <TimetableSlotDelete slotId={s.id} /> : null}
                            </div>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>

            {/* Every swatch carries its word. Nobody has to tell the teal from
                the orange to read this legend. */}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-line
                            bg-slate-50 px-4 py-2.5 text-[12px] text-muted">
              {[
                { c: 'bg-brand-500', t: 'Lecture or seminar' },
                { c: 'bg-accent-500', t: 'Lab or practical' },
                { c: 'bg-red-500', t: 'Hall' },
                ...(registry ? [{ c: 'bg-slate-400', t: 'Draft' }] : []),
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
