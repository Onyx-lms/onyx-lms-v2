import { isoWeekdayInTz, weekdayInTz } from '@/lib/onyx-time';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { OnyxShell } from '@/components/onyx-shell';
import { ROLE_LABELS } from '@/lib/onyx-nav';
import { requireOnyxSession, onyxApi, onyxApiSafe, type Me } from '@/lib/onyx-session';
import { formatDuration, isStaff, type Assignment, type Course, type Outline } from '@/lib/onyx-learn';
import { OnyxNudges } from '@/components/onyx-engage';
import {
  Banner, Buckets, Card, Hero, Icon, ListRow, Meter, Pill, Ring, RowList,
  SectionHead, StackBar, State, StatTile, Empty, relativeDue,
} from '@/components/onyx-ui';
import { QueueRow, TrendBars } from '@/components/onyx-chart';
import type {
  Discussion, Exam, ProgressSummary, Room, TimetableSlot,
} from '@/lib/onyx-campus';
import { WEEKDAYS, hhmm, money } from '@/lib/onyx-campus';
import type { AttendanceAnalytics, AttendanceSession } from '@/lib/onyx-learn';
import type { Drive, JobPost, Readiness as LearnerReadiness } from '@/lib/onyx-career';

export const metadata: Metadata = { title: 'Dashboard' };

interface AttendanceLine {
  course_id: number; held: number; attended: number; percent: number; below_threshold: boolean;
  // The class average, alongside the learner's own figure -- LRN-03 asks for
  // "per-learner and per-cohort" analytics, and this banner used to answer
  // only the first half of that question.
  cohort_percent: number; cohort_size: number;
}

interface Outstanding { total_minor: number; invoices: { overdue: boolean }[] }
interface AuditRow {
  id: number; action: string; entity_type: string; created_at: string;
  actor: { name: string } | null;
  /** What the action wrote. `membership.created` carries the role. */
  after: { role?: string } | null;
}

/**
 * LRN-01b / LRN-05 -- what someone sees when they arrive.
 *
 * The proposal's claim for Onyx Learn is that "every learner always knows
 * what to do next", so the page is ordered by that: the single action that
 * resumes their work, then what is due, then everything else. The previous
 * version opened on four counters -- which is what a person looks at *after*
 * they know what to do, not instead of it.
 *
 * An operator's home screen is the opposite shape, and the admin design says
 * so: the institution in a few numbers, then the one breakdown behind them.
 * Everything the design shows beyond that -- integrity queues, fee arrears,
 * live sittings -- has no endpoint on this page, and inventing one is worse
 * than leaving it out.
 *
 * `employer` and `guardian` never render this page: they are outsiders whose
 * whole account is a view derived from links other people control, with no
 * course and no progress of their own.
 *
 * `exams` and `placement` do not either, for a related but different reason:
 * this page is written for a learner or for whoever runs the whole
 * institution (`isStaff` below is admin/faculty only), and neither role is
 * either -- an examinations officer or a placement officer landing here fell
 * through both branches and got "What you are taking / Nothing yet, look at
 * the catalogue", the empty-student screen, which is nobody's job here. Each
 * already has a real, built-for-them hub; this just sends them to it, the
 * same as employer and guardian already were.
 */
const REDIRECT: Partial<Record<string, string>> = {
  employer: '/onyx/jobs',
  guardian: '/onyx/family',
  exams: '/onyx/exams',
  placement: '/onyx/placement',
};

/**
 * The role split, in the order an administrator reads it.
 *
 * All seven membership roles, not six -- guardian was missing here even
 * though `counts` (below) tallies every role on the register. That made the
 * bar's total silently fall short of the "People" headcount tile whenever an
 * institution had a linked guardian, and gave an administrator no line to
 * read for them at all.
 */
const ROLE_ORDER = [
  'student', 'faculty', 'exams', 'placement', 'employer', 'guardian', 'admin',
] as const;

/* Seven marks that stay distinguishable in greyscale: the label is always
   beside the dot, so the colour is a locator and never the signal. */
const ROLE_MARKS: Record<(typeof ROLE_ORDER)[number], string> = {
  student:   'bg-brand-600',
  faculty:   'bg-brand-400',
  exams:     'bg-accent-500',
  placement: 'bg-brand-200',
  employer:  'bg-slate-400',
  guardian:  'bg-purple-400',
  admin:     'bg-ink',
};

