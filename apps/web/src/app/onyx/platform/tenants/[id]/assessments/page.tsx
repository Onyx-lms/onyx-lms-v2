import type { Metadata } from 'next';
import { requirePlatformSession } from '@/lib/onyx-platform-session';
import {
  attempt, RosterHeader, WhenCell, SCROLLER, Unavailable, Workflow, type AcademicsPayload,
} from '@/lib/onyx-platform-tenant';
import { CreateAssessmentForm, AssessmentEditToggle } from '@/components/onyx-platform-forms';
import { DataTable, EmptyRow } from '@/components/onyx-ui';

export const metadata: Metadata = { title: 'Assessments' };

export default async function OnyxPlatformAssessmentsPage(
  { params }: { params: Promise<{ id: string }> },
) {
  await requirePlatformSession();
  const { id } = await params;
  const tenantId = Number(id);
  const academics = await attempt<AcademicsPayload>(
    '/api/onyx/platform/tenants/' + encodeURIComponent(id) + '/academics?limit=200');
  const assessments = academics?.assessments ?? [];
  const courses = academics?.courses ?? [];

  return (
    <div className="min-w-0 space-y-4">
      <RosterHeader count={assessments.length} noun="assessment"
        action={<CreateAssessmentForm tenantId={tenantId} courses={courses} />} />

      {academics === null ? <Unavailable what="assessment list" /> : (
        <div tabIndex={0} role="region" aria-label="Assessments" className={SCROLLER}>
          <DataTable
            caption="Assessments at this institution, when they close and how many attempts have been sat."
            head={
              <>
                <th scope="col">Assessment</th>
                <th scope="col">Course</th>
                <th scope="col">Closes</th>
                <th scope="col">Attempts</th>
                <th scope="col">Status</th>
                <th scope="col">&nbsp;</th>
              </>
            }
          >
            {assessments.length === 0 ? (
              <EmptyRow colSpan={6} icon="award">
                No assessments. Nothing here has been put in front of a candidate yet.
              </EmptyRow>
            ) : assessments.map((a) => (
              <tr key={a.id} className="align-top">
                <td>
                  <div className="font-semibold">{a.title}</div>
                  <div className="text-[12.5px] text-muted">
                    {a.duration_minutes} min{a.pass_mark == null ? '' : ' · pass ' + a.pass_mark}
                  </div>
                </td>
                <td className="font-mono text-[12.5px]">
                  {a.course?.code ?? <span className="font-sans text-muted">—</span>}
                </td>
                <td><WhenCell at={a.closes_at} status={a.status} /></td>
                <td className="whitespace-nowrap tabular-nums">
                  {a.attempt_count}
                  <span className="text-[12.5px] text-muted"> ({a.submitted_count} sat)</span>
                </td>
                <td><Workflow status={a.status} /></td>
                <td className="text-right"><AssessmentEditToggle tenantId={tenantId} assessment={a} /></td>
              </tr>
            ))}
          </DataTable>
        </div>
      )}
    </div>
  );
}
