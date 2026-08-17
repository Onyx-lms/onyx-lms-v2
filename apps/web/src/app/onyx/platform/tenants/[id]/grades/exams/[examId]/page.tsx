import Link from 'next/link';
import type { Metadata } from 'next';
import { requirePlatformSession } from '@/lib/onyx-platform-session';
import {
  attempt, ago, SCROLLER, Unavailable, Workflow, type GradesPayload,
} from '@/lib/onyx-platform-tenant';
import { ExamMarkEditToggle } from '@/components/onyx-platform-forms';
import { Banner, Card, DataTable, EmptyRow, Meter, Score } from '@/components/onyx-ui';

export const metadata: Metadata = { title: 'Exam grades' };

/** One exam's grades -- reached by picking it from grades/page.tsx. */
export default async function OnyxPlatformExamGradesPage(
  { params }: { params: Promise<{ id: string; examId: string }> },
) {
  const session = await requirePlatformSession();
  const { id, examId } = await params;
  const tenantId = Number(id);
  const grades = await attempt<GradesPayload>(
    '/api/onyx/platform/tenants/' + encodeURIComponent(id)
    + '/grades?exam_id=' + encodeURIComponent(examId));
  const marks = grades?.exam_marks ?? [];
  const examTitle = marks[0]?.exam?.title ?? 'Exam #' + examId;
  const passRate = grades?.summary.exams.pass_rate ?? null;

  return (
    <div className="min-w-0 space-y-3">
      <Link href={'/onyx/platform/tenants/' + tenantId + '/grades'}
        className="inline-flex items-center gap-1 text-[13px] font-semibold text-muted
                   hover:text-brand-700 hover:underline">
        &larr; Grades
      </Link>
      <h1 className="text-xl font-bold">{examTitle}</h1>

      {grades === null ? <Unavailable what="this exam's grades" /> : (
        <>
          <Banner tone="info" icon="shield">
            Reading this exam&rsquo;s grades is recorded in the platform audit log
            against {session.email}.
          </Banner>

          {grades.summary.exams.count > 0 ? (
            <Card className="p-4">
              <div className="grid min-w-0 gap-4 sm:grid-cols-3">
                <div className="min-w-0">
                  <p className="text-[11px] font-bold uppercase tracking-[.08em] text-muted">
                    Cohort mean
                  </p>
                  <p className="mt-1 text-[22px] font-bold tabular-nums">
                    {grades.summary.exams.mean_percent ?? '—'}
                    <span className="text-[13px] font-semibold text-muted">%</span>
                  </p>
                  <p className="text-[12.5px] text-muted">
                    {grades.summary.exams.mean_marks ?? '—'} marks average
                  </p>
                </div>
                <div className="min-w-0">
                  <p className="text-[11px] font-bold uppercase tracking-[.08em] text-muted">
                    Marks entered
                  </p>
                  <p className="mt-1 text-[22px] font-bold tabular-nums">
                    {grades.summary.exams.count}
                  </p>
                  <p className="text-[12.5px] text-muted">
                    {grades.summary.exams.published} published
                  </p>
                </div>
                <div className="min-w-0">
                  <p className="text-[11px] font-bold uppercase tracking-[.08em] text-muted">
                    Pass rate
                  </p>
                  {passRate == null ? (
                    <p className="mt-1 text-[13px] text-muted">
                      No pass mark recorded, so there is no pass rate to give.
                    </p>
                  ) : (
                    <>
                      <p className="mt-1 text-[22px] font-bold tabular-nums">
                        {passRate}<span className="text-[13px] font-semibold text-muted">%</span>
                      </p>
                      <div className="mt-1.5">
                        <Meter percent={passRate} tone="dark" label={'Pass rate ' + passRate + '%'} />
                      </div>
                    </>
                  )}
                </div>
              </div>
            </Card>
          ) : null}

          <div tabIndex={0} role="region" aria-label={examTitle + ' grades'} className={SCROLLER}>
            <DataTable
              caption={'Every candidate marked on ' + examTitle + '.'}
              head={
                <>
                  <th scope="col">Student</th>
                  <th scope="col">Mark</th>
                  <th scope="col">Grade</th>
                  <th scope="col">Status</th>
                  <th scope="col">Recorded</th>
                  <th scope="col">&nbsp;</th>
                </>
              }
            >
              {marks.length === 0 ? (
                <EmptyRow colSpan={6} icon="trophy">
                  Nobody has been marked on this exam yet.
                </EmptyRow>
              ) : marks.map((m) => (
                <tr key={m.id} className="align-top">
                  <td>
                    <div className="font-semibold">{m.student.name}</div>
                    <div className="break-all text-[12.5px] text-muted">{m.student.email}</div>
                  </td>
                  <td><Score value={m.final_marks} outOf={m.max_marks ?? undefined} /></td>
                  <td className="font-semibold tabular-nums">
                    {m.grade ?? <span className="font-normal text-muted">—</span>}
                  </td>
                  <td><Workflow status={m.status} /></td>
                  <td className="whitespace-nowrap text-[12.5px] text-muted">{ago(m.recorded_at)}</td>
                  <td className="text-right">
                    <ExamMarkEditToggle tenantId={tenantId} markId={m.id}
                      rawMarks={m.raw_marks} finalMarks={m.final_marks} />
                  </td>
                </tr>
              ))}
            </DataTable>
          </div>
        </>
      )}
    </div>
  );
}
