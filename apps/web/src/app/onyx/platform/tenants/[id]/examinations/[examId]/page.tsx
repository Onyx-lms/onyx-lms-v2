import Link from 'next/link';
import type { Metadata } from 'next';
import { requirePlatformSession } from '@/lib/onyx-platform-session';
import { attempt as read, SCROLLER, Unavailable, ago, Workflow } from '@/lib/onyx-platform-tenant';
import { Card, DataTable, EmptyRow, Icon, Pill, SectionHead } from '@/components/onyx-ui';
import type { ConsoleAttempt } from '../../assessments/[assessmentId]/page';

export const metadata: Metadata = { title: 'Examination' };

interface Mark {
  id: number; user_id: string; raw_marks: number; moderation_delta: number;
  final_marks: number; grade: string | null; grade_points: number | null; status: string;
  student: { name: string; email: string } | null;
}
interface Seat {
  id: number; user_id: string; room_id: number | null; seat_no: string | null;
  student: { name: string; email: string } | null;
}
interface ExamDetail {
  exam: {
    id: number; title: string; starts_at: string; duration_minutes: number | null;
    max_marks: number | null; pass_marks: number | null; status: string;
    assessment_id: number | null;
    course: { id: number; code: string; title: string } | null;
  };
  marks: Mark[];
  seats: Seat[];
  paper: {
    assessment: { id: number; title: string; status: string };
    attempts: ConsoleAttempt[];
    summary: { sat: number; in_progress: number; marked: number;
      mean: number | null; passed: number | null };
  } | null;
  summary: { entered: number; seated: number; mean: number | null; passed: number | null };
}

/**
 * One sitting, and everything that happened at it.
 *
 * The marks, the seating, and — where the sitting is tied to an online paper —
 * every attempt on that paper, which is where the responses and the
 * invigilation record are. An operator asking "how did this exam go" used to
 * be answered with a row on a list.
 *
 * The two halves are shown separately and labelled, because they are different
 * records: marks entered by hand are what an examiner wrote down, and attempts
 * are what candidates did in the browser. A sitting can have either, both, or
 * neither, and conflating them would hide which one is missing.
 */
