import Link from 'next/link';
import type { Metadata } from 'next';
import { requirePlatformSession } from '@/lib/onyx-platform-session';
import {
  attempt, RosterHeader, SCROLLER, Unavailable, type AcademicsPayload,
} from '@/lib/onyx-platform-tenant';
import { ConsoleCreateProblem } from '@/components/onyx-platform-forms';
import { Banner, DataTable, EmptyRow, Pill } from '@/components/onyx-ui';

export const metadata: Metadata = { title: 'Code Lab' };

/**
 * The coding-problem bank, from the console.
 *
 * This section did not exist. The console could READ an institution's
 * published problems -- the paper builder lists them so a coding question has
 * something to be marked against -- but there was no way to create one, so the
 * first coding problem at any institution had to be authored by signing in as
 * that institution's own administrator. An operator setting a customer up
 * could build every other part of their assessment stack from here and then
 * had to stop.
 *
 * A problem is created as a DRAFT and finished on its own page, which is where
 * the test cases live. That is the API's shape, not a UI preference: it
 * refuses to publish a problem with no cases, and refuses to change the cases
 * of a published one.
 */

const DIFFICULTY_TONE: Record<string, 'good' | 'soon' | 'late'> = {
  easy: 'good', medium: 'soon', hard: 'late',
};

interface ConsoleProblemRow {
  id: number; title: string; slug: string; statement: string | null;
  difficulty: string; topic: string | null; tags: string[]; languages: string[];
  course_id: number | null; time_limit_ms: number; memory_limit_kb: number;
  status: string;
}

export default async function OnyxPlatformProblemsPage(
  { params, searchParams }: {
    params: Promise<{ id: string }>;
    searchParams: Promise<{ difficulty?: string; search?: string; course_id?: string }>;
  },
) {
  await requirePlatformSession();
  const { id } = await params;
  const q = await searchParams;
  const tenantId = Number(id);
  const base = '/api/onyx/platform/tenants/' + encodeURIComponent(id);

  const query = new URLSearchParams();
  if (q.difficulty) query.set('difficulty', q.difficulty);
  if (q.search) query.set('search', q.search);
  if (q.course_id) query.set('course_id', q.course_id);

  const [problems, academics] = await Promise.all([
    attempt<ConsoleProblemRow[]>(base + '/problems' + (query.size ? '?' + query : '')),
    attempt<AcademicsPayload>(base + '/academics?limit=200'),
  ]);
  const courses = academics?.courses ?? [];
  const courseById = new Map(courses.map((c) => [c.id, c]));
  const rows = problems ?? [];
  const drafts = rows.filter((p) => p.status !== 'published');
  const filtered = query.size > 0;

  return (
    <div className="min-w-0 space-y-4">
      <RosterHeader count={rows.length} noun="coding problem"
        plural="coding problems"
        action={<ConsoleCreateProblem tenantId={tenantId} courses={courses} />} />

      {/* Said on the list, where it can be acted on -- not at the moment a
          paper builder finds the bank has nothing bindable in it. Only a
          PUBLISHED problem can mark a coding question. */}
      {drafts.length ? (
        <Banner tone="warn" icon="alert">
          <span className="font-bold">
            {drafts.length} {drafts.length === 1 ? 'problem is' : 'problems are'} still a draft
          </span>{' '}
          — {drafts.length === 1 ? 'it is' : 'they are'} invisible to learners and cannot mark a
          coding question. Open {drafts.length === 1 ? 'it' : 'one'} to set its test cases and
          publish it.
        </Banner>
      ) : null}

      <form method="GET" className="flex flex-wrap items-end gap-2">
        <div className="min-w-[16rem] flex-1">
          <label className="block text-[12px] font-semibold text-slate-700" htmlFor="pb-search">
            Search
          </label>
          <input id="pb-search" name="search" defaultValue={q.search ?? ''}
            placeholder="Title or topic"
            className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm
                       focus:border-slate-500 focus:outline-none" />
        </div>
        <div>
          <label className="block text-[12px] font-semibold text-slate-700" htmlFor="pb-diff">
            Difficulty
          </label>
          <select id="pb-diff" name="difficulty" defaultValue={q.difficulty ?? ''}
            className="mt-1 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm
                       focus:border-slate-500 focus:outline-none">
            <option value="">Any</option>
            <option value="easy">Easy</option>
            <option value="medium">Medium</option>
            <option value="hard">Hard</option>
          </select>
        </div>
        <div>
          <label className="block text-[12px] font-semibold text-slate-700" htmlFor="pb-course">
            Course
          </label>
          <select id="pb-course" name="course_id" defaultValue={q.course_id ?? ''}
            className="mt-1 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm
                       focus:border-slate-500 focus:outline-none">
            <option value="">Any course</option>
            {courses.map((c) => (
              <option key={c.id} value={c.id}>{c.code} — {c.title}</option>
            ))}
          </select>
        </div>
        <button type="submit"
          className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold
                     hover:border-brand-300 hover:text-brand-700">
          Filter
        </button>
        {filtered ? (
          <Link href={'/onyx/platform/tenants/' + tenantId + '/problems'}
            className="px-2 py-2 text-[12.5px] font-semibold text-muted hover:text-brand-700
                       hover:underline">
            Clear
          </Link>
        ) : null}
      </form>

      {problems === null ? <Unavailable what="problem bank" /> : (
        <div tabIndex={0} role="region" aria-label="Coding problems" className={SCROLLER}>
          <DataTable
            caption="This institution's coding problems, what they are worth and whether they are live."
            head={
              <>
                <th scope="col">Problem</th>
                <th scope="col">Difficulty</th>
                <th scope="col">Course</th>
                <th scope="col">Languages</th>
                <th scope="col">Limits</th>
                <th scope="col">Status</th>
              </>
            }
          >
            {rows.map((p) => (
              <tr key={p.id}>
                <td>
                  <Link href={'/onyx/platform/tenants/' + tenantId + '/problems/' + p.id}
                    className="font-semibold">
                    {p.title}
                  </Link>
                  <div className="text-xs text-muted">
                    {p.topic ?? 'No topic'}
                    {(p.tags ?? []).length ? ' · ' + p.tags.slice(0, 3).join(', ') : ''}
                  </div>
                </td>
                <td>
                  <Pill tone={DIFFICULTY_TONE[p.difficulty] ?? 'neutral'}>{p.difficulty}</Pill>
                </td>
                <td className="text-muted">
                  {p.course_id === null
                    ? 'No course'
                    : courseById.get(p.course_id)?.code ?? '#' + p.course_id}
                </td>
                <td className="text-muted">
                  {(p.languages ?? []).join(', ') || '—'}
                </td>
                <td className="whitespace-nowrap text-muted tabular-nums">
                  {(p.time_limit_ms / 1000).toFixed(1)}s · {Math.round(p.memory_limit_kb / 1024)}MB
                </td>
                <td>
                  {p.status === 'published'
                    ? <Pill tone="good">Published</Pill>
                    : <Pill tone="neutral">Draft</Pill>}
                </td>
              </tr>
            ))}
            {rows.length === 0 ? (
              <EmptyRow colSpan={6} icon="code">
                {filtered
                  ? 'No problem matches that filter.'
                  : 'No coding problems yet. Add one — it starts as a draft, and its next screen '
                    + 'is where the test cases go.'}
              </EmptyRow>
            ) : null}
          </DataTable>
        </div>
      )}
    </div>
  );
}
