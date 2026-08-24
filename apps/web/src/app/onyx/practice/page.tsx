import Link from 'next/link';
import type { Metadata } from 'next';
import { OnyxShell } from '@/components/onyx-shell';
import {
  ActionLink, Buckets, Card, Empty, ListRow, Pill, RowList, SectionHead, Segmented, StackBar,
} from '@/components/onyx-ui';
import { navFor } from '@/lib/onyx-nav';
import { requireOnyxSession, onyxApi, onyxApiSafe, type Me } from '@/lib/onyx-session';
import { isStaff, type Course } from '@/lib/onyx-learn';
import { CreateProblem } from '@/components/onyx-manage';
import type { Problem } from '@/lib/onyx-codelab';

export const metadata: Metadata = { title: 'Practice' };

/** Easy first, hard last -- the order the bank is read in, not alphabetical. */
const DIFFICULTIES = ['easy', 'medium', 'hard'] as const;

/** One meaning per colour, and the same one the row chips use. */
const DIFFICULTY_TONE: Record<string, 'good' | 'soon' | 'late'> = {
  easy: 'good', medium: 'soon', hard: 'late',
};

const DIFFICULTY_BAR = {
  easy: 'bg-green-600', medium: 'bg-accent-500', hard: 'bg-red-600',
} as const;

const cap = (s: string) => (s ? s[0]!.toUpperCase() + s.slice(1) : s);