export default async function OnyxDashboard() {
  await requireOnyxSession();
  const me = await onyxApi<Me>('/api/onyx/me');
  if (REDIRECT[me.role]) redirect(REDIRECT[me.role]!);

  // A teacher does not run the institution, so they do not get the screen that
  // does. `isStaff` is admin || faculty, and everything below it was written
  // for an operator: headcounts, the role split, "manage people". See
  // FacultyDashboard for what a teacher actually opens this page to find out.
  if (me.role === 'faculty') return <FacultyDashboard me={me} />;

  const staff = isStaff(me.role);
  const isLearner = me.role === 'student';

  /*
   * ONE WAVE, not three.
   *
   * This page was the slowest thing in the product -- a second and a half,
   * against APIs that answer in a sixth of that -- and the reason was four
   * round trips laid end to end:
   *
   *   1. /me
   *   2. my/courses, attendance, members, progress, my/profile
   *   3. my/learning-overview
   *   4. exams, jobs, drives, outstanding, timetable, audit, courses
   *
   * Waves 2 and 4 never depended on each other. Wave 4 was gated on `staff`,
   * which is known the moment /me returns, so it sat behind wave 2 for no
   * reason at all -- an administrator paid a full round trip in order to ask
   * questions that were already answerable.
   *
   * Wave 3 was deliberate and still wrong: `mine.length ? … : null` skips one
   * call for a learner with no courses, and charges every learner who HAS
   * courses a serialised round trip to find that out. The rare case was
   * optimised at the expense of the common one. It is now asked alongside
   * everything else, and the answer is ignored when there are no courses --
   * one wasted call for the empty case, nothing for anybody else.
   *
   * Everything below still depends only on `me`, so this is the whole page in
   * two waves: who you are, then everything about you at once.
   */
  const [
    courses, attendance, roster, progress, profile, overview,
    exams, jobs, drives, outstanding, allSlots, activity, allCourses,
  ] = await Promise.all([
    onyxApiSafe<Course[]>('/api/onyx/my/courses'),
    staff ? null : onyxApiSafe<AttendanceLine[]>('/api/onyx/my/attendance'),
    staff ? onyxApiSafe<{ role: string }[]>('/api/onyx/members') : null,
    isLearner ? onyxApiSafe<ProgressSummary>('/api/onyx/progress') : null,
    // The proposal's own dashboard mockup pairs a readiness score with the
    // streak widget -- this page had the streak but never the score, which
    // otherwise only ever surfaced a click away on /onyx/profile.
    isLearner ? onyxApiSafe<{ readiness: LearnerReadiness }>('/api/onyx/my/profile') : null,
    // What is due, and each course's own progress. This replaced a loop that
    // called /courses/:id/assignments and /courses/:id/outline once per
    // course, uncapped; one endpoint answers both.
    onyxApiSafe<{ assignments: Assignment[]; outlines: Record<number, Outline> }>(
      '/api/onyx/my/learning-overview'),
    // What an operator actually runs the institution on: exams, placement,
    // the timetable and revenue -- none of which is "my courses", which is
    // why the top of this page used to say "Your courses: you teach 0" to
    // every administrator who does not also personally teach one.
    staff ? onyxApiSafe<Exam[]>('/api/onyx/exams') : null,
    staff ? onyxApiSafe<JobPost[]>('/api/onyx/jobs') : null,
    staff ? onyxApiSafe<Drive[]>('/api/onyx/drives') : null,
    staff ? onyxApiSafe<Outstanding>('/api/onyx/finance/outstanding') : null,
    staff ? onyxApiSafe<TimetableSlot[]>('/api/onyx/timetable') : null,
    // A wider pool than the six shown in the rail, for two reasons. The rail
    // filters out routine account plumbing (a membership created, a guardian
    // link accepted) because it drowns out the operational news the moment
    // anybody does a run of ordinary admin work. The fortnight chart below
    // wants the opposite -- every recorded action, plumbing included, because
    // "how busy has this institution been" is a question about all of it.
    // One read, both answers.
    staff ? onyxApiSafe<AuditRow[]>('/api/onyx/audit?limit=400') : null,
    staff ? onyxApiSafe<Course[]>('/api/onyx/courses?all=1') : null,
  ]);

  const mine = courses ?? [];

  const assignmentsByCourse = groupBy(overview?.assignments ?? [], (a) => a.course_id);
  const assignmentLists = mine.map((c) =>
    (assignmentsByCourse.get(c.id) ?? []).map((a) => ({ ...a, course: c })));

  // Per-course progress, from each course's own outline.
  //
  // `/api/onyx/my/courses` returns bare course rows with no progress on them,
  // so an earlier version of this page painted the learner's PLATFORM-WIDE
  // percentage onto every course card -- two different courses both showing
  // "50%" because that was the overall figure. These are the real numbers,
  // and they are what the resume card picks its target from.
  const outlines = mine.map((c) => overview?.outlines[c.id] ?? null);
  const progressFor = new Map<number, Outline['progress']>();
  mine.forEach((c, i) => {
    const o = outlines[i];
    if (o) progressFor.set(c.id, o.progress);
  });

  // Everything still outstanding, soonest first -- including what is already
  // late, which the old version dropped entirely by filtering to due_at > now.
  // A missed deadline is the most important row on this page, not the one to
  // hide.
  const due = assignmentLists.flat()
    .filter((a) => a.status === 'published' && a.due_at)
    .sort((a, b) => Date.parse(a.due_at!) - Date.parse(b.due_at!))
    .slice(0, 5);

  const counts = (roster ?? []).reduce<Record<string, number>>((acc, m) => {
    acc[m.role] = (acc[m.role] ?? 0) + 1;
    return acc;
  }, {});
  const headcount = (roster ?? []).length;
  const shortfall = (attendance ?? []).filter((a) => a.below_threshold);

  const ROUTINE_ACTIVITY = new Set([
    'membership.created', 'membership.removed', 'membership.role_changed',
    'membership.updated', 'user.updated', 'guardian.linked', 'guardian.consent_changed',
  ]);
  const log = activity ?? [];
  const recentActivity = log
    .filter((a) => !ROUTINE_ACTIVITY.has(a.action)).slice(0, 6);

  /**
   * The last fortnight, a day at a time.
   *
   * Built from the audit log because that is the only history this product
   * keeps: there is no metrics table, and inventing a trend line out of
   * current-state counts (12 students today, so 12 students every day) would
   * draw a chart that is simply false. Every bar here is a count of things
   * that actually happened on that day.
   */
  const DAY_MS = 86_400_000;
  const midnight = new Date(); midnight.setHours(0, 0, 0, 0);
  const perDay = new Map<string, number>();
  for (let i = 13; i >= 0; i -= 1) {
    perDay.set(new Date(midnight.getTime() - i * DAY_MS).toDateString(), 0);
  }
  let newStudentsThisWeek = 0;
  for (const row of log) {
    const at = new Date(row.created_at);
    const key = at.toDateString();
    if (perDay.has(key)) perDay.set(key, perDay.get(key)! + 1);
    // Students only, because the tile it sits under counts students. Counting
    // every membership put "12 students, 18 joined this week" on the same card.
    if (row.action === 'membership.created' && row.after?.role === 'student'
      && at.getTime() >= midnight.getTime() - 6 * DAY_MS) newStudentsThisWeek += 1;
  }
  const activityTrend = [...perDay.entries()].map(([key, value]) => {
    const d = new Date(key);
    return {
      label: d.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short' }),
      full: d.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'long', day: 'numeric', month: 'long' }),
      value,
    };
  });
  const busiest = Math.max(...activityTrend.map((p) => p.value));

  const now = Date.now();
  const examList = exams ?? [];
  const examsRunning = examList.filter((e) => {
    const start = Date.parse(e.starts_at);
    return e.status !== 'cancelled' && Number.isFinite(start)
      && now >= start && now < start + e.duration_minutes * 60_000;
  }).length;
  const examsUpcoming = examList.filter((e) =>
    e.status === 'scheduled' && Date.parse(e.starts_at) > now).length;
  const examsDraft = examList.filter((e) => e.status === 'draft').length;

  const jobList = jobs ?? [];
  const jobsByStatus = {
    open: jobList.filter((j) => j.status === 'open').length,
    draft: jobList.filter((j) => j.status === 'draft').length,
    closed: jobList.filter((j) => j.status === 'closed').length,
  };
  const drivesUpcoming = (drives ?? []).filter((d) =>
    d.scheduled_at && Date.parse(d.scheduled_at) >= now).length;

  const slotList = allSlots ?? [];
  const timetableDrafts = slotList.filter((s) => s.status === 'draft').length;

  const overdueInvoices = (outstanding?.invoices ?? []).filter((i) => i.overdue).length;

  /**
   * What is waiting for somebody.
   *
   * The counters above say how big the institution is; this says what has not
   * been done, which is the question an operator actually opens a home screen
   * with. Every row is a state the product can genuinely be in and a link to
   * the screen that clears it -- a draft course nobody can enrol on, a
   * timetable slot never published, an exam sat but not released, an invoice
   * past its date. Rows with nothing waiting are not rendered, so this list is
   * either work or an empty state, never a column of noughts.
   */
  const courseList = allCourses ?? [];
  const draftCourses = courseList.filter((c) => c.status !== 1).length;
  const examsUnpublished = examList.filter((e) =>
    e.status === 'completed' || (Date.parse(e.starts_at) < now && e.status === 'scheduled')).length;
  const queue = [
    { key: 'invoices', href: '/onyx/finance', icon: 'wallet' as const, tone: 'late' as const,
      title: 'Invoices overdue', meta: 'past their due date and unpaid', count: overdueInvoices },
    { key: 'exams', href: '/onyx/exams', icon: 'award' as const, tone: 'warn' as const,
      title: 'Exams awaiting results', meta: 'sat, but marks not released', count: examsUnpublished },
    { key: 'timetable', href: '/onyx/timetable', icon: 'calendar' as const, tone: 'warn' as const,
      title: 'Timetable slots in draft', meta: 'invisible to learners until published',
      count: timetableDrafts },
    { key: 'courses', href: '/onyx/courses', icon: 'book' as const, tone: 'neutral' as const,
      title: 'Courses in draft', meta: 'nobody can enrol on these yet', count: draftCourses },
    { key: 'jobs', href: '/onyx/jobs', icon: 'briefcase' as const, tone: 'neutral' as const,
      title: 'Job posts in draft', meta: 'not yet open to applications', count: jobsByStatus.draft },
  ].filter((row) => row.count > 0);

  const liveCourses = courseList.length - draftCourses;
  const arrears = outstanding?.total_minor ?? 0;

  const firstName = (me.email ?? '').split('@')[0]!.split(/[._]/)[0]!;
  const greeting = firstName.charAt(0).toUpperCase() + firstName.slice(1);

  const today = new Date().toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'long', day: 'numeric', month: 'long' });

  return (
    <OnyxShell
      me={me}
      title={isLearner ? `Hi, ${greeting} 👋` : me.tenant.name}
      subtitle={isLearner
        ? progressLine(progress)
        // The date, not the role. An operator knows what they signed in as --
        // the sidebar says so twice -- and "Signed in as administrator" was
        // the least useful sentence available in that position. What a home
        // screen is for is orientation in time: this is today, and everything
        // under it is as of now.
        : today + ' · ' + headcount + (headcount === 1 ? ' person' : ' people')
          + ' at this institution'}
      action={staff ? (
        // One primary action, and it is the one an administrator does most:
        // put somebody on the register. Everything else on this page is a
        // link to a screen that has its own controls.
        <Link href="/onyx/people?role=student"
          className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl bg-brand-600 px-4
                     text-[14px] font-bold text-white hover:bg-brand-700">
          <Icon name="users" className="h-4 w-4" />
          Add a student
        </Link>
      ) : undefined}
    >
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.62fr)_minmax(290px,.92fr)] xl:items-start">
        {/* ---------------- main column ---------------- */}
        <div className="min-w-0">
          {isLearner ? <ResumeCard courses={mine} outlines={outlines} /> : null}

          {staff ? (
            <>
              {/* The institution in three numbers. A count on its own is a
                  fact; what makes it a signal is what it is a share of,
                  which is why each tile carries its denominator rather than
                  floating alone. "Your courses" used to sit here -- which
                  read as "you teach 0" to every administrator who does not
                  also personally teach, since teaching is not the job this
                  screen is for. Revenue is covered by the Finance card in
                  Operations below rather than a bare total up here. */}
              {/* Four numbers, each about a different part of the institution
                  -- people, teaching, examinations, money. The old row was
                  three counts of the same register (students, faculty, people,
                  each captioned "of 19 people"), which is one fact printed
                  three times. A tile earns its place by answering a question
                  the tile beside it does not. */}
              <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
                <StatTile label="Students" value={counts.student ?? 0}
                  delta={newStudentsThisWeek || undefined}
                  note={newStudentsThisWeek ? 'joined in the last 7 days' : 'on the register'} />
                <StatTile label="Courses running" value={liveCourses}
                  note={draftCourses ? draftCourses + ' still in draft' : 'all published'} />
                <StatTile label="Examinations"
                  value={examsRunning > 0 ? examsRunning : examsUpcoming}
                  note={examsRunning > 0 ? 'sitting right now' : 'scheduled ahead'} />
                <StatTile label="Fees outstanding"
                  value={outstanding ? money(arrears) : '—'}
                  note={!outstanding ? 'could not be read'
                    : outstanding.invoices.length === 0 ? 'no invoices raised yet'
                      : overdueInvoices ? overdueInvoices + ' invoice'
                        + (overdueInvoices === 1 ? '' : 's') + ' overdue'
                        : outstanding.invoices.length + ' unsettled, none overdue'} />
              </div>

              {/* The one chart on the page, and it is about work rather than
                  headcount: what this institution has actually been doing.
                  Fourteen days is the span where a weekend still reads as a
                  weekend and a quiet week is visible without a date picker. */}
              <section className="mb-5">
                <SectionHead title="Activity" action={{ href: '/onyx/audit', label: 'Full log' }} />
                <Card className="p-4">
                  <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
                    <div className="text-[22px] font-extrabold leading-none tabular-nums">
                      {activityTrend.reduce((n, p) => n + p.value, 0)}
                      <span className="ml-1.5 text-[13px] font-semibold text-muted">
                        recorded actions
                      </span>
                    </div>
                    <div className="text-[12.5px] text-muted">
                      {busiest > 0 ? 'last 14 days · busiest day ' + busiest : 'last 14 days'}
                    </div>
                  </div>
                  <TrendBars points={activityTrend} title="Recorded actions per day"
                    unit="action" />
                </Card>
              </section>

              {/* Work, not counters. This is the section an operator is here
                  for: everything the institution is holding half-finished, in
                  the order it hurts -- money first, then anything a learner
                  can already see is missing. */}
              <section className="mb-5">
                <SectionHead title="Needs attention" />
                {queue.length ? (
                  <RowList label="Waiting for somebody">
                    {queue.map((row) => (
                      <QueueRow key={row.key} href={row.href} icon={row.icon} tone={row.tone}
                        title={row.title} meta={row.meta} count={row.count} />
                    ))}
                  </RowList>
                ) : (
                  <Card className="p-4">
                    <Empty icon="check">
                      Nothing is waiting. No overdue invoices, no unpublished results, and
                      nothing sitting in draft.
                    </Empty>
                  </Card>
                )}
              </section>

              {/* The job board's own shape, read off the counts the cards
                  above already fetched -- a bar earns its place beside a
                  breakdown, not instead of one. */}
              {jobList.length > 0 ? (
                <section className="mb-5">
                  <SectionHead title="Job pipeline"
                    action={{ href: '/onyx/jobs', label: 'All posts' }} />
                  <Card className="p-4">
                    <StackBar parts={[
                      { value: jobsByStatus.open, className: 'bg-green-600' },
                      { value: jobsByStatus.draft, className: 'bg-accent-500' },
                      { value: jobsByStatus.closed, className: 'bg-brand-300' },
                    ]} />
                    <Buckets rows={[
                      { label: 'Open to applications', dotClass: 'bg-green-600',
                        amount: jobsByStatus.open },
                      { label: 'Draft — invisible to learners', dotClass: 'bg-accent-500',
                        amount: jobsByStatus.draft },
                      { label: 'Closed', dotClass: 'bg-brand-300', amount: jobsByStatus.closed },
                    ]} />
                  </Card>
                </section>
              ) : null}

              <section className="mb-5">
                <SectionHead title="People"
                  action={{ href: '/onyx/people', label: 'Manage people' }} />
                {/* One bar, then where it sits. Six disconnected tiles cannot
                    answer "how much of this institution is staff"; a total with
                    its breakdown under it can, and the bar and the rows share
                    an order so the eye can move between them. */}
                <Card className="p-4">
                  {headcount ? (
                    <>
                      <StackBar parts={ROLE_ORDER.map((r) => ({
                        value: counts[r] ?? 0, className: ROLE_MARKS[r],
                      }))} />
                      <Buckets rows={ROLE_ORDER.map((r) => ({
                        label: ROLE_LABELS[r],
                        dotClass: ROLE_MARKS[r],
                        amount: counts[r] ?? 0,
                      }))} />
                    </>
                  ) : (
                    <Empty icon="users">
                      Nobody has been added to {me.tenant.name} yet.
                    </Empty>
                  )}
                </Card>
              </section>
            </>
          ) : null}

          {due.length ? (
            <section className="mb-5">
              <SectionHead title="Due next" id="due-h"
                action={{ href: '/onyx/courses', label: 'All courses' }} />
              {/* A list, not a table: a learner is picking one thing to open
                  rather than comparing a column. Dates are relative because
                  what anyone scans this for is what is urgent. */}
              <RowList label="What is due next">
                {due.map((a) => {
                  const when = relativeDue(a.due_at);
                  return (
                    <ListRow
                      key={a.id}
                      icon="edit"
                      tone={when.tone === 'late' ? 'late' : when.tone === 'soon' ? 'brand' : 'neutral'}
                      title={a.title}
                      href={'/onyx/assignments/' + a.id}
                      meta={a.course.code + ' · ' + a.course.title}
                      trailing={<Pill tone={when.tone}>{when.text}</Pill>}
                    />
                  );
                })}
              </RowList>
            </section>
          ) : null}

          {/* For staff this is "the courses I also personally teach", which
              most administrators do not -- rendering it for zero with a
              "look at the catalogue" prompt read as though the institution
              expected them to enrol in one. A student always sees this
              section, empty state included: "what you are taking" being
              genuinely empty is the true, useful answer for them. */}
          {staff && mine.length === 0 ? null : (
            <section className="mb-5">
              <SectionHead title={staff ? 'Your courses' : 'What you are taking'}
                action={{ href: '/onyx/courses', label: 'Catalogue' }} />
              {mine.length ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  {mine.map((c) => (
                    <Card key={c.id}>
                      <Link href={'/onyx/courses/' + c.id}
                        className="flex items-center gap-3.5 p-3.5">
                        <Ring percent={progressFor.get(c.id)?.percent ?? 0} />
                        <span className="min-w-0">
                          <span className="block truncate text-[14.5px] font-bold">{c.title}</span>
                          <span className="block truncate text-[12.5px] text-muted">
                            {c.code}{c.credits ? ` · ${c.credits} credits` : ''}
                          </span>
                        </span>
                      </Link>
                    </Card>
                  ))}
                </div>
              ) : (
                <Card>
                  <Empty icon="book">
                    Nothing yet.{' '}
                    <Link href="/onyx/courses" className="font-semibold text-brand-600 underline">
                      Look at the catalogue
                    </Link>.
                  </Empty>
                </Card>
              )}
            </section>
          )}

          {shortfall.length ? (
            <section className="mb-5">
              <SectionHead title="Attendance needs attention" />
              <div className="space-y-2">
                {shortfall.map((a) => {
                  const course = mine.find((c) => c.id === a.course_id);
                  const short = a.held - a.attended;
                  return (
                    <Banner key={a.course_id} tone="warn" icon="flag"
                      action={
                        <Link href="/onyx/timetable"
                          className="inline-flex min-h-[36px] items-center rounded-2xl border
                                     border-yellow-300 px-3 text-[13px] font-bold text-yellow-900
                                     hover:bg-yellow-100">
                          Timetable
                        </Link>
                      }
                    >
                      <strong>{course?.title ?? 'A course'}</strong> — {a.percent}%
                      {' '}({a.attended} of {a.held} sessions).
                      <span className="mt-0.5 block text-[13px]">
                        {short === 1
                          ? 'One session missed is what put this below the requirement.'
                          : `${short} sessions missed. This is below the requirement for this course.`}
                        {' '}The class is averaging {a.cohort_percent}% across{' '}
                        {a.cohort_size} {a.cohort_size === 1 ? 'learner' : 'learners'}.
                      </span>
                    </Banner>
                  );
                })}
              </div>
            </section>
          ) : null}
        </div>

        {/* ---------------- right rail ---------------- */}
        <div className="min-w-0 space-y-5">
          {profile ? <ReadinessCard readiness={profile.readiness} /> : null}
          {progress ? <StreakCard progress={progress} /> : null}

          {/* The right rail was empty for an administrator otherwise --
              nothing here is gated behind "my courses", so it is the one
              section of this page that is never blank for the role it is
              built for. */}
          {/* Where the rest of the institution is run. These were four large
              cards in the main column, each repeating a number the tiles at the
              top already carry -- Examinations twice, Finance twice. As rows in
              the rail they keep what they were actually good for, which is
              being a way in, and stop competing with the work list. */}
          {staff ? (
            <section>
              <SectionHead title="Campus" />
              <RowList label="Where the rest of the institution is run">
                <ListRow icon="calendar" tone="neutral" href="/onyx/timetable"
                  title="Timetable"
                  meta={slotList.length + ' session' + (slotList.length === 1 ? '' : 's')
                    + ' on the grid'
                    + (timetableDrafts ? ' · ' + timetableDrafts + ' draft' : '')}
                  trailing={<span className="text-[13px] font-bold tabular-nums">
                    {slotList.length}
                  </span>} />
                <ListRow icon="briefcase" tone="neutral" href="/onyx/placement"
                  title="Placement"
                  meta={jobsByStatus.open + ' open post' + (jobsByStatus.open === 1 ? '' : 's')
                    + (drivesUpcoming ? ' · ' + drivesUpcoming + ' drive upcoming' : '')}
                  trailing={<span className="text-[13px] font-bold tabular-nums">
                    {jobsByStatus.open}
                  </span>} />
                <ListRow icon="wallet" tone="neutral" href="/onyx/finance"
                  title="Finance"
                  meta={outstanding
                    ? outstanding.invoices.length + ' invoice'
                      + (outstanding.invoices.length === 1 ? '' : 's') + ' unsettled'
                    : 'could not be read'}
                  trailing={<span className="text-[13px] font-bold tabular-nums">
                    {outstanding?.invoices.length ?? '—'}
                  </span>} />
              </RowList>
            </section>
          ) : null}

          {staff && recentActivity.length ? (
            <section>
              <SectionHead title="Recent activity"
                action={{ href: '/onyx/audit', label: 'Full log' }} />
              <RowList label="Recent activity">
                {recentActivity.map((a) => {
                  const [noun, verb] = a.action.split('.');
                  return (
                    <ListRow
                      key={a.id}
                      icon="flag"
                      tone="neutral"
                      title={(a.actor?.name ?? 'The system') + ' '
                        + (verb ?? 'acted on').replace(/_/g, ' ') + ' '
                        + (/^[aeiou]/i.test(noun ?? a.entity_type) ? 'an ' : 'a ')
                        + (noun ?? a.entity_type)}
                      meta={new Date(a.created_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                    />
                  );
                })}
              </RowList>
            </section>
          ) : null}

          {progress ? (
            <section>
              <SectionHead title="This week" />
              <div className="grid grid-cols-2 gap-3">
                <StatTile label="Lessons" value={progress.lessons.completed}
                  note={`of ${progress.lessons.total}`} />
                <StatTile label="Attendance" value={progress.attendance.percent + '%'}
                  note={`${progress.attendance.attended} of ${progress.attendance.sessions}`} />
                <StatTile label="Solved" value={progress.practice.solved}
                  note={`of ${progress.practice.attempted} tried`} />
                <StatTile label="Submitted" value={progress.assignments.submitted}
                  note={`${progress.assignments.due} outstanding`} />
              </div>
            </section>
          ) : null}

          {progress?.nudges.length ? (
            <section>
              <SectionHead title="What to do next" />
              <OnyxNudges nudges={progress.nudges} />
            </section>
          ) : null}

          {isLearner ? (
            <section>
              <SectionHead title="Quick links" />
              <RowList label="Quick links">
                {/*
                  * Fees came off the learner's navigation and had to come off
                  * here too. This list is a SECOND entrance, written
                  * independently of `onyx-nav.ts`, so removing the nav item
                  * left the link sitting on the first screen every learner
                  * sees -- which is the one place it was most visible.
                  *
                  * Worth remembering the shape of that mistake: a navigation
                  * change is not complete until the hand-written link lists
                  * have been looked at too.
                  */}
                {([
                  ['/onyx/timetable', 'Timetable', 'calendar'],
                  ['/onyx/results', 'Results', 'award'],
                  ['/onyx/support', 'Ask for help', 'help'],
                ] as const).map(([href, label, icon]) => (
                  <li key={href}>
                    <Link href={href}
                      className="flex items-center gap-3 px-4 py-3 text-sm font-semibold
                                 hover:bg-brand-50/40 hover:text-brand-700">
                      <span className="text-brand-600"><Icon name={icon} /></span>
                      {label}
                      <span className="ml-auto text-muted">
                        <Icon name="chevron" className="h-4 w-4" />
                      </span>
                    </Link>
                  </li>
                ))}
              </RowList>
            </section>
          ) : null}

          {me.memberships.length > 1 ? (
            <Banner tone="info" icon="building">
              You belong to {me.memberships.length} institutions. Use the switcher to move
              between them &mdash; each shows only its own people and records.
            </Banner>
          ) : null}
        </div>
      </div>
    </OnyxShell>
  );
}

