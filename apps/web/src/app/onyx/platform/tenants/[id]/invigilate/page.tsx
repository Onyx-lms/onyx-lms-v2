import Link from 'next/link';
import type { Metadata } from 'next';
import { requirePlatformSession } from '@/lib/onyx-platform-session';
import {
  attempt as read, SCROLLER, Unavailable, WhenCell, type AcademicsPayload,
} from '@/lib/onyx-platform-tenant';
import { LiveRefresh } from '@/components/onyx-live';
import {
  Card, DataTable, EmptyRow, Icon, Pill, SectionHead, StatTile,
} from '@/components/onyx-ui';
import { type QueueRow, sittingOf } from '@/lib/onyx-console-invigilate';

export const metadata: Metadata = { title: 'Invigilate' };

/**
 * What is being sat at this institution right now.
 *
 * The console could report on a sitting after the fact — marks, scripts, flag
 * scores — but had no view of one in progress, so an operator asked to watch
 * an examination on an institution's behalf was handed that institution's own
 * administrator account. This is the missing half.
 *
 * Scheduled EXAMINATIONS come first and are listed even when nobody has
 * started yet, because an invigilator's question before a sitting is "is it
 * live", and a table that only shows papers with attempts on them answers that
 * with silence. Ordinary assessments follow, and only where somebody is
 * actually sitting one: a quiz nobody has opened is not an invigilation
 * matter.
 */
