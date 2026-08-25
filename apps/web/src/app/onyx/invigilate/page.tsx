import Link from 'next/link';
import type { Metadata } from 'next';
import { OnyxShell } from '@/components/onyx-shell';
import { navFor } from '@/lib/onyx-nav';
import { requireOnyxPageRole, onyxApi, onyxApiSafe, type Me } from '@/lib/onyx-session';
import { LiveRefresh } from '@/components/onyx-live';
import { WatchCandidate } from '@/components/onyx-proctor-live';
import { ReinstateAttempt, StoppedBadge } from '@/components/onyx-reinstate';
import type { Exam } from '@/lib/onyx-campus';
import {
  ActionLink, Card, CardGrid, DataTable, EmptyRow, Icon, Meter, Pill, Score,
  SectionHead, State, StatTile,
} from '@/components/onyx-ui';

export const metadata: Metadata = { title: 'Invigilate' };

interface QueueRow {
  attempt_id: number; assessment_id: number; user_id: string; status: string;
  name: string | null; roll_number: string | null;
  integrity_flags: number; integrity_status: string; open_events: number;
  /** null means the attempt has never reported either way -- not the same as off. */
  camera_on: boolean | null; screen_on: boolean | null;
  requires_camera: boolean; requires_screen: boolean;
  /** Whether this paper allows an invigilator to watch the camera live. */
  watch_camera?: boolean;
  tab_switches: number; started_at: string | null;
  /**
   * Departures counted against the RULE -- reset when somebody is reinstated,
   * which is deliberately not the same number as `tab_switches`, the total
   * ever recorded. One says how many lives are left, the other says what this
   * candidate has been doing all morning.
   */
  breaches?: number;
  /** Set when the departure rule stopped the paper. */
  terminated_at?: string | null;
  terminated_reason?: string | null;
}

/**
 * A device, as four states rather than two.
 *
 * "Off", "never said" and "never wanted" are three different things that a
 * boolean flattens into one. Silence on a paper that requires a camera is the
 * loudest of them -- somebody is sitting a monitored paper and the browser has
 * never once said the camera is on -- and it used to render as the reassuring
 * "not required".
 */
function device(on: boolean | null, required: boolean, label: string): {
  tone: 'on' | 'off' | 'idle'; text: string;
} {
  if (!required) return { tone: 'idle', text: 'Not required' };
  if (on === null) return { tone: 'off', text: label + ' never reported' };
  return on ? { tone: 'on', text: label + ' on' } : { tone: 'off', text: label + ' OFF' };
}

/**
 * A live dot that stops moving when the reader has asked for that.
 *
 * `State` paints the dot with `animate-pulse`; a pulsing red mark is exactly
 * the sort of thing `prefers-reduced-motion` exists for, and the word beside
 * it carries the state on its own once the animation is gone.
 */
const CALM = '[&_i]:motion-reduce:animate-none';

/**
 * How loud one attempt's flag score is.
 *
 * `REVIEW_THRESHOLD` in the proctor service is 5, so five is the line at which
 * the product itself already says "a human should look at this". The word is
 * always shown beside the band: severity here decides whether somebody walks
 * into a hall, and about one man in twelve reads the red and the amber alike.
 */
function severity(flags: number): {
  label: string; tone: 'late' | 'soon' | 'neutral'; band: 'lo' | 'mid' | 'none';
} {
  if (flags >= 5) return { label: 'High', tone: 'late', band: 'lo' };
  if (flags >= 2) return { label: 'Medium', tone: 'soon', band: 'mid' };
  return { label: 'Low', tone: 'neutral', band: 'none' };
}

/** Where an attempt's integrity case has got to, as a dot and a word. */
function caseState(status: string): { tone: 'on' | 'off' | 'idle'; label: string } {
  if (status === 'cleared') return { tone: 'on', label: 'Cleared' };
  if (status === 'upheld') return { tone: 'off', label: 'Upheld' };
  if (status === 'review') return { tone: 'off', label: 'Awaiting review' };
  return { tone: 'idle', label: 'Clean' };
}

