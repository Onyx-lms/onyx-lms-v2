import Link from 'next/link';
import type { Metadata } from 'next';
import { OnyxShell } from '@/components/onyx-shell';
import { LocalTime } from '@/components/onyx-local-time';
import { navFor } from '@/lib/onyx-nav';
import { requireOnyxSession, onyxApi, onyxApiSafe, type Me, onyxApiRecord } from '@/lib/onyx-session';
import type { Exam, SeatingPlan, Hall, ExamMark } from '@/lib/onyx-campus';
import {
  AllocateSeating, DeleteExamButton, EnterMarks, ExamEditForm, MarkOverride,
} from '@/components/onyx-manage';
import type { Assessment, MarkingQueueRow, MyAttempt } from '@/lib/onyx-assess';
import { ActionButton } from '@/components/onyx-create';
import { ModerateMarks } from '@/components/onyx-moderate';
import {
  BackLink, Card, DataTable, Empty, EmptyRow, Icon, Meter, Pill, Score, SectionHead, StatTile, State, Stepper,
} from '@/components/onyx-ui';
import { ShareLink } from '@/components/onyx-share';
import { SubmissionsTable } from '@/components/onyx-submissions';
import { dayNumber, dayTime } from '@/lib/onyx-time';

export const metadata: Metadata = { title: 'Exam' };

const EXAM_STAFF = ['admin', 'exams'];
const MIN = 60_000;

/** The pulsing live dot stops moving for anyone who has asked it to. */
const CALM = '[&_i]:motion-reduce:animate-none';

interface Seat { hall_id: number; seat_label: string; user_id: string; created_at: string }

/** Calendar days apart, so "tomorrow" does not depend on the hour of asking. */
function days(from: number, to: number): number {
  // Midnight in the institution's zone, not the runtime's -- see
  // `dayNumber` in lib/onyx-time.ts for what that fixed.
  const startOf = (ms: number) => dayNumber(ms) * 86_400_000;
  return Math.round((startOf(to) - startOf(from)) / 86_400_000);
}

/**
 * When the paper is, relative first.
 *
 * "8/17/2026, 12:00:00 AM" makes urgency something a reader works out. The
 * clock time is still there, underneath, because that is what goes on a door.
 */
function whenText(start: number, end: number, now: number): { lead: string; sub: string } {
  const clock = (ms: number) => new Date(ms).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' });
  const range = clock(start) + ' – ' + clock(end);
  if (!Number.isFinite(start)) return { lead: 'No date', sub: '' };
  if (now >= start && now < end) {
    const mins = Math.max(0, Math.round((end - now) / MIN));
    return {
      lead: mins < 60 ? mins + ' min left'
        : Math.floor(mins / 60) + ' h ' + String(mins % 60).padStart(2, '0') + ' min left',
      sub: range,
    };
  }
  const d = days(now, start);
  const word = d === 0 ? 'Today' : d === 1 ? 'Tomorrow' : d === -1 ? 'Yesterday'
    : d > 0 ? (d <= 13 ? 'In ' + d + ' days' : 'In ' + Math.round(d / 7) + ' weeks')
      : (d >= -13 ? Math.abs(d) + ' days ago' : Math.round(Math.abs(d) / 7) + ' weeks ago');
  return { lead: word, sub: range };
}

/**
 * CMP-02a/b -- one exam: when it is, and where you sit.
 *
 * The seating plan itself (every candidate, every hall) is staff-only -- it is
 * every candidate's name against a room and a seat, which is exactly the roster
 * a learner is never shown. A learner sees only their own row.
 */
