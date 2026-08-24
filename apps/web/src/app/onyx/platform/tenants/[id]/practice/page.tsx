import Link from 'next/link';
import type { Metadata } from 'next';
import { requirePlatformSession } from '@/lib/onyx-platform-session';
import {
  attempt, SCROLLER, Unavailable, ago,
  type AcademicsPayload, type PeoplePayload,
} from '@/lib/onyx-platform-tenant';
import { Banner, Card, CardGrid, DataTable, EmptyRow, Pill, SectionHead, StatTile }
  from '@/components/onyx-ui';
import { formatDateTime } from '@/lib/when';
import type { CodeSubmissionFeed, Workspace } from '@/lib/onyx-codelab';

export const metadata: Metadata = { title: 'Practice activity' };

/**
 * What learners at this institution have actually been doing in Code Lab.
 *
 * Two lists, because they are the two halves of the product: hand-ins against
 * the problem bank, and the project workspaces people build in. Neither had a
 * console view at all -- an operator investigating "the grader looks stuck" or
 * "this cohort has done nothing all term" had to sign in as the institution's
 * own administrator to see a single row.
 *
 * Every filter is a GET parameter and goes to the API rather than to a
 * `.filter()` on the response. That matters for more than tidiness: the
 * submission feed is capped server-side, so filtering in the browser would be
 * filtering a truncated list and quietly answering "none" for a learner whose
 * work fell off the end.
 */

const STATE: Record<string, { label: string; tone: 'good' | 'soon' | 'late' | 'neutral' }> = {
  // Keyed by what the grader writes, labelled with what a person calls it:
  // the row says 'done', the chip says Graded.
  done: { label: 'Graded', tone: 'good' },
  queued: { label: 'Queued', tone: 'soon' },
  running: { label: 'Running', tone: 'soon' },
  failed: { label: 'Failed', tone: 'late' },
};

const control = 'mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm '
  + 'focus:border-slate-500 focus:outline-none';
const filterLabel = 'block text-[12px] font-semibold text-slate-700';

interface Query {
  problem_id?: string; user_id?: string; course_id?: string;
  status?: string; language?: string; mode?: string;
  from?: string; to?: string; search?: string;
  /** The workspace table's own filters, kept separate so one form is not two. */
  ws_owner?: string; ws_course?: string; ws_language?: string; ws_search?: string;
}

interface ProblemRow { id: number; title: string; status: string }