/* =========================================================== faculty ===== */

interface Member { user_id: number; role: string; user: { name: string } | null }

/**
 * Two caps, because both are still a fan-out at the database, even bulked.
 *
 * `/api/onyx/my/teaching-overview` answers "what do I teach" directly now
 * (`teachingFor()`, one query), so there is no catalogue to scan a limit
 * over any more. What is still bounded: how many of those taught courses
 * get the full per-course bundle (roster, assignments, sessions,
 * discussions, attendance), and how many published assignments get a
 * marking-queue count -- both still one row read per item even bulked into
 * a handful of queries, so a very large teaching load still costs a
 * bounded, predictable amount rather than pretending the page is free.
 */
const DEEP = 12;   // taught courses given the full per-course bundle
const QUEUE = 24;  // published assignments whose marking queue is read

const minutesOf = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const clockOf = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' });
const plural = (n: number, one: string, many = one + 's') => n + ' ' + (n === 1 ? one : many);

/** Buckets a flat, `course_id`-carrying list back into per-course arrays --
 *  what every `/my/*-overview` bulk response needs turned into before it can
 *  feed the same per-course rendering this page always rendered from. A
 *  `function` declaration, not a `const`, so it is usable (like
 *  `FacultyDashboard` below) above its own point in the file. */
function groupBy<T, K>(items: T[], keyOf: (item: T) => K): Map<K, T[]> {
  const map = new Map<K, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    const list = map.get(key);
    if (list) list.push(item); else map.set(key, [item]);
  }
  return map;
}

