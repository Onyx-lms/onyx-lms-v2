import Link from 'next/link';
import type { Metadata } from 'next';
import { OnyxShell } from '@/components/onyx-shell';
import {
  BackLink, Banner, Card, DataTable, Empty, EmptyRow, Icon, Meter, Pill, Score, SectionHead, StatTile, State, Stepper, relativeDue,
} from '@/components/onyx-ui';
import { navFor } from '@/lib/onyx-nav';
import { requireOnyxPageRole, onyxApi, onyxApiSafe, type Me } from '@/lib/onyx-session';
import { APPLICATION_LABELS, type Application, type DriveSummary } from '@/lib/onyx-career';
import { RecordRound } from '@/components/onyx-manage';

export const metadata: Metadata = { title: 'Drive' };

const STATUS_TONE: Record<string, 'neutral' | 'brand' | 'good' | 'late' | 'soon'> = {
  applied: 'neutral', shortlisted: 'brand', interviewing: 'brand',
  offered: 'good', hired: 'good', rejected: 'late', withdrawn: 'neutral',
};

/**
 * CAR-04c -- one drive, and whether its rounds and its offers agree.
 *
 * The reconciliation is reported rather than corrected. An offer made outside
 * the last round is a real thing that happens; the platform's job is to say so,
 * not to pretend it did not.
 *
 * The drive IS the pipeline, so the pipeline is the first thing on the page and
 * it carries its own numbers: a stepper with counts answers the only two
 * questions anybody opens this screen with -- how far along is it, and how many
 * fell out where.
 */
