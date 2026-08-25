import type { Metadata } from 'next';
import Link from 'next/link';
import { requirePlatformSession } from '@/lib/onyx-platform-session';
import {
  attempt, RosterHeader, WhenCell, SCROLLER, Unavailable, Workflow,
  type AcademicsPayload,
} from '@/lib/onyx-platform-tenant';
import {
  CreateExamForm, ExamEditToggle, ConsoleCreatePaper,
} from '@/components/onyx-platform-forms';
import { DataTable, EmptyRow } from '@/components/onyx-ui';

export const metadata: Metadata = { title: 'Examinations' };

export default async function OnyxPlatformExamsPage(
  { params }: { params: Promise<{ id: string }> },
) {
  await requirePlatformSession();
  const { id } = await params;
  const tenantId = Number(id);
  // No semester list any more: the scheduling form stopped asking which term a
  // sitting belongs to, because the API takes it from the course and 0037
  // allows an exam that belongs to no term at all.
  const academics = await attempt<AcademicsPayload>(
    '/api/onyx/platform/tenants/' + encodeURIComponent(id) + '/academics?limit=200');
  // Published Code Lab problems, so a coding question in the paper builder has
  // something to be marked against. Safe if it fails -- the builder simply
  // does not offer the coding type.
  const problems = (await attempt<{ id: number; title: string; status: string }[]>(
    '/api/onyx/platform/tenants/' + encodeURIComponent(id) + '/problems')) ?? [];
  // The teaching divisions, so a paper or a sitting can be set for one of them
  // rather than for the whole cohort.
  const sections = (await attempt<{ id: number; name: string; status: number }[]>(
    '/api/onyx/platform/tenants/' + encodeURIComponent(id) + '/sections'))
    ?.filter((sx) => sx.status === 1) ?? [];

  const exams = academics?.exams ?? [];
  const courses = academics?.courses ?? [];

  return (
    <div className="min-w-0 space-y-4">
      <RosterHeader count={exams.length} noun="examination"
        action={(
          <div className="flex flex-wrap items-center gap-2">
            {/* Build the paper here, then pick it in the form beside this --
                which is the order somebody scheduling an exam works in, and
                the reason the institution's own screen puts both together. */}
            <ConsoleCreatePaper tenantId={tenantId} courses={courses} problems={problems} />
          <CreateExamForm tenantId={tenantId} courses={courses} sections={sections}
            // So a sitting can be one somebody sits in a browser. Filtered to
            // the chosen course inside the form: the API refuses a paper from
            // another course, and offering one here would be offering
            // something that cannot be saved.
            papers={(academics?.assessments ?? []).map((a) => ({
              id: a.id, title: a.title, course_id: a.course_id, status: a.status,
            }))} />
          </div>
        )} />

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