/** The shape `/api/onyx/my/teaching-overview` returns -- everything the
 *  faculty dashboard used to gather with a per-course fan-out, in one call. */
interface TeachingOverview {
  taught: Course[];
  taughtTotal: number;
  roster: { course_id: number; user_id: string }[];
  assignments: Assignment[];
  sessions: AttendanceSession[];
  discussions: Discussion[];
  cohort: Record<number, {
    sessions: number; threshold: number;
    cohort: { held: number; percent: number; below: number };
  }>;
  submissionCounts: Record<number, { total: number; waiting: number; held: number; done: number }>;
}

/** One line on the Today rail: a scheduled class, or a register to take. */
interface TodayRow {
  key: string; at: number; kind: 'class' | 'register';
  title: string; time: string; where?: string;
  href?: string; action?: { href: string; label: string }; open?: boolean;
}

/**
 * What a teacher opens this page to find out.
 *
 * The shape follows the products that solved this already: Workable opens on
 * the person and their day, Charma puts today's schedule beside action items
 * split into what is due now and what is coming, and Circle leads with
 * per-course student progress rather than institution totals. None of them
 * open on a headcount, because a teacher cannot act on one.
 *
 * So: what is waiting on them, then their day, then their courses, then the
 * things that have gone quietly wrong. Every number here is one the API
 * actually returns -- see the notes on `attendance` below for the one place
 * that forced a substitution rather than an invention.
 */
