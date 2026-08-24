import Link from 'next/link';
import type { Metadata } from 'next';
import { OnyxShell } from '@/components/onyx-shell';
import { navFor } from '@/lib/onyx-nav';
import { requireOnyxPageRole, onyxApi, onyxApiSafe, type Me, onyxApiRecord } from '@/lib/onyx-session';
import type { AttendanceAnalytics, AttendanceSession, Course } from '@/lib/onyx-learn';
import {
  Banner, Card, DataTable, Empty, EmptyRow, Icon, ListRow, Pill, RowList, Score,
  SectionHead, State, StatTile,
} from '@/components/onyx-ui';
import { ThresholdForm } from '@/components/onyx-attendance';

export const metadata: Metadata = { title: 'Attendance' };

/** The pulsing live dot stops moving for anyone who has asked it to. */
const CALM = '[&_i]:motion-reduce:animate-none';

/** "2 days ago", not "8/9/2026, 12:00:00 AM". */
function when(iso: string, now: number): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return 'No date';
  const startOf = (ms: number) => { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); };
  const d = Math.round((startOf(now) - startOf(t)) / 86_400_000);
  const clock = new Date(t).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  if (d === 0) return 'Today, ' + clock;
  if (d === 1) return 'Yesterday, ' + clock;
  if (d === -1) return 'Tomorrow, ' + clock;
  if (d < 0) return 'In ' + Math.abs(d) + ' days';
  if (d <= 13) return d + ' days ago';
  if (d <= 60) return Math.round(d / 7) + ' weeks ago';
  return new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

/**
 * LRN-03c -- attendance analytics and the export.
 *
 * The acceptance criterion is "per-learner and per-cohort attendance
 * percentages, shortfall flags and export", and until this page existed all
 * three were API-only: the figures a registrar has to act on could be computed
 * but not seen, and the export could not be run by the person who needs it.
 *
 * Shortfall is the point of the screen, so it is what the page opens on and
 * what it sorts by. A list ordered by name buries the four people the report
 * exists to find somewhere in the middle of ninety.
 */