export default async function OnyxDrivePage({ params }: { params: Promise<{ id: string }> }) {
  await requireOnyxPageRole('admin', 'placement');
  const { id } = await params;
  const [me, summary, members] = await Promise.all([
    onyxApi<Me>('/api/onyx/me'),
    onyxApi<DriveSummary>('/api/onyx/drives/' + id + '/summary'),
    onyxApiSafe<{ user_id: string; user: { name: string } | null }[]>('/api/onyx/members'),
  ]);
  const names = new Map((members ?? [])
    .map((m) => [m.user_id, m.user?.name ?? ('User ' + m.user_id)]));

  // Who is actually in this drive: the people who applied to the post it runs
  // against, minus the ones already rejected or withdrawn. An employer coming
  // to interview six people is not handed the institution's roster.
  const applicants = summary.drive.job_id
    ? await onyxApiSafe<Application[]>(
      '/api/onyx/jobs/' + summary.drive.job_id + '/applicants')
    : null;
  const roster = (applicants ?? []).map((a) => ({
    id: a.id,
    user_id: a.user_id,
    status: a.status,
    created_at: a.created_at,
    readiness_at_apply: a.readiness_at_apply,
    name: a.candidate?.name ?? names.get(a.user_id) ?? ('User ' + a.user_id),
  }));
  const candidates = roster
    .filter((a) => !['rejected', 'withdrawn'].includes(a.status))
    .map((a) => ({ user_id: a.user_id, name: a.name }));

  // The funnel's base: everybody who turned up to, or was marked absent from,
  // the widest round -- and never smaller than the applicant list, so a bar
  // cannot exceed its own track.
  const base = Math.max(
    ...summary.rounds.map((r) => r.attended + r.absent),
    roster.length, 1);

  const recorded = (r: { attended: number; absent: number }) => r.attended + r.absent > 0;
  const firstOpen = summary.rounds.findIndex((r) => !recorded(r));
  const when = relativeDue(summary.drive.scheduled_at);

  return (
    <OnyxShell
      me={me}
      nav={navFor(me.role)}
      title={summary.drive.title}
      subtitle={[
        summary.drive.scheduled_at ? when.text : 'Not scheduled',
        summary.drive.venue,
      ].filter(Boolean).join(' · ')}
    >
      <BackLink href="/onyx/placement" label="Placement" />
      <nav aria-label="Breadcrumb" className="mb-4">
        <Link href="/onyx/placement"
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand-600
                     hover:underline">
          <Icon name="chevron" className="h-3.5 w-3.5 rotate-180" />
          Placement
        </Link>
      </nav>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="In the pipeline" value={roster.length}
          note={candidates.length + ' still in contention'} />
        <StatTile label="Rounds" value={summary.rounds.length}
          note={summary.rounds.filter(recorded).length + ' recorded'} />
        <StatTile label="Cleared the last round" value={summary.cleared_final_round}
          note="through every recorded round" />
        <StatTile label="Offers" value={summary.offers}
          note={summary.reconciles ? 'agrees with the rounds' : 'does not agree with the rounds'} />
      </div>

      <section className="mt-6">
        <SectionHead title="Pipeline" />
        <Card className="p-4">
          {summary.rounds.length ? (
            <>
              <Stepper steps={[
                ...summary.rounds.map((r, i) => ({
                  label: r.name + ' · ' + r.passed,
                  state: (recorded(r) ? 'done' : i === firstOpen ? 'current' : 'todo') as
                    'done' | 'current' | 'todo',
                })),
                {
                  label: 'Offered · ' + summary.offers,
                  state: (summary.offers > 0 ? 'done' : 'todo') as 'done' | 'current' | 'todo',
                },
              ]} />

              {/* The same numbers as widths, because "68 of 142" is a fact and
                  a half-length bar is a shape you take in without reading. */}
              <ul className="mt-4 space-y-3 border-t border-line pt-4">
                {summary.rounds.map((r) => (
                  <li key={r.round_id}>
                    <div className="flex items-baseline justify-between gap-2 text-[13px]">
                      <span className="min-w-0 truncate font-bold">{r.name}</span>
                      <span className="shrink-0 tabular-nums text-muted">
                        {r.passed} passed · {Math.round((r.passed / base) * 100)}%
                      </span>
                    </div>
                    <div className="mt-1.5">
                      <Meter percent={(r.passed / base) * 100}
                        label={r.name + ', ' + r.passed + ' of ' + base + ' passed'} />
                    </div>
                    <div className="mt-1 text-[11.5px] text-muted tabular-nums">
                      {r.attended} attended · {r.absent} absent · {r.failed} did not pass
                    </div>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <Empty icon="layers">
              No rounds defined yet. A drive without rounds has nothing to record against,
              so its offers cannot be checked.
            </Empty>
          )}
        </Card>
      </section>

      {/* Rounds against offers. Amber, not red -- this is a decision, not a
          fault, and the platform reports the disagreement rather than
          quietly correcting it. */}
      <section className="mt-6">
        <SectionHead title="Rounds against offers" />
        <Banner tone={summary.reconciles ? 'good' : 'warn'}
          icon={summary.reconciles ? 'check' : 'flag'}>
          <strong className="font-bold">
            {summary.cleared_final_round} cleared the last round; {summary.offers} offer
            {summary.offers === 1 ? '' : 's'} recorded.
          </strong>
          {summary.reconciles ? (
            <span className="mt-0.5 block">These agree.</span>
          ) : (
            <span className="mt-1 block space-y-1">
              {summary.cleared_without_offer.length ? (
                <span className="block">
                  Cleared but no offer:{' '}
                  <span className="font-bold">
                    {summary.cleared_without_offer.map((u) => names.get(u) ?? u).join(', ')}
                  </span>
                </span>
              ) : null}
              {summary.offered_without_clearing.length ? (
                <span className="block">
                  Offered without clearing the last round:{' '}
                  <span className="font-bold">
                    {summary.offered_without_clearing.map((u) => names.get(u) ?? u).join(', ')}
                  </span>
                </span>
              ) : null}
              <span className="block text-xs">
                Neither is necessarily wrong &mdash; this is here so it is a decision
                rather than a surprise.
              </span>
            </span>
          )}
        </Banner>
      </section>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-7">
          {/* Candidates as a table: the officer is comparing stage against
              readiness down forty rows to decide who to push into the free
              slots. Readiness is a Score so the band and the number arrive
              together -- a colour on its own tells a colour-blind reader
              nothing. */}
          <section>
            <SectionHead title="Candidates" />
            <DataTable
              caption={'Candidates in the ' + summary.drive.title + ' drive'}
              head={
                <>
                  <th scope="col">Candidate</th>
                  <th scope="col">Stage</th>
                  <th scope="col">Readiness then</th>
                  <th scope="col">Applied</th>
                </>
              }
            >
              {roster.map((a) => (
                <tr key={a.id}>
                  <td className="font-semibold">{a.name}</td>
                  <td>
                    <Pill tone={STATUS_TONE[a.status] ?? 'neutral'}>
                      {APPLICATION_LABELS[a.status] ?? a.status}
                    </Pill>
                  </td>
                  <td>
                    {a.readiness_at_apply !== null
                      ? <Score value={a.readiness_at_apply} outOf={100} />
                      : <Score value="—" band="none" />}
                  </td>
                  <td className="whitespace-nowrap text-muted">
                    {new Date(a.created_at).toLocaleDateString(undefined,
                      { day: 'numeric', month: 'short' })}
                  </td>
                </tr>
              ))}
              {roster.length === 0 ? (
                <EmptyRow colSpan={4} icon="users">
                  {summary.drive.job_id
                    ? 'Nobody has applied to the post this drive runs against.'
                    : 'This drive is not attached to a post, so it has no applicant list.'}
                </EmptyRow>
              ) : null}
            </DataTable>
          </section>

          <section>
            <SectionHead title="Rounds" />
            <DataTable
              caption={'Rounds in the ' + summary.drive.title + ' drive'}
              head={
                <>
                  <th scope="col">Round</th>
                  <th scope="col">Recorded</th>
                  <th scope="col">Attended</th>
                  <th scope="col">Absent</th>
                  <th scope="col">Passed</th>
                  <th scope="col">Failed</th>
                </>
              }
            >
              {summary.rounds.map((r) => (
                <tr key={r.round_id}>
                  <td>
                    <span className="block font-semibold">{r.name}</span>
                    <span className="mt-1.5 inline-block">
                      <RecordRound roundId={r.round_id} roundName={r.name}
                        candidates={candidates} />
                    </span>
                  </td>
                  <td>
                    {recorded(r)
                      ? <State tone="on">Recorded</State>
                      : <State tone="idle">Nothing yet</State>}
                  </td>
                  <td className="tabular-nums">{r.attended}</td>
                  <td className="tabular-nums">{r.absent}</td>
                  <td className="tabular-nums font-bold">{r.passed}</td>
                  <td className="tabular-nums">{r.failed}</td>
                </tr>
              ))}
              {summary.rounds.length === 0 ? (
                <EmptyRow colSpan={6} icon="layers">No rounds defined.</EmptyRow>
              ) : null}
            </DataTable>
          </section>
        </div>

        {/* -------------------------------------------------------------- rail */}
        <aside className="min-w-0 space-y-6">
          <section>
            <SectionHead title="The drive" />
            <Card className="p-4">
              <dl className="divide-y divide-line text-[13.5px]">
                <div className="flex items-center justify-between gap-3 py-2">
                  <dt className="text-muted">When</dt>
                  <dd>
                    {summary.drive.scheduled_at
                      ? <Pill tone={when.tone}>{when.text}</Pill>
                      : <State tone="idle">Not scheduled</State>}
                  </dd>
                </div>
                {summary.drive.scheduled_at ? (
                  <div className="flex items-center justify-between gap-3 py-2">
                    <dt className="text-muted">Date</dt>
                    <dd className="min-w-0 break-words text-right font-bold">
                      {new Date(summary.drive.scheduled_at).toLocaleString(undefined,
                        { weekday: 'short', day: 'numeric', month: 'short',
                          hour: '2-digit', minute: '2-digit' })}
                    </dd>
                  </div>
                ) : null}
                <div className="flex items-center justify-between gap-3 py-2">
                  <dt className="text-muted">Venue</dt>
                  <dd className="min-w-0 break-words text-right font-bold">{summary.drive.venue ?? 'Not set'}</dd>
                </div>
                <div className="flex items-center justify-between gap-3 py-2">
                  <dt className="text-muted">Stage</dt>
                  <dd className="font-bold capitalize">{summary.drive.status}</dd>
                </div>
                {summary.drive.job_id ? (
                  <div className="flex items-center justify-between gap-3 py-2">
                    <dt className="text-muted">Post</dt>
                    <dd>
                      <Link href={'/onyx/jobs/' + summary.drive.job_id}
                        className="font-bold text-brand-600 hover:underline">
                        Open the post
                      </Link>
                    </dd>
                  </div>
                ) : null}
              </dl>
              <p className="mt-3.5 border-t border-line pt-3 text-xs text-muted">
                The employer sees only the people who applied to this post &mdash; never
                the institution&rsquo;s roster.
              </p>
            </Card>
          </section>
        </aside>
      </div>
    </OnyxShell>
  );
}
