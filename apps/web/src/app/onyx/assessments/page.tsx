import Link from 'next/link';
import type { Metadata } from 'next';
import { OnyxShell } from '@/components/onyx-shell';
import { navFor } from '@/lib/onyx-nav';
import { requireOnyxSession, onyxApi, onyxApiSafe, type Me } from '@/lib/onyx-session';
import { isExamsStaff, type Assessment, type MyAttempt } from '@/lib/onyx-assess';
import type { Course } from '@/lib/onyx-learn';
import { FacultyAssessmentTabs } from '@/lib/onyx-console-exams';
import { PaperBuilder } from '@/components/onyx-paper-builder';
import {
  ActionLink, Banner, CardGrid, DataTable, Empty, EmptyRow, Icon, ListRow, Pill, RowList,
  Score, SectionHead, StatTile,
} from '@/components/onyx-ui';

export const metadata: Metadata = { title: 'Assessments' };

/**
 * Where a paper is in its life, from the two fields that record it.
 *
 * `status` knows draft/published/closed and `results_published_at` knows
 * released; the gap between them -- a paper that has closed but whose marks
 * are not out -- is the state a lecturer spends most of the term in, so it is
 * named rather than lumped in with "closed".
 */
type Stage = 'draft' | 'scheduled' | 'open' | 'marking' | 'released';

function stageOf(a: Assessment, now: number): Stage {
  if (a.results_published_at) return 'released';
  if (a.status === 'draft') return 'draft';
  const opened = !a.opens_at || Date.parse(a.opens_at) <= now;
  const shut = a.status === 'closed' || (!!a.closes_at && Date.parse(a.closes_at) < now);
  if (!opened) return 'scheduled';
  return shut ? 'marking' : 'open';
}

const STAGE_PILL: Record<Stage, { label: string; tone: 'neutral' | 'brand' | 'soon' | 'good' }> = {
  draft:     { label: 'Draft',     tone: 'neutral' },
  scheduled: { label: 'Scheduled', tone: 'brand' },
  open:      { label: 'Open',      tone: 'brand' },
  marking:   { label: 'Marking',   tone: 'soon' },
  released:  { label: 'Released',  tone: 'good' },
};

/**
 * Relative, in both directions -- "3 days ago" as well as "in 3 days".
 *
 * `relativeDue` is built for deadlines and says "2 days late" for anything in
 * the past, which is the wrong sentence for a window that simply closed.
 */
function since(iso: string | null | undefined, now: number): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  const mins = Math.round((now - t) / 60_000);
  const n = Math.abs(mins);
  const say = n < 60 ? (n <= 1 ? 'a minute' : n + ' minutes')
    : n < 1440 ? (Math.round(n / 60) === 1 ? 'an hour' : Math.round(n / 60) + ' hours')
      : n < 10_080 ? (Math.round(n / 1440) === 1 ? 'a day' : Math.round(n / 1440) + ' days')
        : Math.round(n / 10_080) === 1 ? 'a week' : Math.round(n / 10_080) + ' weeks';
  return mins < 0 ? 'in ' + say : say + ' ago';
}

