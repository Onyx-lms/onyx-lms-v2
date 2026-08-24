import type { Metadata } from 'next';
import Link from 'next/link';
import { requirePlatformSession } from '@/lib/onyx-platform-session';
import {
  attempt, RosterHeader, WhenCell, SCROLLER, Unavailable, Workflow,
  type AcademicsPayload, type Semester,
} from '@/lib/onyx-platform-tenant';
import { CreateExamForm, ExamEditToggle } from '@/components/onyx-platform-forms';
import { DataTable, EmptyRow } from '@/components/onyx-ui';

export const metadata: Metadata = { title: 'Examinations' };

export default async function OnyxPlatformExamsPage(
  { params }: { params: Promise<{ id: string }> },
) {
  await requirePlatformSession();
  const { id } = await params;
  const tenantId = Number(id);
  const [academics, semesters] = await Promise.all([
    attempt<AcademicsPayload>(
      '/api/onyx/platform/tenants/' + encodeURIComponent(id) + '/academics?limit=200'),
    attempt<Semester[]>('/api/onyx/platform/tenants/' + encodeURIComponent(id) + '/semesters'),
  ]);
  const exams = academics?.exams ?? [];
  const courses = academics?.courses ?? [];

  return (
    <div className="min-w-0 space-y-4">
      <RosterHeader count={exams.length} noun="examination"
        action={<CreateExamForm tenantId={tenantId} courses={courses} semesters={semesters ?? []} />} />

      {academics === null ? <Unavailable what="examination list" /> : (
        <div tabIndex={0} role="region" aria-label="Examinations" className={SCROLLER}>
          <DataTable
            caption="Examinations scheduled at this institution, with seating and marking progress."
            head={
              <>
                <th scope="col">Exam</th>
                <th scope="col">Course</th>
                <th scope="col">When</th>
                <th scope="col">Out of</th>
                <th scope="col">Seated</th>
                <th scope="col">Marks</th>
                <th scope="col">Status</th>
                <th scope="col">&nbsp;</th>
              </>
            }
          >
            {exams.length === 0 ? (
              <EmptyRow colSpan={8} icon="award">
                No examinations scheduled. A paper needs a course, a start time and a
                mark scheme before it can hold candidates.
              </EmptyRow>
            ) : exams.map((e) => (
              <tr key={e.id} className="align-top">
                <td>
                  {/* Opens onto the mark sheet, the seating, and -- where the
                      sitting is tied to an online paper -- every attempt on
                      it, with responses and the invigilation record. */}
                  <Link href={'/onyx/platform/tenants/' + tenantId + '/examinations/' + e.id}
                    className="font-semibold hover:underline">
                    {e.title}
                  </Link>
                </td>
                <td className="font-mono text-[12.5px]">
                  {e.course?.code ?? <span className="font-sans text-muted">—</span>}
                </td>
                <td><WhenCell at={e.starts_at} status={e.status} /></td>
                <td className="tabular-nums">{e.max_marks}</td>
                <td className="tabular-nums">{e.seats_allocated}</td>
                <td className="whitespace-nowrap tabular-nums">
                  {e.marks_entered}
                  <span className="text-[12.5px] text-muted"> ({e.marks_published} published)</span>
                </td>
                <td><Workflow status={e.status} /></td>
                <td className="text-right"><ExamEditToggle tenantId={tenantId} exam={e} /></td>
              </tr>
            ))}
          </DataTable>
        </div>
      )}
    </div>
  );
}
