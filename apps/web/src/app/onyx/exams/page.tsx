import Link from 'next/link';
import type { Metadata } from 'next';
import { OnyxShell } from '@/components/onyx-shell';
import { ExamWhen } from '@/components/onyx-local-time';
import { navFor } from '@/lib/onyx-nav';
import { requireOnyxSession, onyxApi, type Me } from '@/lib/onyx-session';
import type { Exam } from '@/lib/onyx-campus';
import { CreatePanel } from '@/components/onyx-create';
import { CreatePaper } from '@/components/onyx-manage';
import { onyxApiSafe } from '@/lib/onyx-session';
import type { Course } from '@/lib/onyx-learn';
import {
  DataTable, EmptyRow, Icon, Pill, Banner, Segmented, State, StatTile,
} from '@/components/onyx-ui';
import { dayNumber } from '@/lib/onyx-time';
import { FacultyExamTabs } from '@/lib/onyx-console-exams';
import { CreateExamForm, type ConsoleBank } from '@/components/onyx-platform-forms';

export const metadata: Metadata = { title: 'Examinations' };

const MIN = 60_000;

/** The pulsing live dot stops moving for anyone who has asked it to. */
const CALM = '[&_i]:motion-reduce:animate-none';

/** "1 h 38 min" rather than "98 minutes": the shape a clock is read in. */
function gap(ms: number): string {
  const mins = Math.max(0, Math.round(ms / MIN));
  if (mins < 60) return mins + ' min';
  return Math.floor(mins / 60) + ' h ' + String(mins % 60).padStart(2, '0') + ' min';
}

/**
 * Calendar days apart, not elapsed hours.
 *
 * A paper at 09:00 tomorrow is "Tomorrow" whether it is now 22:00 or 08:00,
 * which is how a person reading a timetable thinks about it.
 */
function days(from: number, to: number): number {
  // Midnight in the institution's zone, not the runtime's -- see
  // `dayNumber` in lib/onyx-time.ts for what that fixed.
  const startOf = (ms: number) => dayNumber(ms) * 86_400_000;
  return Math.round((startOf(to) - startOf(from)) / 86_400_000);
}

const AT = (ms: number) => new Date(ms).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

type Phase = 'running' | 'upcoming' | 'completed' | 'cancelled';

/**
 * Where a paper is in the day, worked out from the two fields the API returns.
 *
 * The relative distance is what an examinations officer scans for; the day and
 * the clock time are the detail underneath, not the headline.
 */
function schedule(exam: Exam, now: number): { phase: Phase; lead: string; sub: string } {
  const start = Date.parse(exam.starts_at);
  if (!Number.isFinite(start)) {
    return { phase: exam.status === 'cancelled' ? 'cancelled' : 'upcoming',
      lead: 'No date', sub: '' };
  }
  const end = start + exam.duration_minutes * MIN;
  const at = AT(start);

  if (exam.status === 'cancelled') return { phase: 'cancelled', lead: 'Cancelled', sub: at };
  if (now >= start && now < end) {
    return { phase: 'running', lead: 'Ends in ' + gap(end - now),
      sub: 'started ' + gap(now - start) + ' ago' };
  }
  if (now >= end || exam.status === 'completed') {
    /*
     * QA F10. This branch fires on `status === 'completed'` whether or not the
     * date has passed -- and publishing marks is what sets that status. A
     * resit arranged early, marks carried across from a previous sitting, or a
     * date corrected afterwards all land here with a start date still ahead.
     *
     * It then called `Math.abs()`, which threw the sign away, so an exam three
     * days in the FUTURE read "3 days ago · sat Wed, Aug 26" under the heading
     * "Examinations already sat".
     *
     * Neither reading is safe to assert about a paper that is marked but not
     * yet due, so nothing is asserted: print the date and let the reader
     * judge. That is what `relativeWhen()` in onyx-ui.tsx already does for the
     * same situation, and this page simply was not using it.
     */
    // `days(now, start)` is start MINUS now, so it is positive while the
    // sitting is still ahead and negative once it has passed. Getting that
    // backwards is the whole of this defect, so the past case names its own
    // variable rather than reusing a signed one.
    const until = days(now, start);
    if (until > 0) {
      return { phase: 'completed', lead: at, sub: 'marks released before the sitting' };
    }
    const ago = -until;
    return {
      phase: 'completed',
      lead: ago === 0 ? 'Today' : ago === 1 ? 'Yesterday'
        : ago <= 13 ? ago + ' days ago' : Math.round(ago / 7) + ' weeks ago',
      sub: 'sat ' + at,
    };
  }
  const d = days(now, start);
  return {
    phase: 'upcoming',
    lead: d === 0 ? 'Today' : d === 1 ? 'Tomorrow'
      : d <= 13 ? 'In ' + d + ' days' : 'In ' + Math.round(d / 7) + ' weeks',
    sub: at,
  };
}

