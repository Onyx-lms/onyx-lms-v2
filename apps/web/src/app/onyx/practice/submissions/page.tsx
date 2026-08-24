import Link from 'next/link';
import type { Metadata } from 'next';
import { OnyxShell } from '@/components/onyx-shell';
import { navFor } from '@/lib/onyx-nav';
import { requireOnyxSession, onyxApi, onyxApiSafe, type Me } from '@/lib/onyx-session';
import { isStaff, type Course } from '@/lib/onyx-learn';
import type { CodeSubmissionFeed, Problem } from '@/lib/onyx-codelab';
import {
  Banner, Card, CardGrid, DataTable, EmptyRow, Icon, Pill, SectionHead, StatTile,
} from '@/components/onyx-ui';
import { formatDateTime } from '@/lib/when';

export const metadata: Metadata = { title: 'Practice submissions' };

/**
 * LAB-04 -- every practice hand-in at the institution, filtered.
 *
 * The screen that was missing. Practice could be read one problem at a time
 * (`/onyx/practice/[id]`, which lists that problem's attempts) or one learner
 * at a time (`/onyx/practice/results?student=…`), and both need the thing being
 * asked about chosen up front. Neither answers the question staff actually
 * arrive with -- "who has been handing work in, on what, and how did it go" --
 * so a tutor wanting to see today's submissions had to guess a problem, and an
 * administrator checking the grader was still running had nowhere to look at
 * all.
 *
 * A GET form, so every filter lands in the URL. That is not a detail: a view
 * of "failed submissions on CS101 this week" is the kind of thing somebody
 * sends to a colleague, and a filter held in component state cannot be sent.
 */

const STATE: Record<string, { label: string; tone: 'good' | 'soon' | 'late' | 'neutral' }> = {
  // Keyed by what the grader writes, labelled with what a person calls it:
  // the row says 'done', the chip says Graded.
  done: { label: 'Graded', tone: 'good' },
  queued: { label: 'Queued', tone: 'soon' },
  running: { label: 'Running', tone: 'soon' },
  failed: { label: 'Failed', tone: 'late' },
};

const DIFFICULTY_TONE: Record<string, 'good' | 'soon' | 'late'> = {
  easy: 'good', medium: 'soon', hard: 'late',
};

const control = 'mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm '
  + 'focus:border-brand-600 focus:outline-none';
const labelClass = 'block text-[12px] font-semibold text-slate-700';

interface Member {
  user_id: string; roll_number: string | null;
  user: { name: string; email: string } | null;
}

/** The filters this page understands, all of them optional. */
interface Query {
  problem_id?: string; user_id?: string; course_id?: string;
  status?: string; language?: string; mode?: string;
  from?: string; to?: string; search?: string;
}

/** Only the filters that were actually set, so the URL stays readable. */
function queryOf(q: Query): URLSearchParams {
  const out = new URLSearchParams();
  for (const [key, value] of Object.entries(q)) {
    if (typeof value === 'string' && value.trim()) out.set(key, value.trim());
  }
  return out;
}