/**
 * What a candidate is actually sitting: a scheduled examination sat online, or
 * an ordinary assessment.
 *
 * The proctor queue only ever knew about assessments -- an exam sat through
 * the CBT engine is, underneath, an assessment with its window locked to the
 * exam's slot (see campus.routes.ts' syncExamAssessmentWindow()). Without
 * this, an invigilator watching a scheduled examination saw "assessment #37"
 * like any other paper, with nothing to say it was the examination they were
 * meant to be watching.
 */
function paperLabel(assessmentId: number, examByAssessment: Map<number, Exam>): {
  isExam: boolean; title: string; href: string; examId: number | null;
} {
  const exam = examByAssessment.get(assessmentId);
  if (exam) {
    // The drill-down below, not the exam's own management page -- "open
    // examination" on this console means "show me its flags", not "let me
    // reschedule it". The management page is still one click further, from
    // the drill-down's own header.
    return { isExam: true, title: exam.title, href: '/onyx/invigilate?assessment_id=' + assessmentId,
      examId: exam.id };
  }
  return { isExam: false, title: 'Assessment #' + assessmentId,
    href: '/onyx/assessments/' + assessmentId, examId: null };
}

/**
 * How a candidate reads on the invigilation queue.
 *
 * The roll number first: an invigilator walking a hall is matching what is on
 * screen against a hall ticket, and the ticket carries a number. The service
 * resolves both now, so the members lookup here is only a fallback for a row
 * whose account has since gone.
 */
function candidateOf(row: { user_id: string; name: string | null; roll_number: string | null },
  nameOf: Map<string, string | null>): string {
  const name = row.name || nameOf.get(row.user_id) || null;
  if (row.roll_number && name) return row.roll_number + ' · ' + name;
  return row.roll_number || name || 'Candidate #' + row.user_id;
}