/** ASS-01 / ASS-04 -- what is coming up, and what came back. */
export default async function OnyxAssessmentsPage() {
  await requireOnyxSession();
  const [me, assessments] = await Promise.all([
    onyxApi<Me>('/api/onyx/me'),
    onyxApi<Assessment[]>('/api/onyx/assessments'),
  ]);
  const staff = isExamsStaff(me.role);
  const mine = staff ? null : await onyxApiSafe<MyAttempt[]>('/api/onyx/my/assessments');
  const now = Date.now();

  // How many attempts this person has on each paper, so a repeated one can be
  // labelled with its ordinal and a single one left alone.
  const attemptsPerPaper = new Map<number, number>();
  for (const a of mine ?? []) {
    const key = Number(a.assessment_id);
    attemptsPerPaper.set(key, (attemptsPerPaper.get(key) ?? 0) + 1);
  }

  // ASS-01: a paper is drawn from banks, so setting one needs the banks and
  // the courses it can belong to. Learners are shown neither.
  const [banks, courses] = await Promise.all([
    staff ? onyxApiSafe<{ id: number; name: string; description: string | null }[]>(
      '/api/onyx/banks') : null,
    staff ? onyxApiSafe<Course[]>('/api/onyx/courses') : null,
  ]);

  const stages = new Map(assessments.map((a) => [a.id, stageOf(a, now)] as const));
  const count = (s: Stage) => assessments.filter((a) => stages.get(a.id) === s).length;
  const courseOf = new Map((courses ?? []).map((c) => [c.id, c] as const));

  // The one paper worth interrupting for: closed a fortnight ago with no
  // marks out. Derived from the dates already on screen, not a new call.
  const stale = assessments
    .filter((a) => stages.get(a.id) === 'marking' && a.closes_at
      && now - Date.parse(a.closes_at) > 14 * 86_400_000)
    .sort((a, b) => Date.parse(a.closes_at!) - Date.parse(b.closes_at!))[0];

  return (
    <OnyxShell
      me={me}
      nav={navFor(me.role)}
      title="Assessments"
      subtitle={staff ? 'Papers set at this institution.' : 'Your tests, and your results.'}
    >
      {/* The two halves of Assessments. Building a bank moved to its own tab:
          a lecturer scheduling a test was scrolling past a question composer
          to reach the list, and a setter writing questions was scrolling past
          a calendar to reach the composer. */}
      {staff ? (
        <FacultyAssessmentTabs scheduled={assessments.length} banks={(banks ?? []).length} />
      ) : null}

      {staff ? (
        <section className="mb-6">
          <div className="flex flex-wrap items-start gap-3">
            {/* The four-step composer, not the old one-shot form: it reaches
                every setting the engine runs on, lets a paper stay a draft,
                and shows a real dealt paper before anything is published. */}
            <PaperBuilder
              banks={(banks ?? []).map((b) => ({
                id: Number(b.id), name: b.name, course_id: null }))}
              courses={(courses ?? []).map((c) => ({ id: Number(c.id), title: c.title }))} />
          </div>
          {banks?.length ? null : (
            <p className="mt-3 text-sm text-muted">
              No question banks yet. A paper draws its questions from one, so build a bank
              first — under <span className="font-semibold">Assessment question bank</span>.
            </p>
          )}
        </section>
      ) : null}

      {staff ? (
        <>
          {/* The four numbers a lecturer acts on. Every one of them comes off
              `status` and `results_published_at`; nothing here is a guess. */}
          <CardGrid min="12.5rem">
            <StatTile label="Published" value={count('open') + count('marking')}
              note={count('open') + ' accepting submissions right now'} />
            <StatTile label="In draft" value={count('draft')}
              note={count('scheduled') + ' more set but not yet open'} />
            <StatTile label="Awaiting results" value={count('marking')}
              note="closed, with marks not yet released" />
            <StatTile label="Released" value={count('released')}
              note="candidates can see their marks" />
          </CardGrid>

          {/* A table, not a row list: this is comparing papers down the state
              column to decide what to open next, which is what a table is for.
              A learner gets the row list below instead, because they are
              picking one thing to sit rather than scanning a column. */}
          <section className="mt-6">
            <SectionHead title="Papers" />
            <DataTable
              caption="Papers set at this institution, with the state of each and what to do next"
              head={<>
                <th scope="col">Assessment</th>
                <th scope="col">Course</th>
                <th scope="col">Window</th>
                <th scope="col">State</th>
                <th scope="col"><span className="sr-only">Actions</span></th>
              </>}
            >
              {assessments.map((a) => {
                const stage = stages.get(a.id)!;
                const pill = STAGE_PILL[stage];
                const course = a.course_id === null ? null : courseOf.get(a.course_id);
                const when = stage === 'scheduled'
                  ? (since(a.opens_at, now) ? 'Opens ' + since(a.opens_at, now) : 'No dates set')
                  : stage === 'draft'
                    ? (since(a.opens_at, now) ? 'Opens ' + since(a.opens_at, now) : 'No dates set')
                    : a.closes_at
                      ? (stage === 'open' ? 'Closes ' : 'Closed ') + since(a.closes_at, now)
                      : 'Open any time';
                const action = stage === 'marking'
                  ? { href: '/onyx/assessments/' + a.id + '/marking', label: 'Mark' }
                  : stage === 'released'
                    ? { href: '/onyx/assessments/' + a.id + '/results', label: 'Results' }
                    : { href: '/onyx/assessments/' + a.id,
                      label: stage === 'draft' ? 'Edit' : 'Open' };
                return (
                  <tr key={a.id}>
                    <td>
                      <Link href={'/onyx/assessments/' + a.id}
                        className="font-semibold hover:underline">{a.title}</Link>
                      <div className="mt-0.5 text-[12.5px] text-muted">
                        <span className="tabular-nums">{a.duration_minutes} min</span>
                        {a.sections?.length
                          ? ' · ' + a.sections.length
                            + (a.sections.length === 1 ? ' section drawn' : ' sections drawn')
                          : ' · no questions drawn yet'}
                        {a.proctoring ? ' · monitored' : ''}
                      </div>
                    </td>
                    <td className="whitespace-nowrap text-muted">{course?.code ?? '—'}</td>
                    <td className="whitespace-nowrap text-muted">{when}</td>
                    <td>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Pill tone={pill.tone}>{pill.label}</Pill>
                        {a.moderation_required && stage === 'marking'
                          ? <Pill tone="neutral">Moderated</Pill> : null}
                      </div>
                    </td>
                    <td className="text-right">
                      <ActionLink href={action.href} label={action.label}
                        tone={stage === 'marking' ? 'brand' : 'quiet'} />
                    </td>
                  </tr>
                );
              })}
              {assessments.length === 0 ? (
                <EmptyRow colSpan={5} icon="edit">
                  No papers have been set yet. Build a question bank, then draw a paper from it.
                </EmptyRow>
              ) : null}
            </DataTable>
          </section>

          {stale ? (
            <div className="mt-3">
              <Banner tone="warn" icon="clock"
                action={<ActionLink href={'/onyx/assessments/' + stale.id + '/marking'}
                  label="Mark it" />}>
                <span className="font-bold">{stale.title}</span> closed{' '}
                {since(stale.closes_at, now)} and its results are still not out. Candidates
                have no way to see how they did until marking finishes.
              </Banner>
            </div>
          ) : null}
        </>
      ) : (
        /* A paper is something you sit, not a value you compare down a column,
           so it gets a row with its state and its action rather than four cells
           of grey text. "Open" is the whole point of the screen and it was the
           last column. */
        <RowList label="Assessments">
          {assessments.map((a) => {
            const stage = stageOf(a, now);
            const pill = STAGE_PILL[stage];
            return (
              <ListRow
                key={a.id}
                icon={stage === 'released' ? 'award' : 'edit'}
                tone={stage === 'released' ? 'good' : stage === 'open' ? 'brand' : 'neutral'}
                title={a.title}
                href={'/onyx/assessments/' + a.id}
                chips={
                  <>
                    <Pill tone={pill.tone}>
                      {stage === 'released' ? 'Results out' : pill.label}
                    </Pill>
                    {a.proctoring ? <Pill tone="soon">Monitored</Pill> : null}
                  </>
                }
                meta={
                  <span className="flex flex-wrap items-center gap-x-3">
                    <span className="tabular-nums">{a.duration_minutes} minutes</span>
                    <span>
                      {a.opens_at
                        ? 'Opens ' + new Date(a.opens_at).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
                        : 'Open any time'}
                    </span>
                  </span>
                }
                action={stage === 'open'
                  ? { href: '/onyx/assessments/' + a.id, label: 'Open' }
                  : undefined}
              />
            );
          })}
          {assessments.length === 0 ? (
            <li>
              <Empty icon="edit">
                Nothing is scheduled. When a paper is set for one of your courses it appears here.
              </Empty>
            </li>
          ) : null}
        </RowList>
      )}

      {mine?.length ? (
        <section className="mt-8">
          <SectionHead title="Your papers" />
          <RowList label="Your attempts">
            {mine.map((a) => (
              <ListRow
                key={a.attempt_id}
                icon={a.results_published ? 'award' : 'clock'}
                tone={a.results_published ? (a.passed === false ? 'late' : 'good') : 'neutral'}
                // A paper you are allowed to sit twice produced two rows that
                // were identical in every visible respect: same title, same
                // "Handed in", nothing saying which was the later one. The
                // ordinal has always been in the payload -- this list just
                // never rendered it. Shown only where there is more than one,
                // because "Attempt 1" on a single-attempt paper is noise.
                title={(attemptsPerPaper.get(Number(a.assessment_id)) ?? 0) > 1
                  ? a.title + ' · Attempt ' + a.attempt
                  : a.title}
                // Every one of these rows leads somewhere now. They led
                // nowhere at all before: a learner could see "Passed" and had
                // no way to click through to what they actually scored.
                href={'/onyx/attempts/' + a.attempt_id}
                meta={a.results_published
                  ? (a.passed === null ? 'Marked' : a.passed ? 'Passed' : 'Not passed')
                  : a.status === 'in_progress'
                    ? 'You have a paper open'
                    : 'Handed in — results are not out yet'}
                trailing={a.results_published && a.score !== null ? (
                  // The band is emphasis; the number inside it is the
                  // information, so nobody is locked out by the colour.
                  <Score value={a.score} outOf={a.max_score}
                    band={a.passed === false ? 'lo' : undefined} />
                ) : null}
                chips={a.status === 'in_progress' ? <Pill tone="soon">In progress</Pill> : null}
              />
            ))}
          </RowList>
        </section>
      ) : null}
    </OnyxShell>
  );
}