export default async function OnyxCourseAttendancePage(
  { params, searchParams }: {
    params: Promise<{ id: string }>;
    searchParams: Promise<{ threshold?: string }>;
  },
) {
  await requireOnyxPageRole('admin', 'faculty');
  const { id } = await params;
  const { threshold: raw } = await searchParams;

  // Clamped rather than trusted: the API defaults to 75 and a nonsense query
  // string should land on the default, not on a report of everybody failing.
  const asked = Number(raw);
  const threshold = Number.isFinite(asked) && asked >= 0 && asked <= 100 ? asked : 75;

  const [me, course, analytics, sessions, members] = await Promise.all([
    onyxApi<Me>('/api/onyx/me'),
    onyxApiRecord<Course>('/api/onyx/courses/' + id),
    onyxApiSafe<AttendanceAnalytics>(
      '/api/onyx/courses/' + id + '/attendance/analytics?threshold=' + threshold),
    onyxApiSafe<AttendanceSession[]>('/api/onyx/courses/' + id + '/attendance'),
    onyxApiSafe<{ user_id: string; user: { name: string; email: string } | null }[]>(
      '/api/onyx/members'),
  ]);

  const names = new Map((members ?? []).map((m) => [m.user_id, m.user]));
  // Worst first. Within the same percentage, by name, so the order is stable
  // between loads rather than following whatever the roster query returned.
  const learners = [...(analytics?.learners ?? [])].sort((a, b) =>
    a.percent - b.percent
    || (names.get(a.user_id)?.name ?? '').localeCompare(names.get(b.user_id)?.name ?? ''));
  const short = learners.filter((l) => l.below_threshold);

  const now = Date.now();
  const held = [...(sessions ?? [])].sort((a, b) =>
    Date.parse(b.scheduled_at) - Date.parse(a.scheduled_at));

  return (
    <OnyxShell
      me={me}
      nav={navFor(me.role)}
      title="Attendance"
      subtitle={course.code + ' · ' + course.title}
      action={
        <a
          href={'/api/proxy/onyx/courses/' + id + '/attendance/export.csv'}
          className="inline-flex min-h-[38px] items-center gap-2 rounded-2xl bg-brand-600 px-4
                     text-sm font-semibold text-white hover:bg-brand-700"
          // One row per learner per session, so it opens in a spreadsheet as a
          // register rather than as a summary somebody has to re-derive.
          download
        >
          <Icon name="download" className="h-4 w-4" />
          Export CSV
        </a>
      }
    >
      <nav aria-label="Breadcrumb"
        className="mb-4 flex items-center gap-1.5 text-[13px] text-muted">
        <Link href={'/onyx/courses/' + id}
          className="font-semibold text-brand-600 hover:underline">
          {course.code}
        </Link>
        <Icon name="chevron" className="h-3 w-3 text-faint" />
        <span>Attendance</span>
      </nav>

      {!analytics || analytics.sessions === 0 ? (
        <Card className="p-0">
          <Empty icon="calendar">
            No sessions have been held on this course yet, so there is nothing to report.{' '}
            <Link href={'/onyx/courses/' + id} className="font-semibold text-brand-600 underline">
              Back to the course
            </Link>
          </Empty>
        </Card>
      ) : (
        <>
          <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatTile label="Cohort attendance" value={analytics.cohort.percent + '%'}
              note={'across ' + learners.length
                + (learners.length === 1 ? ' learner' : ' learners')} />
            <StatTile label="Sessions held" value={analytics.sessions}
              note={held.length > analytics.sessions
                ? 'of ' + held.length + ' on the calendar' : 'on this course'} />
            <StatTile label="Below threshold" value={analytics.cohort.below}
              note={'under ' + analytics.threshold + '%'} />
            {/* The note says "still accepting", so the count has to mean it:
                a session whose owner never pressed Close is not accepting
                anything once it has finished. */}
            <StatTile label="Register open"
              value={held.filter((s) => s.check_in_open).length}
              note="check-in still accepting" />
          </div>

          {/* min-w-0 on the column that holds the table: without it the widest
              row sets the grid track and the whole page scrolls sideways on a
              phone, instead of the table scrolling inside its own box. */}
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_290px] lg:items-start">
            <div className="min-w-0 space-y-7">
              {short.length > 0 ? (
                <Banner tone="warn" icon="alert">
                  <span className="font-bold">
                    {short.length === 1
                      ? 'One learner is below the threshold.'
                      : short.length + ' learners are below the threshold.'}
                  </span>
                  <span className="mt-0.5 block text-[13px]">
                    Present and late both count as attended. An excused session leaves the
                    denominator; a session nobody marked counts as an absence.
                  </span>
                </Banner>
              ) : null}

              <section>
                <div className="mb-2.5 flex items-baseline justify-between gap-3">
                  <h2 className="text-[11.5px] font-bold uppercase tracking-[.085em] text-muted">
                    Attendance per learner
                  </h2>
                  <span className="text-[13px] text-muted">Worst first</span>
                </div>

                {/* tabIndex makes the horizontal scroll reachable by keyboard:
                    a region that only scrolls with a wheel strands anyone on a
                    keyboard at whatever columns happen to fit. */}
                <div tabIndex={0} role="region"
                  aria-label={'Attendance per learner on ' + course.title}>
                  <DataTable
                    caption={'Attendance per learner on ' + course.title}
                    head={
                      <>
                        <th scope="col">Learner</th>
                        <th scope="col">Held</th>
                        <th scope="col">Attended</th>
                        <th scope="col">Absent</th>
                        <th scope="col">Excused</th>
                        <th scope="col">Attendance</th>
                      </>
                    }
                  >
                    {learners.map((l) => (
                      <tr key={l.user_id}
                        className={l.below_threshold ? 'bg-red-50/60' : undefined}>
                        <td>
                          <div className="font-semibold">
                            {names.get(l.user_id)?.name ?? 'User ' + l.user_id}
                          </div>
                          <div className="text-[12.5px] text-muted">
                            {names.get(l.user_id)?.email ?? ''}
                          </div>
                        </td>
                        <td className="tabular-nums">{l.held}</td>
                        <td className="tabular-nums">{l.attended}</td>
                        <td className="tabular-nums">{l.absent}</td>
                        <td className="tabular-nums">{l.excused}</td>
                        <td>
                          {/* The band is the fast read and the number inside it
                              is the accurate one, and the Shortfall pill spells
                              the same thing out in a word — a band on its own
                              would be unreadable to about one man in twelve. */}
                          <div className="flex flex-wrap items-center gap-2">
                            <Score value={l.percent + '%'}
                              band={l.below_threshold ? 'lo' : l.percent >= 90 ? 'hi' : 'mid'} />
                            {l.below_threshold ? (
                              <Pill tone="late">
                                <span className="inline-flex items-center gap-1.5">
                                  <Icon name="alert" className="h-3.5 w-3.5" /> Shortfall
                                </span>
                              </Pill>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    ))}
                    {learners.length === 0 ? (
                      <EmptyRow colSpan={6} icon="users">
                        Nobody is enrolled in this course yet.
                      </EmptyRow>
                    ) : null}
                  </DataTable>
                </div>
              </section>

              <section>
                <SectionHead title="Sessions" />
                {held.length === 0 ? (
                  <Card className="p-0">
                    <Empty icon="calendar">No sessions have been created yet.</Empty>
                  </Card>
                ) : (
                  <RowList label="Attendance sessions on this course">
                    {held.map((s) => {
                      const open = s.check_in_open;
                      return (
                        <ListRow
                          key={s.id}
                          icon={open ? 'clock' : 'check'}
                          tone={open ? 'late' : 'good'}
                          title={s.title}
                          href={'/onyx/courses/' + id + '/attendance/' + s.id}
                          meta={
                            <>
                              {when(s.scheduled_at, now)} · {s.duration_minutes} minutes
                              {open ? ' · check-in open' : ''}
                            </>
                          }
                          chips={open ? (
                            <span className={CALM}><State tone="live">Open</State></span>
                          ) : (
                            <Pill tone="neutral">Closed</Pill>
                          )}
                          action={{
                            href: '/onyx/courses/' + id + '/attendance/' + s.id,
                            label: open ? 'Register' : 'View',
                          }}
                        />
                      );
                    })}
                  </RowList>
                )}
              </section>
            </div>

            <aside className="min-w-0">
              <SectionHead title="Threshold" />
              <Card className="p-4">
                <p className="mb-3 text-[13px] text-muted">
                  The line the shortfall report is drawn at. Changing it re-runs the figures;
                  it does not change any register.
                </p>
                <ThresholdForm courseId={Number(id)} threshold={threshold} />
              </Card>
            </aside>
          </div>
        </>
      )}
    </OnyxShell>
  );
}