const STATE: Record<Exam['status'], { tone: 'neutral' | 'brand' | 'good' | 'late'; label: string }> = {
  draft: { tone: 'neutral', label: 'Draft' },
  scheduled: { tone: 'brand', label: 'Scheduled' },
  completed: { tone: 'good', label: 'Completed' },
  cancelled: { tone: 'late', label: 'Cancelled' },
};

/** CMP-02a -- the calendar. */
export default async function OnyxExamsPage() {
  await requireOnyxSession();
  // No semesters fetched any more: the scheduling form stopped asking for
  // one, and the API takes it from the course.
  const [me, exams, courses] = await Promise.all([
    onyxApi<Me>('/api/onyx/me'),
    onyxApi<Exam[]>('/api/onyx/exams'),
    onyxApiSafe<Course[]>('/api/onyx/courses'),
  ]);
  // Scheduling an exam is the examinations office institution-wide, or this
  // specific course's own faculty -- assertCanRunExam on the API side draws
  // exactly this line; the picker below just avoids offering a faculty
  // member a course the submit would refuse anyway. For faculty specifically
  // there's a second gate now: an institution can switch this off from
  // Settings, in which case every exam has to come from admin or the exams
  // office (see assertCanScheduleExam in campus.routes.ts) -- facultyLocked
  // is what lets this page explain that instead of just hiding the panel.
  const facultyLocked = me.role === 'faculty' && me.tenant.faculty_can_schedule_exams === false;
  const canSchedule = (me.role === 'admin' || me.role === 'exams'
    || (me.role === 'faculty' && !facultyLocked));
  const canManageHalls = me.role === 'admin' || me.role === 'exams';
  // For the "Online paper" picker below -- staff see every assessment
  // regardless of status, same as the assessments page itself.
  const [assessments, myCourses, banks, sections] = await Promise.all([
    canSchedule
      ? onyxApiSafe<{ id: number; title: string; course_id: number | null }[]>(
        '/api/onyx/assessments')
      : null,
    me.role === 'faculty' ? onyxApiSafe<Course[]>('/api/onyx/my/courses') : null,
    // No problem list any more: the only thing on this page that needed one
    // was the bank composer, and that moved to the Exam paper tab. A request
    // per page load for a picker nobody can see is a request for nothing.
    // What a sitting can be set FROM, and which division it can be set for.
    // Both were missing here: a lecturer could tie a sitting to a paper
    // somebody had already built, but not build one from a bank, and could not
    // say "Alpha-CSE only" at all.
    canSchedule ? onyxApiSafe<ConsoleBank[]>('/api/onyx/banks') : null,
    canSchedule
      ? onyxApiSafe<{ id: number; name: string; status: number }[]>('/api/onyx/sections')
      : null,
  ]);
  const schedulableCourses = me.role === 'faculty' ? (myCourses ?? []) : (courses ?? []);

  // The course list is already on the page for the scheduling panel, so the
  // code can sit under each paper's title without a second request.
  const codeOf = new Map((courses ?? []).map((c) => [Number(c.id), c.code]));

  // Whether an exam's online paper has anything a marker needs to look at --
  // the calendar used to say nothing about this at all, so a candidate's
  // handed-in script sat there silently until somebody happened to open that
  // one exam. `canSchedule` is the same staff/course-faculty audience the
  // marking link itself is gated to.
  const markingByExam = new Map<number, { total: number; todo: number }>();
  if (canSchedule) {
    const withPapers = exams.filter((e) => e.assessment_id != null);
    const summaries = await Promise.all(withPapers.map((e) =>
      onyxApiSafe<{ score: number | null }[]>('/api/onyx/assessments/' + e.assessment_id + '/marking')));
    withPapers.forEach((e, i) => {
      const rows = summaries[i] ?? [];
      markingByExam.set(e.id, { total: rows.length, todo: rows.filter((r) => r.score === null).length });
    });
  }

  const now = Date.now();
  const rows = exams
    .map((e) => ({ exam: e, when: schedule(e, now), start: Date.parse(e.starts_at) }))
    .sort((a, b) => (a.start || 0) - (b.start || 0));

  const groups: { id: string; label: string; live?: boolean;
    rows: typeof rows; caption: string }[] = [
    { id: 'in-progress', label: 'In progress', live: true,
      rows: rows.filter((r) => r.when.phase === 'running'),
      caption: 'Examinations running now' },
    { id: 'upcoming', label: 'Upcoming',
      rows: rows.filter((r) => r.when.phase === 'upcoming'),
      caption: 'Examinations scheduled but not yet started' },
    { id: 'completed', label: 'Completed',
      rows: [...rows.filter((r) => r.when.phase === 'completed')].reverse(),
      caption: 'Examinations already sat' },
    { id: 'cancelled', label: 'Cancelled',
      rows: rows.filter((r) => r.when.phase === 'cancelled'),
      caption: 'Examinations that were called off' },
  ].filter((g) => g.rows.length > 0);

  const drafts = rows.filter((r) => r.exam.status === 'draft'
    && r.when.phase === 'upcoming').length;
  const jumpTo = groups[0]?.id;

  return (
    <OnyxShell
      me={me}
      nav={navFor(me.role)}
      title="Examinations"
      subtitle="No learner is ever scheduled for two papers at once -- the calendar refuses that before it happens."
    >
      {/* The two halves of Examinations: this one schedules and reports, the
          other is where the question bank is written. */}
      <FacultyExamTabs scheduled={rows.length} papers={(banks ?? []).length} />

      {/* CMP-02: "schedule exams, assign halls and seats, enter marks and
          generate transcripts end-to-end" -- none of which could be started
          from the product. */}
      {canSchedule || canManageHalls ? (
        <div className="mb-6 grid gap-3 lg:grid-cols-2">
          {/*
            * The same scheduling form the console uses.
            *
            * It replaces a flat CreatePanel that could only tie a sitting to a
            * paper somebody had already built somewhere else. This one offers
            * the three answers that are genuinely different examinations --
            * set it from a bank, sit it on an existing paper, or sit it in a
            * hall -- carries the proctoring switches, and asks which section
            * is sitting it.
            */}
          {canSchedule ? (
            <CreateExamForm
              basePath="onyx"
              courses={schedulableCourses.map((c) =>
                ({ id: Number(c.id), code: c.code, title: c.title }))}
              sections={(sections ?? []).filter((sx) => sx.status === 1)
                .map((sx) => ({ id: Number(sx.id), name: sx.name }))}
              banks={banks ?? []}
              papers={(assessments ?? []).map((a) => ({
                id: Number(a.id), title: a.title, course_id: a.course_id,
                status: 'published',
              }))}
            />
          ) : null}
          {/* The bank composer is NOT here any more: it lives on the Exam
              paper tab. Building the sets and scheduling the sitting are
              different work done at different times, and one page carrying
              both meant scrolling past whichever one you did not come for. */}
          {/* Physical halls are an institution-wide resource shared across every
              course, not something one course's faculty allocate on their own --
              stays with the examinations office even now that scheduling itself
              does not. */}
          {canManageHalls ? (
            <CreatePanel
              title="New hall" cta="Add a hall" icon="building"
              rules={[{ kind: 'atMostProduct', field: 'capacity',
                of: ['row_count', 'col_count'],
                message: 'That is more seats than the rows and columns provide.' }]} compact
              endpoint="halls"
              fields={[
                { name: 'code', label: 'Code', required: true, placeholder: 'H1' },
                { name: 'name', label: 'Name', required: true, placeholder: 'Main Hall' },
                { name: 'row_count', label: 'Rows', type: 'number', min: 1, max: 100,
                  required: true },
                { name: 'col_count', label: 'Columns', type: 'number', min: 1, max: 100,
                  required: true },
                { name: 'capacity', label: 'Usable seats', type: 'number', min: 1, max: 5000,
                  help: 'May be fewer than rows × columns once gangways are left clear.' },
              ]}
            />
          ) : null}
        </div>
      ) : null}

      {/* facultyLocked, not just "faculty who can't schedule" -- a student or
          an employer never scheduling an exam needs no explanation, but a
          faculty member who used to and now can't is the one case where
          silently hiding the panel reads as broken rather than as a choice
          their own institution made. */}
      {facultyLocked ? (
        <div className="mb-6">
          <Banner tone="info" icon="shield">
            Your institution has switched off faculty scheduling exams themselves. Ask an
            administrator to schedule this one, or to turn it back on from Settings.
          </Banner>
        </div>
      ) : null}

      {/* A paper still shown as a draft on the day it is due is the one failure
          that cannot be fixed on the morning, so it is a banner rather than a
          column somebody has to notice. */}
      {drafts > 0 ? (
        <div className="mb-5">
          <Banner tone="warn" icon="alert">
            <span className="font-bold">
              {drafts === 1
                ? 'One upcoming paper is still a draft.'
                : drafts + ' upcoming papers are still drafts.'}
            </span>{' '}
            A draft has no seating and no candidates against it. Each one is marked
            <span className="font-semibold"> Draft</span> in the list below.
          </Banner>
        </div>
      ) : null}

      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Scheduled" value={exams.length}
          note={exams.length === 1 ? 'paper on the calendar' : 'papers on the calendar'} />
        <StatTile label="In progress"
          value={rows.filter((r) => r.when.phase === 'running').length}
          note="sitting right now" />
        <StatTile label="Upcoming"
          value={rows.filter((r) => r.when.phase === 'upcoming').length}
          note={drafts > 0 ? drafts + ' still a draft' : 'all scheduled'} />
        <StatTile label="Completed"
          value={rows.filter((r) => r.when.phase === 'completed').length}
          note="sat, awaiting or holding marks" />
      </div>

      {groups.length > 1 ? (
        <div className="mb-5">
          <Segmented items={groups.map((g) => ({
            label: g.label, href: '#' + g.id, count: g.rows.length, active: g.id === jumpTo,
          }))} />
        </div>
      ) : null}

      <div className="space-y-7">
        {groups.map((g) => (
          <section key={g.id} id={g.id} className="scroll-mt-20">
            <div className="mb-2.5 flex flex-wrap items-baseline justify-between gap-3">
              <h2 className="text-[11.5px] font-bold uppercase tracking-[.085em] text-muted">
                {g.live ? (
                  <span className={CALM}><State tone="live">{g.label}</State></span>
                ) : g.label}
              </h2>
              {g.live ? (
                <Link href="/onyx/invigilate"
                  className="inline-flex min-h-[28px] items-center px-0.5 text-[13px]
                             font-semibold text-brand-600 hover:underline">
                  Invigilation console
                </Link>
              ) : null}
            </div>

            {/* tabIndex makes the horizontal scroll reachable by keyboard: a
                region that only scrolls with a wheel strands anyone on a
                keyboard at whatever columns happen to fit. */}
            <div tabIndex={0} role="region" aria-label={g.caption}>
              <DataTable
                caption={g.caption}
                head={
                  <>
                    <th scope="col">Exam</th>
                    <th scope="col">When</th>
                    <th scope="col">Duration</th>
                    <th scope="col">Out of</th>
                    <th scope="col">Status</th>
                  </>
                }
              >
                {g.rows.map(({ exam, when }) => {
                  const marking = markingByExam.get(exam.id);
                  return (
                  <tr key={exam.id} className="align-top">
                    <td>
                      <Link href={'/onyx/exams/' + exam.id}
                        className="font-semibold text-brand-700 hover:underline">
                        {exam.title}
                      </Link>
                      <div className="text-[12.5px] text-muted">
                        {codeOf.get(Number(exam.course_id))
                          ? codeOf.get(Number(exam.course_id)) + ' · '
                          : ''}
                        pass mark {exam.pass_marks}
                      </div>
                      {/* The one thing this list used to say nothing about:
                          a submitted script sitting there unmarked. Only
                          shown once there is something to say -- an exam
                          with no online paper, or nobody has sat it yet,
                          gets nothing here. */}
                      {marking && marking.total > 0 ? (
                        <Link href={'/onyx/exams/' + exam.id + '/marking'}
                          className={'mt-1 inline-flex items-center gap-1 rounded-full px-2 '
                            + 'py-0.5 text-[11.5px] font-bold hover:underline '
                            + (marking.todo > 0
                              ? 'bg-amber-50 text-amber-800' : 'bg-green-50 text-green-700')}>
                          <Icon name={marking.todo > 0 ? 'edit' : 'check'} className="h-3 w-3" />
                          {marking.todo > 0
                            ? marking.todo + (marking.todo === 1 ? ' script to mark' : ' scripts to mark')
                            : 'All ' + marking.total + (marking.total === 1 ? ' script' : ' scripts') + ' marked'}
                        </Link>
                      ) : null}
                    </td>
                    <td className="whitespace-nowrap">
                      {/*
                        * Rendered in the browser, not here.
                        *
                        * `schedule()` above still decides the PHASE, which is a
                        * comparison between two instants and is the same answer
                        * everywhere. The words are not: formatted on a server
                        * running in UTC, a sitting stored at 08:05Z was shown to
                        * a learner in India as "08:05 AM" when it starts at
                        * 13:35 their time, and the "Today" above it was counted
                        * from the wrong midnight.
                        */}
                      <ExamWhen
                        startsAt={exam.starts_at}
                        durationMinutes={exam.duration_minutes}
                        cancelled={exam.status === 'cancelled'}
                        completed={exam.status === 'completed'}
                      />
                    </td>
                    <td className="whitespace-nowrap tabular-nums">
                      {exam.duration_minutes} min
                    </td>
                    <td className="tabular-nums">{exam.max_marks}</td>
                    <td>
                      {when.phase === 'running' ? (
                        <span className={CALM}><State tone="live">Running</State></span>
                      ) : when.phase === 'completed' && exam.status === 'scheduled' ? (
                        // The row is filed under Completed because the clock
                        // says so, but `status` only reaches 'completed' when
                        // marks are published. So a paper sat last week with
                        // marks still to come sat under a "Completed" heading
                        // wearing a "Scheduled" pill, and read as stale data.
                        // Both were true; neither was the right word on its
                        // own. This is the state they describe together, and
                        // it matches the stepper the exam detail page already
                        // draws.
                        <Pill tone="soon">Awaiting results</Pill>
                      ) : (
                        <Pill tone={STATE[exam.status].tone}>
                          <span className="inline-flex items-center gap-1.5">
                            {exam.status === 'completed'
                              ? <Icon name="check" className="h-3.5 w-3.5" /> : null}
                            {exam.status === 'cancelled'
                              ? <Icon name="x" className="h-3.5 w-3.5" /> : null}
                            {STATE[exam.status].label}
                          </span>
                        </Pill>
                      )}
                    </td>
                  </tr>
                  );
                })}
              </DataTable>
            </div>
          </section>
        ))}

        {exams.length === 0 ? (
          <DataTable
            caption="Examinations"
            head={<><th scope="col">Exam</th><th scope="col">When</th><th scope="col">Status</th></>}
          >
            <EmptyRow colSpan={3} icon="calendar">
              Nothing is scheduled. An exam needs a course, a start time and a mark
              scheme before it can hold candidates — the term comes from the course,
              and a resit or a certification sitting need not have one at all.
            </EmptyRow>
          </DataTable>
        ) : null}
      </div>
    </OnyxShell>
  );
}
