import Link from 'next/link';
import type { Metadata } from 'next';
import { requirePlatformSession } from '@/lib/onyx-platform-session';
import {
  attempt, ago, SCROLLER, Unavailable, AccountState, clockTime,
} from '@/lib/onyx-platform-tenant';
import {
  Card, DataTable, EmptyRow, Icon, Pill, Score, SectionHead,
} from '@/components/onyx-ui';
import { ReinstateAttempt, StoppedBadge } from '@/components/onyx-reinstate';

export const metadata: Metadata = { title: 'Student' };

interface Named { id: number; code?: string; title: string }

interface StudentRecord {
  student: {
    user_id: string; membership_id: number; name: string;
    email: string | null; phone: string | null;
    role: string; status: number; roll_number: string | null;
    section: { id: number; name: string } | null;
    joined_at: string | null;
  };
  enrolments: {
    id: number; course_id: number; course: (Named & { access: string; status: number }) | null;
    status: number; since: string | null;
  }[];
  attempts: {
    id: number; assessment_id: number;
    paper: (Named & { pass_mark: number | null; status: string }) | null;
    exam: { id: number; title: string } | null;
    attempt: number; status: string;
    started_at: string | null; submitted_at: string | null;
    score: number | null; max_score: number | null;
    integrity_flags: number; integrity_status: string;
    terminated_at: string | null; breaches: number;
  }[];
  exam_marks: {
    id: number; exam_id: number;
    exam: (Named & { starts_at: string; max_marks: number; pass_marks: number }) | null;
    raw_marks: number; moderation_delta: number; final_marks: number;
    grade: string | null; status: string;
  }[];
}

/**
 * One student, and everything this institution has of them.
 *
 * The question somebody actually arrives with — "what is going on with this
 * person" — used to take four screens: the roll for their number, the section
 * list for their division, a course for their enrolment, a sitting for their
 * mark. This is that question answered once.
 *
 * The order is the order it gets asked in: who they are, what they are
 * enrolled in, what they have sat, and what an examiner wrote down. Papers
 * they were stopped on carry the way back from it, because an invigilator
 * looking a candidate up by name is often doing so precisely because that
 * happened.
 */
