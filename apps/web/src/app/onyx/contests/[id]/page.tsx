import Link from 'next/link';
import type { Metadata } from 'next';
import { OnyxShell } from '@/components/onyx-shell';
import { OnyxContestTeams } from '@/components/onyx-career';
import {
  BackLink, Banner, Card, DataTable, EmptyRow, Hero, Icon, ListRow, Meter, Pill, RowList, SectionHead, State,
} from '@/components/onyx-ui';
import { ShareLink } from '@/components/onyx-share';
import { navFor } from '@/lib/onyx-nav';
import { requireOnyxSession, onyxApi, type Me, onyxApiRecord } from '@/lib/onyx-session';
import type { Contest, Leaderboard, LeaderboardRow } from '@/lib/onyx-career';

export const metadata: Metadata = { title: 'Contest' };

/** A span of time, in the units a person would say it in. */
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
  return Math.round(days / 30) + ' months';
}

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/**
 * CAR-01a -- one contest: the problems, the teams and the board.
 *
 * The header is the hero band because a running contest is a clock: the time
 * left, how much of it has gone and where you stand are the whole screen for
 * the next hour, and they should not be three tiles apart.
 */
export default async function OnyxContestPage({ params }: { params: Promise<{ id: string }> }) {
  await requireOnyxSession();
  const { id } = await params;
  const [me, contest, board] = await Promise.all([
    onyxApi<Me>('/api/onyx/me'),
    onyxApiRecord<Contest>('/api/onyx/contests/' + id),
    onyxApiRecord<Leaderboard>('/api/onyx/contests/' + id + '/leaderboard'),
  ]);
  const now = Date.now();
  const starts = Date.parse(contest.starts_at);
  const ends = Date.parse(contest.ends_at);
  const running = starts <= now && now < ends;
  const finished = ends <= now;

  const problems = contest.problems ?? [];
  const totalPoints = problems.reduce((n, p) => n + (p.points ?? 0), 0);
  const format = contest.team_size > 1 ? 'Teams of up to ' + contest.team_size : 'Individual';

  // Where you stand comes out of the board you were already sent -- your row
  // is the one belonging to the team the API says you are in.
  const myTeamId = contest.my_team?.team_id;
  const mine: LeaderboardRow | undefined = myTeamId === undefined
    ? undefined : board.rows.find((r) => r.team_id === myTeamId);
  const myProblem = (problemId: number) =>
    mine?.problems?.find((p) => p.problem_id === problemId);

  const elapsed = ends > starts
    ? Math.max(0, Math.min(100, ((now - starts) / (ends - starts)) * 100)) : 0;

  const clock = running ? 'Ends in ' + gap(ends - now)
    : finished ? 'Finished ' + gap(now - ends) + ' ago'
      : 'Starts in ' + gap(starts - now);

  return (
    <OnyxShell
      me={me}
      nav={navFor(me.role)}
      title={contest.title}
      subtitle={format + ' · runs ' + gap(ends - starts)
        + (problems.length
          ? ' · ' + problems.length + ' problem' + (problems.length === 1 ? '' : 's')
            + (totalPoints ? ', ' + totalPoints + ' points' : '')
          : '')}
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <BackLink href="/onyx/contests" label="All contests" />
        <ShareLink label="Copy link" />
      </div>
      <nav aria-label="Breadcrumb"
        className="mb-4 flex items-center gap-1.5 text-[13px] text-muted">
        <Link href="/onyx/contests"
          className="font-semibold text-brand-600 hover:underline">Contests</Link>
        <Icon name="chevron" className="h-3.5 w-3.5 text-faint" />
        <span className="truncate">{contest.title}</span>
      </nav>

      <Hero
        eyebrow={format + (problems.length ? ' · ' + problems.length + ' problems' : '')}
        title={clock}
        sub={running
          ? gap(now - starts) + ' elapsed of ' + gap(ends - starts)
          : finished
            ? 'The board below is final.'
            : 'Runs for ' + gap(ends - starts) + '.'}
        actions={running ? (
          <span className="inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1.5
                           text-[13px] font-bold">
            <span aria-hidden="true" className="h-2 w-2 animate-pulse rounded-full bg-white" />
            Live
          </span>
        ) : null}
      >
        {running ? (
          <Meter percent={elapsed} tone="light"
            label={Math.round(elapsed) + '% of the contest has run'} />
        ) : null}

        {mine ? (
          <dl className="mt-3.5 flex flex-wrap gap-x-5 gap-y-1.5 text-[13px]">
            <HeroFigure k="Your rank" v={mine.rank + ' of ' + board.rows.length} />
            <HeroFigure k="Solved" v={mine.solved + (problems.length
              ? ' of ' + problems.length : '')} />
            <HeroFigure k="Points" v={mine.points + (totalPoints ? ' of ' + totalPoints : '')} />
            <HeroFigure k="Penalty" v={mine.penalty + ' min'} />
          </dl>
        ) : (
          <p className="mt-3.5 text-[13px] text-white/80">
            {contest.my_team
              ? 'You are entered. Nothing is on the board for your team yet.'
              : 'You have not entered this contest.'}
          </p>
        )}
      </Hero>

      {contest.description ? (
        <article className="mt-5 whitespace-pre-wrap text-sm text-slate-700">
          {contest.description}
        </article>
      ) : null}

      {/* min-w-0 on both columns is not cosmetic: a grid item defaults to
          min-width auto, so the leaderboard's own minimum would otherwise push
          the whole column -- hero, problems and all -- wider than a phone. */}
      <div className="mt-5 grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
        <div className="min-w-0 space-y-6">
          {/* Problems in contest order rather than by difficulty: the letter is
              how everyone refers to them for the length of the contest. */}
          {problems.length ? (
            <section>
              <div className="mb-2.5 flex items-baseline justify-between gap-3">
                <h2 className="text-[11.5px] font-bold uppercase tracking-[.085em] text-muted">
                  Problems
                </h2>
                {totalPoints ? (
                  <span className="text-[13px] tabular-nums text-muted">
                    {mine ? mine.points + ' of ' : ''}{totalPoints} points
                  </span>
                ) : null}
              </div>
              <RowList label="Contest problems">
                {problems.map((p, i) => {
                  const got = myProblem(p.problem_id);
                  const solved = Boolean(got?.solved);
                  const tried = Boolean(got && got.attempts > 0);
                  return (
                    <ListRow
                      key={p.problem_id}
                      icon={solved ? 'check' : tried ? 'refresh' : 'code'}
                      tone={solved ? 'good' : tried ? 'neutral' : 'brand'}
                      title={(LETTERS.charAt(i) || String(i + 1)) + ' · Problem ' + p.problem_id}
                      href={'/onyx/practice/' + p.problem_id}
                      chips={solved ? <Pill tone="good">Solved</Pill>
                        : tried ? <Pill tone="soon">Attempted</Pill>
                          : <Pill>Not started</Pill>}
                      meta={
                        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span>{p.points} points</span>
                          {got ? (
                            <>
                              <span aria-hidden="true">·</span>
                              <span>
                                {got.attempts} attempt{got.attempts === 1 ? '' : 's'}
                              </span>
                            </>
                          ) : null}
                          {solved && got?.at_minute !== null && got?.at_minute !== undefined ? (
                            <>
                              <span aria-hidden="true">·</span>
                              <span>solved at minute {got.at_minute}</span>
                            </>
                          ) : null}
                        </span>
                      }
                      action={{ href: '/onyx/practice/' + p.problem_id, label: 'Open' }}
                    />
                  );
                })}
              </RowList>
            </section>
          ) : null}

          {/* The one learner screen that earns a table instead of a row list: a
              leaderboard is a comparison down a column by definition. It is
              also the widest thing here, so it scrolls inside its own box and
              never takes the page sideways with it. */}
          <section>
            <div className="mb-2.5 flex items-baseline justify-between gap-3">
              <h2 className="text-[11.5px] font-bold uppercase tracking-[.085em] text-muted">
                Leaderboard
              </h2>
              <span className="text-[13px] text-muted">Ranked by points, then by penalty</span>
            </div>

            {board.frozen ? (
              <div className="mb-2.5">
                <Banner tone="warn" icon="lock">
                  The board is frozen
                  {board.frozen_after_minute !== null
                    ? ' after minute ' + board.frozen_after_minute : ''}
                  {' '}and stays frozen until the contest ends. Solves after that still count
                  &mdash; you just will not see them move.
                </Banner>
              </div>
            ) : null}

            <DataTable
              caption={'Leaderboard for ' + contest.title + ', '
                + board.rows.length + ' entries'}
              head={<>
                <th scope="col" className="w-16">Rank</th>
                <th scope="col">{contest.team_size > 1 ? 'Team' : 'Competitor'}</th>
                <th scope="col" className="text-right">Solved</th>
                <th scope="col" className="text-right">Points</th>
                <th scope="col" className="text-right">Penalty</th>
                <th scope="col" className="text-right">Last solve</th>
              </>}
            >
              {board.rows.map((r) => {
                const you = r.team_id === myTeamId;
                return (
                  <tr key={r.team_id}
                    className={'[&>td]:whitespace-nowrap ' + (you ? 'bg-brand-50' : '')}>
                    <td>
                      {r.rank <= 3 ? (
                        <Pill tone="brand">
                          <span className="inline-flex items-center gap-1 tabular-nums">
                            {r.rank === 1
                              ? <Icon name="trophy" className="h-3.5 w-3.5" /> : null}
                            {r.rank}
                          </span>
                        </Pill>
                      ) : (
                        <span className={'tabular-nums ' + (you ? 'font-bold' : '')}>{r.rank}</span>
                      )}
                    </td>
                    <td>
                      <span className="flex items-center gap-2">
                        <span className={'block max-w-[180px] truncate '
                          + (you ? 'font-bold' : 'font-semibold')}>{r.name}</span>
                        {/* Your own row is marked with a word, not only a tint
                            -- the same rule the status dots follow. */}
                        {you ? <Pill tone="brand">You</Pill> : null}
                      </span>
                    </td>
                    <td className="text-right tabular-nums">{r.solved}</td>
                    <td className={'text-right tabular-nums ' + (you ? 'font-bold' : '')}>
                      {r.points}
                    </td>
                    <td className="text-right tabular-nums text-muted">{r.penalty}</td>
                    <td className="text-right tabular-nums text-muted">
                      {r.last_solve_minute ? 'minute ' + r.last_solve_minute : '—'}
                    </td>
                  </tr>
                );
              })}
              {board.rows.length === 0 ? (
                <EmptyRow colSpan={6} icon="trophy">No teams yet.</EmptyRow>
              ) : null}
            </DataTable>

            {board.frozen ? (
              <p className="mt-2 text-[13px] text-muted">
                Solves in the closing minutes are hidden until the contest ends.
              </p>
            ) : null}
          </section>
        </div>

        <aside className="min-w-0 space-y-6">
          <section>
            <SectionHead title="Your entry" />
            <Card className="p-4">
              {mine ? (
                <dl className="grid gap-2">
                  <Row k="Rank" v={mine.rank + ' of ' + board.rows.length} />
                  <Row k="Solved" v={mine.solved + (problems.length
                    ? ' of ' + problems.length : '')} />
                  <Row k="Points" v={mine.points + (totalPoints ? ' of ' + totalPoints : '')} />
                  <Row k="Penalty" v={mine.penalty + ' min'} />
                  {mine.last_solve_minute ? (
                    <Row k="Last solve" v={'minute ' + mine.last_solve_minute} />
                  ) : null}
                </dl>
              ) : (
                <p className="text-sm text-muted">
                  Nothing on the board yet. It fills in as soon as a problem is judged.
                </p>
              )}
              <div className="mt-3 border-t border-line pt-3">
                <OnyxContestTeams
                  contestId={Number(id)}
                  teams={contest.teams ?? []}
                  inTeam={Boolean(contest.my_team)}
                  teamSize={contest.team_size}
                />
              </div>
            </Card>
          </section>

          <section>
            <SectionHead title="Scoring" />
            <Card className="p-4">
              <dl className="grid gap-2">
                <Row k="Format" v={format} />
                <Row k="Wrong attempt" v={contest.penalty_minutes
                  ? '+' + contest.penalty_minutes + ' min' : 'no penalty'} />
                <Row k="Board freeze" v={contest.freeze_minutes
                  ? 'last ' + contest.freeze_minutes + ' min' : 'never'} />
                <Row k="Starts" v={new Date(contest.starts_at).toLocaleString()} />
                <Row k="Ends" v={new Date(contest.ends_at).toLocaleString()} />
              </dl>
              <p className="mt-3 border-t border-line pt-3 text-[13px] text-muted">
                Solve them in Code Lab, then record the submission here.
                {contest.penalty_minutes
                  ? ' Each wrong attempt on a problem you eventually solve adds '
                    + contest.penalty_minutes + ' minutes.'
                  : ''}
              </p>
              {!running ? (
                <p className="mt-2 text-[13px] text-muted">
                  {starts > now ? 'This has not started yet.' : 'This has finished.'}
                </p>
              ) : null}
              {contest.status === 'draft' ? (
                <p className="mt-2">
                  <State tone="idle">Draft &mdash; not yet published</State>
                </p>
              ) : null}
            </Card>
          </section>
        </aside>
      </div>
    </OnyxShell>
  );
}

/** One figure on the dark band. The label is dimmed; the value is not. */
function HeroFigure({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <dt className="text-white/75">{k}</dt>
      <dd className="font-extrabold tabular-nums">{v}</dd>
    </div>
  );
}

/** One key and its value, at the size every card in the kit uses. */
function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-[12.5px] text-muted">{k}</dt>
      <dd className="text-right text-[14px] font-semibold tabular-nums">{v}</dd>
    </div>
  );
}
