import type { Metadata } from 'next';
import Link from 'next/link';
import { requirePlatformSession } from '@/lib/onyx-platform-session';
import {
  attempt, RosterHeader, WhenCell, SCROLLER, Unavailable, Workflow, type AcademicsPayload,
} from '@/lib/onyx-platform-tenant';
import {
  CreateAssessmentForm, AssessmentEditToggle, AssessmentSectionsForm,
  AssessmentPublishButton, type ConsoleBank,
} from '@/components/onyx-platform-forms';
import { Banner, DataTable, EmptyRow, Pill } from '@/components/onyx-ui';

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
  // What there is to draw from. A paper needs a bank with questions in it, and
  // an institution that has none is the reason a paper stays unsittable.
  const banks = (await attempt<ConsoleBank[]>(
    '/api/onyx/platform/tenants/' + encodeURIComponent(id) + '/banks')) ?? [];
  const drawable = banks.filter((b) => b.question_count > 0);
  const drawsNothing = assessments.filter((a) => !(a.sections ?? []).length);

  return (
    <div className="min-w-0 space-y-4">
      <RosterHeader count={assessments.length} noun="assessment"
        action={<CreateAssessmentForm tenantId={tenantId} courses={courses} />} />

      {/* Said on the list, where somebody can act on it -- not at the moment a
          candidate presses Start, which is where the engine refuses it. */}
      {drawsNothing.length ? (
        <Banner tone="warn" icon="alert">
          <span className="font-bold">
            {drawsNothing.length} {drawsNothing.length === 1 ? 'paper draws' : 'papers draw'}
          </span>{' '}
          no questions yet, so {drawsNothing.length === 1 ? 'it cannot' : 'they cannot'} be sat.
          {drawable.length
            ? ' Use “Add questions” to draw from a bank.'
            : ' This institution has no question bank with questions in it yet — one has to be'
              + ' authored from the institution before a paper can draw from it.'}
        </Banner>
      ) : null}

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
                  {/* Opens onto every attempt, every score and the
                      invigilation record. */}
                  <Link href={'/onyx/platform/tenants/' + tenantId + '/assessments/' + a.id}
                    className="font-semibold hover:underline">
                    {a.title}
                  </Link>
                  <div className="flex flex-wrap items-center gap-1.5 text-[12.5px] text-muted">
                    <span>
                      {a.duration_minutes} min{a.pass_mark == null ? '' : ' · pass ' + a.pass_mark}
                    </span>
                    {(a.sections ?? []).length ? (
                      <span>
                        · draws {(a.sections ?? []).reduce((n, sec) => n + Number(sec.take), 0)}
                      </span>
                    ) : <Pill tone="late">No questions</Pill>}
                  </div>
                  <AssessmentSectionsForm tenantId={tenantId} assessment={a} banks={banks} />
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
                <td className="text-right">
                  <div className="flex flex-col items-end gap-1.5">
                    <AssessmentEditToggle tenantId={tenantId} assessment={a} />
                    <AssessmentPublishButton tenantId={tenantId} assessment={a} />
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