export default async function OnyxPlatformStudentPage(
  { params }: { params: Promise<{ id: string; userId: string }> },
) {
  await requirePlatformSession();
  const { id, userId } = await params;
  const tenantId = Number(id);
  const base = '/onyx/platform/tenants/' + tenantId;

  const data = await attempt<StudentRecord>(
    '/api/onyx/platform/tenants/' + encodeURIComponent(id)
    + '/students/' + encodeURIComponent(userId));
  if (data === null) return <Unavailable what="student" />;
  const { student, enrolments, attempts, exam_marks: marks } = data;

  const active = enrolments.filter((e) => e.status === 1);
  const sat = attempts.filter((a) => a.status !== 'in_progress');
  const stopped = attempts.filter((a) => a.terminated_at);

  return (
    <div className="min-w-0 space-y-5">
      <Link href={base + '/students'}
        className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-brand-700
                   hover:underline">
        <Icon name="chevron" className="h-4 w-4 rotate-180" />
        All students
      </Link>

      <Card className="p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-[19px] font-bold text-ink">{student.name}</h2>
            <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[12.5px] text-muted">
              {student.roll_number ? (
                <span className="font-mono font-semibold text-ink">{student.roll_number}</span>
              ) : null}
              {student.section ? <Pill tone="neutral">{student.section.name}</Pill>
                : <Pill tone="late">No section</Pill>}
              <span className="break-all">{student.email}</span>
              {student.joined_at ? <><span>·</span><span>joined {ago(student.joined_at)}</span></>
                : null}
            </div>
          </div>
          <AccountState status={student.status} />
        </div>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="p-3.5">
          <div className="text-[22px] font-bold tabular-nums">{active.length}</div>
          <div className="text-[12.5px] text-muted">courses enrolled</div>
        </Card>
        <Card className="p-3.5">
          <div className="text-[22px] font-bold tabular-nums">{sat.length}</div>
          <div className="text-[12.5px] text-muted">papers sat</div>
        </Card>
        <Card className="p-3.5">
          <div className="text-[22px] font-bold tabular-nums">{marks.length}</div>
          <div className="text-[12.5px] text-muted">marks on record</div>
        </Card>
        <Card className="p-3.5">
          <div className="text-[22px] font-bold tabular-nums">{stopped.length}</div>
          <div className="text-[12.5px] text-muted">
            {stopped.length ? 'papers stopped mid-sitting' : 'nothing stopped'}
          </div>
        </Card>
      </div>

      <section>
        <SectionHead title="Courses" />
        <div tabIndex={0} role="region" aria-label="Courses" className={SCROLLER}>
          <DataTable
            caption="What this student is enrolled in, and how they got on."
            head={
              <>
                <th scope="col">Course</th>
                <th scope="col">How they joined</th>
                <th scope="col">Since</th>
                <th scope="col">State</th>
              </>
            }
          >
            {enrolments.length === 0 ? (
              <EmptyRow colSpan={4} icon="book">
                Not enrolled in anything. Nothing will be dealt to them until they are —
                a paper is sat by the people on its course.
              </EmptyRow>
            ) : enrolments.map((e) => (
              <tr key={e.id} className="align-top">
                <td>
                  <Link href={base + '/courses/' + e.course_id}
                    className="font-semibold hover:underline">
                    {e.course?.title ?? 'Course #' + e.course_id}
                  </Link>
                  <div className="font-mono text-[12px] text-muted">{e.course?.code}</div>
                </td>
                <td className="text-[12.5px] text-muted">{e.course?.access ?? '—'}</td>
                <td className="text-[12.5px] text-muted">{e.since ? ago(e.since) : '—'}</td>
                <td>
                  {e.status === 1
                    ? <Pill tone="good">Enrolled</Pill>
                    : <Pill tone="neutral">Withdrawn</Pill>}
                </td>
              </tr>
            ))}
          </DataTable>
        </div>
      </section>

      <section>
        <SectionHead title="Assessments and examinations sat" />
        <div tabIndex={0} role="region" aria-label="Attempts" className={SCROLLER}>
          <DataTable
            caption="Every paper this student has opened, and what happened to it."
            head={
              <>
                <th scope="col">Paper</th>
                <th scope="col">Started</th>
                <th scope="col">Handed in</th>
                <th scope="col">Marks</th>
                <th scope="col">State</th>
                <th scope="col">&nbsp;</th>
              </>
            }
          >
            {attempts.length === 0 ? (
              <EmptyRow colSpan={6} icon="edit">
                They have not opened a paper yet.
              </EmptyRow>
            ) : attempts.map((a) => (
              <tr key={a.id} className="align-top">
                <td>
                  <Link href={base + '/attempts/' + a.id} className="font-semibold hover:underline">
                    {/* The examination's name where there is one: a candidate
                        sat "the Python mid-term", not "assessment 378". */}
                    {a.exam?.title ?? a.paper?.title ?? 'Paper #' + a.assessment_id}
                  </Link>
                  <div className="text-[12px] text-muted">
                    {a.exam ? 'Examination' : 'Assessment'}
                    {a.attempt > 1 ? ' · attempt ' + a.attempt : ''}
                  </div>
                </td>
                <td className="whitespace-nowrap text-[12.5px] text-muted">
                  {a.started_at ? clockTime(a.started_at) : '—'}
                </td>
                <td className="whitespace-nowrap text-[12.5px] text-muted">
                  {a.submitted_at ? clockTime(a.submitted_at)
                    : <span className="italic">still sitting</span>}
                </td>
                <td>
                  {a.score === null
                    ? <Pill tone="soon">Not marked</Pill>
                    : <Score value={a.score} outOf={a.max_score ?? 0} />}
                </td>
                <td>
                  <div className="flex flex-col items-start gap-1">
                    <span className="text-[12.5px] text-muted">{a.status}</span>
                    <StoppedBadge at={a.terminated_at} breaches={a.breaches} />
                    {a.integrity_flags > 0 ? (
                      <Pill tone="late">{a.integrity_flags} flag
                        {a.integrity_flags === 1 ? '' : 's'}</Pill>
                    ) : null}
                  </div>
                </td>
                <td className="text-right">
                  {a.terminated_at ? (
                    <ReinstateAttempt attemptId={a.id} name={student.name}
                      basePath={'onyx/platform/tenants/' + tenantId + '/attempts/'} compact />
                  ) : (
                    <a href={'/api/proxy/onyx/platform/tenants/' + tenantId
                      + '/attempts/' + a.id + '/script.pdf'} download
                      className="inline-flex min-h-[30px] items-center gap-1 rounded-lg border
                                 border-line px-2.5 text-[12.5px] font-semibold text-muted
                                 hover:bg-brand-50 hover:text-ink">
                      <Icon name="download" className="h-3.5 w-3.5" />
                      PDF
                    </a>
                  )}
                </td>
              </tr>
            ))}
          </DataTable>
        </div>
      </section>

      <section>
        <SectionHead title="Marks entered by hand" />
        {marks.length === 0 ? (
          <Card className="p-5 text-center text-[13px] text-muted">
            No examiner has written a mark against this student. A paper sat in a browser is
            scored by the engine and appears above instead.
          </Card>
        ) : (
          <div tabIndex={0} role="region" aria-label="Marks" className={SCROLLER}>
            <DataTable
              caption="The examinations mark sheet for this student, raw and after moderation."
              head={
                <>
                  <th scope="col">Examination</th>
                  <th scope="col">Raw</th>
                  <th scope="col">Moderation</th>
                  <th scope="col">Final</th>
                  <th scope="col">Grade</th>
                  <th scope="col">Result</th>
                </>
              }
            >
              {marks.map((m) => {
                const pass = m.exam?.pass_marks == null
                  ? null : m.final_marks >= Number(m.exam.pass_marks);
                return (
                  <tr key={m.id} className="align-top">
                    <td>
                      <Link href={base + '/examinations/' + m.exam_id}
                        className="font-semibold hover:underline">
                        {m.exam?.title ?? 'Examination #' + m.exam_id}
                      </Link>
                      <div className="text-[12px] text-muted">
                        out of {m.exam?.max_marks ?? '—'}
                      </div>
                    </td>
                    <td className="tabular-nums">{m.raw_marks}</td>
                    <td className="tabular-nums">
                      {m.moderation_delta === 0
                        ? <span className="text-muted">—</span>
                        : (m.moderation_delta > 0 ? '+' : '') + m.moderation_delta}
                    </td>
                    <td className="font-semibold tabular-nums">{m.final_marks}</td>
                    <td>{m.grade ? <Pill tone="brand">{m.grade}</Pill>
                      : <span className="text-muted">—</span>}</td>
                    <td>
                      {pass === null ? <span className="text-[12.5px] text-muted">—</span>
                        : pass ? <Pill tone="good">Pass</Pill> : <Pill tone="late">Fail</Pill>}
                    </td>
                  </tr>
                );
              })}
            </DataTable>
          </div>
        )}
      </section>
    </div>
  );
}
