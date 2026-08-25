import Link from 'next/link';
import type { Metadata } from 'next';
import { requirePlatformSession } from '@/lib/onyx-platform-session';
import { attempt as read, SCROLLER, Unavailable, ago, Workflow } from '@/lib/onyx-platform-tenant';
import { LiveRefresh } from '@/components/onyx-live';
import { WatchCandidate } from '@/components/onyx-proctor-live';
import { AttemptVerdict } from '@/components/onyx-console-proctor';
import { ReinstateAttempt, StoppedBadge } from '@/components/onyx-reinstate';
import { ExamRegister } from '@/components/onyx-exam-register';
import {
  Card, DataTable, EmptyRow, Icon, Pill, Score, SectionHead, State, StatTile,
} from '@/components/onyx-ui';
import { candidateOf, device, severity, type QueueRow } from '@/lib/onyx-console-invigilate';
import type { ExamRegisterRow } from '@/components/onyx-exam-register';

export const metadata: Metadata = { title: 'Invigilate' };

interface ExamDetail {
  exam: {
    id: number; title: string; starts_at: string; duration_minutes: number | null;
    max_marks: number | null; pass_marks: number | null; status: string;
    assessment_id: number | null;
    course: { id: number; code: string; title: string } | null;
  };
  register: ExamRegisterRow[];
  paper: {
    assessment: { id: number; title: string; status: string };
    summary: { sat: number; in_progress: number; marked: number;
      mean: number | null; passed: number | null };
  } | null;
}

/**
 * One examination, watched while it happens.
 *
 * Four things in the order somebody invigilating asks for them: who is sitting
 * it right now and whether their devices are reporting; which flags are open
 * and want a decision; what has been handed in and marked; and — throughout —
 * the controls to act, rather than a read-only screen and a note telling you to
 * sign in somewhere else.
 *
 * The register at the bottom is the same component the sitting's own page uses.
 * An invigilator watching a paper and an examinations officer reading the
 * results are asking the same question ten minutes apart, and answering it
 * twice in two shapes is what makes two screens disagree.
 */