/** LAB-04 -- the problem bank, by topic and difficulty. */
export default async function OnyxPracticePage({ searchParams }: {
  searchParams: Promise<{ difficulty?: string; topic?: string }>;
}) {
  await requireOnyxSession();
  const q = await searchParams;
  const query = new URLSearchParams();
  if (q.difficulty) query.set('difficulty', q.difficulty);
  if (q.topic) query.set('topic', q.topic);

  const [me, problems] = await Promise.all([
    onyxApi<Me>('/api/onyx/me'),
    onyxApi<Problem[]>('/api/onyx/problems' + (query.size ? '?' + query : '')),
  ]);
  // A course a problem can be tied to -- an admin picks from every course at
  // the institution, faculty from the ones they actually teach (courses?all=1
  // is admin/faculty-only anyway, and /my/courses now includes taught
  // courses, not only enrolled-in ones).
  const courseOptions = isStaff(me.role)
    ? await onyxApiSafe<Course[]>(
      me.role === 'admin' ? '/api/onyx/courses?all=1' : '/api/onyx/my/courses')
    : null;

  const topics = [...new Set(problems.map((p) => p.topic).filter(Boolean))] as string[];

  // The counts belong in the filter label -- you should know what is behind a
  // filter before you spend a click finding out it was empty. They are only
  // shown unfiltered, because a filtered response is the only thing this page
  // is given and counting a subset would print a confidently wrong number.
  const filtered = Boolean(q.difficulty || q.topic);
  const showCounts = !filtered && problems.length > 0;
  const byDifficulty = DIFFICULTIES.map((d) => ({
    difficulty: d,
    count: problems.filter((p) => p.difficulty === d).length,
  }));
  const banded = byDifficulty.reduce((n, b) => n + b.count, 0);

  return (
    <OnyxShell
      me={me}
      nav={navFor(me.role)}
      title="Practice"
      subtitle={isStaff(me.role)
        ? 'The problem bank, drafts included.'
        : 'Work through problems and get graded instantly.'}
      // "Your results" pointed at /onyx/results, which is the grades ledger:
      // exam marks, assessment attempts and transcripts, and not one word
      // about practice. The button promised one thing and delivered another.
      //
      // Staff get two links rather than that one, because they ask two
      // questions. "Learner progress" needs a name chosen before it shows
      // anything, which is the wrong shape for "has anybody handed anything in
      // today" -- so the cohort-wide submission feed is its own destination.
      action={isStaff(me.role) ? (
        <span className="flex flex-wrap items-center gap-2">
          <ActionLink href="/onyx/practice/submissions" label="Submissions" tone="quiet" />
          <ActionLink href="/onyx/practice/results" label="Learner progress" tone="quiet" />
        </span>
      ) : (
        <ActionLink href="/onyx/practice/results" label="Your practice results" tone="quiet" />
      )}
    >
      {/* LAB-04: "curated problems organised by topic and difficulty".
          Left as a draft on creation -- the API refuses to publish a problem
          with no test cases, and at least one of them has to be visible.
          CreateProblem collects everything the API accepts a problem for
          (this used to be three fields out of a dozen) and, on success,
          goes straight to the new problem's own page to set those cases --
          not back to this list, where a freshly-made draft was one more
          row to find. */}
      {isStaff(me.role) ? (
        <div className="mb-6">
          <CreateProblem
            courses={(courseOptions ?? []).map((c) => ({ id: c.id, label: c.code + ' — ' + c.title }))}
          />
        </div>
      ) : null}

      {/* What the bank is made of, before the list makes anyone count rows.
          One bar and its breakdown share an order, so "most of this is medium"
          is a glance rather than a subtraction. */}
      {!filtered && banded > 0 ? (
        <Card className="mb-5 p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <div className="text-[10.5px] font-bold uppercase tracking-[.08em] text-muted">
              Problems in the bank
            </div>
            <div className="text-[26px] font-extrabold leading-none tabular-nums">
              {problems.length}
            </div>
          </div>
          <div className="mt-3">
            <StackBar parts={byDifficulty.map((b) => ({
              value: b.count, className: DIFFICULTY_BAR[b.difficulty],
            }))} />
          </div>
          <Buckets rows={byDifficulty.map((b) => ({
            label: cap(b.difficulty),
            dotClass: DIFFICULTY_BAR[b.difficulty],
            count: Math.round((b.count / banded) * 100) + '%',
            amount: b.count,
          }))} />
        </Card>
      ) : null}

      {/* Filters in the order the question is asked: how hard, then what
          topic. The selected one carries the weight -- the old set drew every
          option with the same border, so which filter was on was a question
          you answered by reading the URL. */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Segmented items={[
          { label: 'All', href: '/onyx/practice', active: !q.difficulty && !q.topic,
            count: showCounts ? problems.length : undefined },
          ...byDifficulty.map((b) => ({
            label: cap(b.difficulty),
            href: '/onyx/practice?difficulty=' + b.difficulty,
            active: q.difficulty === b.difficulty,
            count: showCounts ? b.count : undefined,
          })),
        ]} />
      </div>

      {topics.length ? (
        <div className="mb-5 flex flex-wrap items-center gap-2">
          <span className="text-[11.5px] font-bold uppercase tracking-[.085em] text-muted">
            Topic
          </span>
          {topics.map((t) => (
            <Topic key={t} href={'/onyx/practice?topic=' + encodeURIComponent(t)}
              label={t} on={q.topic === t} />
          ))}
        </div>
      ) : null}

      <SectionHead title={'Problems · ' + problems.length} />

      <RowList label="Problems">
        {problems.map((p) => {
          const draft = p.status !== 'published';
          const tone = DIFFICULTY_TONE[p.difficulty];
          return (
            <ListRow
              key={p.id}
              icon="code"
              tone={draft ? 'neutral' : 'brand'}
              title={p.title}
              href={'/onyx/practice/' + p.id}
              chips={
                <>
                  {/* Difficulty is the thing a learner picks on, so it is a
                      coloured chip and not a lowercase word in a grey column. */}
                  <Pill tone={tone ?? 'neutral'}>{cap(p.difficulty)}</Pill>
                  {draft ? <Pill tone="neutral">Draft</Pill> : null}
                </>
              }
              meta={
                <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  <span>{p.topic ?? 'No topic'}</span>
                  {(p.tags ?? []).slice(0, 3).map((t) => (
                    <span key={t}>· {t}</span>
                  ))}
                  <span>· {(p.time_limit_ms / 1000).toFixed(1)}s per case</span>
                  {(p.languages ?? []).length ? (
                    <span>· {p.languages.join(', ')}</span>
                  ) : null}
                </span>
              }
              action={{ href: '/onyx/practice/' + p.id, label: 'Solve' }}
            />
          );
        })}
        {problems.length === 0 ? (
          <li>
            <Empty icon="code">
              {filtered
                ? 'No problems match that filter.'
                : 'No problems have been published yet.'}
            </Empty>
          </li>
        ) : null}
      </RowList>
    </OnyxShell>
  );
}

/** One topic chip. Selected is filled, not merely outlined differently. */
function Topic({ href, label, on }: { href: string; label: string; on: boolean }) {
  return (
    <Link href={href} aria-current={on ? 'page' : undefined}
      className={'inline-flex min-h-[32px] items-center rounded-2xl px-3 text-[13px] font-semibold '
        + (on
          ? 'bg-brand-600 text-white'
          : 'border border-line bg-white text-slate-700 hover:bg-brand-50')}>
      {label}
    </Link>
  );
}
