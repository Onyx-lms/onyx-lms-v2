import Link from 'next/link';
import type { Metadata } from 'next';
import { requirePlatformSession } from '@/lib/onyx-platform-session';
import {
  attempt, Fact, SCROLLER, Unavailable, type AcademicsPayload,
} from '@/lib/onyx-platform-tenant';
import {
  ConsoleProblemEdit, ConsolePublishProblem, ConsoleTestCases,
  type ConsoleProblem,
} from '@/components/onyx-platform-forms';
import {
  Banner, Card, DataTable, EmptyRow, Icon, Pill, SectionHead,
} from '@/components/onyx-ui';
import { formatDateTime } from '@/lib/when';
import type { CodeSubmissionFeed } from '@/lib/onyx-codelab';

export const metadata: Metadata = { title: 'Coding problem' };

/**
 * One coding problem, and everything needed to finish it.
 *
 * The order down the page is the order the work happens in, which is imposed
 * by the API rather than chosen here: the statement, then the answer key, then
 * publishing -- a problem cannot be published with no test cases, and its cases
 * cannot be changed once it is. The submissions at the bottom are the reason
 * the last of those rules exists, so they are on the same screen as the button
 * that would break them.
 */

const DIFFICULTY_TONE: Record<string, 'good' | 'soon' | 'late'> = {
  easy: 'good', medium: 'soon', hard: 'late',
};

const STATE: Record<string, { label: string; tone: 'good' | 'soon' | 'late' | 'neutral' }> = {
  // Keyed by what the grader writes, labelled with what a person calls it:
  // the row says 'done', the chip says Graded.
  done: { label: 'Graded', tone: 'good' },
  queued: { label: 'Queued', tone: 'soon' },
  running: { label: 'Running', tone: 'soon' },
  failed: { label: 'Failed', tone: 'late' },
};

interface ProblemDetail extends ConsoleProblem {
  solution: string | null;
  tests: {
    id: number; name: string; stdin: string | null; expected_stdout: string | null;
    is_hidden: number | boolean; weight: number;
  }[];
}

