import Link from 'next/link';
import type { Metadata } from 'next';
import { OnyxShell } from '@/components/onyx-shell';
import { Card, Pill } from '@/components/onyx-ui';
import { OnyxGrader } from '@/components/onyx-assignment';
import { navFor } from '@/lib/onyx-nav';
import { requireOnyxPageRole, onyxApi, onyxApiSafe, type Me } from '@/lib/onyx-session';
import type { Assignment, Submission } from '@/lib/onyx-learn';

export const metadata: Metadata = { title: 'Marking' };

/** LRN-04b -- marking one submission against the rubric. */
export default async function OnyxSubmissionPage({ params }: { params: Promise<{ id: string }> }) {
  await requireOnyxPageRole('admin', 'faculty');
  const { id } = await params;

  const [me, submission] = await Promise.all([
    onyxApi<Me>('/api/onyx/me'),
    onyxApi<Submission>('/api/onyx/submissions/' + id),
  ]);
  const assignment = await onyxApi<Assignment>('/api/onyx/assignments/' + submission.assignment_id);
  const members = await onyxApiSafe<{ user_id: string; user: { name: string } | null }[]>(
    '/api/onyx/members');
  const name = (members ?? []).find((m) => m.user_id === submission.user_id)?.user?.name
    ?? 'User ' + submission.user_id;
  const initials = name.slice(0, 2).toUpperCase();

  return (
    <OnyxShell
      me={me}
      nav={navFor(me.role)}
      title={assignment.title}
      subtitle={name + ', attempt ' + submission.attempt + (submission.is_late ? ', submitted late' : '')}
    >
      <Link href={'/onyx/assignments/' + submission.assignment_id}
        className="inline-flex items-center gap-1 text-[13px] font-semibold text-muted
                   hover:text-brand-700 hover:underline">
        &larr; Back to the assignment
      </Link>

      <div className="mt-6 grid gap-8 lg:grid-cols-[1fr_380px]">
        <Card className="overflow-hidden">
          <div className="flex flex-wrap items-center gap-3 border-b border-line bg-slate-50 px-4 py-3.5">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full
                             bg-brand-100 text-[12.5px] font-bold text-brand-700">
              {initials}
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[14px] font-semibold">{name}</div>
              <div className="text-[12.5px] text-muted">
                {submission.submitted_at
                  ? 'Handed in ' + new Date(submission.submitted_at).toLocaleString(undefined,
                    { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
                  : 'Not handed in'}
              </div>
            </div>
            {submission.is_late ? <Pill tone="late">Late</Pill> : null}
          </div>
          <article className="whitespace-pre-wrap p-4 text-[14.5px] leading-relaxed text-slate-700">
            {submission.body || 'Nothing was written.'}
          </article>
        </Card>
        <OnyxGrader
          submission={submission}
          rubric={assignment.rubric ?? []}
          totalPoints={assignment.total_points}
        />
      </div>
    </OnyxShell>
  );
}
