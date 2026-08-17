/**
 * CAR-01 / CAR-02 -- contests and mock interviews.
 *
 * "Host timed events with team formation, leaderboards and structured judging."
 * "Scheduled practice interviews with structured feedback and optional
 * recording for later review."
 *
 * The leaderboard is the interesting part. CAR-01a's acceptance criterion is
 * that it is **correct and stable under concurrent submissions**, which means
 * two things and they are different:
 *
 *   * **Correct** -- a team's score counts each problem once, at its first
 *     solve, with a penalty per earlier wrong attempt on that problem. Later
 *     submissions on a solved problem change nothing.
 *   * **Stable** -- the order never depends on insertion order or on which row
 *     the database happened to return first. Ties break on penalty, then on the
 *     minute of the last solve, then on team id, which is total.
 *
 * Both are computed from the submissions rather than from a running total on
 * the team row: an increment under concurrency is a lost update waiting to
 * happen, and a leaderboard that is occasionally wrong is worse than a slow one.
 */
import type { OnyxDb } from './db.ts';
import type { Role } from '@onyx/types';
import { HttpError } from '../http/errors.ts';

const CONTEST_COLUMNS = 'id, tenant_id, title, description, starts_at, ends_at, problems, team_size, penalty_minutes, status, freeze_minutes, created_at';
const TEAM_COLUMNS = 'id, tenant_id, contest_id, name, created_by, created_at';
const MEMBER_COLUMNS = 'id, tenant_id, team_id, contest_id, user_id, created_at';
const SUBMISSION_COLUMNS = 'id, tenant_id, contest_id, team_id, user_id, problem_id, submission_id, solved, points, at_minute, created_at';
const INTERVIEW_COLUMNS = 'id, tenant_id, user_id, interviewer_id, title, scheduled_at, duration_minutes, join_url, status, feedback, overall, notes, recording_path, recording_consented_at, released_at, created_at';

const STAFF: Role[] = ['admin', 'faculty', 'placement'];
const isStaff = (role: Role) => STAFF.includes(role);

export interface LeaderboardRow {
  rank: number;
  team_id: number;
  name: string;
  solved: number;
  points: number;
  /** Total penalty minutes: time to each solve plus the wrong attempts before it. */
  penalty: number;
  last_solve_minute: number;
  problems: { problem_id: number; solved: boolean; attempts: number; at_minute: number | null }[];
}

export class ContestService {
  #db: OnyxDb;
  #now: () => number;

  constructor(db: OnyxDb, now: () => number = Date.now) {
    this.#db = db;
    this.#now = now;
  }

  // -------------------------------------------------------------------------
  // CAR-01 -- contests
  // -------------------------------------------------------------------------

