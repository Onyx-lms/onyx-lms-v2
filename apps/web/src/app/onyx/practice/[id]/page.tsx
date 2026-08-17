import Link from 'next/link';
import type { Metadata } from 'next';
import { OnyxShell } from '@/components/onyx-shell';
import { OnyxCodeLab } from '@/components/onyx-codelab';
import { Card, CodeBlock, Icon, Pill, SectionHead } from '@/components/onyx-ui';
import { navFor } from '@/lib/onyx-nav';
import { requireOnyxSession, onyxApi, onyxApiSafe, type Me } from '@/lib/onyx-session';
import { DIFFICULTY_LABELS, type ProblemDetail } from '@/lib/onyx-codelab';
import type { Course } from '@/lib/onyx-learn';
import { ProblemSettingsForm, TestCases } from '@/components/onyx-manage';

export const metadata: Metadata = { title: 'Problem' };

const DIFFICULTY_TONE: Record<string, 'good' | 'soon' | 'late'> = {
  easy: 'good', medium: 'soon', hard: 'late',
};

/**
 * LAB-01 / LAB-03 / LAB-04 -- one problem, with the editor beside it.
 *
 * Everything conditional was decided by the API: hidden cases arrive without
 * input or expected output, unrevealed hints arrive with a null body, and the
 * worked solution is present only if the release rule has been met. This page
 * renders what it was given and has no branch that could reveal more.
 *
 * Two even columns rather than a narrow rail: the statement is prose and the
 * editor is code, and neither survives being squeezed. The statement is first
 * in source order so a phone, which stacks them, reads the problem before it
 * is handed a text box.
 */
export default async function OnyxProblemPage({ params }: { params: Promise<{ id: string }> }) {
  await requireOnyxSession();
  const { id } = await params;
  const [me, problem] = await Promise.all([
    onyxApi<Me>('/api/onyx/me'),
    onyxApi<ProblemDetail>('/api/onyx/problems/' + id),
  ]);
  const staff = me.role === 'admin' || me.role === 'faculty';
  // For the course picker on ProblemSettingsForm -- same split as the
  // practice list's own CreateProblem: admin picks from every course,
  // faculty from the ones they actually teach.
  const courseOptions = staff
    ? await onyxApiSafe<Course[]>(
      me.role === 'admin' ? '/api/onyx/courses?all=1' : '/api/onyx/my/courses')
    : null;

  const visible = problem.tests.filter((t) => !t.is_hidden);
  const hidden = problem.tests.length - visible.length;
  const difficulty = DIFFICULTY_LABELS[problem.difficulty] ?? problem.difficulty;
  const memoryMb = Math.round(problem.memory_limit_kb / 1024);

  return (
    <OnyxShell
      me={me}
      nav={navFor(me.role)}
      title={problem.title}
      subtitle={difficulty
        + (problem.topic ? ', ' + problem.topic : '')
        + ', ' + problem.time_limit_ms.toLocaleString() + 'ms and '
        + memoryMb + 'MB per case'
        + (problem.attempts
          ? ' · ' + problem.attempts + ' attempt' + (problem.attempts === 1 ? '' : 's')
            + (problem.solved ? ', solved' : ' so far')
          : '')}
    >
      <nav aria-label="Breadcrumb"
        className="mb-4 flex items-center gap-1.5 text-[13px] text-muted">
        <Link href="/onyx/practice"
          className="font-semibold text-brand-600 hover:underline">Practice</Link>
        <Icon name="chevron" className="h-3.5 w-3.5 text-faint" />
        <span className="truncate">{problem.topic ?? difficulty}</span>
      </nav>

      {/* LAB-01: a problem without cases cannot be judged. Authoring them was
          API-only until now, which meant a problem created in the browser
          could never be finished there. Settings and cases side by side --
          both are "set this problem up properly", not two different jobs.
          TestCases gets the staff-only unredacted list (hidden cases
          included) so re-opening it to add one more case does not silently
          wipe the ones already there. */}
      {staff ? (
        <div className="mb-4 grid gap-3 sm:grid-cols-2">
          <ProblemSettingsForm
            problemId={Number(id)}
            problem={problem}
            courses={(courseOptions ?? []).map((c) => ({ id: c.id, label: c.code + ' — ' + c.title }))}
          />
          <TestCases problemId={Number(id)} initial={problem.tests}
            published={problem.status === 'published'} />
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
        <div className="min-w-0 space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Pill tone={DIFFICULTY_TONE[problem.difficulty] ?? 'neutral'}>{difficulty}</Pill>
            {problem.topic ? <Pill tone="brand">{problem.topic}</Pill> : null}
            {(problem.tags ?? []).map((t) => <Pill key={t}>{t}</Pill>)}
            {problem.status !== 'published' ? <Pill>Draft</Pill> : null}
          </div>

          <Card className="p-4 sm:p-5">
            {problem.statement ? (
              <article className="whitespace-pre-wrap text-[15px] leading-relaxed text-slate-700">
                {problem.statement}
              </article>
            ) : (
              <p className="text-sm text-muted">No statement was written for this problem.</p>
            )}

            <hr className="my-4 border-line" />

            <SectionHead title="Constraints" />
            <dl className="grid gap-2">
              <Constraint k="Time per case"
                v={problem.time_limit_ms.toLocaleString() + ' ms'} />
              <Constraint k="Memory per case" v={memoryMb + ' MB'} />
              <Constraint k="Languages"
                v={(problem.languages ?? []).length
                  ? problem.languages.join(', ') : 'Any offered by the editor'} />
              <Constraint k="Test cases"
                v={problem.tests.length + ' · ' + visible.length + ' visible'} />
            </dl>
          </Card>

          {/* Worked examples come from the visible test cases themselves, so
              what is printed here is exactly what Run will check. The count of
              hidden cases is stated but never their content. */}
          <section>
            <SectionHead title="Examples" />
            {visible.length ? (
              <div className="space-y-2.5">
                {visible.map((t) => (
                  <CodeBlock key={t.id} filename={t.name}>
                    {t.stdin ? (
                      <>
                        <span className="text-slate-500"># stdin</span>{'\n'}
                        {t.stdin}{'\n'}
                      </>
                    ) : null}
                    <span className="text-slate-500"># expected stdout</span>{'\n'}
                    <span className="text-green-300">{t.expected_stdout}</span>
                  </CodeBlock>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted">
                No example is published for this problem &mdash; every case is hidden.
              </p>
            )}
            {hidden ? (
              <p className="mt-2.5 text-[13px] text-muted">
                {hidden} further case{hidden === 1 ? ' is' : 's are'} hidden. Submitting
                checks those too.
              </p>
            ) : null}
          </section>
        </div>

        <div className="min-w-0">
          <OnyxCodeLab problem={problem} />
        </div>
      </div>
    </OnyxShell>
  );
}

/** One constraint. The label is what it is, the value is a figure. */
function Constraint({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-[12.5px] text-muted">{k}</dt>
      <dd className="text-right text-[14.5px] font-semibold tabular-nums">{v}</dd>
    </div>
  );
}