export default async function OnyxPlatformInvigilateExamPage(
  { params }: { params: Promise<{ id: string; examId: string }> },
) {
  await requirePlatformSession();
  const { id, examId } = await params;
  const tenantId = Number(id);
  const base = '/api/onyx/platform/tenants/' + encodeURIComponent(id);

  const detail = await read<ExamDetail>(base + '/exams/' + encodeURIComponent(examId));
  if (detail === null) return <Unavailable what="examination" />;
  const { exam, paper } = detail;
  const register = detail.register ?? [];

  // Scoped to this sitting's paper. An exam marked by hand has none, and the
  // queue is not asked for at all rather than asked for and thrown away.
  const queue = exam.assessment_id
    ? (await read<QueueRow[]>(base + '/proctor/queue?assessment_id=' + exam.assessment_id)) ?? []
    : [];

  const live = queue.filter((r) => r.status === 'in_progress');
  /*
   * Papers the rule has STOPPED, first on the page.
   *
   * There is a candidate sitting in front of each of these waiting to be told
   * whether their examination is over. Nothing else on this screen is that
   * urgent -- a flag can be read after the sitting; this cannot.
   */
  const stopped = queue.filter((r) => r.terminated_at);
  const flagged = queue.filter((r) => r.integrity_flags > 0)
    .sort((a, b) => b.open_events - a.open_events || b.integrity_flags - a.integrity_flags);
  const openEvents = queue.reduce((n, r) => n + Number(r.open_events ?? 0), 0);
  const deviceDown = live.filter((r) => (
    (r.requires_camera && r.camera_on !== true) || (r.requires_screen && r.screen_on !== true)
  ));
  // Said once here so the table and the button agree: nothing is watchable on
  // a paper whose candidates never agreed to being watched.
  const watchable = queue.some((r) => r.watch_camera);

  return (
    <div className="min-w-0 space-y-5">
      <LiveRefresh seconds={15} label="this sitting" />

      <Link href={'/onyx/platform/tenants/' + tenantId + '/invigilate'}
        className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-brand-700
                   hover:underline">
        <Icon name="chevron" className="h-4 w-4 rotate-180" />
        All sittings
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
                <><span>·</span>
                  <span className="tabular-nums">{exam.duration_minutes} min</span></>
              ) : null}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Workflow status={exam.status} />
            <Link href={'/onyx/platform/tenants/' + tenantId + '/examinations/' + exam.id}
              className="inline-flex min-h-[34px] items-center gap-1.5 rounded-xl border
                         border-slate-300 bg-white px-3 text-[13px] font-semibold
                         hover:bg-slate-50">
              Manage the sitting
            </Link>
          </div>
        </div>
      </Card>

      {exam.assessment_id === null ? (
        <Card className="p-5 text-center text-[13px] text-muted">
          This sitting is marked by hand — nothing is sat in a browser, so there is nothing to
          invigilate. Its marks and grades are below.
        </Card>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatTile label="Sitting now" value={live.length}
              note={paper ? paper.summary.sat + ' handed in' : 'papers open in a browser'} />
            <StatTile label="Flagged" value={flagged.length}
              note="attempts with at least one flag" />
            <StatTile label="Awaiting a decision" value={openEvents}
              note="flags nobody has ruled on" />
            <StatTile label="Device dropped" value={deviceDown.length}
              note={deviceDown.length
                ? 'a required camera or screen is not reporting'
                : 'every required device is reporting'} />
          </div>

          {stopped.length ? (
            <section>
              <SectionHead title="Stopped, and waiting on you" />
              <p className="mb-2 max-w-3xl text-[13px] leading-relaxed text-muted">
                These papers were handed in automatically because the candidate left the
                examination more times than it allows. Everything they had written is kept.
                Letting one carry on restores their answers and the minutes that were left
                on their clock — use it where what happened was not what it looked like.
              </p>
              <div tabIndex={0} role="region" aria-label="Stopped attempts" className={SCROLLER}>
                <DataTable
                  caption="Papers stopped by the departure rule, and the way back from it."
                  head={
                    <>
                      <th scope="col">Candidate</th>
                      <th scope="col">Stopped</th>
                      <th scope="col">Departures</th>
                      <th scope="col">Flags</th>
                      <th scope="col">&nbsp;</th>
                    </>
                  }
                >
                  {stopped.map((r) => (
                    <tr key={r.attempt_id} className="align-top">
                      <td>
                        <Link
                          href={'/onyx/platform/tenants/' + tenantId + '/attempts/' + r.attempt_id}
                          className="font-semibold hover:underline">
                          {candidateOf(r)}
                        </Link>
                        <div className="text-[12px] text-muted">Attempt {r.attempt_id}</div>
                      </td>
                      <td><StoppedBadge at={r.terminated_at} breaches={r.breaches} /></td>
                      <td className="tabular-nums">
                        {r.tab_switches} in all
                      </td>
                      <td className="tabular-nums">{r.integrity_flags}</td>
                      <td className="text-right">
                        <ReinstateAttempt
                          attemptId={r.attempt_id}
                          name={candidateOf(r)}
                          basePath={'onyx/platform/tenants/' + tenantId + '/attempts/'}
                          compact
                        />
                      </td>
                    </tr>
                  ))}
                </DataTable>
              </div>
            </section>
          ) : null}

          <section>
            <SectionHead title="Sitting now" />
            {live.length === 0 ? (
              <Card className="p-5 text-center text-[13px] text-muted">
                Nobody has this paper open. It either has not started or everybody has
                handed in.
              </Card>
            ) : (
              <div tabIndex={0} role="region" aria-label="Attempts in progress"
                className={SCROLLER}>
                <DataTable
                  caption="Papers open in a browser, with the state of each required device."
                  head={
                    <>
                      <th scope="col">Candidate</th>
                      <th scope="col">Camera</th>
                      <th scope="col">Screen</th>
                      <th scope="col">Left the paper</th>
                      <th scope="col">Flags</th>
                      <th scope="col">&nbsp;</th>
                    </>
                  }
                >
                  {live.map((r) => {
                    const cam = device(r.camera_on, r.requires_camera, 'Camera');
                    const scr = device(r.screen_on, r.requires_screen, 'Screen');
                    const sev = severity(r.integrity_flags);
                    return (
                      <tr key={r.attempt_id} className="align-middle">
                        <td>
                          <Link
                            href={'/onyx/platform/tenants/' + tenantId
                              + '/attempts/' + r.attempt_id}
                            className="font-semibold hover:underline">
                            {candidateOf(r)}
                          </Link>
                          <div className="text-[12px] text-muted">Attempt {r.attempt_id}</div>
                        </td>
                        <td><State tone={cam.tone}>{cam.text}</State></td>
                        <td><State tone={scr.tone}>{scr.text}</State></td>
                        <td className="tabular-nums">
                          {r.tab_switches === 0 ? (
                            <span className="text-muted">Never</span>
                          ) : (
                            <span className={r.tab_switches >= 3
                              ? 'font-semibold text-red-700' : ''}>
                              {r.tab_switches} {r.tab_switches === 1 ? 'time' : 'times'}
                            </span>
                          )}
                        </td>
                        <td>
                          <Score value={r.integrity_flags} band={sev.band} />
                          <span className="ml-1.5 text-[12px] text-muted">{sev.label}</span>
                        </td>
                        <td className="text-right">
                          {/* Only where the paper was set up for it and the
                              candidate consented — the API refuses the rest,
                              and offering a button that always fails is worse
                              than not offering one. */}
                          {r.watch_camera ? (
                            <WatchCandidate attemptId={r.attempt_id} name={candidateOf(r)}
                              base={'onyx/platform/tenants/' + tenantId + '/attempts/'} />
                          ) : (
                            <span className="text-[12px] text-muted">Not watchable</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </DataTable>
              </div>
            )}
            {!watchable && live.length ? (
              <p className="mt-2 text-[12.5px] leading-relaxed text-muted">
                This paper was not set up for live invigilation, so no camera can be watched.
                Its candidates agreed to monitoring that does not include being watched —
                turn “Watch the camera” on before the sitting, not during it.
              </p>
            ) : null}
          </section>

          <section>
            <SectionHead title="Breaches" />
            {flagged.length === 0 ? (
              <Card className="p-5 text-center text-[13px] text-muted">
                Nothing has been flagged on this sitting.
              </Card>
            ) : (
              <div tabIndex={0} role="region" aria-label="Breaches" className={SCROLLER}>
                <DataTable
                  caption="Every attempt invigilation has flagged, worst first."
                  head={
                    <>
                      <th scope="col">Candidate</th>
                      <th scope="col">Severity</th>
                      <th scope="col">Flags</th>
                      <th scope="col">Open</th>
                      <th scope="col">Case</th>
                      <th scope="col">&nbsp;</th>
                    </>
                  }
                >
                  {flagged.map((r) => {
                    const sev = severity(r.integrity_flags);
                    return (
                      <tr key={r.attempt_id} className="align-top">
                        <td>
                          <Link
                            href={'/onyx/platform/tenants/' + tenantId
                              + '/attempts/' + r.attempt_id}
                            className="font-semibold hover:underline">
                            {candidateOf(r)}
                          </Link>
                          <div className="text-[12px] text-muted">
                            {r.status === 'in_progress' ? 'still sitting' : r.status}
                          </div>
                        </td>
                        <td><Pill tone={sev.tone}>{sev.label}</Pill></td>
                        <td className="tabular-nums">{r.integrity_flags}</td>
                        <td className="tabular-nums">
                          {r.open_events
                            ? <Pill tone="soon">{r.open_events}</Pill>
                            : <span className="text-[12.5px] text-muted">settled</span>}
                        </td>
                        <td className="text-[12.5px] text-muted">
                          {r.integrity_status === 'none' ? 'clean' : r.integrity_status}
                        </td>
                        <td className="text-right">
                          {/* The decision itself, on the row that raised it.
                              Sending an operator to another screen to record
                              it is how flags come to sit open for a week. */}
                          <AttemptVerdict tenantId={tenantId} attemptId={r.attempt_id}
                            settled={r.integrity_status === 'cleared'
                              || r.integrity_status === 'upheld'} />
                        </td>
                      </tr>
                    );
                  })}
                </DataTable>
              </div>
            )}
          </section>
        </>
      )}

      <section>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <SectionHead title="Submissions and grades" />
          {exam.assessment_id ? (
            <a
              href={'/api/proxy/onyx/platform/tenants/' + tenantId + '/exams/'
                + examId + '/scripts.pdf'}
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
        {register.length === 0 ? (
          <Card className="p-5 text-center text-[13px] text-muted">
            Nobody is on this sitting yet — no attempt, no mark and no seat.
          </Card>
        ) : (
          <ExamRegister
            rows={register}
            attemptBase={'/onyx/platform/tenants/' + tenantId + '/attempts/'}
            scriptBase={'/api/proxy/onyx/platform/tenants/' + tenantId + '/attempts/'}
            outOf={exam.max_marks}
          />
        )}
      </section>
    </div>
  );
}
