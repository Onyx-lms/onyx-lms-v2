import Link from 'next/link';
import type { Metadata } from 'next';
import { requirePlatformSession } from '@/lib/onyx-platform-session';
import {
  attempt, SCROLLER, Unavailable, Workflow, clockTime, tookFor,
} from '@/lib/onyx-platform-tenant';
import { Card, DataTable, EmptyRow, Icon, Pill, SectionHead } from '@/components/onyx-ui';

export const metadata: Metadata = { title: 'Assessment' };

export interface ConsoleAttempt {
  id: number; user_id: string; attempt: number; status: string;
  started_at: string | null; submitted_at: string | null;
  auto_score: number | null; manual_score: number | null;
  score: number | null; max_score: number | null;
  integrity_score: number;
  student: { name: string; email: string } | null;
}
interface AssessmentDetail {
  assessment: {
    id: number; title: string; instructions: string | null;
    opens_at: string | null; closes_at: string | null; duration_minutes: number;
    attempts_allowed: number; pass_mark: number | null; status: string;
    proctoring: boolean | number | null; moderation_required: boolean | number | null;
    results_published_at: string | null;
    sections: { id: string; title: string; bank_id: number; take: number }[] | null;
    course: { id: number; code: string; title: string } | null;
  };
  attempts: ConsoleAttempt[];
  summary: {
    sat: number; in_progress: number; marked: number;
    mean: number | null; passed: number | null;
  };
}

/**
 * One paper, and everybody who sat it.
 *
 * The console could list papers and nothing more: an operator asking how a
 * paper went was answered with a row. Every attempt, every score and every
 * integrity flag was already recorded and none of it was reachable from here.
 *
 * Each attempt opens, and that is where the responses are -- a summary of
 * scores answers "how did the cohort do" and never "what did this person
 * write", which is the question somebody is usually holding.
 */
export default async function OnyxPlatformAssessmentPage(
  { params }: { params: Promise<{ id: string; assessmentId: string }> },
) {
  await requirePlatformSession();
  const { id, assessmentId } = await params;
  const tenantId = Number(id);
  const data = await attempt<AssessmentDetail>(
    '/api/onyx/platform/tenants/' + encodeURIComponent(id)
    + '/assessments/' + encodeURIComponent(assessmentId));

  if (data === null) return <Unavailable what="assessment" />;
  const { assessment: a, attempts, summary } = data;
  const draws = (a.sections ?? []).reduce((n, sec) => n + Number(sec.take), 0);

  return (
    <div className="min-w-0 space-y-5">
      <Link href={'/onyx/platform/tenants/' + tenantId + '/assessments'}
        className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-brand-700
                   hover:underline">
        <Icon name="chevron" className="h-4 w-4 rotate-180" />
        All assessments
      </Link>

      <Card className="p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-[19px] font-bold text-ink">{a.title}</h2>
            <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[12.5px] text-muted">
              {a.course ? <span className="font-mono">{a.course.code}</span> : null}
              {a.course ? <span>·</span> : null}
              <span className="tabular-nums">{a.duration_minutes} min</span>
              <span>·</span>
              <span className="tabular-nums">
                {a.attempts_allowed} attempt{a.attempts_allowed === 1 ? '' : 's'} allowed
              </span>
              {a.pass_mark != null ? (
                <><span>·</span><span className="tabular-nums">pass {a.pass_mark}</span></>
              ) : null}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {draws
                ? <Pill tone="neutral">draws {draws}</Pill>
                : <Pill tone="late">No questions</Pill>}
              {a.proctoring ? <Pill tone="neutral">Monitored</Pill> : null}
              {a.moderation_required ? <Pill tone="neutral">Moderated</Pill> : null}
              {a.results_published_at ? <Pill tone="good">Results released</Pill> : null}
            </div>
          </div>
          <Workflow status={a.status} />
        </div>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="p-3.5">
          <div className="text-[22px] font-bold tabular-nums">{summary.sat}</div>
          <div className="text-[12.5px] text-muted">handed in</div>
        </Card>
        <Card className="p-3.5">
          <div className="text-[22px] font-bold tabular-nums">{summary.in_progress}</div>
          <div className="text-[12.5px] text-muted">still sitting</div>
        </Card>
        <Card className="p-3.5">
          <div className="text-[22px] font-bold tabular-nums">
            {summary.mean == null ? '—' : summary.mean}
          </div>
          <div className="text-[12.5px] text-muted">mean of {summary.marked} marked</div>
        </Card>
        <Card className="p-3.5">
          <div className="text-[22px] font-bold tabular-nums">
            {summary.passed == null ? '—' : summary.passed}
          </div>
          <div className="text-[12.5px] text-muted">
            {a.pass_mark == null ? 'no pass mark set' : 'at or above the pass mark'}
          </div>
        </Card>
      </div>

      <section>
        <SectionHead title="Attempts" />
        <div tabIndex={0} role="region" aria-label="Attempts" className={SCROLLER}>
          <DataTable
            caption="Everyone who sat this paper, what they scored and what the invigilation console recorded."
            head={
              <>
                <th scope="col">Candidate</th>
                <th scope="col">Try</th>
                <th scope="col">State</th>
                <th scope="col">Score</th>
                <th scope="col">Flags</th>
                {/* When they started and when they finished, not "2 hours
                    ago": an operator checking whether somebody began late
                    needs a time they can hold against the scheduled one. */}
                <th scope="col">Started</th>
                <th scope="col">Handed in</th>
                <th scope="col">Took</th>
              </>
            }
          >
            {attempts.length === 0 ? (
              <EmptyRow colSpan={8} icon="edit">
                Nobody has sat this paper yet.
              </EmptyRow>
            ) : attempts.map((t) => (
              <tr key={t.id} className="align-top">
                <td>
                  {/* The attempt opens: this is the route to what they
                      actually wrote. */}
                  <Link
                    href={'/onyx/platform/tenants/' + tenantId + '/attempts/' + t.id}
                    className="font-semibold hover:underline"
                  >
                    {t.student?.name ?? 'Unknown'}
                  </Link>
                  <div className="break-all text-[12px] text-muted">{t.student?.email ?? ''}</div>
                </td>
                <td className="tabular-nums">{t.attempt}</td>
                <td><Pill tone={t.status === 'in_progress' ? 'late' : 'neutral'}>{t.status}</Pill></td>
                <td className="tabular-nums">
                  {t.score == null
                    ? <span className="text-muted">not marked</span>
                    : t.score + ' / ' + (t.max_score ?? '?')}
                </td>
                <td>
                  {/* Zero is worth showing as "clean" rather than as a bare 0:
                      an empty cell reads as "not monitored". */}
                  {t.integrity_score > 0
                    ? <Pill tone="late">{t.integrity_score}</Pill>
                    : <span className="text-[12.5px] text-muted">clean</span>}
                </td>
                <td className="whitespace-nowrap text-[12.5px] tabular-nums text-muted">
                  {clockTime(t.started_at)}
                </td>
                <td className="whitespace-nowrap text-[12.5px] tabular-nums text-muted">
                  {t.submitted_at
                    ? clockTime(t.submitted_at)
                    : <span className="italic">still sitting</span>}
                </td>
                <td className="whitespace-nowrap text-[12.5px] tabular-nums">
                  {tookFor(t.started_at, t.submitted_at)}
                </td>
              </tr>
            ))}
          </DataTable>
        </div>
      </section>
    </div>
  );
}