export default async function OnyxExamPage({ params }: { params: Promise<{ id: string }> }) {
  await requireOnyxSession();
  const { id } = await params;
  const [me, exam] = await Promise.all([
    onyxApi<Me>('/api/onyx/me'),
    onyxApiRecord<Exam>('/api/onyx/exams/' + id),
  ]);
  // `staff` runs the examinations office institution-wide: seating stays
  // theirs alone, a shared physical resource one course's faculty do not
  // allocate on their own. `canMark` is wider -- scheduling, editing,
  // marking, moderating and publishing an exam are all also open to this
  // specific course's own faculty (assertCanRunExam on the API side draws
  // exactly this line for every one of those routes), so it takes knowing
  // which courses this viewer actually teaches, not just their role.
  const staff = EXAM_STAFF.includes(me.role);
  const myCourses = me.role === 'faculty'
    ? await onyxApiSafe<{ id: number }[]>('/api/onyx/my/courses') : null;
  const teachesThisCourse = (myCourses ?? []).some((c) => Number(c.id) === Number(exam.course_id));
  const canMark = staff || (me.role === 'faculty' && teachesThisCourse);

  // `canMark` is not the whole answer for moderating and publishing.
  //
  // Both routes sit behind `assertCan(... 'exams.moderate' | 'exams.publish')`,
  // and both capabilities default to admin and the examinations office and are
  // grantable to nobody else -- faculty cannot hold either, however many of
  // this exam's courses they teach. So `canMark` alone put a Publish button in
  // front of every course's faculty that could only ever answer 403. Asked of
  // the API rather than reproduced here, so the screen has no second, drifting
  // copy of the rules.
  const perms = await onyxApiSafe<{ mine: string[] }>('/api/onyx/permissions');
  const held = new Set(perms?.mine ?? []);
  const mayModerate = canMark && held.has('exams.moderate');
  const mayPublish = canMark && held.has('exams.publish');

  const [seat, courseOf, plan, halls, marks, roster, members, myMarks, myAttempts] = await Promise.all([
    canMark ? null : onyxApiSafe<Seat>('/api/onyx/exams/' + id + '/seat'),
    // The seating plan itself stays staff-only on the API (every candidate's
    // name against a room and a seat) -- faculty get the marks register
    // below instead, not this.
    /* The course this sitting belongs to, so the page can NAME it. It printed
       `Course #626` -- a row id, which tells a candidate nothing. */
    onyxApiSafe<{ id: number; code: string; title: string }>(
      '/api/onyx/courses/' + exam.course_id),
    staff ? onyxApiSafe<SeatingPlan>('/api/onyx/exams/' + id + '/seating') : null,
    staff ? onyxApiSafe<Hall[]>('/api/onyx/halls') : null,
    canMark ? onyxApiSafe<ExamMark[]>('/api/onyx/exams/' + id + '/marks') : null,
    // Who sits this paper: whoever is enrolled on the course it belongs to.
    // The roster is enrolments only, so names come from the member list.
    canMark ? onyxApiSafe<{ user_id: string }[]>(
      '/api/onyx/courses/' + exam.course_id + '/roster') : null,
    canMark ? onyxApiSafe<{ user_id: string; user: { name: string } | null }[]>(
      '/api/onyx/members') : null,
    // A candidate's own result on the one page they'd naturally look for it --
    // marksFor() already returns published-only for a non-staff caller asking
    // about themselves, so an empty array here means exactly "not out yet",
    // never a mark that exists but is being withheld.
    canMark ? null : onyxApiSafe<ExamMark[]>('/api/onyx/results?exam_id=' + id),
    /*
     * The candidate's own sitting of the online paper.
     *
     * The page showed the hand-entered exam MARK -- a number an examiner wrote
     * down -- and never the attempt: what the candidate actually submitted,
     * what each answer earned, or the script itself. Somebody who had just sat
     * the paper here had nowhere on this page to see any of it, and was sent
     * to a separate Results screen to find a total.
     */
    canMark ? null : onyxApiSafe<MyAttempt[]>('/api/onyx/my/assessments'),
  ]);

  // user_id is a Supabase Auth uuid, not a bigint any more -- Number(uuid) is
  // NaN for every row, and Map treats NaN as equal to itself (SameValueZero),
  // so every candidate collapsed onto the one "NaN" key and inherited
  // whichever member's name happened to be inserted last. Keying on the
  // string itself is the fix; there is no numeric id to convert to.
  const nameOf = new Map((members ?? []).map((m) => [m.user_id, m.user?.name ?? null]));

  /*
   * Their latest sitting of THIS exam's paper.
   *
   * `myAttempts` is newest first, so a paper allowing two attempts is
   * represented by the one that counts.
   */
  const mySitting = exam.assessment_id
    ? (myAttempts ?? []).find((a) => Number(a.assessment_id) === Number(exam.assessment_id))
    : undefined;
  // Marks already entered, so re-opening the panel shows what is there rather
  // than a blank grid that reads as "nobody has been marked".
  const entered = new Map((marks ?? []).map((m) => [m.user_id, Number(m.raw_marks)]));
  const candidates = (roster ?? []).map((r) => ({
    user_id: r.user_id,
    name: nameOf.get(r.user_id) ?? 'User ' + r.user_id,
    current: entered.get(r.user_id) ?? null,
  }));
  const published = (marks ?? []).some((m) => m.status === 'published');
  const myMark = (myMarks ?? [])[0] ?? null;

  // What a moderation pass would actually move. The service refuses when there
  // is nothing unpublished, so the panel is told the number rather than being
  // let to offer an action that can only be refused.
  const unpublished = (marks ?? []).filter((m) => m.status !== 'published').length;
  const alreadyModerated = (marks ?? []).filter((m) => Number(m.moderation_delta) !== 0).length;

  // The exam's own online paper, if it has one -- syncExamAssessmentWindow()
  // is what keeps its open/close window locked to exactly this exam's slot,
  // so this page never has to check the clock itself; AssessService.start()
  // already refuses an attempt outside that window.
  const [onlinePaper, proctorSnapshot, markingQueue] = await Promise.all([
    exam.assessment_id
      ? onyxApiSafe<Assessment>('/api/onyx/assessments/' + exam.assessment_id) : null,
    exam.assessment_id && canMark
      ? onyxApiSafe<{ status: string; integrity_flags: number }[]>(
        '/api/onyx/proctor/queue?assessment_id=' + exam.assessment_id)
      : null,
    // Who has actually submitted, for the "Review submission" / "Didn't
    // attempt yet" column in the candidate register below.
    // Every marker, not only faculty: the submissions table below is the
    // first thing an examinations officer and an administrator want too, and
    // this was the one fetch that decided whether they got it.
    exam.assessment_id && canMark
      ? onyxApiSafe<MarkingQueueRow[]>('/api/onyx/assessments/' + exam.assessment_id + '/marking')
      : null,
  ]);
  const sittingNow = (proctorSnapshot ?? []).filter((r) => r.status === 'in_progress').length;
  const examFlagged = (proctorSnapshot ?? []).filter((r) => r.integrity_flags > 0).length;

  // The whole mark, not just the raw figure, for the register's Mark column.
  const markOf = new Map((marks ?? []).map((m) => [m.user_id, m]));
  // Which candidates have actually submitted the online paper, keyed the same
  // way -- markingQueue() excludes still-in-progress attempts by design (see
  // its own comment), so "not here" reads correctly as "nothing to review
  // yet". Anonymised marking pseudonymises user_id to null on every row, and
  // there is no way to attribute a specific attempt to a specific candidate
  // in that case, so the column is hidden rather than shown wrong.
  const showSubmissions = Boolean(exam.assessment_id) && !onlinePaper?.anonymous_marking;
  const attemptOf = new Map(
    (markingQueue ?? [])
      .filter((a): a is MarkingQueueRow & { user_id: string } => a.user_id !== null)
      .map((a) => [a.user_id, a]));

  const now = Date.now();
  const start = Date.parse(exam.starts_at);
  const end = start + exam.duration_minutes * MIN;
  const when = whenText(start, end, now);
  const running = exam.status !== 'cancelled'
    && Number.isFinite(start) && now >= start && now < end;

  /* The lifecycle as a stepper rather than a status word: a single pill says
     where the paper is, this says what is behind it and what is left. Marks
     cannot be published from a paper still shown as running. */
  const stage = published ? 4
    : (marks ?? []).length > 0 ? 3
      : (now >= end || exam.status === 'completed') ? 2
        : running ? 1 : 0;
  const steps = ['Scheduled', 'Running', 'Closed', 'Marked', 'Published'].map((label, i) => ({
    label,
    state: (i < stage ? 'done' : i === stage ? 'current' : 'todo') as 'done' | 'current' | 'todo',
  }));

  const marked = candidates.filter((c) => c.current !== null).length;

  return (
    <OnyxShell
      me={me}
      nav={navFor(me.role)}
      title={exam.title}
      subtitle={when.lead + ' · ' + exam.duration_minutes + ' minutes · out of ' + exam.max_marks}
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <BackLink href="/onyx/exams" label="All examinations" />
        {/* Staff only: a candidate has the link -- they are on it. Offering
            them "Copy link for candidates" is offering an invigilator's
            control to the invigilated. */}
        {staff ? <ShareLink label="Copy link for candidates" /> : null}
      </div>
      <nav aria-label="Breadcrumb"
        className="mb-4 flex items-center gap-1.5 text-[13px] text-muted">
        <Link href="/onyx/exams" className="font-semibold text-brand-600 hover:underline">
          Examinations
        </Link>
        <Icon name="chevron" className="h-3 w-3 text-faint" />
        <span className="truncate">{exam.title}</span>
      </nav>

      <div className="space-y-6">
        <div className="flex flex-wrap items-center gap-3">
          {running ? (
            <span className={CALM}><State tone="live">Running now</State></span>
          ) : null}
          {exam.status === 'cancelled'
            ? <Pill tone="late">Cancelled</Pill>
            : exam.status === 'draft' ? <Pill tone="neutral">Draft</Pill> : null}
          {canMark && exam.status !== 'cancelled' ? <Stepper steps={steps} /> : null}
        </div>

        {/* CMP-02 end to end: seat the hall, enter the marks, moderate them,
            publish the results. Every step already existed on the API and had
            no way to reach it from a browser. Seating stays staff-only --
            physical halls are a shared institution-wide resource, not
            something one course's faculty allocate on their own -- but
            editing, marking, moderating and publishing are all open to this
            exam's own course faculty now, the ordinary case rather than the
            exception. */}
        {canMark ? (
          <div className="flex flex-wrap items-start gap-2">
            <ExamEditForm examId={Number(id)} exam={exam} />
            {staff ? <AllocateSeating examId={Number(id)} halls={halls ?? []} /> : null}
            {/* A blind number box only makes sense when there is nothing else
                to look at -- a paper exam has no submission behind it, so raw
                entry IS the source of truth. An exam with an online paper has
                a real submission sitting one click away in its own marking
                queue -- this exam's own page at /marking, not a detour
                through Assessments -- and typing a mark without ever opening
                it was exactly the "how would I know what to give them" gap
                this replaces. */}
            {exam.assessment_id ? (
              <Link href={'/onyx/exams/' + id + '/marking'}
                className="inline-flex min-h-[38px] items-center gap-1.5 rounded-2xl
                           bg-brand-600 px-3.5 text-[13px] font-bold text-white
                           hover:bg-brand-700">
                <Icon name="edit" className="h-4 w-4" />
                Mark the online paper
              </Link>
            ) : (
              <EnterMarks examId={Number(id)} maxMarks={exam.max_marks}
                candidates={candidates} />
            )}
            {/* No separate "pull marks" step any more: publishing an exam
                with an online paper pulls every fully-marked score in first,
                automatically, then publishes -- one action instead of two,
                and there is nothing left to do here between finishing the
                marking queue and releasing results. */}
            {/* The step between marking and publishing, which had an API and
                no way to reach it. Without it a board that agreed a paper was
                marked two points harsh had to publish it anyway or edit
                scripts one at a time. Hidden once results are out: the service
                leaves published marks alone, so offering it there would be a
                button that can only refuse. */}
            {/* Pulling the online paper's marks in WITHOUT publishing.
                Publishing does this on the way past, which is right for the
                ordinary case and leaves one workflow impossible: an exam with
                an online paper has no marks until publish time, so there was
                nothing to moderate beforehand and moderating it at all meant
                publishing first -- which is the one order a moderation is
                supposed to prevent. The route has always existed; this is the
                only thing that calls it. */}
            {exam.assessment_id && !published && mayModerate && unpublished === 0 ? (
              <ActionButton endpoint={'exams/' + id + '/marks/sync-from-paper'}
                label="Pull marks from the paper" tone="quiet" />
            ) : null}
            {mayModerate && !published ? (
              <ModerateMarks examId={Number(id)} maxMarks={Number(exam.max_marks)}
                unpublished={unpublished} moderated={alreadyModerated} />
            ) : null}
            {published ? (
              <span className="inline-flex min-h-[38px] items-center gap-1.5 rounded-2xl
                               bg-green-50 px-3.5 text-[13px] font-bold text-green-700">
                <Icon name="check" className="h-4 w-4" />
                Results published
              </span>
            ) : mayPublish ? (
              <ActionButton endpoint={'exams/' + id + '/publish'} label="Publish results"
                confirm="Publish results to every candidate?" />
            ) : (
              /* Said, rather than left as an absence. A faculty member who has
                 finished marking needs to know the paper is waiting on
                 somebody else, not to wonder where the button went. */
              <span className="inline-flex min-h-[38px] items-center gap-1.5 rounded-2xl
                               border border-line px-3.5 text-[13px] font-semibold text-muted">
                <Icon name="clock" className="h-4 w-4" />
                The examinations office releases results
              </span>
            )}
          </div>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile label={running ? 'Time left' : 'When'} value={when.lead} note={when.sub} />
          <StatTile label="Duration" value={exam.duration_minutes + ' min'} />
          <StatTile label="Out of" value={exam.max_marks}
            note={'pass mark ' + exam.pass_marks} />
          {staff ? (
            <StatTile label="Seats used" value={plan?.total ?? 0}
              note={candidates.length + ' on the roster'} />
          ) : canMark ? (
            <StatTile label="Marked" value={marked}
              note={candidates.length + ' on the roster'} />
          ) : (
            <StatTile label="Pass mark" value={exam.pass_marks} />
          )}
        </div>

        {/* min-w-0 on the column that holds the register: without it the widest
            row sets the grid track and the whole page scrolls sideways on a
            phone, instead of the table scrolling inside its own box. */}
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_290px] lg:items-start">
          <div className="min-w-0 space-y-6">
            {/*
              * Who has handed it in, first.
              *
              * A marker opening an examination is asking "who sat it and what
              * did they get", and the answer lived one click away on a
              * separate marking queue. It leads the page now, with the same
              * table the paper's own page and the console use.
              */}
            {canMark && exam.assessment_id ? (
              <section>
                <SectionHead title={'Submissions · ' + (markingQueue?.length ?? 0)} />
                <Card className="p-4">
                  {markingQueue === null ? (
                    <p className="text-[13px] text-muted">
                      The submissions could not be loaded.
                    </p>
                  ) : (
                    <SubmissionsTable
                      caption="Everybody who has sat this examination's paper."
                      rows={markingQueue.map((r) => ({
                        id: r.id,
                        attempt: r.attempt,
                        status: r.status,
                        submitted_at: r.submitted_at,
                        score: r.score,
                        max_score: r.max_score,
                        candidate: r.candidate,
                        roll_number: r.roll_number ?? null,
                        section: r.section ?? null,
                        integrity_flags: r.integrity_flags,
                      }))}
                      markBase="/onyx/attempts/"
                      scriptBase="/api/proxy/onyx/attempts/"
                      bundleHref={markingQueue.length
                        ? '/api/proxy/onyx/assessments/' + exam.assessment_id + '/scripts.pdf'
                        : undefined}
                    />
                  )}
                </Card>
              </section>
            ) : null}

            {/* This exam's paper is sat through the assessment engine, not
                started here -- the actual start/resume button, with its own
                eligibility and resume logic, already exists on the
                assessment's own page. This is only ever the status: before,
                during, or after the one window it can be sat in, which is
                the whole difference between an exam and an ordinary
                assessment (CMP-02's "scheduled time only" vs LRN-04's
                "any time before the deadline"). */}
            {!canMark && onlinePaper ? (
              <Card className="p-4">
                <div className="text-[10.5px] font-bold uppercase tracking-[.08em] text-muted">
                  Online paper
                </div>
                {running ? (
                  <>
                    <p className="mt-1 text-[15px] font-bold text-green-700">
                      Open now — {when.lead.toLowerCase()}.
                    </p>
                    <Link href={'/onyx/assessments/' + onlinePaper.id}
                      className="mt-3 inline-flex min-h-[40px] items-center gap-1.5 rounded-2xl
                                 bg-brand-600 px-3.5 text-[13px] font-bold text-white
                                 hover:bg-brand-700">
                      <Icon name="play" className="h-3.5 w-3.5" />
                      Start exam
                    </Link>
                  </>
                ) : now < start ? (
                  <p className="mt-1 text-[13.5px] text-slate-700">
                    Opens {when.sub.split(' – ')[0]}. Unlike an assessment, this cannot be
                    started early — the window opens with the exam and nowhere sooner.
                  </p>
                ) : mySitting ? (
                  // They sat it. What follows says so and shows it, rather
                  // than the old "if you sat it, your result appears here" --
                  // which was written for a page that could not tell.
                  <p className="mt-1 text-[13.5px] text-slate-700">
                    You sat this paper. Your answers are below.
                  </p>
                ) : (
                  <p className="mt-1 text-[13.5px] text-slate-700">
                    This exam’s window has closed, and there is no sitting of it on your
                    record.
                  </p>
                )}
              </Card>
            ) : null}

            {/*
              * Their own sitting: the mark, their answers, and the script.
              *
              * All three on the page they were already looking at. The mark
              * alone lived on a separate Results screen, and what they wrote
              * lived nowhere a candidate could reach from here at all.
              */}
            {!canMark && mySitting ? (
              <Card className="p-4">
                <div className="text-[10.5px] font-bold uppercase tracking-[.08em] text-muted">
                  Your submission
                </div>
                <div className="mt-1.5 flex flex-wrap items-center gap-2">
                  {mySitting.score !== null ? (
                    <Score value={mySitting.score} outOf={mySitting.max_score}
                      band={mySitting.passed === false ? 'lo' : 'hi'} />
                  ) : (
                    <Pill tone="soon">Not marked yet</Pill>
                  )}
                  {mySitting.submitted_at ? (
                    <span className="text-[12.5px] text-muted">
                      Handed in {dayTime(mySitting.submitted_at)}
                    </span>
                  ) : null}
                </div>
                <p className="mt-1.5 text-[13px] leading-relaxed text-muted">
                  {mySitting.score === null
                    ? 'Something on this paper has to be read by a person. Your mark appears '
                      + 'here once it has been marked.'
                    : 'Open it to see every answer you gave, and the correct one beside it '
                      + 'where the paper allows.'}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Link href={'/onyx/attempts/' + mySitting.attempt_id}
                    className="inline-flex min-h-[40px] items-center gap-1.5 rounded-2xl
                               bg-brand-600 px-3.5 text-[13px] font-bold text-white
                               hover:bg-brand-700">
                    <Icon name="eye" className="h-3.5 w-3.5" />
                    See your answers
                  </Link>
                  {/* The script as a document they can keep. */}
                  <a
                    href={'/api/proxy/onyx/attempts/' + mySitting.attempt_id + '/script.pdf'}
                    download
                    className="inline-flex min-h-[40px] items-center gap-1.5 rounded-2xl
                               border border-line bg-white px-3.5 text-[13px] font-bold
                               hover:bg-brand-50"
                  >
                    <Icon name="download" className="h-3.5 w-3.5" />
                    Download my report
                  </a>
                </div>
              </Card>
            ) : null}

            {/* The result itself, not just a promise it exists somewhere --
                published marks used to live only on the standalone /results
                page, so a candidate finishing here had nowhere on this page
                to actually see what they got. */}
            {!canMark && myMark ? (
              <Card className="p-4">
                <div className="text-[10.5px] font-bold uppercase tracking-[.08em] text-muted">
                  Your result
                </div>
                <div className="mt-1.5 flex items-center gap-2">
                  <Score value={myMark.final_marks} outOf={exam.max_marks}
                    band={myMark.final_marks >= exam.pass_marks ? 'hi' : 'lo'} />
                  {myMark.grade ? <Pill tone="brand">{myMark.grade}</Pill> : null}
                </div>
                <div className="mt-1.5 text-[13px] text-muted">
                  {myMark.final_marks >= exam.pass_marks ? 'Passed' : 'Below the pass mark'}
                  {myMark.moderation_delta ? ' · moderated' : ''}
                </div>
              </Card>
            ) : null}

            {!canMark ? (
              seat ? (
                <Card className="p-4">
                  <div className="text-[10.5px] font-bold uppercase tracking-[.08em] text-muted">
                    Your seat
                  </div>
                  <div className="mt-1 text-[22px] font-extrabold tabular-nums">
                    {seat.seat_label}
                  </div>
                  <div className="mt-0.5 text-[13px] text-muted">Hall #{seat.hall_id}</div>
                </Card>
              ) : (
                <Card className="p-0">
                  <Empty icon="calendar">Seating has not been published yet.</Empty>
                </Card>
              )
            ) : !staff ? (
              /* Faculty: the register they actually need -- who is on the
                 course and what they got, not the hall-by-hall seating plan,
                 which stays an examinations-office document (see the
                 /seating guard's comment above). */
              <section>
                <div className="mb-2.5 flex flex-wrap items-baseline justify-between gap-3">
                  <h2 className="text-[11.5px] font-bold uppercase tracking-[.085em] text-muted">
                    Candidates &mdash; {candidates.length} on the roster
                  </h2>
                </div>
                <div tabIndex={0} role="region" aria-label="Candidates and marks">
                  <DataTable
                    caption="Candidates enrolled on this course, and their mark for this paper."
                    head={
                      <>
                        <th scope="col">Candidate</th>
                        <th scope="col">Grade</th>
                        <th scope="col">Mark</th>
                        {showSubmissions ? <th scope="col">Submission</th> : null}
                      </>
                    }
                  >
                    {candidates.length === 0 ? (
                      <EmptyRow colSpan={showSubmissions ? 4 : 3} icon="users">
                        Nobody is enrolled on this course yet.
                      </EmptyRow>
                    ) : candidates.map((c) => {
                      const m = markOf.get(c.user_id);
                      const attempt = attemptOf.get(c.user_id);
                      return (
                        <tr key={c.user_id}>
                          <td className="font-semibold">{c.name}</td>
                          <td className="text-[13px] text-muted">
                            {m?.grade ?? <span aria-hidden>&mdash;</span>}
                            {m ? null : <span className="sr-only">Not marked</span>}
                          </td>
                          <td>
                            {m ? (
                              <Score value={m.final_marks} outOf={exam.max_marks}
                                band={m.final_marks >= exam.pass_marks ? 'hi' : 'lo'} />
                            ) : (
                              <Score value="—" band="none" />
                            )}
                          </td>
                          {showSubmissions ? (
                            <td>
                              {attempt ? (
                                <Link href={'/onyx/attempts/' + attempt.id + '/mark'}
                                  className="inline-flex items-center gap-1 text-[12.5px]
                                             font-bold text-brand-600 hover:underline">
                                  <Icon name="edit" className="h-3.5 w-3.5" />
                                  Review submission
                                </Link>
                              ) : (
                                <span className="text-[12.5px] text-muted">Didn’t attempt yet</span>
                              )}
                            </td>
                          ) : null}
                        </tr>
                      );
                    })}
                  </DataTable>
                </div>
              </section>
            ) : plan && plan.total > 0 ? (
              <section>
                <div className="mb-2.5 flex flex-wrap items-baseline justify-between gap-3">
                  <h2 className="text-[11.5px] font-bold uppercase tracking-[.085em] text-muted">
                    Candidate register &mdash; {plan.total} seated
                  </h2>
                  {/* CMP-02b: the plan goes on a door and the sheet goes on a
                      clipboard, so it has to leave the screen as a document. */}
                  <a
                    href={'/api/proxy/onyx/exams/' + id + '/seating.pdf'}
                    download
                    className="inline-flex min-h-[38px] items-center gap-1.5 rounded-2xl border
                               border-line px-3.5 text-[13px] font-bold text-slate-700
                               hover:bg-brand-50"
                  >
                    <Icon name="download" className="h-4 w-4" />
                    Seating &amp; attendance sheet
                  </a>
                </div>

                <div className="space-y-5">
                  {/* Ordered by seat, not by name: that is the order an
                      invigilator walks the hall in. */}
                  {plan.halls.map((h) => (
                    <div key={h.hall_id}>
                      <h3 className="mb-2 text-sm font-bold">{h.hall}</h3>
                      <div tabIndex={0} role="region" aria-label={'Seating for ' + h.hall}>
                        <DataTable
                          caption={'Seating for ' + h.hall}
                          head={
                            <>
                              <th scope="col">Seat</th>
                              <th scope="col">Candidate</th>
                              <th scope="col">Grade</th>
                              <th scope="col">Mark</th>
                            </>
                          }
                        >
                          {h.seats.map((s) => {
                            const m = markOf.get(s.user_id);
                            return (
                              <tr key={s.seat_label}>
                                <td className="whitespace-nowrap font-semibold tabular-nums">
                                  {s.seat_label}
                                </td>
                                <td>{s.name ?? 'User #' + s.user_id}</td>
                                <td className="text-[13px] text-muted">
                                  {m?.grade ?? <span aria-hidden>&mdash;</span>}
                                  {m ? null : <span className="sr-only">Not marked</span>}
                                </td>
                                <td>
                                  {m ? (
                                    <span className="inline-flex items-center gap-1">
                                      <Score value={m.final_marks} outOf={exam.max_marks}
                                        band={m.final_marks >= exam.pass_marks ? 'hi' : 'lo'} />
                                      <MarkOverride markId={m.id} maxMarks={exam.max_marks}
                                        current={m.final_marks} />
                                    </span>
                                  ) : (
                                    <Score value="—" band="none" />
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                          {h.seats.length === 0 ? (
                            <EmptyRow colSpan={4} icon="users">
                              No seats have been allocated in this hall.
                            </EmptyRow>
                          ) : null}
                        </DataTable>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            ) : (
              <Card className="p-0">
                <Empty icon="building">
                  No seating has been allocated yet. Allocating one fills every hall in seat
                  order and gives the invigilators a sheet to walk the room with.
                </Empty>
              </Card>
            )}
          </div>

          <aside className="min-w-0 space-y-6">
            {canMark ? (
              <section>
                <SectionHead title="Marking" />
                <Card className="p-4">
                  <div className="flex items-baseline justify-between gap-2 text-[13px]">
                    <span className="font-bold">Scripts marked</span>
                    <span className="tabular-nums text-muted">
                      {marked} of {candidates.length}
                    </span>
                  </div>
                  <div className="mt-2">
                    <Meter
                      percent={candidates.length ? (marked / candidates.length) * 100 : 0}
                      label={'Scripts marked on ' + exam.title} />
                  </div>
                  <dl className="mt-4 divide-y divide-line border-t border-line text-[13.5px]">
                    <div className="flex items-center justify-between gap-3 py-2.5">
                      <dt className="text-muted">Marks entered</dt>
                      <dd className="font-bold tabular-nums">{(marks ?? []).length}</dd>
                    </div>
                    <div className="flex items-center justify-between gap-3 py-2.5">
                      <dt className="text-muted">Moderated</dt>
                      <dd className="font-bold tabular-nums">
                        {(marks ?? []).filter((m) => m.moderation_delta !== 0).length}
                      </dd>
                    </div>
                    {/* "Exam marks", not "Results". The online-paper panel
                        below has its own release flag and its own row, and
                        when both were called "Results" the page appeared to
                        contradict itself -- published here, not published
                        there -- while both statements were correct about
                        different things. */}
                    <div className="flex items-center justify-between gap-3 py-2.5">
                      <dt className="text-muted">Exam marks</dt>
                      <dd>
                        {published
                          ? <State tone="on">Published</State>
                          : <State tone="idle">Not published</State>}
                      </dd>
                    </div>
                  </dl>
                </Card>
              </section>
            ) : null}

            {/* Only ever shown to staff who can actually reach it: the
                proctor queue this reads is now scoped to a faculty
                member's own courses (see /proctor/queue's own comment), so
                an exam on somebody else's course would return nothing here
                rather than leak flags across it. */}
            {canMark && onlinePaper ? (
              <section>
                <SectionHead title="Online paper" />
                <Card className="p-4">
                  <p className="text-[13px] text-muted">
                    Sat through the assessment engine, locked to this exam’s slot.
                  </p>
                  <dl className="mt-3 divide-y divide-line border-t border-line text-[13.5px]">
                    <div className="flex items-center justify-between gap-3 py-2.5">
                      <dt className="text-muted">Sitting now</dt>
                      <dd className="font-bold tabular-nums">{sittingNow}</dd>
                    </div>
                    <div className="flex items-center justify-between gap-3 py-2.5">
                      <dt className="text-muted">Flagged by the proctor</dt>
                      <dd className="font-bold tabular-nums">{examFlagged}</dd>
                    </div>
                    {/* Per-question feedback on the online paper, which is a
                        separate release from the exam mark register above and
                        is not performed by publishing marks. */}
                    <div className="flex items-center justify-between gap-3 py-2.5">
                      <dt className="text-muted">Paper feedback</dt>
                      <dd>
                        {onlinePaper.results_published_at
                          ? <State tone="on">Released</State>
                          : <State tone="idle">Not released</State>}
                      </dd>
                    </div>
                  </dl>
                  <div className="mt-3.5 flex flex-wrap gap-2 border-t border-line pt-3.5">
                    <Link href={'/onyx/invigilate?assessment_id=' + exam.assessment_id}
                      className="inline-flex min-h-[36px] items-center gap-1.5 rounded-xl
                                 border border-line px-3 text-[12.5px] font-bold text-slate-700
                                 hover:bg-brand-50">
                      <Icon name="shield" className="h-3.5 w-3.5" />
                      Invigilate
                    </Link>
                    <Link href={'/onyx/assessments/' + onlinePaper.id + '/marking'}
                      className="inline-flex min-h-[36px] items-center gap-1.5 rounded-xl
                                 border border-line px-3 text-[12.5px] font-bold text-slate-700
                                 hover:bg-brand-50">
                      <Icon name="edit" className="h-3.5 w-3.5" />
                      Marking queue
                    </Link>
                    <Link href={'/onyx/assessments/' + onlinePaper.id + '/results'}
                      className="inline-flex min-h-[36px] items-center gap-1.5 rounded-xl
                                 border border-line px-3 text-[12.5px] font-bold text-slate-700
                                 hover:bg-brand-50">
                      <Icon name="chart" className="h-3.5 w-3.5" />
                      Results
                    </Link>
                  </div>
                </Card>
              </section>
            ) : null}

            <section>
              <SectionHead title="Paper" />
              <Card className="p-4">
                <dl className="divide-y divide-line text-[13.5px]">
                  <div className="flex items-center justify-between gap-3 pb-2.5">
                    <dt className="text-muted">Out of</dt>
                    <dd className="font-bold tabular-nums">{exam.max_marks}</dd>
                  </div>
                  <div className="flex items-center justify-between gap-3 py-2.5">
                    <dt className="text-muted">Pass mark</dt>
                    <dd className="font-bold tabular-nums">{exam.pass_marks}</dd>
                  </div>
                  <div className="flex items-center justify-between gap-3 py-2.5">
                    <dt className="text-muted">Starts</dt>
                    <dd className="text-right font-semibold">
                      {/* In the reader's zone, not the server's. Formatted
                          here it came out in UTC, which for a sitting stored
                          at 08:05Z read as 08:05 to somebody due at 13:35. */}
                      {Number.isFinite(start)
                        ? <LocalTime iso={exam.starts_at} />
                        : '—'}
                    </dd>
                  </div>
                  <div className="flex items-center justify-between gap-3 pt-2.5">
                    <dt className="text-muted">Course</dt>
                    <dd>
                      {/* The course's NAME. This printed `Course #626`, which
                          is a database row id shown to a candidate -- it tells
                          them nothing and it tells anybody reading over their
                          shoulder how many courses the institution has. The
                          exam already carries the course it is on. */}
                      <Link href={'/onyx/courses/' + exam.course_id}
                        className="font-semibold text-brand-600 hover:underline">
                        {courseOf ? courseOf.code + ' · ' + courseOf.title : 'This course'}
                      </Link>
                    </dd>
                  </div>
                </dl>
              </Card>
            </section>

            {/* Down here, not next to "Edit exam" above, same reasoning as the
                tenant "Danger zone": read past what the exam actually is
                before reaching the one control that removes it outright. */}
            {canMark ? (
              <section>
                <SectionHead title="Danger zone" />
                <Card className="border-red-200 p-4">
                  <p className="text-[13px] text-muted">
                    Removes this exam and its seating and marks. The paper it draws on, if
                    any, is not touched — only this one scheduled slot.
                  </p>
                  <div className="mt-3 border-t border-red-100 pt-3">
                    <DeleteExamButton examId={Number(id)} />
                  </div>
                </Card>
              </section>
            ) : null}
          </aside>
        </div>
      </div>
    </OnyxShell>
  );
}
