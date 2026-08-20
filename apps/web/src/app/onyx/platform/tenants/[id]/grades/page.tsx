import Link from 'next/link';
import type { Metadata } from 'next';
import { requirePlatformSession } from '@/lib/onyx-platform-session';
import {
  attempt, WhenCell, SCROLLER, Unavailable, Workflow, type AcademicsPayload,
} from '@/lib/onyx-platform-tenant';
import { DataTable, EmptyRow } from '@/components/onyx-ui';

export const metadata: Metadata = { title: 'Grades' };

/**
 * Grades used to be one flat table: the institution's 200 most recent marks,
 * exams and assessments mixed together, sorted by when each was recorded --
 * a feed of individual student rows with no sense of which paper any of them
 * belonged to. An operator wanting "how did CS101's midterm go" had to scan
 * for it by eye in a list sorted by something else entirely.
 *
 * This is the same drill-down every other platform screen already uses:
 * pick the exam or assessment first (from the same lists Examinations and
 * Assessments already show), then see its grades. See grades/exams/[examId]
 * and grades/assessments/[assessmentId].
 */
export default async function OnyxPlatformGradesPage(
  { params }: { params: Promise<{ id: string }> },
) {
  await requirePlatformSession();
  const { id } = await params;
  const tenantId = Number(id);
  const academics = await attempt<AcademicsPayload>(
    '/api/onyx/platform/tenants/' + encodeURIComponent(id) + '/academics?limit=200');
  const exams = academics?.exams ?? [];
  const assessments = academics?.assessments ?? [];

  return (
    <div className="min-w-0 space-y-6">
      <p className="max-w-prose text-[13px] text-muted">
        Pick an examination or an assessment below to see who sat it and what they scored.
      </p>

      {academics === null ? <Unavailable what="grades" /> : (
        <>
          <section className="min-w-0 space-y-2">
            <h2 className="text-[13px] font-bold text-slate-700">Examinations</h2>
            <div tabIndex={0} role="region" aria-label="Examinations" className={SCROLLER}>
              <DataTable
                caption="Examinations at this institution -- pick one to see its grades."
                head={
                  <>
                    <th scope="col">Exam</th>
                    <th scope="col">Course</th>
                    <th scope="col">When</th>
                    <th scope="col">Marks</th>
                    <th scope="col">Status</th>
                    <th scope="col">&nbsp;</th>
                  </>
                }
              >
                {exams.length === 0 ? (
                  <EmptyRow colSpan={6} icon="award">
                    No examinations scheduled yet.
                  </EmptyRow>
                ) : exams.map((e) => (
                  <tr key={e.id} className="align-top">
                    <td className="font-semibold">{e.title}</td>
                    <td className="font-mono text-[12.5px]">
                      {e.course?.code ?? <span className="font-sans text-muted">—</span>}
                    </td>
                    <td><WhenCell at={e.starts_at} status={e.status} /></td>
                    <td className="whitespace-nowrap tabular-nums">
                      {e.marks_entered}
                      <span className="text-[12.5px] text-muted"> ({e.marks_published} published)</span>
                    </td>
                    <td><Workflow status={e.status} /></td>
                    <td className="text-right">
                      <Link href={'/onyx/platform/tenants/' + tenantId + '/grades/exams/' + e.id}
                        className="text-[13px] font-semibold text-brand-700 hover:underline">
                        View grades
                      </Link>
                    </td>
                  </tr>
                ))}
              </DataTable>
            </div>
          </section>

          <section className="min-w-0 space-y-2">
            <h2 className="text-[13px] font-bold text-slate-700">Assessments</h2>
            <div tabIndex={0} role="region" aria-label="Assessments" className={SCROLLER}>
              <DataTable
                caption="Assessments at this institution -- pick one to see its grades."
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
                    No assessments yet.
                  </EmptyRow>
                ) : assessments.map((a) => (
                  <tr key={a.id} className="align-top">
                    <td className="font-semibold">{a.title}</td>
                    <td className="font-mono text-[12.5px]">
                      {a.course?.code ?? <span className="font-sans text-muted">—</span>}
                    </td>
                    <td><WhenCell at={a.closes_at} status={a.status} /></td>
                    <td className="whitespace-nowrap tabular-nums">
                      {a.attempt_count}
                      <span className="text-[12.5px] text-muted"> ({a.submitted_count} sat)</span>
                    </td>
                    <td><Workflow status={a.status} /></td>
                    <td className="text-right">
                      <Link
                        href={'/onyx/platform/tenants/' + tenantId + '/grades/assessments/' + a.id}
                        className="text-[13px] font-semibold text-brand-700 hover:underline">
                        View grades
                      </Link>
                    </td>
                  </tr>
                ))}
              </DataTable>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