/** ASS-02b -- everything an invigilator has to look at, worst first. */
export default async function OnyxInvigilatePage(
  { searchParams }: { searchParams: Promise<{ assessment_id?: string }> },
) {
  await requireOnyxPageRole('admin', 'faculty', 'exams');
  // Drilled into one paper's own console from a card on the full one below --
  // "open examination" used to mean "leave invigilation and go manage the
  // exam instead", which is not what anyone watching flags was asking for.
  const { assessment_id } = await searchParams;
  const scopedId = assessment_id ? Number(assessment_id) : null;

  const [me, queue, exams, members] = await Promise.all([
    onyxApi<Me>('/api/onyx/me'),
    onyxApi<QueueRow[]>('/api/onyx/proctor/queue'
      + (scopedId ? '?assessment_id=' + scopedId : '')),
    onyxApiSafe<Exam[]>('/api/onyx/exams'),
    // Every flag on this console used to be a bare "Candidate #867" -- the
    // one thing an invigilator or examinations officer actually needs to
    // know when a flag is real enough to walk into a hall over.
    onyxApiSafe<{ user_id: string; user: { name: string } | null }[]>('/api/onyx/members'),
  ]);
  const nameOf = new Map((members ?? []).map((m) => [m.user_id, m.user?.name ?? null]));

  // Only exams sat online carry an assessment_id at all -- a paper exam never
  // enters this map and every lookup against it correctly falls through to
  // "assessment".
  const examByAssessment = new Map<number, Exam>();
  for (const exam of exams ?? []) {
    if (exam.assessment_id != null) examByAssessment.set(exam.assessment_id, exam);
  }
  const scopedExam = scopedId ? examByAssessment.get(scopedId) : undefined;

  // Everything below is read off the queue the API already returned. The queue
  // now carries every running attempt as well as every flagged one, so the two
  // are counted separately: a clean sitting in progress is not a flag, and a
  // console that adds them together tells an invigilator the room is on fire.
  const running = queue.filter((r) => r.status === 'in_progress');
  /*
   * Papers the departure rule has STOPPED.
   *
   * Pulled out and put at the top of this console, above everything else on
   * it, because these are the only rows with a person sitting in front of them
   * waiting to be told whether their examination is over. A flag can be read
   * after the sitting; this cannot.
   */
  const stoppedPapers = queue.filter((r) => r.terminated_at);
  const flagged = queue.filter((r) => r.integrity_flags > 0);
  const openEvents = queue.reduce((n, r) => n + r.open_events, 0);
  const awaiting = queue.filter((r) => r.open_events > 0).length;
  const decided = queue.filter((r) => r.integrity_status === 'cleared'
    || r.integrity_status === 'upheld').length;
  // A running paper whose required device has dropped out: the one thing on
  // this screen worth interrupting somebody for.
  const deviceDown = running.filter((r) =>
    (r.requires_camera && r.camera_on !== true) || (r.requires_screen && r.screen_on !== true));

  const sittings = [...flagged.reduce((map, r) => {
    const s = map.get(r.assessment_id) ?? {
      assessment_id: r.assessment_id, attempts: 0, live: 0, open: 0, worst: 0, settled: 0,
    };
    s.attempts += 1;
    if (r.status === 'in_progress') s.live += 1;
    s.open += r.open_events;
    s.worst = Math.max(s.worst, r.integrity_flags);
    if (r.open_events === 0) s.settled += 1;
    map.set(r.assessment_id, s);
    return map;
  }, new Map<number, {
    assessment_id: number; attempts: number; live: number;
    open: number; worst: number; settled: number;
  }>()).values()].sort((a, b) => b.open - a.open || b.worst - a.worst);

  // Split so a scheduled examination's flags are never buried in a list of
  // ordinary assessments -- the one thing this console was asked to make
  // impossible to miss.
  const examSittings = sittings.filter((s) => examByAssessment.has(s.assessment_id));
  const assessmentSittings = sittings.filter((s) => !examByAssessment.has(s.assessment_id));

  // Split every list on this page the same way, not only the summary cards:
  // an invigilator watching examinations should never have to pick a
  // scheduled exam's row out of a table also full of ordinary quizzes.
  const runningExams = running.filter((r) => examByAssessment.has(r.assessment_id));
  const runningAssessments = running.filter((r) => !examByAssessment.has(r.assessment_id));
  const flaggedExams = flagged.filter((r) => examByAssessment.has(r.assessment_id));
  const flaggedAssessments = flagged.filter((r) => !examByAssessment.has(r.assessment_id));

  function sittingNowTable(rows: QueueRow[], emptyMessage: string) {
    return (
      <div tabIndex={0} role="region" aria-label="Attempts in progress">
        <DataTable
          caption="Papers in progress, with the state of each required device"
          head={
            <>
              <th scope="col">Attempt</th>
              <th scope="col">Camera</th>
              <th scope="col">Screen</th>
              <th scope="col">Left the paper</th>
              <th scope="col">Flag score</th>
              <th scope="col"><span className="sr-only">Actions</span></th>
            </>
          }
        >
          {rows.map((r) => {
            const cam = device(r.camera_on, r.requires_camera, 'Camera');
            const scr = device(r.screen_on, r.requires_screen, 'Screen');
            const sev = severity(r.integrity_flags);
            const paper = paperLabel(r.assessment_id, examByAssessment);
            return (
              <tr key={r.attempt_id} className="align-middle">
                <td>
                  <div className="font-semibold">{candidateOf(r, nameOf)}</div>
                  <div className="text-[12.5px] text-muted">
                    Attempt {r.attempt_id} ·{' '}
                    {paper.isExam
                      ? <span className="font-semibold text-brand-700">Exam: {paper.title}</span>
                      : paper.title}
                  </div>
                </td>
                <td><State tone={cam.tone}>{cam.text}</State></td>
                <td><State tone={scr.tone}>{scr.text}</State></td>
                <td className="tabular-nums">
                  {r.tab_switches === 0 ? (
                    <span className="text-muted">Never</span>
                  ) : (
                    <span className={r.tab_switches >= 3 ? 'font-semibold text-red-700' : ''}>
                      {r.tab_switches} {r.tab_switches === 1 ? 'time' : 'times'}
                    </span>
                  )}
                </td>
                <td><Score value={r.integrity_flags} band={sev.band} /></td>
                <td className="text-right">
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    {/* Only for papers set up for it, and only while the attempt
                        is running. ASS-02b: one candidate at a time, because the
                        media is peer-to-peer and a browser will not hold forty
                        inbound streams. */}
                    {r.watch_camera ? (
                      <WatchCandidate attemptId={r.attempt_id} name={candidateOf(r, nameOf)} />
                    ) : null}
                    <ActionLink href={'/onyx/attempts/' + r.attempt_id + '/integrity'}
                      label="Flags" />
                  </div>
                </td>
              </tr>
            );
          })}
          {rows.length === 0 ? (
            <EmptyRow colSpan={6} icon="shield">{emptyMessage}</EmptyRow>
          ) : null}
        </DataTable>
      </div>
    );
  }

  function reviewQueueTable(rows: QueueRow[], emptyMessage: string) {
    return (
      // tabIndex makes the horizontal scroll reachable by keyboard: a region
      // that only scrolls with a wheel strands anyone on a keyboard at
      // whatever columns happen to fit.
      <div tabIndex={0} role="region" aria-label="Attempts awaiting review">
        <DataTable
          caption="Attempts with integrity flags, worst first"
          head={
            <>
              <th scope="col">Attempt</th>
              <th scope="col">Severity</th>
              <th scope="col">Flag score</th>
              <th scope="col">Still open</th>
              <th scope="col">Case</th>
              <th scope="col"><span className="sr-only">Actions</span></th>
            </>
          }
        >
          {rows.map((r) => {
            const sev = severity(r.integrity_flags);
            const state = caseState(r.integrity_status);
            const paper = paperLabel(r.assessment_id, examByAssessment);
            return (
              <tr key={r.attempt_id} className="align-middle">
                <td>
                  <div className="font-semibold">{candidateOf(r, nameOf)}</div>
                  <div className="text-[12.5px] text-muted">
                    Attempt {r.attempt_id} ·{' '}
                    {paper.isExam
                      ? <span className="font-semibold text-brand-700">Exam: {paper.title}</span>
                      : paper.title}
                  </div>
                </td>
                <td>
                  <Pill tone={sev.tone}>
                    <span className="inline-flex items-center gap-1.5">
                      <Icon name="flag" className="h-3.5 w-3.5" />
                      {sev.label}
                    </span>
                  </Pill>
                </td>
                <td><Score value={r.integrity_flags} band={sev.band} /></td>
                <td className="tabular-nums">{r.open_events}</td>
                <td><State tone={state.tone}>{state.label}</State></td>
                <td className="text-right">
                  <ActionLink href={'/onyx/attempts/' + r.attempt_id + '/integrity'}
                    label="Review" />
                </td>
              </tr>
            );
          })}
          {rows.length === 0 ? (
            <EmptyRow colSpan={6} icon="shield">{emptyMessage}</EmptyRow>
          ) : null}
        </DataTable>
      </div>
    );
  }

  function sittingCard(s: (typeof sittings)[number]) {
    const worst = severity(s.worst);
    const paper = paperLabel(s.assessment_id, examByAssessment);
    return (
      <Card key={s.assessment_id} className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Pill tone={worst.tone}>
            <span className="inline-flex items-center gap-1.5">
              <Icon name="flag" className="h-3.5 w-3.5" />
              {worst.label}
            </span>
          </Pill>
          <span className={'text-[13px] ' + CALM}>
            {s.live > 0
              ? <State tone="live">{s.live} running</State>
              : <State tone="idle">Finished</State>}
          </span>
        </div>

        <div className="mt-2 flex items-center gap-1.5 text-[15px] font-semibold">
          {paper.title}
          {paper.isExam ? <Pill tone="brand">Exam</Pill> : null}
        </div>
        <div className="mt-0.5 text-[13px] text-muted">
          {s.attempts === 1 ? '1 flagged attempt' : s.attempts + ' flagged attempts'}
          {' · '}
          <span className="tabular-nums">{s.open}</span> still open
        </div>

        <div className="mt-3">
          <div className="mb-1.5 flex items-baseline justify-between text-[12.5px]">
            <span className="font-semibold">Decided</span>
            <span className="tabular-nums text-muted">
              {s.settled} of {s.attempts}
            </span>
          </div>
          <Meter percent={(s.settled / s.attempts) * 100}
            label={'Attempts decided on ' + paper.title} />
        </div>

        <div className="mt-3.5 flex flex-wrap items-center gap-x-4 gap-y-1.5">
          <ActionLink href={paper.href} label={paper.isExam ? 'Open examination' : 'Open'} />
          {/* The exam's own console -- scheduling, seating, marks -- is one
              click further than this, not the same click: invigilation and
              exam management are different jobs, done by the same person on
              different days. */}
          {paper.isExam && paper.examId ? (
            <Link href={'/onyx/exams/' + paper.examId}
              className="text-[12.5px] font-semibold text-muted hover:text-brand-700
                         hover:underline">
              Manage exam
            </Link>
          ) : null}
        </div>
      </Card>
    );
  }

  return (
    <OnyxShell
      me={me}
      nav={navFor(me.role)}
      title={scopedExam ? scopedExam.title : 'Invigilation'}
      // A flag is what a browser noticed, not proof of anything, and a console
      // that implies otherwise is how proctoring earns its bad name.
      subtitle={scopedExam
        ? 'This examination only. A flag is evidence, not a verdict.'
        : 'A flag is evidence, not a verdict. Nothing here fails anybody on its own.'}
    >
      {scopedExam ? (
        <nav aria-label="Breadcrumb"
          className="mb-4 flex items-center gap-1.5 text-[13px] text-muted">
          <Link href="/onyx/invigilate" className="font-semibold text-brand-600 hover:underline">
            Invigilation
          </Link>
          <Icon name="chevron" className="h-3 w-3 text-faint" />
          <span className="truncate">{scopedExam.title}</span>
        </nav>
      ) : null}

      {/* The live bar is the whole reason this screen exists, so it is the first
          thing under the title: everything below is historical the moment an
          attempt is handed in. */}
      <Card className={'mb-5 p-4 ' + (running.length > 0 ? 'border-red-200' : '')}>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <span className={CALM}>
            {running.length > 0 ? (
              <State tone="live">
                {running.length === 1 ? '1 attempt running' : running.length + ' attempts running'}
              </State>
            ) : (
              <State tone="idle">No attempt is running</State>
            )}
          </span>
          <span className="text-[13px] text-muted">
            <span className="tabular-nums">{flagged.length}</span> flagged
            {' · '}
            <span className="tabular-nums">{openEvents}</span>
            {openEvents === 1 ? ' event awaiting review' : ' events awaiting review'}
          </span>
          {deviceDown.length ? (
            <span className="text-[13px] font-semibold text-red-700">
              {deviceDown.length === 1
                ? '1 running paper has a required device off'
                : deviceDown.length + ' running papers have a required device off'}
            </span>
          ) : null}
          {/* Without this the console rendered once and then went stale, which
              on the one screen meant to show what is happening now is the most
              misleading thing it could do. */}
          <span className="ml-auto"><LiveRefresh seconds={15} label="This console" /></span>
        </div>
      </Card>

      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Flagged attempts" value={flagged.length}
          note={flagged.length === 0 ? 'nothing has tripped a rule' : 'worst first below'} />
        <StatTile label="Awaiting review" value={awaiting}
          note={openEvents + (openEvents === 1 ? ' open event' : ' open events')} />
        <StatTile label="Running now" value={running.length} note="papers still in progress" />
        <StatTile label="Decided" value={decided} note="cleared or upheld by a person" />
      </div>

      {/*
        * THE ONE THING ON THIS SCREEN THAT IS WAITING ON A PERSON.
        *
        * Shown above the summary tiles and both splits, whether or not the
        * console is scoped to one paper. Everything else here is a record to
        * read; this is a decision somebody is standing in a room waiting for.
        */}
      {stoppedPapers.length ? (
        <section className="mb-7">
          <SectionHead title="Stopped, and waiting on you" />
          <p className="mb-2 max-w-3xl text-[13px] leading-relaxed text-muted">
            These papers were handed in automatically because the candidate left the
            examination more times than it allows. Everything they had written has been kept.
            Letting one carry on restores their answers and the minutes that were left on
            their clock — use it where what happened was not what it looked like.
          </p>
          <div tabIndex={0} role="region" aria-label="Stopped attempts">
            <DataTable
              caption="Papers stopped by the departure rule, and the way back from it"
              head={
                <>
                  <th scope="col">Candidate</th>
                  <th scope="col">Stopped</th>
                  <th scope="col">Departures</th>
                  <th scope="col">Flag score</th>
                  <th scope="col"><span className="sr-only">Actions</span></th>
                </>
              }
            >
              {stoppedPapers.map((r) => (
                <tr key={r.attempt_id} className="align-top">
                  <td>
                    <div className="font-semibold">{candidateOf(r, nameOf)}</div>
                    <div className="text-[12.5px] text-muted">
                      Attempt {r.attempt_id} · {paperLabel(r.assessment_id, examByAssessment).title}
                    </div>
                  </td>
                  <td><StoppedBadge at={r.terminated_at} breaches={r.breaches} /></td>
                  <td className="tabular-nums">{r.tab_switches} in all</td>
                  <td><Score value={r.integrity_flags} band={severity(r.integrity_flags).band} /></td>
                  <td className="text-right">
                    <ReinstateAttempt attemptId={r.attempt_id}
                      name={candidateOf(r, nameOf)} compact />
                  </td>
                </tr>
              ))}
            </DataTable>
          </div>
        </section>
      ) : null}

      {scopedId ? (
        <>
          {/* Already looking at one paper -- its own type is not in question,
              so there is nothing here for an Examinations/Assessments split
              to clarify. */}
          <section className="mb-7">
            <SectionHead title="Sitting now" />
            {sittingNowTable(running,
              'Nobody is sitting this paper at the moment. Candidates appear here as soon '
              + 'as they start, whether or not anything has been flagged.')}
          </section>
          <section>
            <SectionHead title="Review queue" />
            {reviewQueueTable(flagged,
              'Nothing to review. Attempts appear here the moment a monitored event is '
              + 'recorded against one — a tab switch, a paste, a camera that stops.')}
          </section>
        </>
      ) : (
        <>
          {/* Two sections, not one list with a label column -- an
              examinations officer watching a scheduled exam and a faculty
              member watching their own quiz are doing two different jobs,
              and neither should have to pick their rows out of the other's
              table. */}
          <section className="mb-8">
            <SectionHead title="Examinations"
              action={{ href: '/onyx/exams', label: 'All examinations' }} />
            <div className="space-y-5">
              <div>
                <h3 className="mb-2 text-[13px] font-bold text-slate-700">Sitting now</h3>
                {sittingNowTable(runningExams,
                  'Nobody is sitting a monitored examination at the moment.')}
              </div>
              {examSittings.length > 0 ? (
                <CardGrid min="15rem">
                  {examSittings.map((s) => sittingCard(s))}
                </CardGrid>
              ) : null}
              <div>
                <h3 className="mb-2 text-[13px] font-bold text-slate-700">Review queue</h3>
                {reviewQueueTable(flaggedExams,
                  'Nothing to review. An examination appears here the moment a monitored '
                  + 'event is recorded against one of its attempts.')}
              </div>
            </div>
          </section>

          <section>
            <SectionHead title="Assessments"
              action={{ href: '/onyx/assessments', label: 'All assessments' }} />
            <div className="space-y-5">
              <div>
                <h3 className="mb-2 text-[13px] font-bold text-slate-700">Sitting now</h3>
                {sittingNowTable(runningAssessments,
                  'Nobody is sitting a monitored assessment at the moment.')}
              </div>
              {assessmentSittings.length > 0 ? (
                <CardGrid min="15rem">
                  {assessmentSittings.map((s) => sittingCard(s))}
                </CardGrid>
              ) : null}
              <div>
                <h3 className="mb-2 text-[13px] font-bold text-slate-700">Review queue</h3>
                {reviewQueueTable(flaggedAssessments,
                  'Nothing to review. An assessment appears here the moment a monitored '
                  + 'event is recorded against one of its attempts.')}
              </div>
            </div>
          </section>
        </>
      )}
    </OnyxShell>
  );
}