async function FacultyDashboard({ me }: { me: Me }) {
  const [catalogue, grid, rooms, members, overview] = await Promise.all([
    onyxApiSafe<Course[]>('/api/onyx/courses'),
    onyxApiSafe<TimetableSlot[]>('/api/onyx/timetable?faculty_id=' + me.user_id),
    onyxApiSafe<Room[]>('/api/onyx/rooms'),
    onyxApiSafe<Member[]>('/api/onyx/members'),
    onyxApiSafe<TeachingOverview>(
      '/api/onyx/my/teaching-overview?deep=' + DEEP + '&queue=' + QUEUE),
  ]);

  const catalog = catalogue ?? [];
  const slots = grid ?? [];

  // Everything below used to come from up to SCAN individual course-detail
  // reads (there was no direct "what do I teach" query, so the page read
  // the catalogue and checked each course's own faculty list), then DEEP
  // taught courses times 5 more per-course reads, then up to QUEUE more
  // per-assignment reads for marking-queue counts -- as many as ~128 round
  // trips for one page load. `/my/teaching-overview` answers all of it in
  // one call; this just buckets that single response back into the same
  // per-course `packs` / `queues` shape the rest of this function has
  // always rendered from.
  const taught = overview?.taught ?? [];
  const taughtTotal = overview?.taughtTotal ?? taught.length;
  const rosterByCourse = groupBy(overview?.roster ?? [], (r) => r.course_id);
  const assignmentsByCourse = groupBy(overview?.assignments ?? [], (a) => a.course_id);
  const sessionsByCourse = groupBy(overview?.sessions ?? [], (s) => s.course_id);
  const discussionsByCourse = groupBy(overview?.discussions ?? [], (d) => d.course_id);
  const cohortByCourse = overview?.cohort ?? {};

  const packs = taught.map((course) => ({
    course,
    roster: rosterByCourse.get(course.id) ?? [],
    assignments: assignmentsByCourse.get(course.id) ?? [],
    sessions: sessionsByCourse.get(course.id) ?? [],
    questions: discussionsByCourse.get(course.id) ?? [],
    attendance: cohortByCourse[course.id] ?? null,
  }));

  // The marking queue -- counts read in bulk by `/my/teaching-overview`
  // (one query across every published assignment) instead of one
  // `/api/onyx/assignments/:id` call per assignment.
  const briefs = packs.flatMap((p) => p.assignments
    .filter((a) => a.status === 'published')
    .map((a) => ({ assignment: a, course: p.course })));
  const submissionCounts = overview?.submissionCounts ?? {};
  const queues = briefs.map((b) => ({
    ...b,
    ...(submissionCounts[b.assignment.id] ?? { total: 0, waiting: 0, held: 0, done: 0 }),
  }));

  const toMark = queues.filter((q) => q.waiting > 0).sort((a, b) => b.waiting - a.waiting);
  const toReturn = queues.filter((q) => q.held > 0);
  const waiting = queues.reduce((n, q) => n + q.waiting, 0);
  const held = queues.reduce((n, q) => n + q.held, 0);
  const marked = queues.reduce((n, q) => n + q.done, 0);
  const handed = queues.reduce((n, q) => n + q.total, 0);

  // Headcount that means something to a teacher: the people in front of them,
  // counted once even when they take two of your courses.
  const learners = new Set<string>();
  packs.forEach((p) => p.roster.forEach((r) => learners.add(r.user_id)));

  const now = new Date();
  // The institution's day, not the runtime's -- see isoWeekdayInTz. Monday = 1.
  const todayNum = isoWeekdayInTz(now);
  const isToday = (iso: string) => {
    const d = new Date(iso);
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()
      && d.getDate() === now.getDate();
  };

  const roomName = new Map((rooms ?? []).map((r) => [r.id, r.code + ' · ' + r.name]));
  const courseName = new Map(catalog.map((c) => [c.id, c.code + ' · ' + c.title]));
  const teaches = new Set(taught.map((c) => c.id));

  const classes: TodayRow[] = slots.filter((s) => s.day_of_week === todayNum).map((s) => ({
    key: 'slot-' + s.id,
    at: minutesOf(s.starts_at),
    kind: 'class',
    title: courseName.get(s.course_id) ?? 'Course #' + s.course_id,
    time: hhmm(s.starts_at) + '–' + hhmm(s.ends_at),
    where: roomName.get(s.room_id),
    href: teaches.has(s.course_id) ? '/onyx/courses/' + s.course_id : undefined,
    // A register link only where a register can actually be taken: the API
    // refuses the attendance screens for a course you are not on.
    action: teaches.has(s.course_id)
      ? { href: '/onyx/courses/' + s.course_id + '/attendance', label: 'Register' }
      : undefined,
  }));

  const registers: TodayRow[] = packs.flatMap((p) => p.sessions
    .filter((s) => isToday(s.scheduled_at))
    .map((s) => {
      const at = new Date(s.scheduled_at);
      const href = '/onyx/courses/' + p.course.id + '/attendance/' + s.id;
      return {
        key: 'sess-' + s.id,
        at: at.getHours() * 60 + at.getMinutes(),
        kind: 'register' as const,
        title: s.title,
        time: clockOf(s.scheduled_at) + ' · ' + s.duration_minutes + ' min',
        where: p.course.code + ' · ' + p.course.title,
        open: s.status === 'open',
        href,
        action: { href, label: s.status === 'open' ? 'Take register' : 'View' },
      };
    }));

  const today = [...classes, ...registers].sort((a, b) => a.at - b.at);
  const nextSlot = slots.find((s) => s.day_of_week > todayNum) ?? slots[0] ?? null;

  // Registers left open after the class has been and gone. Anyone can still
  // check themselves in to one of these, which is the reason it is a warning
  // and not a statistic.
  const stale = packs.flatMap((p) => p.sessions
    .filter((s) => s.status === 'open' && Date.parse(s.scheduled_at) < now.getTime()
      && !isToday(s.scheduled_at))
    .map((s) => ({ course: p.course, session: s })));

  const unanswered = packs.flatMap((p) => p.questions
    .filter((q) => q.reply_count === 0)
    .map((q) => ({ course: p.course, q })));
  const shortfalls = packs.filter((p) => (p.attendance?.cohort.below ?? 0) > 0);

  // Deadlines you set, soonest first, late included -- a brief that went past
  // its date is the one about to arrive as a pile of late submissions.
  const deadlines = briefs
    .filter((b) => b.assignment.due_at)
    .sort((a, b) => Date.parse(a.assignment.due_at!) - Date.parse(b.assignment.due_at!))
    .slice(0, 4);

  const contactMinutes = slots.reduce((n, s) =>
    n + (minutesOf(s.ends_at) - minutesOf(s.starts_at)), 0);
  const daysTaught = new Set(slots.map((s) => s.day_of_week)).size;

  const myName = (members ?? []).find((m) => String(m.user_id) === me.user_id)?.user?.name ?? null;

  /* The one thing on the page, chosen rather than stacked: marking first
     because it blocks a learner, then questions, then an open register. */
  const lead = waiting > 0
    ? {
      eyebrow: 'Waiting on you',
      title: plural(waiting, 'submission') + ' to mark',
      sub: toMark[0]
        ? toMark[0].course.code + ' · ' + toMark[0].assignment.title
          + ' has the most — ' + toMark[0].waiting + ' waiting'
        : undefined,
      href: '/onyx/assignments/' + (toMark[0]?.assignment.id ?? ''),
      cta: 'Start marking',
    }
    : unanswered.length > 0
      ? {
        eyebrow: 'Waiting on you',
        title: plural(unanswered.length, 'question') + ' with no reply',
        sub: unanswered[0]!.course.code + ' · ' + unanswered[0]!.q.title,
        href: '/onyx/discussions/' + unanswered[0]!.q.id,
        cta: 'Answer it',
      }
      : stale.length > 0
        ? {
          eyebrow: 'Waiting on you',
          title: plural(stale.length, 'register') + ' still open',
          sub: stale[0]!.course.code + ' · ' + stale[0]!.session.title
            + ' — anyone can still check in',
          href: '/onyx/courses/' + stale[0]!.course.id + '/attendance/'
            + stale[0]!.session.id,
          cta: 'Close it',
        }
        : null;

  return (
    <OnyxShell
      me={me}
      title={myName ? 'Hello, ' + myName : me.tenant.name}
      subtitle={taught.length
        ? plural(taught.length, 'course') + ' · ' + plural(learners.size, 'student')
          + ' · ' + me.tenant.name
        : 'No course has been assigned to you at ' + me.tenant.name + ' yet.'}
    >
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.62fr)_minmax(290px,.92fr)] xl:items-start">
        {/* ---------------- main column ---------------- */}
        <div className="min-w-0">
          <section className="mb-5" aria-labelledby="waiting-h">
            {lead ? (
              <Hero
                eyebrow={lead.eyebrow}
                title={<span id="waiting-h">{lead.title}</span>}
                sub={lead.sub}
                // One button, not two. `Hero` sizes its action slot at
                // max-content and clips what does not fit, so a second link
                // here loses its right-hand end at 320px -- and "your courses"
                // is already the section heading's action and a quick link.
                actions={
                  <Link href={lead.href}
                    className="inline-flex min-h-[44px] items-center gap-2 rounded-2xl bg-white
                               px-4 text-[14.5px] font-bold text-brand-700 hover:bg-brand-50
                               focus-visible:outline-white">
                    <Icon name="edit" className="h-4 w-4" />
                    {lead.cta}
                  </Link>
                }
              >
                {handed > 0 ? (
                  <>
                    <Meter percent={handed ? (marked / handed) * 100 : 0}
                      label="Submissions marked" tone="light" />
                    <div className="mt-2 flex flex-wrap items-baseline justify-between gap-x-3
                                    text-[12.5px]">
                      <span className="font-bold tabular-nums">
                        {marked} of {handed} submissions marked
                      </span>
                      <span className="tabular-nums text-white/80">
                        {held > 0 ? held + ' marked, not returned yet' : 'across your courses'}
                      </span>
                    </div>
                  </>
                ) : null}
              </Hero>
            ) : (
              // A zero in a big box is a thing to interpret. A sentence is not.
              <Banner tone="good" icon="check">
                <strong className="font-bold" id="waiting-h">Nothing is waiting on you.</strong>
                <span className="mt-0.5 block text-[13px]">
                  {taught.length
                    ? 'Every submission is marked, every question has a reply and no register '
                      + 'was left open. Today is below.'
                    : 'Once you are on a course -- your own, or one an administrator puts you '
                      + 'on -- its marking queue, register and questions all arrive here.'}
                </span>
              </Banner>
            )}
          </section>

          {/* Four numbers about this person's teaching. Not one of them is a
              fact about the institution -- that screen belongs to somebody
              whose job is the institution. */}
          <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile label="Your courses" value={taught.length}
              note={catalog.length ? 'of ' + plural(catalog.length, 'in the catalogue',
                'in the catalogue') : undefined} />
            <StatTile label="Students taught" value={learners.size}
              note={packs.length ? 'across ' + plural(packs.length, 'course') : undefined} />
            <StatTile label="Waiting to mark" value={waiting}
              note={held > 0
                ? held + ' marked, not returned'
                : waiting === 1 ? 'submission waiting' : 'submissions waiting'} />
            <StatTile label="Today" value={today.length}
              note={slots.length ? plural(slots.length, 'class') + ' on your week' : 'nothing on'} />
          </div>

          <section className="mb-5">
            <SectionHead title={'Today · ' + (WEEKDAYS[todayNum - 1] ?? '')}
              action={{ href: '/onyx/timetable', label: 'Your week' }} />
            {today.length ? (
              <RowList label="What you are teaching today">
                {today.map((r) => (
                  <ListRow
                    key={r.key}
                    icon={r.kind === 'register' ? 'users' : 'calendar'}
                    tone={r.open ? 'late' : 'brand'}
                    title={r.title}
                    href={r.href}
                    meta={
                      <span className="tabular-nums">
                        {r.time}{r.where ? ' · ' + r.where : ''}
                      </span>
                    }
                    chips={r.kind === 'register'
                      ? (r.open
                        ? <span className="[&_i]:motion-reduce:animate-none">
                          <State tone="live">Check-in open</State>
                        </span>
                        : <Pill tone="neutral">Closed</Pill>)
                      : null}
                    action={r.action}
                  />
                ))}
              </RowList>
            ) : (
              <Card>
                <Empty icon="calendar">
                  Nothing is scheduled for you today.
                  {nextSlot ? (
                    <>
                      {' '}Next:{' '}
                      <strong className="font-semibold text-ink">
                        {WEEKDAYS[nextSlot.day_of_week - 1] ?? 'Day ' + nextSlot.day_of_week}
                        {' '}{hhmm(nextSlot.starts_at)}
                      </strong>
                      {' — '}
                      {courseName.get(nextSlot.course_id) ?? 'Course #' + nextSlot.course_id}
                      {roomName.get(nextSlot.room_id)
                        ? ' in ' + roomName.get(nextSlot.room_id) : ''}.
                    </>
                  ) : null}
                </Empty>
              </Card>
            )}
          </section>

          <section className="mb-5">
            <SectionHead title="Your courses"
              action={{ href: '/onyx/courses', label: 'All courses' }} />
            {packs.length ? (
              <div className="grid gap-3 sm:grid-cols-2">
                {packs.map((p) => {
                  const a = p.attendance;
                  const queue = queues
                    .filter((q) => q.course.id === p.course.id)
                    .reduce((n, q) => n + q.waiting, 0);
                  return (
                    // min-w-0 on the grid item, not just on the flex child
                    // inside it: a grid item's automatic minimum size is its
                    // min-content, and the course title is `truncate`, i.e.
                    // white-space: nowrap. Without this the longest title sets
                    // the track and the whole page scrolls sideways at 320px.
                    <Card key={p.course.id} className="min-w-0 p-4">
                      <div className="flex items-start gap-2.5">
                        <div className="min-w-0 flex-1">
                          <Link href={'/onyx/courses/' + p.course.id}
                            className="block truncate text-[14.5px] font-bold hover:underline">
                            {p.course.title}
                          </Link>
                          <p className="mt-0.5 truncate text-[12.5px] text-muted">
                            {p.course.code}
                            {p.course.credits ? ' · ' + p.course.credits + ' credits' : ''}
                          </p>
                        </div>
                        <Pill tone="neutral">{plural(p.roster.length, 'enrolled', 'enrolled')}</Pill>
                      </div>

                      {/* Deliberately cohort attendance and not "class
                          progress". `/courses/:id/outline` returns the
                          *viewer's* lesson completions, so on a teacher's
                          screen that number is how much of their own material
                          they have clicked through -- which would read as the
                          class's progress and be wrong. There is no per-cohort
                          lesson-progress endpoint, so this shows the one
                          cohort figure the API does return. */}
                      {a && a.sessions > 0 ? (
                        <div className="mt-3">
                          <Meter percent={a.cohort.percent}
                            label={'Cohort attendance on ' + p.course.title} />
                          <div className="mt-1.5 flex flex-wrap items-baseline justify-between
                                          gap-x-3 text-[12.5px]">
                            <span className="font-bold tabular-nums">
                              {a.cohort.percent}% cohort attendance
                            </span>
                            <span className="tabular-nums text-muted">
                              {plural(a.sessions, 'session')} held
                            </span>
                          </div>
                        </div>
                      ) : (
                        <p className="mt-3 text-[12.5px] text-muted">
                          No register has been taken on this course yet.
                        </p>
                      )}

                      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2
                                      border-t border-line pt-3 text-[13px] font-semibold">
                        <Link href={'/onyx/courses/' + p.course.id + '/attendance'}
                          className="text-brand-600 hover:underline">Attendance</Link>
                        <Link href={'/onyx/courses/' + p.course.id}
                          className="text-brand-600 hover:underline">Course</Link>
                        {queue > 0 ? (
                          <span className="ml-auto"><Pill tone="soon">{queue} to mark</Pill></span>
                        ) : null}
                      </div>
                    </Card>
                  );
                })}
              </div>
            ) : (
              <Card>
                <Empty icon="book">
                  You are not on any course yet. Start one yourself, or an administrator can
                  put you on an existing one, from{' '}
                  <Link href="/onyx/courses" className="font-semibold text-brand-600 underline">
                    the catalogue
                  </Link>.
                </Empty>
              </Card>
            )}
          </section>

          {toMark.length || toReturn.length || unanswered.length || stale.length
            || shortfalls.length ? (
              <section className="mb-5">
                <SectionHead title="Needs attention" />
                <RowList label="Things on your courses that need attention">
                  {toMark.map((q) => (
                    <ListRow
                      key={'mark-' + q.assignment.id}
                      icon="edit" tone="brand"
                      title={q.assignment.title}
                      href={'/onyx/assignments/' + q.assignment.id}
                      meta={q.course.code + ' · ' + relativeDue(q.assignment.due_at).text}
                      trailing={<Pill tone="soon">{plural(q.waiting, 'to mark', 'to mark')}</Pill>}
                    />
                  ))}
                  {toReturn.map((q) => (
                    <ListRow
                      key={'return-' + q.assignment.id}
                      icon="upload" tone="neutral"
                      title={q.assignment.title}
                      href={'/onyx/assignments/' + q.assignment.id}
                      meta={q.course.code + ' · marked, but the learner cannot see it yet'}
                      trailing={
                        <Pill tone="neutral">{plural(q.held, 'to return', 'to return')}</Pill>
                      }
                    />
                  ))}
                  {stale.map(({ course, session }) => (
                    <ListRow
                      key={'open-' + session.id}
                      icon="clock" tone="late"
                      title={session.title}
                      href={'/onyx/courses/' + course.id + '/attendance/' + session.id}
                      meta={course.code + ' · register left open after the class'}
                      trailing={<Pill tone="late">Open</Pill>}
                    />
                  ))}
                  {unanswered.map(({ course, q }) => (
                    <ListRow
                      key={'q-' + q.id}
                      icon="message" tone="neutral"
                      title={q.title}
                      href={'/onyx/discussions/' + q.id}
                      meta={course.code + ' · nobody has replied'}
                      trailing={<Pill tone="neutral">No reply</Pill>}
                    />
                  ))}
                  {shortfalls.map((p) => (
                    <ListRow
                      key={'short-' + p.course.id}
                      icon="alert" tone="late"
                      title={p.course.title}
                      href={'/onyx/courses/' + p.course.id + '/attendance'}
                      meta={p.course.code + ' · below ' + p.attendance!.threshold
                        + '% attendance'}
                      trailing={
                        <Pill tone="late">
                          {plural(p.attendance!.cohort.below, 'learner')}
                        </Pill>
                      }
                    />
                  ))}
                </RowList>
              </section>
            ) : null}
        </div>

        {/* ---------------- right rail ---------------- */}
        <div className="min-w-0 space-y-5">
          {slots.length ? (
            <section>
              <SectionHead title="Your week" />
              <div className="grid grid-cols-2 gap-3">
                <StatTile label="Contact hours" value={Math.round(contactMinutes / 60)}
                  note="on the published grid" />
                <StatTile label="Classes" value={slots.length}
                  note={plural(daysTaught, 'day') + ' a week'} />
              </div>
            </section>
          ) : null}

          {deadlines.length ? (
            <section>
              <SectionHead title="Deadlines you set" />
              <RowList label="Deadlines on your courses">
                {deadlines.map((d) => {
                  const when = relativeDue(d.assignment.due_at);
                  return (
                    <ListRow
                      key={'due-' + d.assignment.id}
                      icon="calendar"
                      tone={when.tone === 'late' ? 'late' : when.tone === 'soon' ? 'brand' : 'neutral'}
                      title={d.assignment.title}
                      href={'/onyx/assignments/' + d.assignment.id}
                      meta={d.course.code}
                      trailing={<Pill tone={when.tone}>{when.text}</Pill>}
                    />
                  );
                })}
              </RowList>
            </section>
          ) : null}

          <section>
            <SectionHead title="Quick links" />
            <RowList label="Quick links">
              {([
                ['/onyx/courses', 'Your courses', 'book'],
                ['/onyx/timetable', 'Timetable', 'calendar'],
                ['/onyx/assessments', 'Assessments', 'edit'],
                ['/onyx/support', 'Mentor queue', 'help'],
              ] as const).map(([href, label, icon]) => (
                <li key={href}>
                  <Link href={href}
                    className="flex items-center gap-3 px-4 py-3 text-sm font-semibold
                               hover:bg-brand-50/40 hover:text-brand-700">
                    <span className="text-brand-600"><Icon name={icon} /></span>
                    {label}
                    <span className="ml-auto text-muted">
                      <Icon name="chevron" className="h-4 w-4" />
                    </span>
                  </Link>
                </li>
              ))}
            </RowList>
          </section>

          {taughtTotal > DEEP ? (
            <Banner tone="info" icon="alert">
              You teach {taughtTotal} courses; this covers the first {DEEP}. Anything beyond
              that is on the course itself.
            </Banner>
          ) : null}

          {me.memberships.length > 1 ? (
            <Banner tone="info" icon="building">
              You belong to {me.memberships.length} institutions. Use the switcher to move
              between them &mdash; each shows only its own people and records.
            </Banner>
          ) : null}
        </div>
      </div>
    </OnyxShell>
  );
}