export default async function OnyxPlatformInvigilatePage(
  { params }: { params: Promise<{ id: string }> },
) {
  await requirePlatformSession();
  const { id } = await params;
  const tenantId = Number(id);
  const base = '/api/onyx/platform/tenants/' + encodeURIComponent(id);

  const [academics, queue] = await Promise.all([
    read<AcademicsPayload>(base + '/academics?limit=200'),
    read<QueueRow[]>(base + '/proctor/queue'),
  ]);

  if (academics === null) return <Unavailable what="invigilation console" />;
  const rows = queue ?? [];

  // Only exams sat online carry an assessment_id at all; a paper exam never
  // enters this map, and nothing on this screen claims to invigilate one.
  const exams = (academics.exams ?? []).filter((e) => e.assessment_id != null);
  const byAssessment = new Map(exams.map((e) => [Number(e.assessment_id), e]));

  const live = rows.filter((r) => r.status === 'in_progress');
  const flagged = rows.filter((r) => r.integrity_flags > 0);
  const openEvents = rows.reduce((n, r) => n + Number(r.open_events ?? 0), 0);
  // A running paper whose required device has dropped out: the one thing here
  // worth interrupting somebody for.
  const deviceDown = live.filter((r) => (
    (r.requires_camera && r.camera_on !== true) || (r.requires_screen && r.screen_on !== true)
  ));

  const examRows = exams.map((e) => ({
    exam: e,
    ...sittingOf(rows.filter((r) => Number(r.assessment_id) === Number(e.assessment_id))),
  }));

  // Everything running that is NOT a scheduled examination, grouped by paper.
  const looseIds = [...new Set(live
    .map((r) => Number(r.assessment_id))
    .filter((aid) => !byAssessment.has(aid)))];
  const loose = looseIds.map((aid) => ({
    assessment_id: aid,
    title: (academics.assessments ?? []).find((a) => Number(a.id) === aid)?.title
      ?? 'Assessment #' + aid,
    ...sittingOf(rows.filter((r) => Number(r.assessment_id) === aid)),
  })).sort((a, b) => b.live - a.live);

  return (
    <div className="min-w-0 space-y-5">
      {/* A console watching a sitting that goes stale is a console that says a
          candidate is fine when they left the paper two minutes ago. */}
      <LiveRefresh seconds={20} label="invigilation" />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Sitting now" value={live.length}
          note={live.length ? 'papers open in a browser' : 'nothing is being sat'} />
        <StatTile label="Flagged" value={flagged.length}
          note="attempts with at least one flag" />
        <StatTile label="Awaiting a decision" value={openEvents}
          note="flags nobody has ruled on" />
        <StatTile label="Device dropped" value={deviceDown.length}
          note={deviceDown.length
            ? 'a required camera or screen is not reporting'
            : 'every required device is reporting'} />
      </div>

      <section>
        <SectionHead title="Scheduled examinations" />
        <div tabIndex={0} role="region" aria-label="Scheduled examinations" className={SCROLLER}>
          <DataTable
            caption="Examinations sat through the browser, and what invigilation is seeing."
            head={
              <>
                <th scope="col">Examination</th>
                <th scope="col">Course</th>
                <th scope="col">When</th>
                <th scope="col">Sitting</th>
                <th scope="col">Flagged</th>
                <th scope="col">Open flags</th>
                <th scope="col">&nbsp;</th>
              </>
            }
          >
            {examRows.length === 0 ? (
              <EmptyRow colSpan={7} icon="shield">
                No examination here is sat through the browser. A sitting marked by hand has
                nothing to invigilate — tie one to a question bank to invigilate it.
              </EmptyRow>
            ) : examRows.map((x) => (
              <tr key={x.exam.id} className="align-top">
                <td>
                  <Link href={'/onyx/platform/tenants/' + tenantId + '/invigilate/' + x.exam.id}
                    className="font-semibold hover:underline">
                    {x.exam.title}
                  </Link>
                </td>
                <td className="font-mono text-[12.5px]">
                  {x.exam.course?.code ?? <span className="font-sans text-muted">—</span>}
                </td>
                <td><WhenCell at={x.exam.starts_at} status={x.exam.status} /></td>
                <td className="tabular-nums">
                  {x.live
                    ? <Pill tone="brand">{x.live} live</Pill>
                    : <span className="text-[12.5px] text-muted">nobody</span>}
                </td>
                <td className="tabular-nums">
                  {x.flagged
                    ? <Pill tone="late">{x.flagged}</Pill>
                    : <span className="text-[12.5px] text-muted">clean</span>}
                </td>
                <td className="tabular-nums">
                  {x.open
                    ? <Pill tone="soon">{x.open}</Pill>
                    : <span className="text-[12.5px] text-muted">—</span>}
                </td>
                <td className="text-right">
                  <Link href={'/onyx/platform/tenants/' + tenantId + '/invigilate/' + x.exam.id}
                    className="inline-flex min-h-[30px] items-center gap-1 rounded-lg border
                               border-slate-300 px-2.5 text-[12.5px] font-semibold
                               hover:bg-slate-50">
                    <Icon name="shield" className="h-3.5 w-3.5" />
                    Invigilate
                  </Link>
                </td>
              </tr>
            ))}
          </DataTable>
        </div>
      </section>

      <section>
        <SectionHead title="Other papers being sat" />
        {loose.length === 0 ? (
          <Card className="p-5 text-center text-[13px] text-muted">
            Nobody is sitting an ordinary assessment right now.
          </Card>
        ) : (
          <div tabIndex={0} role="region" aria-label="Other papers" className={SCROLLER}>
            <DataTable
              caption="Assessments in progress that are not a scheduled examination."
              head={
                <>
                  <th scope="col">Paper</th>
                  <th scope="col">Sitting</th>
                  <th scope="col">Flagged</th>
                  <th scope="col">Open flags</th>
                  <th scope="col">&nbsp;</th>
                </>
              }
            >
              {loose.map((x) => (
                <tr key={x.assessment_id} className="align-top">
                  <td className="font-semibold">{x.title}</td>
                  <td className="tabular-nums">{x.live}</td>
                  <td className="tabular-nums">{x.flagged}</td>
                  <td className="tabular-nums">{x.open}</td>
                  <td className="text-right">
                    <Link
                      href={'/onyx/platform/tenants/' + tenantId
                        + '/assessments/' + x.assessment_id}
                      className="text-[12.5px] font-semibold text-brand-700 hover:underline">
                      Open the paper
                    </Link>
                  </td>
                </tr>
              ))}
            </DataTable>
          </div>
        )}
      </section>
    </div>
  );
}
