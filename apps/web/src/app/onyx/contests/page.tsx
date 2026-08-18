import type { Metadata } from 'next';
import { OnyxShell } from '@/components/onyx-shell';
import {
  ActionLink, Banner, CardGrid, Empty, ListRow, Pill, RowList, SectionHead, State, StatTile,
} from '@/components/onyx-ui';
import { navFor } from '@/lib/onyx-nav';
import { requireOnyxSession, onyxApi, type Me } from '@/lib/onyx-session';
import type { Contest } from '@/lib/onyx-career';
import { CreatePanel } from '@/components/onyx-create';

export const metadata: Metadata = { title: 'Contests' };

/**
 * A span of time, in the units a person would say it in.
 *
 * "Ends in 1 h 12 min" is what someone in a running contest is reading the
 * clock for; `10/4/2026, 6:00:00 PM` makes that a subtraction.
 */
function gap(ms: number): string {
  const mins = Math.max(0, Math.round(Math.abs(ms) / 60_000));
  if (mins < 1) return 'under a minute';
  if (mins < 60) return mins + ' min';
  const hours = Math.floor(mins / 60);
  if (hours < 24) {
    const rest = mins % 60;
    return hours + ' h' + (rest ? ' ' + rest + ' min' : '');
  }
  const days = Math.round(hours / 24);
  if (days < 14) return days + (days === 1 ? ' day' : ' days');
  const weeks = Math.round(days / 7);
  if (weeks < 9) return weeks + ' weeks';
  const months = Math.round(days / 30);
  return months + (months === 1 ? ' month' : ' months');
}

/** The one line of context a contest row is worth, from what the API returns. */
function shape(c: Contest): string[] {
  const problems = c.problems ?? [];
  const points = problems.reduce((n, p) => n + (p.points ?? 0), 0);
  return [
    c.team_size > 1 ? 'Teams of up to ' + c.team_size : 'Individual',
    problems.length
      ? problems.length + ' problem' + (problems.length === 1 ? '' : 's')
        + (points ? ', ' + points + ' points' : '')
      : null,
    'runs ' + gap(Date.parse(c.ends_at) - Date.parse(c.starts_at)),
    c.freeze_minutes ? 'board freezes for the last ' + c.freeze_minutes + ' minutes' : null,
  ].filter(Boolean) as string[];
}

function ContestMeta({ lead, c }: { lead?: React.ReactNode; c: Contest }) {
  return (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
      {lead ? <>{lead}<span aria-hidden="true">·</span></> : null}
      {shape(c).map((s, i) => (
        <span key={s} className="flex items-center gap-2">
          {i ? <span aria-hidden="true">·</span> : null}{s}
        </span>
      ))}
    </span>
  );
}