/* ------------------------------------------------------------------ parts */

function progressLine(p: ProgressSummary | null): string {
  if (!p) return 'Welcome back.';
  const left = p.lessons.total - p.lessons.completed;
  if (p.courses.enrolled === 0) return 'You are not enrolled in a course yet.';
  if (left <= 0 && p.lessons.total > 0) return "You've finished every lesson. Nice.";
  if (left === 1) return "You're 1 lesson from finishing your plan.";
  if (left > 1) return `You're ${left} lessons from finishing your plan.`;
  return 'Welcome back.';
}

/**
 * The single most important control on the page: get back to work.
 *
 * Every serious learning product opens on this -- Uxcel, Coursera, Codecademy
 * and Mindvalley all lead with a resume card. Onyx previously had no resume
 * affordance at all, so a student landed on counters and went hunting.
 *
 * The `<section aria-labelledby>` around the band is not decoration: it is how
 * this region is announced and how it is addressable, so it stays even though
 * the band itself is now the shared `Hero`.
 */
function ResumeCard({ courses, outlines }: {
  courses: Course[]; outlines: (Outline | null)[];
}) {
  if (!courses.length) return null;

  // The course to resume is the one actually part-finished. Falling back to
  // whichever course happened to sort first would send a learner who is 90%
  // through one course into a different one they have not started.
  let index = outlines.findIndex((o) => o && o.progress.percent > 0 && o.progress.percent < 100);
  if (index === -1) index = outlines.findIndex((o) => o && o.progress.percent < 100);
  if (index === -1) index = 0;

  const course = courses[index]!;
  const outline = outlines[index] ?? null;
  const percent = outline?.progress.percent ?? 0;

  // Deep-link to the first lesson they have not finished, so "Resume" resumes
  // rather than dropping them at the top of the syllabus to find their place.
  const nextLesson = outline?.modules
    .flatMap((m) => m.lessons)
    .find((l) => !l.completed_at && !l.locked) ?? null;
  const href = nextLesson
    ? `/onyx/courses/${course.id}/lessons/${nextLesson.id}`
    : `/onyx/courses/${course.id}`;

  // The band names the lesson rather than saying "continue" and making
  // somebody click to find out what continuing means.
  const sub = nextLesson
    ? nextLesson.title
      + (nextLesson.duration_seconds ? ' — ' + formatDuration(nextLesson.duration_seconds) : '')
    : course.code + (course.credits ? ` · ${course.credits} credits` : '');

  return (
    <section className="mb-5" aria-labelledby="resume-h">
      <Hero
        eyebrow={percent > 0 ? 'Pick up where you left off' : 'Start here'}
        title={<span id="resume-h">{course.title}</span>}
        sub={sub}
        actions={
          <>
            <Link href={href}
              className="inline-flex min-h-[44px] items-center gap-2 rounded-2xl bg-white px-4
                         text-[14.5px] font-bold text-brand-700 hover:bg-brand-50
                         focus-visible:outline-white">
              <Icon name="play" className="h-4 w-4" />
              {percent > 0 ? 'Resume lesson' : 'Start course'}
            </Link>
            <Link href="/onyx/courses"
              className="inline-flex min-h-[44px] items-center rounded-2xl border border-white/30
                         bg-white/10 px-4 text-[14.5px] font-bold text-white hover:bg-white/20
                         focus-visible:outline-white">
              All courses
            </Link>
          </>
        }
      >
        <Meter percent={percent} label="Course progress" tone="light" />
        <div className="mt-2 flex flex-wrap items-baseline justify-between gap-x-3 text-[12.5px]">
          <span className="font-bold tabular-nums">{percent}% complete</span>
          <span className="tabular-nums text-white/80">
            {outline ? `${outline.progress.completed} of ${outline.progress.total} lessons` : ''}
          </span>
        </div>
      </Hero>
    </section>
  );
}