export default async function OnyxPracticeSubmissionsPage(
  { searchParams }: { searchParams: Promise<Query> },
) {
  await requireOnyxSession();
  const q = await searchParams;
  const me = await onyxApi<Me>('/api/onyx/me');

  // A learner has no business on a cohort-wide list, and the API refuses them
  // anyway -- so they are sent to their own record rather than shown an
  // "unavailable" box for a page that was never theirs.
  if (!isStaff(me.role)) {
    return (
      <OnyxShell me={me} nav={navFor(me.role)} title="Practice submissions">
        <Card className="p-6">
          <p className="text-[14px]">
            This list is for the people teaching. Your own hand-ins are on{' '}
            <Link href="/onyx/practice/results" className="font-semibold text-brand-700 underline">
              your practice results
            </Link>.
          </p>
        </Card>
      </OnyxShell>
    );
  }

  const params = queryOf(q);
  const [feed, problems, members, courses] = await Promise.all([
    onyxApiSafe<CodeSubmissionFeed>(
      '/api/onyx/practice/submissions' + (params.size ? '?' + params : '')),
    onyxApiSafe<Problem[]>('/api/onyx/problems'),
    onyxApiSafe<Member[]>('/api/onyx/members?role=student'),
    onyxApiSafe<Course[]>(
      me.role === 'admin' ? '/api/onyx/courses?all=1' : '/api/onyx/my/courses'),
  ]);

  const rows = feed?.submissions ?? [];
  const courseById = new Map((courses ?? []).map((c) => [c.id, c]));
  const filtered = params.size > 0;

  // Counted off what came back, so the tiles describe the list being read
  // rather than the institution as a whole -- which would be a different
  // number sitting above a filtered table, and read as a contradiction.
  const handed = rows.filter((r) => r.mode === 'submit');
  const solved = handed.filter((r) => r.status === 'done' && r.max_score > 0
    && r.score >= r.max_score);
  const waiting = rows.filter((r) => r.status === 'queued' || r.status === 'running');
  const broke = rows.filter((r) => r.status === 'failed');

  return (
    <OnyxShell
      me={me}
      nav={navFor(me.role)}
      title="Practice submissions"
      subtitle="Every hand-in in Code Lab, narrowed to the ones you want to look at."
      action={(
        <Link href="/onyx/practice"
          className="inline-flex items-center gap-1.5 rounded-xl border border-line px-3 py-2
                     text-[13px] font-semibold hover:bg-canvas">
          <Icon name="code" className="h-4 w-4" />
          The problem bank
        </Link>
      )}
    >
      <Card className="mb-5 p-4">
        {/* GET, so the filters are in the URL and the view can be linked,
            bookmarked and reloaded. */}
        <form method="GET" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="sm:col-span-2">
            <label className={labelClass} htmlFor="f-search">Search</label>
            <input id="f-search" name="search" defaultValue={q.search ?? ''}
              placeholder="Name, roll number or problem" className={control} />
          </div>
          <div>
            <label className={labelClass} htmlFor="f-problem">Problem</label>
            <select id="f-problem" name="problem_id" defaultValue={q.problem_id ?? ''}
              className={control}>
              <option value="">Any problem</option>
              {(problems ?? []).map((p) => (
                <option key={p.id} value={p.id}>{p.title}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass} htmlFor="f-student">Learner</label>
            <select id="f-student" name="user_id" defaultValue={q.user_id ?? ''}
              className={control}>
              <option value="">Anyone</option>
              {(members ?? []).map((m) => (
                <option key={m.user_id} value={m.user_id}>
                  {m.roll_number ? m.roll_number + ' · ' : ''}{m.user?.name ?? m.user_id}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass} htmlFor="f-course">Course</label>
            <select id="f-course" name="course_id" defaultValue={q.course_id ?? ''}
              className={control}>
              <option value="">Any course</option>
              {(courses ?? []).map((c) => (
                <option key={c.id} value={c.id}>{c.code} — {c.title}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass} htmlFor="f-status">State</label>
            <select id="f-status" name="status" defaultValue={q.status ?? ''} className={control}>
              <option value="">Any state</option>
              {['queued', 'running', 'done', 'failed'].map((s) => (
                <option key={s} value={s}>{STATE[s]!.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass} htmlFor="f-language">Language</label>
            <select id="f-language" name="language" defaultValue={q.language ?? ''}
              className={control}>
              <option value="">Any language</option>
              {/* What this institution has actually used, not everything the
                  sandbox supports -- a menu of twelve languages nobody here
                  writes is a menu of eleven empty results. */}
              {(feed?.languages ?? []).map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
          </div>
          <div>
            <label className={labelClass} htmlFor="f-mode">Kind</label>
            <select id="f-mode" name="mode" defaultValue={q.mode ?? ''} className={control}>
              <option value="">Runs and hand-ins</option>
              <option value="submit">Hand-ins only</option>
              <option value="run">Runs only</option>
            </select>
          </div>
          <div>
            <label className={labelClass} htmlFor="f-from">From</label>
            <input id="f-from" name="from" type="date" defaultValue={q.from ?? ''}
              className={control} />
          </div>
          <div>
            <label className={labelClass} htmlFor="f-to">To</label>
            <input id="f-to" name="to" type="date" defaultValue={q.to ?? ''}
              className={control} />
          </div>

          <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-4">
            <button type="submit"
              className="rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-bold text-white
                         hover:bg-brand-700">
              Show these
            </button>
            {filtered ? (
              <Link href="/onyx/practice/submissions"
                className="rounded-xl border border-line px-4 py-2.5 text-sm font-semibold
                           hover:bg-canvas">
                Clear
              </Link>
            ) : null}
          </div>
        </form>
      </Card>

      {feed === null ? (
        <Banner tone="warn" icon="alert">
          The submission list could not be loaded. Nothing has been changed — try again.
        </Banner>
      ) : (
        <>
          {feed.truncated ? (
            <Banner tone="warn" icon="alert">
              Showing the {rows.length} most recent. There are more than this — narrow it with a
              date range, a course or a problem to see the rest.
            </Banner>
          ) : null}

          <CardGrid>
            <StatTile label="Hand-ins" value={handed.length}
              note={rows.length - handed.length + ' runs alongside them'} />
            <StatTile label="Full marks" value={solved.length}
              note={handed.length ? Math.round((solved.length / handed.length) * 100) + '% of hand-ins' : 'None yet'} />
            <StatTile label="Waiting on the grader" value={waiting.length}
              note="queued or running" />
            <StatTile label="Failed to grade" value={broke.length}
              note={broke.length ? 'the sandbox could not finish these' : 'none'} />
          </CardGrid>

          <section className="mt-6">
            <SectionHead title={'Submissions · ' + rows.length} />
            <DataTable
              caption="Practice submissions, most recent first, with who handed each one in."
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
                    <td>
                      <Link href={'/onyx/submissions/' + r.id} className="font-semibold">
                        {r.learner}
                      </Link>
                      {r.roll_number ? (
                        <div className="text-xs text-muted">{r.roll_number}</div>
                      ) : null}
                    </td>
                    <td>
                      <Link href={'/onyx/practice/' + r.problem_id} className="hover:underline">
                        {r.problem_title}
                      </Link>
                      {r.difficulty ? (
                        <span className="ml-2 align-middle">
                          <Pill tone={DIFFICULTY_TONE[r.difficulty] ?? 'neutral'}>
                            {r.difficulty}
                          </Pill>
                        </span>
                      ) : null}
                    </td>
                    <td className="text-muted">
                      {course ? course.code : r.course_id === null ? 'No course' : '—'}
                    </td>
                    <td>
                      <Pill>{r.language}</Pill>
                      {/* A Run is not an attempt at the problem -- said on the
                          row, because a list mixing the two otherwise makes a
                          careful learner look like a busy one. */}
                      {r.mode === 'run' ? (
                        <span className="ml-1.5 align-middle">
                          <Pill tone="neutral">Run</Pill>
                        </span>
                      ) : null}
                    </td>
                    <td className="tabular-nums">
                      {r.status === 'done'
                        ? r.score + '/' + r.max_score + ' · ' + r.passed + '/' + r.total + ' cases'
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
                  {filtered
                    ? 'Nothing matches those filters. Widen the date range or clear them.'
                    : 'Nobody has submitted any practice yet.'}
                </EmptyRow>
              ) : null}
            </DataTable>
          </section>
        </>
      )}
    </OnyxShell>
  );
}