export default async function OnyxPlatformProblemPage(
  { params }: { params: Promise<{ id: string; problemId: string }> },
) {
  await requirePlatformSession();
  const { id, problemId } = await params;
  const tenantId = Number(id);
  const base = '/api/onyx/platform/tenants/' + encodeURIComponent(id);
  const backHref = '/onyx/platform/tenants/' + tenantId + '/problems';

  const [problem, academics, feed] = await Promise.all([
    attempt<ProblemDetail>(base + '/problems/' + encodeURIComponent(problemId)),
    attempt<AcademicsPayload>(base + '/academics?limit=200'),
    attempt<CodeSubmissionFeed>(
      base + '/code-submissions?problem_id=' + encodeURIComponent(problemId) + '&limit=100'),
  ]);

  if (problem === null) {
    return (
      <div className="min-w-0 space-y-4">
        <Link href={backHref} className="text-[13px] font-semibold text-muted hover:underline">
          ← All coding problems
        </Link>
        <Unavailable what="problem" />
      </div>
    );
  }

  const courses = academics?.courses ?? [];
  const course = problem.course_id === null
    ? null : courses.find((c) => c.id === problem.course_id) ?? null;
  const tests = problem.tests ?? [];
  const visible = tests.filter((t) => !t.is_hidden);
  const published = problem.status === 'published';
  const submissions = feed?.submissions ?? [];

  return (
    <div className="min-w-0 space-y-5">
      <Link href={backHref} className="text-[13px] font-semibold text-muted hover:underline">
        ← All coding problems
      </Link>

      <Card className="p-4">
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-[17px] font-extrabold">{problem.title}</h2>
              <Pill tone={DIFFICULTY_TONE[problem.difficulty] ?? 'neutral'}>
                {problem.difficulty}
              </Pill>
              {published ? <Pill tone="good">Published</Pill> : <Pill tone="neutral">Draft</Pill>}
            </div>
            <p className="mt-0.5 font-mono text-[12px] text-muted">{problem.slug}</p>
          </div>
          <ConsoleProblemEdit tenantId={tenantId} problem={problem} courses={courses} />
        </div>

        <dl className="mt-4 grid gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-4">
          <Fact label="Topic">{problem.topic ?? 'None'}</Fact>
          <Fact label="Course">
            {course ? course.code + ' — ' + course.title : 'Not tied to a course'}
          </Fact>
          <Fact label="Languages">{(problem.languages ?? []).join(', ') || 'None set'}</Fact>
          <Fact label="Limits">
            {(problem.time_limit_ms / 1000).toFixed(1)}s ·{' '}
            {Math.round(problem.memory_limit_kb / 1024)}MB per case
          </Fact>
        </dl>

        {(problem.tags ?? []).length ? (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {problem.tags.map((t) => <Pill key={t}>{t}</Pill>)}
          </div>
        ) : null}
      </Card>

      <section>
        <SectionHead title="Description" />
        <Card className="p-4">
          {problem.statement?.trim() ? (
            // Pre-wrapped rather than rendered as markup: what an author typed
            // is what a learner is shown, and a statement is mostly prose with
            // a worked example whose line breaks carry meaning.
            <p className="whitespace-pre-wrap text-[14px] leading-relaxed">
              {problem.statement}
            </p>
          ) : (
            <p className="text-[13px] text-muted">
              No description yet. Use Edit above — this is the only thing a learner reads
              before they start writing.
            </p>
          )}
        </Card>
      </section>

      <section>
        <SectionHead title={'Test cases · ' + tests.length} />
        {!published && !visible.length && tests.length ? (
          <Banner tone="warn" icon="alert">
            Every case is hidden. At least one has to be visible before this can be published —
            without one a learner cannot tell what the problem wants, only that they got it wrong.
          </Banner>
        ) : null}
        <div className="mt-2">
          <ConsoleTestCases
            tenantId={tenantId}
            problemId={problem.id}
            published={published}
            initial={tests.map((t) => ({
              name: t.name, stdin: t.stdin, expected_stdout: t.expected_stdout,
              is_hidden: t.is_hidden, weight: t.weight,
            }))}
          />
        </div>
      </section>

      <section>
        <SectionHead title="Publishing" />
        <Card className="p-4">
          <ConsolePublishProblem tenantId={tenantId} problemId={problem.id}
            published={published} caseCount={tests.length} />
        </Card>
      </section>

      <section>
        <SectionHead title={'Submissions · ' + submissions.length} />
        {feed === null ? <Unavailable what="submission list" /> : (
          <div tabIndex={0} role="region" aria-label="Submissions on this problem"
            className={SCROLLER}>
            <DataTable
              caption="Everyone who has handed this problem in, most recent first."
              head={
                <>
                  <th scope="col">Learner</th>
                  <th scope="col">Language</th>
                  <th scope="col">Score</th>
                  <th scope="col">State</th>
                  <th scope="col">When</th>
                </>
              }
            >
              {submissions.map((s) => {
                const state = STATE[s.status] ?? { label: s.status, tone: 'neutral' as const };
                return (
                  <tr key={s.id}>
                    <td className="font-semibold">
                      {s.learner}
                      {s.roll_number ? (
                        <div className="text-xs font-normal text-muted">{s.roll_number}</div>
                      ) : null}
                    </td>
                    <td>
                      <Pill>{s.language}</Pill>
                      {s.mode === 'run' ? (
                        <span className="ml-1.5 align-middle"><Pill tone="neutral">Run</Pill></span>
                      ) : null}
                    </td>
                    <td className="tabular-nums">
                      {s.status === 'done'
                        ? s.score + '/' + s.max_score + ' · ' + s.passed + '/' + s.total + ' cases'
                        : '—'}
                    </td>
                    <td><Pill tone={state.tone}>{state.label}</Pill></td>
                    <td className="whitespace-nowrap text-muted">
                      {formatDateTime(s.graded_at ?? s.queued_at)}
                    </td>
                  </tr>
                );
              })}
              {submissions.length === 0 ? (
                <EmptyRow colSpan={5} icon="code">
                  <span className="inline-flex items-center gap-1.5">
                    <Icon name="clock" className="h-4 w-4" />
                    {published
                      ? 'Nobody has handed this in yet.'
                      : 'Nobody can hand this in — it is still a draft.'}
                  </span>
                </EmptyRow>
              ) : null}
            </DataTable>
          </div>
        )}
      </section>
    </div>
  );
}