  async create(tenantId: number, createdBy: string, input: {
    title: string; description?: string | null;
    starts_at: string; ends_at: string;
    problems?: { problem_id: number; points: number }[];
    team_size?: number; penalty_minutes?: number; freeze_minutes?: number;
  }) {
    if (Date.parse(input.ends_at) <= Date.parse(input.starts_at)) {
      throw new HttpError(422, 'A contest cannot end before it starts.');
    }
    const size = input.team_size ?? 1;
    if (size < 1 || size > 10) throw new HttpError(422, 'A team is between one and ten people.');

    // Every problem has to exist and be published, or the contest opens with a
    // problem nobody can attempt.
    for (const p of input.problems ?? []) {
      const { data } = await this.#db.from('onyx_problems')
        .select('id, status').eq('tenant_id', tenantId).eq('id', p.problem_id).maybeSingle();
      if (!data) throw new HttpError(404, 'One of those problems does not exist.');
      if (data.status !== 'published') {
        throw new HttpError(422, 'Every contest problem has to be published first.');
      }
      if (p.points <= 0) throw new HttpError(422, 'Every problem has to be worth something.');
    }

    const { data, error } = await this.#db.from('onyx_contests').insert({
      tenant_id: tenantId,
      title: input.title.trim(),
      description: input.description ?? null,
      starts_at: input.starts_at,
      ends_at: input.ends_at,
      problems: (input.problems ?? []) as never,
      team_size: size,
      penalty_minutes: input.penalty_minutes ?? 20,
      freeze_minutes: input.freeze_minutes ?? 0,
      status: 'draft',
      created_by: createdBy,
    }).select(CONTEST_COLUMNS).maybeSingle();
    if (error) throw new HttpError(500, 'Could not create the contest: ' + error.message);
    return data!;
  }

  async contest(tenantId: number, id: number) {
    const { data } = await this.#db.from('onyx_contests')
      .select(CONTEST_COLUMNS).eq('tenant_id', tenantId).eq('id', id).maybeSingle();
    if (!data) throw new HttpError(404, 'Contest not found.');
    return data;
  }

  async contests(tenantId: number, role: Role) {
    let q = this.#db.from('onyx_contests').select(CONTEST_COLUMNS).eq('tenant_id', tenantId);
    if (!isStaff(role)) q = q.neq('status', 'draft');
    const { data } = await q.order('starts_at', { ascending: false });
    return data ?? [];
  }

  async publish(tenantId: number, id: number) {
    const contest = await this.contest(tenantId, id);
    const problems = (contest.problems ?? []) as unknown as { problem_id: number }[];
    if (!problems.length) throw new HttpError(422, 'Add problems before publishing.');
    await this.#db.from('onyx_contests')
      .update({ status: 'published', updated_at: new Date(this.#now()).toISOString() })
      .eq('tenant_id', tenantId).eq('id', id);
    return { ...contest, status: 'published' };
  }

  // ---- teams ----

  async createTeam(tenantId: number, contestId: number, userId: string, name: string) {
    const contest = await this.contest(tenantId, contestId);
    if (contest.status === 'draft') throw new HttpError(404, 'Contest not found.');
    // Forming a team after the whistle is how a team of one becomes a team of
    // five who already know the answers.
    if (this.#now() > Date.parse(contest.ends_at)) {
      throw new HttpError(422, 'This contest has finished.');
    }
    if (await this.teamFor(tenantId, contestId, userId)) {
      throw new HttpError(422, 'You are already in a team for this contest.');
    }

    const { data, error } = await this.#db.from('onyx_contest_teams').insert({
      tenant_id: tenantId, contest_id: contestId, name: name.trim(), created_by: userId,
    }).select(TEAM_COLUMNS).maybeSingle();
    if (error?.code === '23505') throw new HttpError(422, 'That team name is taken.');
    if (error) throw new HttpError(500, 'Could not create the team: ' + error.message);

    await this.#db.from('onyx_contest_members').insert({
      tenant_id: tenantId, team_id: Number(data!.id), contest_id: contestId, user_id: userId,
    });
    return data!;
  }

  async joinTeam(tenantId: number, teamId: number, userId: string) {
    const { data: team } = await this.#db.from('onyx_contest_teams')
      .select(TEAM_COLUMNS).eq('tenant_id', tenantId).eq('id', teamId).maybeSingle();
    if (!team) throw new HttpError(404, 'Team not found.');

    const contest = await this.contest(tenantId, Number(team.contest_id));
    if (this.#now() > Date.parse(contest.ends_at)) {
      throw new HttpError(422, 'This contest has finished.');
    }
    if (await this.teamFor(tenantId, Number(team.contest_id), userId)) {
      throw new HttpError(422, 'You are already in a team for this contest.');
    }
    const members = await this.teamMembers(tenantId, teamId);
    if (members.length >= Number(contest.team_size)) {
      throw new HttpError(422, 'That team is full.');
    }

    const { error } = await this.#db.from('onyx_contest_members').insert({
      tenant_id: tenantId, team_id: teamId,
      contest_id: Number(team.contest_id), user_id: userId,
    });
    if (error?.code === '23505') throw new HttpError(422, 'You are already in a team.');
    if (error) throw new HttpError(500, 'Could not join: ' + error.message);
    return team;
  }

  async teamFor(tenantId: number, contestId: number, userId: string) {
    const { data } = await this.#db.from('onyx_contest_members')
      .select(MEMBER_COLUMNS)
      .eq('tenant_id', tenantId).eq('contest_id', contestId).eq('user_id', userId)
      .maybeSingle();
    return data ?? null;
  }

  async teamMembers(tenantId: number, teamId: number) {
    const { data } = await this.#db.from('onyx_contest_members')
      .select(MEMBER_COLUMNS).eq('tenant_id', tenantId).eq('team_id', teamId);
    return data ?? [];
  }

  async teams(tenantId: number, contestId: number) {
    const { data } = await this.#db.from('onyx_contest_teams')
      .select(TEAM_COLUMNS).eq('tenant_id', tenantId).eq('contest_id', contestId).order('id');
    return data ?? [];
  }

  // ---- submissions ----

  /**
   * Records a Code Lab submission as a contest attempt.
   *
   * The judgement is the evaluator's, not this service's: `solved` comes from
   * the submission's own score. Recomputing it here would let the two disagree,
   * and then nobody could say which was right.
   */
  async recordSubmission(tenantId: number, contestId: number, userId: string, input: {
    problem_id: number; submission_id: number;
  }) {
    const contest = await this.contest(tenantId, contestId);
    const now = this.#now();
    if (now < Date.parse(contest.starts_at)) throw new HttpError(422, 'This contest has not started.');
    if (now > Date.parse(contest.ends_at)) throw new HttpError(422, 'This contest has finished.');

    const membership = await this.teamFor(tenantId, contestId, userId);
    if (!membership) throw new HttpError(403, 'You are not in a team for this contest.');

    const problems = (contest.problems ?? []) as unknown as { problem_id: number; points: number }[];
    const entry = problems.find((p) => Number(p.problem_id) === input.problem_id);
    if (!entry) throw new HttpError(422, 'That problem is not in this contest.');

    const { data: submission } = await this.#db.from('onyx_code_submissions')
      .select('id, user_id, problem_id, score, max_score, status')
      .eq('tenant_id', tenantId).eq('id', input.submission_id).maybeSingle();
    if (!submission) throw new HttpError(404, 'Submission not found.');
    if (String(submission.user_id) !== userId) throw new HttpError(403, 'That is not your submission.');
    if (Number(submission.problem_id) !== input.problem_id) {
      throw new HttpError(422, 'That submission is for a different problem.');
    }
    if (submission.status !== 'done') throw new HttpError(422, 'That submission has not been graded.');

    const solved = Number(submission.max_score) > 0
      && Number(submission.score) >= Number(submission.max_score);
    const minute = Math.max(0, Math.floor((now - Date.parse(contest.starts_at)) / 60_000));

    const { data, error } = await this.#db.from('onyx_contest_submissions').insert({
      tenant_id: tenantId, contest_id: contestId, team_id: Number(membership.team_id),
      user_id: userId, problem_id: input.problem_id, submission_id: input.submission_id,
      solved: solved ? 1 : 0, points: solved ? entry.points : 0, at_minute: minute,
    }).select(SUBMISSION_COLUMNS).maybeSingle();
    if (error) throw new HttpError(500, 'Could not record that: ' + error.message);
    return data!;
  }

  /**
   * The leaderboard.
   *
   * Computed from the submissions every time. A running total on the team row
   * would be one increment away from a lost update under concurrency, and this
   * is the one screen everybody is watching.
   *
   * Freezing hides changes in the closing minutes so the final standings are a
   * surprise; staff always see the live board, because somebody has to.
   */
  async leaderboard(tenantId: number, contestId: number, viewer: { role: Role }): Promise<{
    frozen: boolean; frozen_after_minute: number | null; rows: LeaderboardRow[];
  }> {
    const contest = await this.contest(tenantId, contestId);
    const problems = (contest.problems ?? []) as unknown as { problem_id: number; points: number }[];
    const [teams, { data: submissions }] = await Promise.all([
      this.teams(tenantId, contestId),
      this.#db.from('onyx_contest_submissions')
        .select(SUBMISSION_COLUMNS).eq('tenant_id', tenantId).eq('contest_id', contestId),
    ]);

    const duration = Math.floor(
      (Date.parse(contest.ends_at) - Date.parse(contest.starts_at)) / 60_000);
    const freeze = Number(contest.freeze_minutes);
    const running = this.#now() < Date.parse(contest.ends_at);
    // The board freezes only while the contest is still running: after the end
    // there is nothing left to be surprised by.
    const frozen = freeze > 0 && running && !isStaff(viewer.role);
    const cutoff = frozen ? duration - freeze : null;

    const visible = (submissions ?? [])
      .filter((s) => cutoff === null || Number(s.at_minute) <= cutoff);

    const rows: LeaderboardRow[] = teams.map((team) => {
      const mine = visible.filter((s) => Number(s.team_id) === Number(team.id));
      let points = 0;
      let penalty = 0;
      let lastSolve = 0;

      const perProblem = problems.map((p) => {
        // Every attempt at this problem, oldest first. Sorting by minute then
        // id makes the result independent of what order the rows came back in.
        const attempts = mine
          .filter((s) => Number(s.problem_id) === Number(p.problem_id))
          .sort((a, b) => Number(a.at_minute) - Number(b.at_minute) || Number(a.id) - Number(b.id));
        const solvedAt = attempts.findIndex((s) => s.solved === 1);

        if (solvedAt === -1) {
          // Wrong attempts on a problem never solved cost nothing. Penalising
          // them would punish trying.
          return {
            problem_id: Number(p.problem_id), solved: false,
            attempts: attempts.length, at_minute: null,
          };
        }
        const solve = attempts[solvedAt]!;
        const minute = Number(solve.at_minute);
        points += Number(p.points);
        // Time to the solve, plus the standard penalty for each wrong attempt
        // before it. Attempts after the solve are ignored entirely.
        penalty += minute + solvedAt * Number(contest.penalty_minutes);
        lastSolve = Math.max(lastSolve, minute);
        return {
          problem_id: Number(p.problem_id), solved: true,
          attempts: solvedAt + 1, at_minute: minute,
        };
      });

      return {
        rank: 0,
        team_id: Number(team.id),
        name: String(team.name),
        solved: perProblem.filter((p) => p.solved).length,
        points,
        penalty,
        last_solve_minute: lastSolve,
        problems: perProblem,
      };
    });

    // Most points, then least penalty, then the earliest last solve, then team
    // id. Total, so two runs of the same data give the same board.
    rows.sort((a, b) => b.points - a.points
      || a.penalty - b.penalty
      || a.last_solve_minute - b.last_solve_minute
      || a.team_id - b.team_id);

    // Teams level on every tie-break share a rank, which is what a scoreboard
    // means by a tie.
    let rank = 0;
    let previous: LeaderboardRow | null = null;
    for (const [i, row] of rows.entries()) {
      const tied = previous
        && previous.points === row.points
        && previous.penalty === row.penalty
        && previous.last_solve_minute === row.last_solve_minute;
      rank = tied ? rank : i + 1;
      row.rank = rank;
      previous = row;
    }

    return { frozen, frozen_after_minute: cutoff, rows };
  }

  // -------------------------------------------------------------------------
  // CAR-02 -- mock interviews
  // -------------------------------------------------------------------------

  async scheduleInterview(tenantId: number, input: {
    user_id: string; interviewer_id?: string | null; title: string;
    scheduled_at: string; duration_minutes?: number; join_url?: string | null;
  }) {
    if (Number.isNaN(Date.parse(input.scheduled_at))) {
      throw new HttpError(422, 'That is not a time.');
    }
    const { data, error } = await this.#db.from('onyx_mock_interviews').insert({
      tenant_id: tenantId,
      user_id: input.user_id,
      interviewer_id: input.interviewer_id ?? null,
      title: input.title.trim(),
      scheduled_at: input.scheduled_at,
      duration_minutes: input.duration_minutes ?? 45,
      join_url: input.join_url ?? null,
      status: 'scheduled',
    }).select(INTERVIEW_COLUMNS).maybeSingle();
    if (error) throw new HttpError(500, 'Could not schedule that: ' + error.message);
    return data!;
  }

  /**
   * One interview, as this caller may see it.
   *
   * CAR-02a's acceptance criterion is that a learner cannot see another
   * learner's feedback -- so the check is on the row's owner, and unreleased
   * feedback is stripped even from the person it is about. A half-written note
   * read as a verdict is worse than no note.
   */
  async interview(tenantId: number, id: number, viewer: { role: Role; userId: string }) {
    const { data } = await this.#db.from('onyx_mock_interviews')
      .select(INTERVIEW_COLUMNS).eq('tenant_id', tenantId).eq('id', id).maybeSingle();
    if (!data) throw new HttpError(404, 'Interview not found.');

    const own = String(data.user_id) === viewer.userId;
    const interviewer = String(data.interviewer_id) === viewer.userId;
    if (!own && !interviewer && !isStaff(viewer.role)) {
      throw new HttpError(403, 'That is not your interview.');
    }

    const canSeeFeedback = interviewer || isStaff(viewer.role) || Boolean(data.released_at);
    return {
      ...data,
      feedback: canSeeFeedback ? data.feedback : null,
      overall: canSeeFeedback ? data.overall : null,
      notes: interviewer || isStaff(viewer.role) ? data.notes : null,
      // A recording exists or it does not; where it is stored is not the
      // learner's to know.
      recording_path: undefined,
      has_recording: Boolean(data.recording_path),
      feedback_released: Boolean(data.released_at),
    };
  }

  async myInterviews(tenantId: number, userId: string) {
    const { data } = await this.#db.from('onyx_mock_interviews')
      .select(INTERVIEW_COLUMNS)
      .eq('tenant_id', tenantId).eq('user_id', userId)
      .order('scheduled_at', { ascending: false });
    return (data ?? []).map((i) => ({
      id: i.id, title: i.title, scheduled_at: i.scheduled_at,
      duration_minutes: i.duration_minutes, status: i.status,
      // The list never carries feedback, released or not: the detail view is
      // the one place it is decided.
      feedback_released: Boolean(i.released_at),
      overall: i.released_at ? i.overall : null,
    }));
  }

  /** The interviewer's own list, for the people they are seeing. */
  async interviewsFor(tenantId: number, interviewerId: string) {
    const { data } = await this.#db.from('onyx_mock_interviews')
      .select(INTERVIEW_COLUMNS)
      .eq('tenant_id', tenantId).eq('interviewer_id', interviewerId)
      .order('scheduled_at', { ascending: false });
    return data ?? [];
  }

  async recordFeedback(tenantId: number, id: number, viewer: { role: Role; userId: string }, input: {
    feedback: { criterion: string; score: number; of: number; comment?: string | null }[];
    overall: number; notes?: string | null; release?: boolean;
    recording_path?: string | null; recording_consented?: boolean;
  }) {
    const { data } = await this.#db.from('onyx_mock_interviews')
      .select(INTERVIEW_COLUMNS).eq('tenant_id', tenantId).eq('id', id).maybeSingle();
    if (!data) throw new HttpError(404, 'Interview not found.');
    if (String(data.interviewer_id) !== viewer.userId && !isStaff(viewer.role)) {
      throw new HttpError(403, 'You are not the interviewer.');
    }
    if (input.overall < 1 || input.overall > 5) {
      throw new HttpError(422, 'An overall score is between one and five.');
    }
    for (const f of input.feedback) {
      if (f.of <= 0) throw new HttpError(422, 'A criterion has to be out of something.');
      if (f.score < 0 || f.score > f.of) {
        throw new HttpError(422, '"' + f.criterion + '" is out of ' + f.of + '.');
      }
    }
    // A recording without consent is not a recording anyone should keep.
    if (input.recording_path && !input.recording_consented && !data.recording_consented_at) {
      throw new HttpError(422, 'A recording needs the learner\'s consent.');
    }

    const at = new Date(this.#now()).toISOString();
    await this.#db.from('onyx_mock_interviews').update({
      feedback: input.feedback as never,
      overall: input.overall,
      notes: input.notes ?? data.notes,
      status: 'completed',
      recording_path: input.recording_path ?? data.recording_path,
      recording_consented_at: input.recording_consented
        ? (data.recording_consented_at ?? at)
        : data.recording_consented_at,
      released_at: input.release ? (data.released_at ?? at) : data.released_at,
      updated_at: at,
    }).eq('id', id);
    return this.interview(tenantId, id, viewer);
  }

  /** Releasing is a separate act, so feedback can be written and reviewed first. */
  async releaseFeedback(tenantId: number, id: number, viewer: { role: Role; userId: string }) {
    const { data } = await this.#db.from('onyx_mock_interviews')
      .select(INTERVIEW_COLUMNS).eq('tenant_id', tenantId).eq('id', id).maybeSingle();
    if (!data) throw new HttpError(404, 'Interview not found.');
    if (String(data.interviewer_id) !== viewer.userId && !isStaff(viewer.role)) {
      throw new HttpError(403, 'You are not the interviewer.');
    }
    if (!data.feedback) throw new HttpError(422, 'There is no feedback to release.');
    const at = new Date(this.#now()).toISOString();
    await this.#db.from('onyx_mock_interviews')
      .update({ released_at: data.released_at ?? at, updated_at: at }).eq('id', id);
    return { id, released_at: data.released_at ?? at };
  }
}
