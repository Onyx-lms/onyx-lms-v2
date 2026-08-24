import Link from 'next/link';
import type { Metadata } from 'next';
import { OnyxShell } from '@/components/onyx-shell';
import { navFor } from '@/lib/onyx-nav';
import { requireOnyxSession, onyxApi, onyxApiSafe, type Me } from '@/lib/onyx-session';
import { isStaff } from '@/lib/onyx-learn';
import type { PracticeResult } from '@/lib/onyx-codelab';
import {
  Card, CardGrid, Empty, Icon, ListRow, Pill, RowList, SectionHead, StatTile,
} from '@/components/onyx-ui';
import { formatDateTime } from '@/lib/when';

export const metadata: Metadata = { title: 'Practice results' };

/**
 * LAB-04 -- how practice is actually going, for one person.
 *
 * This page exists because the Practice screen's "Your results" button went to
 * `/onyx/results`, which is the grades ledger: exam marks, assessment attempts
 * and transcripts, and not one word about Code Lab. Somebody who had just spent
 * an hour on problems and pressed the obvious button landed on a page with
 * nothing of theirs on it.
 *
 * One page, two readings, because it is one question asked by two people. A
 * learner asks "where am I up to"; a tutor asks "where is this learner up to,
 * and who set the problems they are stuck on". The second needs a name to
 * ask about, so staff get a picker and nothing until they choose -- a default
 * of "the first student alphabetically" would be a page that looks like an
 * answer to a question nobody asked.
 */

interface Member { user_id: string; roll_number: string | null;
  user: { name: string; email: string } | null }
interface Learner { user_id: string; name: string; roll_number: string | null }

const TONE: Record<string, 'good' | 'soon' | 'late'> = {
  easy: 'good', medium: 'soon', hard: 'late',
};

export default async function OnyxPracticeResultsPage(
  { searchParams }: { searchParams: Promise<{ student?: string }> },
) {
  await requireOnyxSession();
  const { student } = await searchParams;
  const me = await onyxApi<Me>('/api/onyx/me');
  const staff = isStaff(me.role);

  // Staff read somebody else's record and need to say whose. A learner's own
  // is the only one they can ask for -- the endpoint takes no parameter.
  const [results, members] = await Promise.all([
    staff
      ? (student
        ? onyxApiSafe<{ learner: Learner | null; results: PracticeResult[] }>(
          '/api/onyx/practice/results/' + student)
        : Promise.resolve(null))
      : onyxApiSafe<PracticeResult[]>('/api/onyx/practice/results'),
    staff ? onyxApiSafe<Member[]>('/api/onyx/members?role=student') : Promise.resolve(null),
  ]);

  // Staff get { learner, results }; a learner gets their own rows directly.
  const staffView = staff ? results as { learner: Learner | null; results: PracticeResult[] } | null : null;
  const rows = (staff ? staffView?.results : results as PracticeResult[] | null) ?? [];
  const learner = staffView?.learner ?? null;
  const solved = rows.filter((r) => r.solved).length;
  const chosen = (members ?? []).find((m) => m.user_id === student);

  return (
    <OnyxShell
      me={me} nav={navFor(me.role)}
      title="Practice results"
      subtitle={staff
        ? 'What a learner has solved, and who set each problem.'
        : 'Every problem you have handed in, and how it went.'}
      action={
        <span className="flex flex-wrap items-center gap-2">
          {staff ? (
            <Link href="/onyx/practice/submissions"
              className="inline-flex items-center gap-1.5 rounded-xl border border-line px-3 py-2
                         text-[13px] font-semibold hover:bg-canvas">
              <Icon name="list" className="h-4 w-4" />
              All submissions
            </Link>
          ) : null}
          <Link href="/onyx/practice"
            className="inline-flex items-center gap-1.5 rounded-xl border border-line px-3 py-2
                       text-[13px] font-semibold hover:bg-canvas">
            <Icon name="code" className="h-4 w-4" />
            Back to practice
          </Link>
        </span>
      }
    >
      {staff ? (
        <Card className="mb-4 p-4">
          {/* A GET form, so the choice lands in the URL and the page can be
              linked, bookmarked and reloaded -- which matters for something a
              tutor will want to send to a colleague. */}
          <form method="GET" className="flex flex-wrap items-end gap-3">
            <div className="min-w-[240px] flex-1">
              <label className="block text-[13px] font-semibold text-slate-700"
                htmlFor="student">
                Learner
              </label>
              <select id="student" name="student" defaultValue={student ?? ''}
                className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2
                           text-sm focus:border-brand-600 focus:outline-none">
                <option value="">Choose a learner…</option>
                {(members ?? []).map((m) => (
                  <option key={m.user_id} value={m.user_id}>
                    {m.roll_number ? m.roll_number + ' · ' : ''}
                    {m.user?.name ?? m.user_id}{m.user?.email ? ' — ' + m.user.email : ''}
                  </option>
                ))}
              </select>
            </div>
            <button type="submit"
              className="rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-bold text-white
                         hover:bg-brand-700">
              Show
            </button>
          </form>
        </Card>
      ) : null}

      {staff && !student ? (
        <Card className="p-0">
          <Empty icon="users">
            Choose a learner to see which problems they have solved, and who set them.
          </Empty>
        </Card>
      ) : rows.length === 0 ? (
        <Card className="p-0">
          <Empty icon="code">
            {staff
              ? (learner?.name ?? chosen?.user?.name ?? 'This learner')
                + ' has not handed in any practice yet.'
              : 'You have not handed in any practice yet. Solve a problem and it appears here.'}
          </Empty>
        </Card>
      ) : (
        <>
          <CardGrid>
            <StatTile label="Solved" value={solved}
              note={'of ' + rows.length + ' attempted'} />
            <StatTile label="Attempts" value={rows.reduce((n, r) => n + r.attempts, 0)}
              note="hand-ins, not test runs" />
            <StatTile label="Still open" value={rows.length - solved}
              note="tried but not passing" />
          </CardGrid>

          <section className="mt-6">
            <SectionHead title={staff && (learner || chosen)
              ? (learner?.roll_number ? learner.roll_number + ' · ' : '')
                + (learner?.name ?? chosen?.user?.name ?? 'This learner') + '’s problems'
              : 'Your problems'} />
            <RowList label="Practice results">
              {rows.map((r) => (
                <ListRow
                  key={r.problem_id}
                  icon={r.solved ? 'check' : r.pending ? 'clock' : 'code'}
                  tone={r.solved ? 'good' : r.pending ? 'neutral' : 'late'}
                  title={r.title}
                  href={'/onyx/practice/' + r.problem_id}
                  meta={
                    <>
                      {r.attempts} {r.attempts === 1 ? 'attempt' : 'attempts'}
                      {r.max_score > 0 ? ' · best ' + r.best_score + '/' + r.max_score : ''}
                      {r.last_attempt_at ? ' · ' + formatDateTime(r.last_attempt_at) : ''}
                      {/* Only ever present on the staff read. */}
                      {r.author ? ' · set by ' + r.author : ''}
                    </>
                  }
                  chips={
                    <>
                      <Pill tone={TONE[r.difficulty] ?? 'neutral'}>{r.difficulty}</Pill>
                      {r.solved ? <Pill tone="good">Solved</Pill> : null}
                      {r.pending ? <Pill tone="soon">Grading</Pill> : null}
                    </>
                  }
                />
              ))}
            </RowList>
          </section>
        </>
      )}
    </OnyxShell>
  );
}
