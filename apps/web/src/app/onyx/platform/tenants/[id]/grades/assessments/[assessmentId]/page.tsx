import Link from 'next/link';
import type { Metadata } from 'next';
import { requirePlatformSession } from '@/lib/onyx-platform-session';
import {
  attempt, ago, SCROLLER, Unavailable, Workflow, type GradesPayload,
} from '@/lib/onyx-platform-tenant';
import { AssessmentGradeActions } from '@/components/onyx-platform-forms';
import { Banner, Card, DataTable, EmptyRow, Meter, Score } from '@/components/onyx-ui';

export const metadata: Metadata = { title: 'Assessment grades' };

/** One assessment's grades -- reached by picking it from grades/page.tsx. */
export default async function OnyxPlatformAssessmentGradesPage(
  { params }: { params: Promise<{ id: string; assessmentId: string }> },
) {
  const session = await requirePlatformSession();
  const { id, assessmentId } = await params;
  const tenantId = Number(id);
  const grades = await attempt<GradesPayload>(
    '/api/onyx/platform/tenants/' + encodeURIComponent(id)
    + '/grades?assessment_id=' + encodeURIComponent(assessmentId));
  const rows = grades?.assessment_grades ?? [];
  const title = rows[0]?.assessment?.title ?? 'Assessment #' + assessmentId;
  const passRate = grades?.summary.assessments.pass_rate ?? null;

  return (
    <div className="min-w-0 space-y-3">
      <Link href={'/onyx/platform/tenants/' + tenantId + '/grades'}
        className="inline-flex items-center gap-1 text-[13px] font-semibold text-muted
                   hover:text-brand-700 hover:underline">
        &larr; Grades
      </Link>
      <h1 className="text-xl font-bold">{title}</h1>

      {grades === null ? <Unavailable what="this assessment's grades" /> : (
        <>
          <Banner tone="info" icon="shield">
            Reading this assessment&rsquo;s grades is recorded in the platform audit log
            against {session.email}.
          </Banner>

          {grades.summary.assessments.count > 0 ? (
            <Card className="p-4">
              <div className="grid min-w-0 gap-4 sm:grid-cols-2">
                <div className="min-w-0">
                  <p className="text-[11px] font-bold uppercase tracking-[.08em] text-muted">
                    Cohort mean
                  </p>
                  <p className="mt-1 text-[22px] font-bold tabular-nums">
                    {grades.summary.assessments.mean_percent ?? '—'}
                    <span className="text-[13px] font-semibold text-muted">%</span>
                  </p>
                  <p className="text-[12.5px] text-muted">
                    over {grades.summary.assessments.count} scored
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

          <div tabIndex={0} role="region" aria-label={title + ' grades'} className={SCROLLER}>
            <DataTable
              caption={'Every attempt scored on ' + title + '.'}
              head={
                <>
                  <th scope="col">Student</th>
                  <th scope="col">Score</th>
                  <th scope="col">Status</th>
                  <th scope="col">Submitted</th>
                  <th scope="col">&nbsp;</th>
                </>
              }
            >
              {rows.length === 0 ? (
                <EmptyRow colSpan={5} icon="trophy">
                  Nobody has a scored attempt on this assessment yet.
                </EmptyRow>
              ) : rows.map((g) => (
                <tr key={g.id} className="align-top">
                  <td>
                    <div className="font-semibold">{g.student.name}</div>
                    <div className="break-all text-[12.5px] text-muted">{g.student.email}</div>
                  </td>
                  <td>
                    {g.score == null
                      ? <span className="text-[12.5px] text-muted">Unmarked</span>
                      : <Score value={g.score} outOf={g.max_score || undefined} />}
                  </td>
                  <td><Workflow status={g.status} /></td>
                  <td className="whitespace-nowrap text-[12.5px] text-muted">
                    {ago(g.submitted_at)}
                  </td>
                  <td className="text-right">
                    <AssessmentGradeActions tenantId={tenantId} attemptId={g.id}
                      score={g.score} maxScore={g.max_score} />
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
