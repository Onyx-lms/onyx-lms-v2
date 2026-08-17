import Link from 'next/link';
import type { Metadata } from 'next';
import { OnyxShell } from '@/components/onyx-shell';
import {
  Card, Empty, ListRow, Pill, RowList, SectionHead, relativeDue,
} from '@/components/onyx-ui';
import { OnyxReturnedWork, OnyxSubmissionForm } from '@/components/onyx-assignment';
import { ActionButton } from '@/components/onyx-create';
import { navFor } from '@/lib/onyx-nav';
import { requireOnyxSession, onyxApi, onyxApiSafe, type Me } from '@/lib/onyx-session';
import { isStaff, type Assignment } from '@/lib/onyx-learn';

export const metadata: Metadata = { title: 'Assignment' };

/**
 * LRN-04 -- one assignment.
 *
 * A learner sees the brief, the rubric they will be marked against, and their
 * own work. Faculty see the marking queue. The API decides which of those goes
 * in the payload, so this page renders whichever it was given rather than
 * asking for both and hiding one.
 */
export default async function OnyxAssignmentPage({ params }: { params: Promise<{ id: string }> }) {
  const claims = await requireOnyxSession();
  const { id } = await params;
  const [me, assignment] = await Promise.all([
    onyxApi<Me>('/api/onyx/me'),
    onyxApi<Assignment>('/api/onyx/assignments/' + id),
  ]);

  const staff = isStaff(claims.tenant_role);
  const members = staff
    ? await onyxApiSafe<{ user_id: string; user: { name: string; email: string } | null }[]>(
      '/api/onyx/members')
    : null;
  const names = new Map((members ?? []).map((m) => [m.user_id, m.user]));
  const mine = assignment.my_submission ?? null;
  const when = relativeDue(assignment.due_at);
  // Graded but not yet released. What "return all" would actually release.
  const readyToReturn = (assignment.submissions ?? [])
    .filter((sub) => sub.status === 'graded').length;

  return (
    <OnyxShell
      me={me}
      nav={navFor(me.role)}
      title={assignment.title}
      subtitle={when.text}
    >
      <Link href={'/onyx/courses/' + assignment.course_id}
        className="inline-flex items-center gap-1 text-[13px] font-semibold text-muted
                   hover:text-brand-700 hover:underline">
        &larr; Back to the course
      </Link>

      {/* The facts that decide what a learner does next -- when it is due, what
          it is worth, what happens if they are late -- were a subtitle reading
          "Out of 100, due 8/17/2026, 12:00:00 AM". Now they are chips, and the
          late policy is stated rather than discovered by being late. */}
      <div className="mt-4 flex flex-wrap items-center gap-2.5">
        <Pill tone={when.tone}>{when.text}</Pill>
        <Pill tone="neutral">{assignment.total_points} marks</Pill>
        {assignment.late_policy === 'reject' ? (
          <Pill tone="late">Nothing accepted after the deadline</Pill>
        ) : assignment.late_policy === 'penalty' ? (
          <Pill tone="soon">Late work loses {assignment.late_penalty_percent}%</Pill>
        ) : (
          <Pill tone="good">Late work accepted</Pill>
        )}
      </div>

      <div className="mt-6 grid gap-8 lg:grid-cols-[1fr_280px]">
        <div className="space-y-6">
          {assignment.instructions ? (
            <Card className="p-4">
              <h2 className="mb-2 text-[11.5px] font-bold uppercase tracking-[.085em] text-muted">
                The brief
              </h2>
              <article className="whitespace-pre-wrap text-[14.5px] leading-relaxed text-slate-700">
                {assignment.instructions}
              </article>
            </Card>
          ) : null}

          {staff ? (
            <section>
              <div className="mb-2.5 flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-[11.5px] font-bold uppercase tracking-[.085em] text-muted">
                  Submissions &middot; {(assignment.submissions ?? []).length}
                </h2>
                {/* LRN-04b: a score is invisible to the learner until it is
                    returned, so marking thirty papers and releasing them one at
                    a time was thirty chances to release twenty-nine. The API
                    could release the lot and nothing asked it to. */}
                {readyToReturn > 0 ? (
                  <ActionButton
                    endpoint={'assignments/' + id + '/return-all'}
                    label={readyToReturn === 1
                      ? 'Return 1 marked paper'
                      : 'Return all ' + readyToReturn + ' marked papers'}
                    confirm={'Release ' + readyToReturn + ' mark'
                      + (readyToReturn === 1 ? '' : 's')
                      + ' to the learners? They cannot be un-seen.'}
                  />
                ) : null}
              </div>
              {/* A marking queue is a list of people to open one at a time, so
                  the row is the person and the action is marking them. */}
              <RowList label="Submissions">
                {(assignment.submissions ?? []).map((s) => (
                  <ListRow
                    key={s.id}
                    icon={s.status === 'returned' ? 'check' : 'edit'}
                    tone={s.status === 'returned' ? 'good' : s.is_late ? 'late' : 'brand'}
                    title={names.get(s.user_id)?.name ?? ('User ' + s.user_id)}
                    href={'/onyx/submissions/' + s.id}
                    chips={s.is_late ? <Pill tone="late">Late</Pill> : null}
                    meta={s.submitted_at
                      ? 'Handed in ' + new Date(s.submitted_at).toLocaleDateString(undefined,
                        { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
                      : 'Not handed in'}
                    trailing={s.score !== null && s.score !== undefined ? (
                      <span className="text-[15px] font-extrabold tabular-nums">
                        {s.score}
                        <span className="text-[13px] font-semibold text-muted">
                          /{assignment.total_points}
                        </span>
                      </span>
                    ) : (
                      <span className="text-[12.5px] font-semibold capitalize text-muted">
                        {s.status}
                      </span>
                    )}
                    action={{ href: '/onyx/submissions/' + s.id,
                      label: s.status === 'returned' ? 'Review' : 'Mark' }}
                  />
                ))}
                {(assignment.submissions ?? []).length === 0 ? (
                  <li><Empty icon="edit">Nothing has been handed in yet.</Empty></li>
                ) : null}
              </RowList>
            </section>
          ) : (
            <>
              {mine?.returned_at
                ? <OnyxReturnedWork assignment={assignment} submission={mine} />
                : null}
              <OnyxSubmissionForm assignment={assignment} submission={mine} />
            </>
          )}
        </div>

        <aside>
          {assignment.rubric?.length ? (
            <section>
              <SectionHead title="How this is marked" />
              <Card>
                <ul className="divide-y divide-line">
                  {assignment.rubric.map((c) => (
                    <li key={c.id} className="flex items-start justify-between gap-3 px-3.5 py-3">
                      <span className="min-w-0">
                        <span className="block text-[14px] font-semibold">{c.title}</span>
                        {c.description ? (
                          <span className="mt-0.5 block text-[12.5px] leading-relaxed text-muted">
                            {c.description}
                          </span>
                        ) : null}
                      </span>
                      <span className="shrink-0 rounded-lg bg-slate-100 px-2 py-0.5 text-[13px]
                                       font-bold tabular-nums text-slate-700">
                        {c.points}
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="border-t border-line px-3.5 py-2.5 text-[12px] text-muted">
                  The criteria add up to the {assignment.total_points} marks for the whole
                  assignment.
                </p>
              </Card>
            </section>
          ) : null}
        </aside>
      </div>
    </OnyxShell>
  );
}