export default async function OnyxPlatformExamPage(
  { params }: { params: Promise<{ id: string; examId: string }> },
) {
  await requirePlatformSession();
  const { id, examId } = await params;
  const tenantId = Number(id);
  const data = await read<ExamDetail>(
    '/api/onyx/platform/tenants/' + encodeURIComponent(id)
    + '/exams/' + encodeURIComponent(examId));

  if (data === null) return <Unavailable what="examination" />;
  const { exam, marks, seats, paper, summary } = data;

  return (
    <div className="min-w-0 space-y-5">
      <Link href={'/onyx/platform/tenants/' + tenantId + '/examinations'}
        className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-brand-700
                   hover:underline">
        <Icon name="chevron" className="h-4 w-4 rotate-180" />
        All examinations
      </Link>

      <Card className="p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-[19px] font-bold text-ink">{exam.title}</h2>
            <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[12.5px] text-muted">
              {exam.course ? <span className="font-mono">{exam.course.code}</span> : null}
              {exam.course ? <span>·</span> : null}
              <span>{ago(exam.starts_at)}</span>
              {exam.duration_minutes ? (
                <><span>·</span><span className="tabular-nums">{exam.duration_minutes} min</span></>
              ) : null}
              <span>·</span>
              <span className="tabular-nums">out of {exam.max_marks ?? '—'}</span>
              {exam.pass_marks != null ? (
                <><span>·</span><span className="tabular-nums">pass {exam.pass_marks}</span></>
              ) : null}
            </div>
          </div>
          <Workflow status={exam.status} />
        </div>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="p-3.5">
          <div className="text-[22px] font-bold tabular-nums">{summary.entered}</div>
          <div className="text-[12.5px] text-muted">marks entered</div>
        </Card>
        <Card className="p-3.5">
          <div className="text-[22px] font-bold tabular-nums">{summary.seated}</div>
          <div className="text-[12.5px] text-muted">candidates seated</div>
        </Card>
        <Card className="p-3.5">
          <div className="text-[22px] font-bold tabular-nums">
            {summary.mean == null ? '—' : summary.mean}
          </div>
          <div className="text-[12.5px] text-muted">mean mark</div>
        </Card>
        <Card className="p-3.5">
          <div className="text-[22px] font-bold tabular-nums">
            {summary.passed == null ? '—' : summary.passed}
          </div>
          <div className="text-[12.5px] text-muted">
            {exam.pass_marks == null ? 'no pass mark set' : 'at or above the pass mark'}
          </div>
        </Card>
      </div>

      {/* The online paper, where there is one. This is the half that carries
          responses and invigilation; the marks below are what an examiner
          wrote down by hand. */}
      {paper ? (
        <section>
          <SectionHead title="Sat in the browser" />
          <p className="mb-2 text-[13px] text-muted">
            This sitting is tied to{' '}
            <Link href={'/onyx/platform/tenants/' + tenantId + '/assessments/' + paper.assessment.id}
              className="font-semibold text-brand-700 hover:underline">
              {paper.assessment.title}
            </Link>
            . {paper.summary.sat} handed in, {paper.summary.in_progress} still sitting.
          </p>
          <div tabIndex={0} role="region" aria-label="Attempts" className={SCROLLER}>
            <DataTable
              caption="Every attempt on the paper this sitting is tied to."
              head={
                <>
                  <th scope="col">Candidate</th>
                  <th scope="col">State</th>
                  <th scope="col">Score</th>
                  <th scope="col">Flags</th>
                  <th scope="col">Handed in</th>
                </>
              }
            >
              {paper.attempts.length === 0 ? (
                <EmptyRow colSpan={5} icon="edit">Nobody has sat it yet.</EmptyRow>
              ) : paper.attempts.map((t) => (
                <tr key={t.id} className="align-top">
                  <td>
                    <Link href={'/onyx/platform/tenants/' + tenantId + '/attempts/' + t.id}
                      className="font-semibold hover:underline">
                      {t.student?.name ?? 'Unknown'}
                    </Link>
                    <div className="break-all text-[12px] text-muted">{t.student?.email ?? ''}</div>
                  </td>
                  <td><Pill tone={t.status === 'in_progress' ? 'late' : 'neutral'}>{t.status}</Pill></td>
                  <td className="tabular-nums">
                    {t.score == null
                      ? <span className="text-muted">not marked</span>
                      : t.score + ' / ' + (t.max_score ?? '?')}
                  </td>
                  <td>
                    {t.integrity_score > 0
                      ? <Pill tone="late">{t.integrity_score}</Pill>
                      : <span className="text-[12.5px] text-muted">clean</span>}
                  </td>
                  <td className="whitespace-nowrap text-[12.5px] text-muted">
                    {t.submitted_at ? ago(t.submitted_at) : '—'}
                  </td>
                </tr>
              ))}
            </DataTable>
          </div>
        </section>
      ) : (
        <section>
          <SectionHead title="Sat in the browser" />
          <Card className="p-5 text-center text-[13px] text-muted">
            This sitting is not tied to an online paper — its marks are entered by hand.
          </Card>
        </section>
      )}

      <section>
        <SectionHead title="Marks" />
        <div tabIndex={0} role="region" aria-label="Marks" className={SCROLLER}>
          <DataTable
            caption="The mark sheet for this sitting, raw and after moderation."
            head={
              <>
                <th scope="col">Candidate</th>
                <th scope="col">Raw</th>
                <th scope="col">Moderation</th>
                <th scope="col">Final</th>
                <th scope="col">Grade</th>
                <th scope="col">State</th>
              </>
            }
          >
            {marks.length === 0 ? (
              <EmptyRow colSpan={6} icon="award">
                No marks have been entered for this sitting.
              </EmptyRow>
            ) : marks.map((m) => (
              <tr key={m.id} className="align-top">
                <td>
                  <div className="font-semibold">{m.student?.name ?? 'Unknown'}</div>
                  <div className="break-all text-[12px] text-muted">{m.student?.email ?? ''}</div>
                </td>
                <td className="tabular-nums">{m.raw_marks}</td>
                <td className="tabular-nums">
                  {Number(m.moderation_delta) === 0
                    ? <span className="text-muted">—</span>
                    : (Number(m.moderation_delta) > 0 ? '+' : '') + m.moderation_delta}
                </td>
                <td className="font-semibold tabular-nums">{m.final_marks}</td>
                <td>{m.grade ? <Pill tone="neutral">{m.grade}</Pill> : <span className="text-muted">—</span>}</td>
                <td className="text-[12.5px] text-muted">{m.status}</td>
              </tr>
            ))}
          </DataTable>
        </div>
      </section>

      <section>
        <SectionHead title="Seating" />
        {seats.length === 0 ? (
          <Card className="p-5 text-center text-[13px] text-muted">
            No seats have been allocated for this sitting.
          </Card>
        ) : (
          <div tabIndex={0} role="region" aria-label="Seating" className={SCROLLER}>
            <DataTable
              caption="Where each candidate sits."
              head={<><th scope="col">Candidate</th><th scope="col">Room</th><th scope="col">Seat</th></>}
            >
              {seats.map((x) => (
                <tr key={x.id}>
                  <td className="font-semibold">{x.student?.name ?? 'Unknown'}</td>
                  <td className="tabular-nums">{x.room_id ?? '—'}</td>
                  <td className="font-mono tabular-nums">{x.seat_no ?? '—'}</td>
                </tr>
              ))}
            </DataTable>
          </div>
        )}
      </section>
    </div>
  );
}
