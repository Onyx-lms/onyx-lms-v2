import Link from 'next/link';
import type { Metadata } from 'next';
import { requirePlatformSession } from '@/lib/onyx-platform-session';
import {
  attempt, DueCell, SCROLLER, Unavailable, Workflow, type AcademicsPayload,
} from '@/lib/onyx-platform-tenant';
import {
  CreateAssignmentForm, AssignmentEditToggle, AssignmentSubmissionsToggle,
} from '@/components/onyx-platform-forms';
import { DataTable, EmptyRow } from '@/components/onyx-ui';

export const metadata: Metadata = { title: 'Assignments' };

export default async function OnyxPlatformAssignmentsPage(
  { params }: { params: Promise<{ id: string }> },
) {
  await requirePlatformSession();
  const { id } = await params;
  const tenantId = Number(id);
  const academics = await attempt<AcademicsPayload>(
    '/api/onyx/platform/tenants/' + encodeURIComponent(id) + '/academics?limit=200');
  const assignments = academics?.assignments ?? [];
  const courses = academics?.courses ?? [];

  return (
    <div className="min-w-0 space-y-4">
      {/* Assignments live under Courses now, not their own nav entry -- see
          onyx-platform-tenant-nav.tsx. Back goes there, not to the
          institution root, since that is genuinely where this was reached
          from. */}
      <Link href={'/onyx/platform/tenants/' + tenantId + '/courses'}
        className="inline-flex items-center gap-1 text-[13px] font-semibold text-muted
                   hover:text-brand-700 hover:underline">
        &larr; Courses
      </Link>
      <CreateAssignmentForm tenantId={tenantId} courses={courses} />

      {academics === null ? <Unavailable what="assignment list" /> : (
        <div tabIndex={0} role="region" aria-label="Assignments" className={SCROLLER}>
          <DataTable
            caption="Assignments set at this institution, when they are due and how much has come back."
            head={
              <>
                <th scope="col">Assignment</th>
                <th scope="col">Course</th>
                <th scope="col">Due</th>
                <th scope="col">Out of</th>
                <th scope="col">Submitted</th>
                <th scope="col">Status</th>
                <th scope="col">&nbsp;</th>
              </>
            }
          >
            {assignments.length === 0 ? (
              <EmptyRow colSpan={7} icon="edit">
                Nothing has been set. Assignments belong to a course, so this stays
                empty until this institution has one with work on it.
              </EmptyRow>
            ) : assignments.map((a) => (
              <tr key={a.id} className="align-top">
                <td className="font-semibold">{a.title}</td>
                <td className="font-mono text-[12.5px]">
                  {a.course?.code ?? <span className="font-sans text-muted">—</span>}
                </td>
                <td><DueCell at={a.due_at} /></td>
                <td className="tabular-nums">{a.total_points}</td>
                <td className="whitespace-nowrap tabular-nums">
                  {a.submission_count}
                  <span className="text-[12.5px] text-muted"> ({a.graded_count} graded)</span>
                </td>
                <td><Workflow status={a.status} /></td>
                <td className="text-right">
                  <div className="flex flex-col items-end gap-1">
                    <AssignmentEditToggle tenantId={tenantId} assignment={a} />
                    <AssignmentSubmissionsToggle tenantId={tenantId} assignmentId={a.id} />
                  </div>
                </td>
              </tr>
            ))}
          </DataTable>
        </div>
      )}
    </div>
  );
}