/**
 * The streak, drawn as the week.
 *
 * The days are pills rather than bare dots because colour is not allowed to be
 * the whole signal: a finished day carries a tick AND its letter, today is the
 * one solid pill, and the rest are plainly empty. Every learning product worth
 * copying draws the week this way, and it reads at a glance in a way
 * "longest 0 · nothing today" never did.
 */
/**
 * CAR-05 -- the readiness score, as the one thing to do about it.
 *
 * This was a number, its denominator, and a sentence naming the five inputs:
 * "49.96 / readiness score / Out of 100 / From attendance, assessments,
 * practice, projects and interviews". Three problems, and the first is the
 * smallest.
 *
 *   * **49.96.** Two decimal places on a score out of a hundred reads as a
 *     spreadsheet cell rather than a judgement, and the hundredth of a point
 *     is not a fact about anybody -- it is a rounding artefact of five
 *     weighted components. Rounded, with the exact figure kept in the title
 *     attribute for anybody who wants it.
 *   * **Nothing said whether it was good.** A bare 50 out of 100 is unreadable
 *     without a scale: is that failing, or the middle of a cohort? So the
 *     number carries a band word and sits on a track, which is how every score
 *     people actually act on is drawn -- a credit score, a password health
 *     score, a site performance score.
 *   * **It listed the ingredients instead of the advice.** Naming the five
 *     inputs tells a learner nothing they can do on a Tuesday afternoon. The
 *     breakdown is already on the wire -- `/my/profile` returns every
 *     component with its weight and the points earned -- so the card names the
 *     ONE furthest from full marks and links straight at it.
 *
 * The formula stays published on /onyx/profile, where the full working
 * belongs. This is the dashboard: one number, one verdict, one next move.
 */