/** CAR-01 -- hackathons and contests. */
export default async function OnyxContestsPage() {
  await requireOnyxSession();
  const [me, contests] = await Promise.all([
    onyxApi<Me>('/api/onyx/me'),
    onyxApi<Contest[]>('/api/onyx/contests'),
  ]);
  const now = Date.now();

  const live = contests
    .filter((c) => Date.parse(c.starts_at) <= now && now < Date.parse(c.ends_at))
    .sort((a, b) => Date.parse(a.ends_at) - Date.parse(b.ends_at));
  const upcoming = contests.filter((c) => Date.parse(c.starts_at) > now)
    .sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at));
  const past = contests.filter((c) => Date.parse(c.ends_at) <= now)
    .sort((a, b) => Date.parse(b.ends_at) - Date.parse(a.ends_at));

  const soonest = live[0];
  const next = upcoming[0];

  return (
    <OnyxShell
      me={me}
      nav={navFor(me.role)}
      title="Contests"
      subtitle="Timed events, judged by the same evaluator as Code Lab."
    >
      {/* CAR-01: "administrators must host timed events with team formation,
          leaderboards and judging". */}
      {me.role === 'admin' || me.role === 'placement' ? (
        <div className="mb-6">
          <CreatePanel
            title="New contest" cta="Host a contest" icon="trophy"
            rules={[{ kind: 'before', field: 'starts_at', than: 'ends_at', orEqual: true,
              message: 'That contest ends before it starts.' }]}
            endpoint="contests"
            fields={[
              { name: 'title', label: 'Contest', required: true, wide: true,
                placeholder: 'Autumn Hackathon' },
              { name: 'description', label: 'Description', type: 'textarea', rows: 2 },
              { name: 'starts_at', label: 'Starts', type: 'datetime', required: true },
              { name: 'ends_at', label: 'Ends', type: 'datetime', required: true },
              { name: 'team_size', label: 'Team size', type: 'number', min: 1, max: 10,
                fallback: 1, help: '1 for an individual contest.' },
              { name: 'freeze_minutes', label: 'Freeze board for last (min)', type: 'number',
                min: 0, max: 600, fallback: 0 },
            ]}
          />
        </div>
      ) : null}

      {/* A contest that is running and ending is the most perishable thing on
          this screen, so it is a banner above everything rather than a row you
          have to find. */}
      {soonest ? (
        <div className="mb-5">
          <Banner tone="late" icon="clock"
            action={<ActionLink href={'/onyx/contests/' + soonest.id} label="Go to contest" />}>
            <span className="font-bold">
              {soonest.title} ends in {gap(Date.parse(soonest.ends_at) - now)}.
            </span>
            {live.length > 1 ? (
              <span className="block text-[13px]">
                {live.length - 1} other contest{live.length === 2 ? ' is' : 's are'} running too.
              </span>
            ) : null}
          </Banner>
        </div>
      ) : null}

      {contests.length ? (
        <div className="mb-6">
          <CardGrid min="10rem">
            <StatTile label="Scheduled" value={contests.length} note="in this institution" />
            <StatTile label="Live now" value={live.length}
              note={live.length ? 'judging as you watch' : 'nothing running'} />
            <StatTile label="Upcoming" value={upcoming.length}
              note={next ? 'next in ' + gap(Date.parse(next.starts_at) - now)
                : 'none scheduled'} />
            <StatTile label="Finished" value={past.length} note="results are final" />
          </CardGrid>
        </div>
      ) : null}

      {/* Three sections rather than one list sorted by date: live, upcoming and
          past ask for three different things -- compete, register, review --
          and a single ordered list makes you work out which is which from a
          timestamp. */}
      {live.length ? (
        <section className="mb-7">
          <div className="mb-2.5 flex items-baseline justify-between gap-3">
            <h2 className="text-[11.5px] font-bold uppercase tracking-[.085em] text-muted">
              Live now
            </h2>
            <State tone="live">{live.length} running</State>
          </div>
          <RowList label="Live contests">
            {live.map((c) => (
              <ListRow
                key={c.id}
                icon="trophy" tone="brand"
                title={c.title}
                href={'/onyx/contests/' + c.id}
                chips={<>
                  {c.my_team ? <Pill tone="good">Entered</Pill> : <Pill>Not entered</Pill>}
                  {c.status === 'draft' ? <Pill tone="neutral">Draft</Pill> : null}
                </>}
                meta={<ContestMeta c={c} lead={
                  <State tone="live">Ends in {gap(Date.parse(c.ends_at) - now)}</State>
                } />}
                action={{ href: '/onyx/contests/' + c.id, label: 'Compete' }}
              />
            ))}
          </RowList>
        </section>
      ) : null}

      {upcoming.length ? (
        <section className="mb-7">
          <SectionHead title={'Upcoming · ' + upcoming.length} />
          <RowList label="Upcoming contests">
            {upcoming.map((c) => (
              <ListRow
                key={c.id}
                icon="clock" tone="neutral"
                title={c.title}
                href={'/onyx/contests/' + c.id}
                chips={<>
                  {c.my_team ? <Pill tone="good">Registered</Pill> : null}
                  {c.status === 'draft' ? <Pill tone="neutral">Draft</Pill> : null}
                </>}
                meta={<ContestMeta c={c} lead={
                  <span className="font-semibold text-accent-700">
                    Starts in {gap(Date.parse(c.starts_at) - now)}
                  </span>
                } />}
                action={{ href: '/onyx/contests/' + c.id,
                  label: c.team_size > 1 ? 'Your team' : 'Open' }}
              />
            ))}
          </RowList>
        </section>
      ) : null}

      {past.length ? (
        <section className="mb-7">
          <SectionHead title={'Past · ' + past.length} />
          <RowList label="Past contests">
            {past.map((c) => (
              <ListRow
                key={c.id}
                icon="award" tone="neutral"
                title={c.title}
                href={'/onyx/contests/' + c.id}
                chips={c.status === 'judged' ? <Pill tone="good">Judged</Pill> : null}
                meta={<ContestMeta c={c} lead={
                  <span>Finished {gap(now - Date.parse(c.ends_at))} ago</span>
                } />}
                action={{ href: '/onyx/contests/' + c.id, label: 'Review' }}
              />
            ))}
          </RowList>
        </section>
      ) : null}

      {contests.length === 0 ? (
        <RowList label="Contests">
          <li><Empty icon="trophy">Nothing is scheduled.</Empty></li>
        </RowList>
      ) : null}
    </OnyxShell>
  );
}
