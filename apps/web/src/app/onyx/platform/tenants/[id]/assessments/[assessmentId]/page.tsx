import Link from 'next/link';
import type { Metadata } from 'next';
import { requirePlatformSession } from '@/lib/onyx-platform-session';
import {
  attempt, SCROLLER, Unavailable, Workflow, clockTime, tookFor,
} from '@/lib/onyx-platform-tenant';
import { Card, DataTable, EmptyRow, Icon, Pill, SectionHead } from '@/components/onyx-ui';
import { PaperSettingsForm } from '@/components/onyx-platform-forms';

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
    shuffle_questions: boolean | number | null; shuffle_options: boolean | number | null;
    proctoring: boolean | number | null; require_camera: boolean | number | null;
    require_screen: boolean | number | null; watch_camera: boolean | number | null;
    anonymous_marking: boolean | number | null; moderation_required: boolean | number | null;
    instant_results: boolean | number | null;
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
              {/*
                * Every switch, named, rather than one "Monitored" pill.
                *
                * What a paper is actually set to is the question asked when a
                * candidate disputes a sitting -- was a camera required, were
                * the options shuffled -- and the answer was on no screen in
                * this console. An absent pill said nothing and looked the same
                * as a setting nobody had thought about.
                */}
              {a.proctoring ? (
                <>
                  <Pill tone="neutral">Monitored</Pill>
                  {a.require_camera ? <Pill tone="neutral">Camera required</Pill> : null}
                  {a.require_screen ? <Pill tone="neutral">Screen shared</Pill> : null}
                  {a.watch_camera ? <Pill tone="neutral">Invigilator can watch</Pill> : null}
                </>
              ) : <Pill tone="late">Not monitored</Pill>}
              {a.shuffle_questions ? <Pill tone="neutral">Questions shuffled</Pill> : null}
              {a.shuffle_options ? <Pill tone="neutral">Options shuffled</Pill> : null}
              {a.anonymous_marking ? <Pill tone="neutral">Marked anonymously</Pill> : null}
              {a.moderation_required ? <Pill tone="neutral">Moderated</Pill> : null}
              {a.instant_results ? <Pill tone="good">Instant results</Pill> : null}
              {a.results_published_at ? <Pill tone="good">Results released</Pill> : null}
            </div>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-2">
            <Workflow status={a.status} />
            <PaperSettingsForm tenantId={tenantId} assessment={a} />
          </div>
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
        <div className="flex flex-wrap items-center justify-between gap-2">
          <SectionHead title="Attempts" />
          {/*
            * Every script on this paper, in one document.
            *
            * The console already had the cohort report -- a row per candidate
            * with their total. This is what they actually wrote, which is the
            * document an operator is asked for when a mark is queried.
            */}
          {attempts.length ? (
            <a
              href={'/api/proxy/onyx/platform/tenants/' + tenantId + '/assessments/'
                + assessmentId + '/scripts.pdf'}
              download
              className="inline-flex min-h-[36px] items-center gap-1.5 rounded-xl border
                         border-slate-300 bg-white px-3 text-[13px] font-semibold
                         hover:bg-slate-50"
            >
              <Icon name="download" className="h-4 w-4" />
              Download every script
            </a>
          ) : null}
        </div>
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
                <th scope="col">&nbsp;</th>
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
                <td className="text-right">
                  {/* This one candidate's script. Asked for by name when a
                      mark is queried, so it is on the row rather than one
                      click further in. */}
                  {t.status === 'in_progress' ? null : (
                    <a
                      href={'/api/proxy/onyx/platform/tenants/' + tenantId + '/attempts/'
                        + t.id + '/script.pdf'}
                      download
                      aria-label={'Download the script for ' + (t.student?.name ?? 'this candidate')}
                      className="inline-flex min-h-[30px] items-center gap-1 rounded-lg border
                                 border-slate-300 px-2.5 text-[12.5px] font-semibold text-muted
                                 hover:bg-slate-50 hover:text-ink"
                    >
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
    </div>
  );
}