export default async function OnyxPlatformPracticePage(
  { params, searchParams }: {
    params: Promise<{ id: string }>; searchParams: Promise<Query>;
  },
) {
  await requirePlatformSession();
  const { id } = await params;
  const q = await searchParams;
  const tenantId = Number(id);
  const base = '/api/onyx/platform/tenants/' + encodeURIComponent(id);
  const here = '/onyx/platform/tenants/' + tenantId + '/practice';

  const feedQuery = new URLSearchParams();
  for (const key of
    ['problem_id', 'user_id', 'course_id', 'status', 'language', 'mode', 'from', 'to', 'search'] as const) {
    const value = q[key];
    if (value?.trim()) feedQuery.set(key, value.trim());
  }
  feedQuery.set('limit', '300');

  const wsQuery = new URLSearchParams();
  if (q.ws_owner?.trim()) wsQuery.set('user_id', q.ws_owner.trim());
  if (q.ws_course?.trim()) wsQuery.set('course_id', q.ws_course.trim());
  if (q.ws_language?.trim()) wsQuery.set('language', q.ws_language.trim());
  if (q.ws_search?.trim()) wsQuery.set('search', q.ws_search.trim());

  const [feed, workspaces, problems, academics, people] = await Promise.all([
    attempt<CodeSubmissionFeed>(base + '/code-submissions?' + feedQuery),
    attempt<Workspace[]>(base + '/workspaces' + (wsQuery.size ? '?' + wsQuery : '')),
    attempt<ProblemRow[]>(base + '/problems'),
    attempt<AcademicsPayload>(base + '/academics?limit=200'),
    // 200 is the endpoint's own maximum -- asking for more is a 422, which
    // attempt() turns into null, which would have emptied both pickers.
    attempt<PeoplePayload>(base + '/people?limit=200'),
  ]);

  const courses = academics?.courses ?? [];
  const courseById = new Map(courses.map((c) => [c.id, c]));
  const everyone = people?.people ?? [];
  const learners = everyone.filter((p) => p.role === 'student');
  const nameOf = new Map(everyone.map((p) => [String(p.user_id), p]));

  const rows = feed?.submissions ?? [];
  const handed = rows.filter((r) => r.mode === 'submit');
  const solved = handed.filter((r) => r.status === 'done' && r.max_score > 0
    && r.score >= r.max_score);
  const waiting = rows.filter((r) => r.status === 'queued' || r.status === 'running');
  const broke = rows.filter((r) => r.status === 'failed');

  // `limit` is always set, so it is not evidence of a filter -- only the
  // caller's own choices are.
  const filteringFeed = [...feedQuery.keys()].some((k) => k !== 'limit');
  const filteringWs = wsQuery.size > 0;
  const wsRows = workspaces ?? [];

  return (
    <div className="min-w-0 space-y-6">
      {broke.length ? (
        <Banner tone="warn" icon="alert">
          <span className="font-bold">{broke.length} submissions failed to grade.</span>{' '}
          The sandbox could not finish them — worth checking before a cohort concludes their
          code was wrong.
        </Banner>
      ) : null}

      <section>
        <SectionHead title={'Practice submissions · ' + rows.length}
          action={{ href: '/onyx/platform/tenants/' + tenantId + '/problems',
            label: 'The problem bank' }} />

        <Card className="mb-4 p-4">
          <form method="GET" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {/* The workspace filters ride along as hidden fields, so submitting
                one form does not silently reset the other table below. */}
            {(['ws_owner', 'ws_course', 'ws_language', 'ws_search'] as const)
              .filter((k) => q[k]?.trim())
              .map((k) => <input key={k} type="hidden" name={k} value={q[k]} />)}

            <div className="sm:col-span-2">
              <label className={filterLabel} htmlFor="s-search">Search</label>
              <input id="s-search" name="search" defaultValue={q.search ?? ''}
                placeholder="Name, roll number or problem" className={control} />
            </div>
            <div>
              <label className={filterLabel} htmlFor="s-problem">Problem</label>
              <select id="s-problem" name="problem_id" defaultValue={q.problem_id ?? ''}
                className={control}>
                <option value="">Any problem</option>
                {(problems ?? []).map((p) => (
                  <option key={p.id} value={p.id}>{p.title}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={filterLabel} htmlFor="s-learner">Learner</label>
              <select id="s-learner" name="user_id" defaultValue={q.user_id ?? ''}
                className={control}>
                <option value="">Anyone</option>
                {learners.map((p) => (
                  <option key={p.user_id} value={p.user_id}>
                    {p.roll_number ? p.roll_number + ' · ' : ''}{p.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={filterLabel} htmlFor="s-course">Course</label>
              <select id="s-course" name="course_id" defaultValue={q.course_id ?? ''}
                className={control}>
                <option value="">Any course</option>
                {courses.map((c) => (
                  <option key={c.id} value={c.id}>{c.code} — {c.title}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={filterLabel} htmlFor="s-status">State</label>
              <select id="s-status" name="status" defaultValue={q.status ?? ''}
                className={control}>
                <option value="">Any state</option>
                {['queued', 'running', 'done', 'failed'].map((s) => (
                  <option key={s} value={s}>{STATE[s]!.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={filterLabel} htmlFor="s-language">Language</label>
              <select id="s-language" name="language" defaultValue={q.language ?? ''}
                className={control}>
                <option value="">Any language</option>
                {(feed?.languages ?? []).map((l) => <option key={l} value={l}>{l}</option>)}
              </select>
            </div>
            <div>
              <label className={filterLabel} htmlFor="s-mode">Kind</label>
              <select id="s-mode" name="mode" defaultValue={q.mode ?? ''} className={control}>
                <option value="">Runs and hand-ins</option>
                <option value="submit">Hand-ins only</option>
                <option value="run">Runs only</option>
              </select>
            </div>
            <div>
              <label className={filterLabel} htmlFor="s-from">From</label>
              <input id="s-from" name="from" type="date" defaultValue={q.from ?? ''}
                className={control} />
            </div>
            <div>
              <label className={filterLabel} htmlFor="s-to">To</label>
              <input id="s-to" name="to" type="date" defaultValue={q.to ?? ''}
                className={control} />
            </div>
            <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-4">
              <button type="submit"
                className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold
                           hover:border-brand-300 hover:text-brand-700">
                Filter
              </button>
              {filteringFeed ? (
                <Link href={here}
                  className="px-2 py-2 text-[12.5px] font-semibold text-muted
                             hover:text-brand-700 hover:underline">
                  Clear
                </Link>
              ) : null}
            </div>
          </form>
        </Card>

        {feed === null ? <Unavailable what="submission list" /> : (
          <>
            {feed.truncated ? (
              <Banner tone="warn" icon="alert">
                Showing the {rows.length} most recent. There are more — narrow it by date, course
                or problem to see the rest.
              </Banner>
            ) : null}

            <CardGrid>
              <StatTile label="Hand-ins" value={handed.length}
                note={rows.length - handed.length + ' runs alongside them'} />
              <StatTile label="Full marks" value={solved.length}
                note={handed.length
                  ? Math.round((solved.length / handed.length) * 100) + '% of hand-ins'
                  : 'None yet'} />
              <StatTile label="Waiting on the grader" value={waiting.length}
                note="queued or running" />
              <StatTile label="Failed to grade" value={broke.length}
                note={broke.length ? 'the sandbox could not finish these' : 'none'} />
            </CardGrid>

            <div tabIndex={0} role="region" aria-label="Practice submissions"
              className={SCROLLER + ' mt-4'}>
              <DataTable
                caption="Practice submissions at this institution, most recent first."
                head={
                  <>
                    <th scope="col">Learner</th>
                    <th scope="col">Problem</th>
                    <th scope="col">Course</th>
                    <th scope="col">Language</th>
                    <th scope="col">Score</th>
                    <th scope="col">State</th>
                    <th scope="col">When</th>
                  </>
                }
              >
                {rows.map((r) => {
                  const state = STATE[r.status] ?? { label: r.status, tone: 'neutral' as const };
                  const course = r.course_id === null ? null : courseById.get(r.course_id);
                  return (
                    <tr key={r.id}>
                      <td className="font-semibold">
                        {r.learner}
                        {r.roll_number ? (
                          <div className="text-xs font-normal text-muted">{r.roll_number}</div>
                        ) : null}
                      </td>
                      <td>
                        <Link
                          href={'/onyx/platform/tenants/' + tenantId + '/problems/' + r.problem_id}
                          className="hover:underline">
                          {r.problem_title}
                        </Link>
                      </td>
                      <td className="text-muted">
                        {course ? course.code : r.course_id === null ? 'No course' : '—'}
                      </td>
                      <td>
                        <Pill>{r.language}</Pill>
                        {r.mode === 'run' ? (
                          <span className="ml-1.5 align-middle">
                            <Pill tone="neutral">Run</Pill>
                          </span>
                        ) : null}
                      </td>
                      <td className="tabular-nums">
                        {r.status === 'done'
                          ? r.score + '/' + r.max_score + ' · ' + r.passed + '/' + r.total
                          : '—'}
                      </td>
                      <td><Pill tone={state.tone}>{state.label}</Pill></td>
                      <td className="whitespace-nowrap text-muted">
                        {formatDateTime(r.graded_at ?? r.queued_at)}
                      </td>
                    </tr>
                  );
                })}
                {rows.length === 0 ? (
                  <EmptyRow colSpan={7} icon="code">
                    {filteringFeed
                      ? 'Nothing matches those filters.'
                      : 'Nobody at this institution has submitted any practice yet.'}
                  </EmptyRow>
                ) : null}
              </DataTable>
            </div>
          </>
        )}
      </section>

      <section>
        <SectionHead title={'Project workspaces · ' + wsRows.length} />

        <Card className="mb-4 p-4">
          <form method="GET" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {(['problem_id', 'user_id', 'course_id', 'status', 'language', 'mode', 'from', 'to',
              'search'] as const)
              .filter((k) => q[k]?.trim())
              .map((k) => <input key={k} type="hidden" name={k} value={q[k]} />)}

            <div className="sm:col-span-2">
              <label className={filterLabel} htmlFor="w-search">Search</label>
              <input id="w-search" name="ws_search" defaultValue={q.ws_search ?? ''}
                placeholder="Project name" className={control} />
            </div>
            <div>
              <label className={filterLabel} htmlFor="w-owner">Owner</label>
              <select id="w-owner" name="ws_owner" defaultValue={q.ws_owner ?? ''}
                className={control}>
                <option value="">Anyone</option>
                {everyone.map((p) => (
                  <option key={p.user_id} value={p.user_id}>
                    {p.roll_number ? p.roll_number + ' · ' : ''}{p.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={filterLabel} htmlFor="w-course">Course</label>
              <select id="w-course" name="ws_course" defaultValue={q.ws_course ?? ''}
                className={control}>
                <option value="">Any course</option>
                <option value="none">Personal projects (no course)</option>
                {courses.map((c) => (
                  <option key={c.id} value={c.id}>{c.code} — {c.title}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={filterLabel} htmlFor="w-language">Language</label>
              <select id="w-language" name="ws_language" defaultValue={q.ws_language ?? ''}
                className={control}>
                <option value="">Any language</option>
                {[...new Set([
                  ...wsRows.map((w) => w.language),
                  ...(q.ws_language ? [q.ws_language] : []),
                ].filter(Boolean))].sort().map((l) => <option key={l} value={l}>{l}</option>)}
              </select>
            </div>
            <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-4">
              <button type="submit"
                className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold
                           hover:border-brand-300 hover:text-brand-700">
                Filter
              </button>
              {filteringWs ? (
                <Link href={here}
                  className="px-2 py-2 text-[12.5px] font-semibold text-muted
                             hover:text-brand-700 hover:underline">
                  Clear
                </Link>
              ) : null}
            </div>
          </form>
        </Card>

        {workspaces === null ? <Unavailable what="workspace list" /> : (
          <div tabIndex={0} role="region" aria-label="Project workspaces" className={SCROLLER}>
            <DataTable
              caption="Every project workspace at this institution, most recently touched first."
              head={
                <>
                  <th scope="col">Project</th>
                  <th scope="col">Owner</th>
                  <th scope="col">Course</th>
                  <th scope="col">Language</th>
                  <th scope="col">Entry file</th>
                  <th scope="col">Last touched</th>
                </>
              }
            >
              {[...wsRows]
                .sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at))
                .map((w) => {
                  const owner = nameOf.get(String(w.user_id));
                  const course = w.course_id === null ? null : courseById.get(w.course_id);
                  return (
                    <tr key={w.id}>
                      <td className="font-semibold">{w.title}</td>
                      <td>
                        {owner ? (
                          <>
                            <div>{owner.name}</div>
                            <div className="text-xs text-muted">
                              {owner.roll_number ?? owner.email}
                            </div>
                          </>
                        ) : 'Unknown'}
                      </td>
                      <td className="text-muted">
                        {course ? course.code : w.course_id === null ? 'Personal project' : '—'}
                      </td>
                      <td><Pill>{w.language}</Pill></td>
                      <td className="font-mono text-[12.5px] text-muted">{w.entry_path}</td>
                      <td className="whitespace-nowrap text-muted">{ago(w.updated_at)}</td>
                    </tr>
                  );
                })}
              {wsRows.length === 0 ? (
                <EmptyRow colSpan={6} icon="layers">
                  {filteringWs
                    ? 'No project matches those filters.'
                    : 'Nobody at this institution has started a project yet.'}
                </EmptyRow>
              ) : null}
            </DataTable>
          </div>
        )}
      </section>
    </div>
  );
}