const READINESS_BANDS = [
  { at: 80, word: 'Strong', tone: 'text-green-700', bar: 'bg-green-600' },
  { at: 60, word: 'On track', tone: 'text-green-700', bar: 'bg-green-600' },
  { at: 40, word: 'Getting there', tone: 'text-accent-700', bar: 'bg-accent-500' },
  { at: 0, word: 'Early days', tone: 'text-muted', bar: 'bg-slate-400' },
] as const;

/** Where each component sends somebody who wants to move it. */
const READINESS_LINKS: Record<string, { href: string; verb: string }> = {
  attendance: { href: '/onyx/timetable', verb: 'Your timetable' },
  assessment: { href: '/onyx/assessments', verb: 'Your papers' },
  practice: { href: '/onyx/practice', verb: 'Open Code Lab' },
  projects: { href: '/onyx/workspaces', verb: 'Your projects' },
  // "Your mock interviews", not "Book a mock interview". The other four verbs
  // here name a destination; this one named an action, and it was the one
  // action on the list a learner cannot take -- the route that schedules an
  // interview accepts admin, placement and faculty, so a student following
  // this nudge arrived at a page with nothing to press. The page is still the
  // right place to send them: it is where the interview appears once the
  // placement office books it, and where the feedback lands afterwards.
  interview: { href: '/onyx/interviews', verb: 'Your mock interviews' },
};

function ReadinessCard({ readiness }: { readiness: LearnerReadiness }) {
  const exact = Number(readiness?.score ?? 0);
  const score = Math.round(exact);
  const band = READINESS_BANDS.find((b) => score >= b.at) ?? READINESS_BANDS[3];

  /*
   * The component with the most points still on the table -- not the lowest
   * percentage.
   *
   * Those are different questions and only one of them is useful. Mock
   * interviews at nought per cent are worth 15 points; attendance at eighty
   * per cent is worth 4. Somebody told to fix the smaller number would spend
   * their afternoon on the one that moves the score least.
   */
  const gaps = (readiness?.breakdown ?? [])
    .map((c) => ({ ...c, missing: Number(c.weight ?? 0) - Number(c.points ?? 0) }))
    .filter((c) => c.missing > 0.5)
    .sort((a, b) => b.missing - a.missing);
  const biggest = gaps[0];
  const link = biggest ? READINESS_LINKS[biggest.key] : undefined;

  return (
    <section aria-labelledby="readiness-h">
      <Card className="p-4">
        <div className="flex items-baseline gap-2.5">
          <span
            title={'Exactly ' + exact}
            className={'text-[40px] font-extrabold leading-none tabular-nums ' + band.tone}
          >
            {score}
          </span>
          <span className="min-w-0">
            <span id="readiness-h" className="block text-[13.5px] font-bold">
              {band.word}
            </span>
            <span className="block text-[12px] text-muted">readiness, out of 100</span>
          </span>
        </div>

        {/* The track. Colour is never the only signal -- the band word above
            says the same thing in words, and the bar carries an accessible
            name and value of its own. */}
        <div
          role="progressbar"
          aria-valuenow={score} aria-valuemin={0} aria-valuemax={100}
          aria-label={'Readiness ' + score + ' out of 100, ' + band.word}
          className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100"
        >
          <span className={'block h-full rounded-full ' + band.bar}
            style={{ width: Math.max(2, score) + '%' }} />
        </div>

        {biggest ? (
          <div className="mt-3 rounded-xl bg-slate-50 p-3">
            <p className="text-[12px] font-bold uppercase tracking-wide text-muted">
              Worth the most right now
            </p>
            <p className="mt-1 text-[13px] font-semibold leading-snug text-ink">
              {biggest.label}
            </p>
            <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted">
              {Math.round(biggest.missing)} of your {Math.round(Number(biggest.weight))} points
              here are still unearned &mdash; more than anywhere else.
            </p>
            {link ? (
              // `min-h-[24px]`, and the same on "How this is worked out"
              // below: both are standing calls to action rather than words
              // inside a sentence, so the 24px floor in WCAG 2.5.8 applies to
              // them with no exception to claim. Small type made them 19px.
              <Link href={link.href}
                className="mt-1.5 inline-flex min-h-[24px] items-center gap-1 text-[12.5px]
                           font-bold text-brand-600 hover:underline">
                {link.verb}
                <Icon name="chevron" className="h-3.5 w-3.5" />
              </Link>
            ) : null}
          </div>
        ) : (
          <p className="mt-3 rounded-xl bg-green-50 p-3 text-[12.5px] leading-relaxed
                        text-green-800">
            Every part of your score is at or near full marks. Nothing here is holding
            you back.
          </p>
        )}

        <div className="mt-3">
          <Link href="/onyx/profile"
            className="inline-flex min-h-[24px] items-center text-[12.5px] font-bold
                       text-brand-600 hover:underline">
            How this is worked out
          </Link>
        </div>
      </Card>
    </section>
  );
}

function StreakCard({ progress }: { progress: ProgressSummary }) {
  // The institution's weekday, not the runtime's: a learner opening this
  // before dawn had the wrong square lit on their streak.
  const today = weekdayInTz();
  const monday = (today + 6) % 7;             // 0 = Monday, matching the labels
  const labels = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
  const names = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const current = progress.streak.current;

  return (
    <section aria-labelledby="streak-h">
      <Card className="p-4">
        <div className="flex items-center gap-3">
          <span className="text-[40px] font-extrabold leading-none tabular-nums text-accent-700">
            {current}
          </span>
          <span>
            <span id="streak-h" className="block text-[13.5px] font-bold">day streak</span>
            <span className="block text-[12.5px] text-muted">
              {progress.streak.longest > current
                ? `Best yet: ${progress.streak.longest} days`
                : progress.streak.active_today ? 'Counted for today' : 'Nothing today yet'}
            </span>
          </span>
        </div>

        <ul className="mt-4 flex flex-wrap gap-1.5">
          {labels.map((l, i) => {
            // Days before today in this week are "done" only as far back as the
            // streak actually reaches -- an 11-day best does not fill Monday if
            // the current run is 2.
            const done = i <= monday && (monday - i) < current;
            const isToday = i === monday;
            return (
              <li key={i}
                className={'inline-flex min-w-[34px] items-center justify-center gap-1 '
                  + 'rounded-full px-2 py-1 text-[12.5px] font-bold '
                  + (done
                    ? 'bg-green-50 text-green-700'
                    : isToday
                      ? 'bg-brand-600 text-white'
                      : 'bg-slate-100 text-muted')}>
                {done ? <Icon name="check" className="h-3.5 w-3.5" /> : null}
                <span aria-hidden="true">{l}</span>
                <span className="sr-only">
                  {names[i]}{isToday ? ', today' : ''}{done ? ', done' : ', nothing yet'}
                </span>
              </li>
            );
          })}
        </ul>

        <p className="mt-3 text-[12.5px] text-muted">
          Counted from lessons finished, work submitted and code run &mdash; not from
          signing in.
        </p>
      </Card>
    </section>
  );
}
