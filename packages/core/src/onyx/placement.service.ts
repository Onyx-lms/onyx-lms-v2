/**
 * CAR-04 -- employers, job posts, applications and placement drives.
 *
 * "Job posts, applications, shortlisting and drive management connecting
 * institutions with employers."
 *
 * An employer is an outsider with an account, which is the one genuinely new
 * thing in this sprint. Two rules follow from that and are enforced here rather
 * than on any screen:
 *
 *   * **An employer sees only what was shared with them.** Their own company,
 *     their own posts, and the applicants to those posts. Not the roster, not a
 *     cohort, not another employer's pipeline. `assertEmployerOwns` is on every
 *     route they can reach.
 *   * **Eligibility is computed, never typed.** A job carries thresholds; the
 *     platform works out whether somebody meets them from their own record. An
 *     "eligible" checkbox somebody ticks is a checkbox somebody ticks wrongly.
 */
import type { OnyxDb } from './db.ts';
import type { Role } from '@onyx/types';
import { HttpError } from '../http/errors.ts';
import type { CareerService } from './career.service.ts';
import type { AttendanceService } from './attendance.service.ts';

const EMPLOYER_COLUMNS = 'id, tenant_id, name, website, about, contact_name, contact_email, user_id, status, created_at';
const JOB_COLUMNS = 'id, tenant_id, employer_id, title, description, location, compensation, openings, min_readiness, min_attendance, required_skills, program_ids, batch_ids, closes_at, status, created_at';
const APPLICATION_COLUMNS = 'id, tenant_id, job_id, user_id, status, note, readiness_at_apply, decided_by, decided_at, created_at, updated_at';
const DRIVE_COLUMNS = 'id, tenant_id, employer_id, job_id, title, scheduled_at, venue, status, created_at';
const ROUND_COLUMNS = 'id, tenant_id, drive_id, name, sort, scheduled_at';
const RESULT_COLUMNS = 'id, tenant_id, round_id, drive_id, user_id, outcome, note, recorded_by, recorded_at';

export const APPLICATION_STATUSES = [
  'applied', 'shortlisted', 'interviewing', 'offered', 'hired', 'rejected', 'withdrawn',
] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

export const ROUND_OUTCOMES = ['attended', 'absent', 'passed', 'failed'] as const;
export type RoundOutcome = (typeof ROUND_OUTCOMES)[number];

/** Who runs placement. Employers are outsiders and are never in this list. */
const PLACEMENT_STAFF: Role[] = ['admin', 'placement'];
const isPlacementStaff = (role: Role) => PLACEMENT_STAFF.includes(role);

export interface EligibilityResult {
  eligible: boolean;
  /** Every rule, whether it passed, and the numbers -- so a refusal is explainable. */
  checks: { rule: string; required: string; actual: string; met: boolean }[];
}

export class PlacementService {
  #db: OnyxDb;
  #career: CareerService;
  #attendance: AttendanceService;
  #now: () => number;

  constructor(
    db: OnyxDb, career: CareerService, attendance: AttendanceService,
    now: () => number = Date.now,
  ) {
    this.#db = db;
    this.#career = career;
    this.#attendance = attendance;
    this.#now = now;
  }

  // -------------------------------------------------------------------------
  // CAR-04a -- employers
  // -------------------------------------------------------------------------

  async createEmployer(tenantId: number, createdBy: string, input: {
    name: string; website?: string | null; about?: string | null;
    contact_name?: string | null; contact_email?: string | null;
    user_id?: string | null;
  }) {
    const { data, error } = await this.#db.from('onyx_employers').insert({
      tenant_id: tenantId,
      name: input.name.trim(),
      website: input.website ?? null,
      about: input.about ?? null,
      contact_name: input.contact_name ?? null,
      contact_email: input.contact_email?.trim().toLowerCase() ?? null,
      user_id: input.user_id ?? null,
      status: 1,
      created_by: createdBy,
    }).select(EMPLOYER_COLUMNS).maybeSingle();
    if (error) throw new HttpError(500, 'Could not add the employer: ' + error.message);
    return data!;
  }

  async employers(tenantId: number) {
    const { data } = await this.#db.from('onyx_employers')
      .select(EMPLOYER_COLUMNS).eq('tenant_id', tenantId).order('name');
    return data ?? [];
  }

  async employer(tenantId: number, id: number) {
    const { data } = await this.#db.from('onyx_employers')
      .select(EMPLOYER_COLUMNS).eq('tenant_id', tenantId).eq('id', id).maybeSingle();
    if (!data) throw new HttpError(404, 'Employer not found.');
    return data;
  }

  /**
   * Editing an employer record -- most usefully, linking it to the login
   * account of the contact it is for. A company added before its contact
   * had a login (or before anyone thought to link the two) sat with
   * `user_id: null` forever: nothing let placement come back and connect
   * them, so the contact could see the jobs board but never post to it or
   * see who applied, and placement's own "needs the office" queue could
   * only name the problem, never fix it.
   */
  async updateEmployer(tenantId: number, id: number, input: {
    name?: string; website?: string | null; about?: string | null;
    contact_name?: string | null; contact_email?: string | null;
    user_id?: string | null;
  }) {
    await this.employer(tenantId, id);
    if (input.user_id) {
      const { data: membership } = await this.#db.from('onyx_memberships')
        .select('role').eq('tenant_id', tenantId).eq('user_id', input.user_id)
        .eq('status', 1).maybeSingle();
      if (!membership) throw new HttpError(422, 'That account is not a member of this institution.');
      if (membership.role !== 'employer') {
        throw new HttpError(422, 'That account does not hold the employer role.');
      }
      const { data: already } = await this.#db.from('onyx_employers')
        .select('id, name').eq('tenant_id', tenantId).eq('user_id', input.user_id)
        .neq('id', id).maybeSingle();
      if (already) {
        throw new HttpError(422, 'That account is already linked to ' + already.name + '.');
      }
    }
    const patch: Record<string, unknown> = {};
    for (const key of
      ['name', 'website', 'about', 'contact_name', 'contact_email', 'user_id'] as const) {
      if (input[key] !== undefined) patch[key] = input[key];
    }
    if (patch.contact_email) {
      patch.contact_email = String(patch.contact_email).trim().toLowerCase();
    }
    const { data, error } = await this.#db.from('onyx_employers')
      .update(patch).eq('tenant_id', tenantId).eq('id', id).select(EMPLOYER_COLUMNS).maybeSingle();
    if (error) throw new HttpError(500, 'Could not update the employer: ' + error.message);
    return data!;
  }

  /** The employer account a signed-in contact belongs to, if any. */
  async employerFor(tenantId: number, userId: string) {
    const { data } = await this.#db.from('onyx_employers')
      .select(EMPLOYER_COLUMNS).eq('tenant_id', tenantId).eq('user_id', userId).maybeSingle();
    return data ?? null;
  }

  /**
   * The check on every employer-facing route.
   *
   * Placement staff may act on any employer in their institution. An employer
   * contact may act only on their own company -- which is the whole of "an
   * employer sees only what the institution has shared with them".
   */
  async assertEmployerOwns(tenantId: number, employerId: number, viewer: {
    role: Role; userId: string;
  }) {
    const employer = await this.employer(tenantId, employerId);
    if (isPlacementStaff(viewer.role)) return employer;
    if (viewer.role !== 'employer') throw new HttpError(403, 'This is not yours.');
    if (String(employer.user_id) !== viewer.userId) {
      // Another employer's record, in the same institution. A 403 rather than a
      // 404 because they legitimately know other employers exist.
      throw new HttpError(403, 'This is not your company.');
    }
    return employer;
  }

  // -------------------------------------------------------------------------
  // CAR-04b -- job posts
  // -------------------------------------------------------------------------

  async createJob(tenantId: number, createdBy: string, viewer: { role: Role; userId: string }, input: {
    employer_id: number; title: string; description?: string | null;
    location?: string | null; compensation?: string | null; openings?: number;
    min_readiness?: number | null; min_attendance?: number | null;
    required_skills?: number[]; program_ids?: number[]; batch_ids?: number[];
    closes_at?: string | null;
  }) {
    await this.assertEmployerOwns(tenantId, input.employer_id, viewer);
    for (const [label, value] of [['readiness', input.min_readiness],
      ['attendance', input.min_attendance]] as const) {
      if (value !== null && value !== undefined && (value < 0 || value > 100)) {
        throw new HttpError(422, 'A minimum ' + label + ' is a percentage.');
      }
    }

    const { data, error } = await this.#db.from('onyx_jobs_posted').insert({
      tenant_id: tenantId,
      employer_id: input.employer_id,
      title: input.title.trim(),
      description: input.description ?? null,
      location: input.location ?? null,
      compensation: input.compensation ?? null,
      openings: input.openings ?? 1,
      min_readiness: input.min_readiness ?? null,
      min_attendance: input.min_attendance ?? null,
      required_skills: (input.required_skills ?? []) as never,
      program_ids: (input.program_ids ?? []) as never,
      batch_ids: (input.batch_ids ?? []) as never,
      closes_at: input.closes_at ?? null,
      status: 'draft',
      created_by: createdBy,
    }).select(JOB_COLUMNS).maybeSingle();
    if (error) throw new HttpError(500, 'Could not create the post: ' + error.message);
    return data!;
  }

  async job(tenantId: number, id: number) {
    const { data } = await this.#db.from('onyx_jobs_posted')
      .select(JOB_COLUMNS).eq('tenant_id', tenantId).eq('id', id).maybeSingle();
    if (!data) throw new HttpError(404, 'Job not found.');
    return data;
  }

  /**
   * The job board, as this caller may see it.
   *
   * A learner sees open posts. Placement staff see everything. An employer sees
   * their own, drafts included -- and nobody else's, because a rival's pipeline
   * is not something an institution shares.
   */
  async jobs(tenantId: number, viewer: { role: Role; userId: string }) {
    let q = this.#db.from('onyx_jobs_posted').select(JOB_COLUMNS).eq('tenant_id', tenantId);
    if (viewer.role === 'employer') {
      const mine = await this.employerFor(tenantId, viewer.userId);
      if (!mine) return [];
      q = q.eq('employer_id', Number(mine.id));
    } else if (!isPlacementStaff(viewer.role)) {
      q = q.eq('status', 'open');
    }
    const { data } = await q.order('id', { ascending: false });
    return data ?? [];
  }

  async publishJob(tenantId: number, id: number, viewer: { role: Role; userId: string }) {
    const job = await this.job(tenantId, id);
    await this.assertEmployerOwns(tenantId, Number(job.employer_id), viewer);
    // Publishing a post is the institution vouching for it, so it is theirs.
    if (!isPlacementStaff(viewer.role)) {
      throw new HttpError(403, 'The placement office publishes job posts.');
    }
    await this.#db.from('onyx_jobs_posted')
      .update({ status: 'open', updated_at: new Date(this.#now()).toISOString() }).eq('id', id);
    return { ...job, status: 'open' };
  }

  async closeJob(tenantId: number, id: number, viewer: { role: Role; userId: string }) {
    const job = await this.job(tenantId, id);
    await this.assertEmployerOwns(tenantId, Number(job.employer_id), viewer);
    await this.#db.from('onyx_jobs_posted')
      .update({ status: 'closed', updated_at: new Date(this.#now()).toISOString() }).eq('id', id);
    return { ...job, status: 'closed' };
  }

  /**
   * CAR-04b's acceptance criterion: eligibility is computed, not typed.
   *
   * Every rule is returned with its numbers whether it passed or not, so a
   * learner who cannot apply is told exactly what is missing rather than being
   * shown a greyed-out button.
   */
  async eligibility(tenantId: number, jobId: number, userId: string): Promise<EligibilityResult> {
    const job = await this.job(tenantId, jobId);
    const checks: EligibilityResult['checks'] = [];

    if (job.min_readiness !== null) {
      const score = await this.#career.computeReadiness(tenantId, userId);
      checks.push({
        rule: 'Readiness score',
        required: 'at least ' + job.min_readiness,
        actual: String(score.score),
        met: score.score >= Number(job.min_readiness),
      });
    }

    if (job.min_attendance !== null) {
      const summary = await this.#attendance.learnerSummary(tenantId, userId);
      const average = summary.length
        ? Math.round((summary.reduce((t, a) => t + a.percent, 0) / summary.length) * 10) / 10
        : 0;
      checks.push({
        rule: 'Attendance',
        required: 'at least ' + job.min_attendance + '%',
        actual: average + '%',
        met: average >= Number(job.min_attendance),
      });
    }

    const required = (job.required_skills ?? []) as unknown as number[];
    if (required.length) {
      const passport = await this.#career.passport(tenantId, userId);
      const held = new Set(passport.map((s) => s.skill_id));
      const missing = required.filter((s) => !held.has(Number(s)));
      checks.push({
        rule: 'Skills',
        required: required.length + ' required',
        actual: (required.length - missing.length) + ' held',
        met: missing.length === 0,
      });
    }

    const batches = (job.batch_ids ?? []) as unknown as number[];
    if (batches.length) {
      const { data } = await this.#db.from('onyx_batch_members')
        .select('batch_id').eq('tenant_id', tenantId).eq('user_id', userId);
      const mine = new Set((data ?? []).map((b) => Number(b.batch_id)));
      const inBatch = batches.some((b) => mine.has(Number(b)));
      checks.push({
        rule: 'Cohort',
        required: 'one of ' + batches.length + ' batches',
        actual: inBatch ? 'in scope' : 'not in scope',
        met: inBatch,
      });
    }

    return { eligible: checks.every((c) => c.met), checks };
  }

  async apply(tenantId: number, jobId: number, userId: string, note?: string | null) {
    const job = await this.job(tenantId, jobId);
    if (job.status !== 'open') throw new HttpError(422, 'This post is not open.');
    if (job.closes_at && this.#now() > Date.parse(job.closes_at)) {
      throw new HttpError(422, 'This post has closed.');
    }

    const existing = await this.application(tenantId, jobId, userId);
    if (existing) throw new HttpError(422, 'You have already applied.');

    const eligibility = await this.eligibility(tenantId, jobId, userId);
    if (!eligibility.eligible) {
      const missing = eligibility.checks.filter((c) => !c.met)
        .map((c) => c.rule + ' (' + c.required + ', you have ' + c.actual + ')');
      throw new HttpError(422, 'You do not meet the requirements: ' + missing.join('; '));
    }

    const readiness = await this.#career.readiness(tenantId, userId);
    const { data, error } = await this.#db.from('onyx_job_applications').insert({
      tenant_id: tenantId, job_id: jobId, user_id: userId,
      status: 'applied', note: note ?? null,
      // Kept, so a later change to their record cannot rewrite whether they
      // were eligible at the time.
      readiness_at_apply: readiness ? Number(readiness.score) : null,
    }).select(APPLICATION_COLUMNS).maybeSingle();
    if (error) throw new HttpError(500, 'Could not apply: ' + error.message);
    return data!;
  }

  async application(tenantId: number, jobId: number, userId: string) {
    const { data } = await this.#db.from('onyx_job_applications')
      .select(APPLICATION_COLUMNS)
      .eq('tenant_id', tenantId).eq('job_id', jobId).eq('user_id', userId).maybeSingle();
    return data ?? null;
  }

  /**
   * The applicants to one post. Employers see only their own posts' applicants.
   *
   * Each carries the candidate's name and email, because applying to a job IS
   * sharing those with that employer. It comes from here rather than from the
   * roster endpoint: an employer must not be able to list the institution's
   * people, only the ones who chose to apply to them.
   */
  async applicants(tenantId: number, jobId: number, viewer: { role: Role; userId: string }) {
    const job = await this.job(tenantId, jobId);
    await this.assertEmployerOwns(tenantId, Number(job.employer_id), viewer);
    const { data } = await this.#db.from('onyx_job_applications')
      .select(APPLICATION_COLUMNS).eq('tenant_id', tenantId).eq('job_id', jobId).order('id');
    const rows = data ?? [];
    if (!rows.length) return [];

    const ids = [...new Set(rows.map((r) => String(r.user_id)))];
    const { data: people } = await this.#db.from('onyx_users')
      .select('id, name, email').in('id', ids);
    const byId = new Map((people ?? []).map((p) => [String(p.id), p]));
    return rows.map((r) => ({
      ...r,
      candidate: byId.get(String(r.user_id))
        ? { name: byId.get(String(r.user_id))!.name, email: byId.get(String(r.user_id))!.email }
        : null,
    }));
  }

  async myApplications(tenantId: number, userId: string) {
    const { data } = await this.#db.from('onyx_job_applications')
      .select(APPLICATION_COLUMNS)
      .eq('tenant_id', tenantId).eq('user_id', userId).order('id', { ascending: false });
    const rows = data ?? [];
    if (!rows.length) return [];
    const jobIds = [...new Set(rows.map((r) => Number(r.job_id)))];
    const { data: jobs } = await this.#db.from('onyx_jobs_posted')
      .select(JOB_COLUMNS).eq('tenant_id', tenantId).in('id', jobIds);
    const byId = new Map((jobs ?? []).map((j) => [Number(j.id), j]));
    return rows.map((r) => ({ ...r, job: byId.get(Number(r.job_id)) ?? null }));
  }

  async decide(tenantId: number, applicationId: number, viewer: { role: Role; userId: string }, input: {
    status: ApplicationStatus; note?: string | null;
  }) {
    if (!APPLICATION_STATUSES.includes(input.status)) {
      throw new HttpError(422, 'That is not an application status.');
    }
    const { data } = await this.#db.from('onyx_job_applications')
      .select(APPLICATION_COLUMNS).eq('tenant_id', tenantId).eq('id', applicationId).maybeSingle();
    if (!data) throw new HttpError(404, 'Application not found.');

    const job = await this.job(tenantId, Number(data.job_id));
    await this.assertEmployerOwns(tenantId, Number(job.employer_id), viewer);
    // Withdrawing is the candidate's word, not the employer's.
    if (input.status === 'withdrawn') {
      throw new HttpError(422, 'Only the candidate can withdraw an application.');
    }

    const at = new Date(this.#now()).toISOString();
    await this.#db.from('onyx_job_applications').update({
      status: input.status, note: input.note ?? data.note,
      decided_by: viewer.userId, decided_at: at, updated_at: at,
    }).eq('id', applicationId);
    return { ...data, status: input.status, decided_at: at };
  }

  async withdraw(tenantId: number, applicationId: number, userId: string) {
    const { data } = await this.#db.from('onyx_job_applications')
      .select(APPLICATION_COLUMNS).eq('tenant_id', tenantId).eq('id', applicationId).maybeSingle();
    if (!data) throw new HttpError(404, 'Application not found.');
    if (String(data.user_id) !== userId) throw new HttpError(403, 'That is not your application.');
    if (['hired', 'rejected'].includes(String(data.status))) {
      throw new HttpError(422, 'That application is already decided.');
    }
    const at = new Date(this.#now()).toISOString();
    await this.#db.from('onyx_job_applications')
      .update({ status: 'withdrawn', updated_at: at }).eq('id', applicationId);
    return { ...data, status: 'withdrawn' as const };
  }

  // -------------------------------------------------------------------------
  // CAR-04c -- drives
  // -------------------------------------------------------------------------

  async createDrive(tenantId: number, createdBy: string, input: {
    employer_id: number; title: string; job_id?: number | null;
    scheduled_at?: string | null; venue?: string | null;
    rounds?: { name: string; scheduled_at?: string | null }[];
  }) {
    await this.employer(tenantId, input.employer_id);
    if (input.job_id) await this.job(tenantId, input.job_id);

    const { data, error } = await this.#db.from('onyx_drives').insert({
      tenant_id: tenantId,
      employer_id: input.employer_id,
      job_id: input.job_id ?? null,
      title: input.title.trim(),
      scheduled_at: input.scheduled_at ?? null,
      venue: input.venue ?? null,
      status: 'planned',
      created_by: createdBy,
    }).select(DRIVE_COLUMNS).maybeSingle();
    if (error) throw new HttpError(500, 'Could not create the drive: ' + error.message);

    for (const [i, round] of (input.rounds ?? []).entries()) {
      await this.#db.from('onyx_drive_rounds').insert({
        tenant_id: tenantId, drive_id: Number(data!.id),
        name: round.name.trim(), sort: i, scheduled_at: round.scheduled_at ?? null,
      });
    }
    return data!;
  }

  async drives(tenantId: number, viewer: { role: Role; userId: string }) {
    let q = this.#db.from('onyx_drives').select(DRIVE_COLUMNS).eq('tenant_id', tenantId);
    if (viewer.role === 'employer') {
      const mine = await this.employerFor(tenantId, viewer.userId);
      if (!mine) return [];
      q = q.eq('employer_id', Number(mine.id));
    }
    const { data } = await q.order('scheduled_at', { ascending: false });
    return data ?? [];
  }

  async recordRound(tenantId: number, roundId: number, recordedBy: string, entries: {
    user_id: string; outcome: RoundOutcome; note?: string | null;
  }[]) {
    const { data: round } = await this.#db.from('onyx_drive_rounds')
      .select(ROUND_COLUMNS).eq('tenant_id', tenantId).eq('id', roundId).maybeSingle();
    if (!round) throw new HttpError(404, 'Round not found.');
    for (const e of entries) {
      if (!ROUND_OUTCOMES.includes(e.outcome)) {
        throw new HttpError(422, '"' + e.outcome + '" is not an outcome.');
      }
    }

    const { data: existing } = await this.#db.from('onyx_drive_results')
      .select(RESULT_COLUMNS).eq('tenant_id', tenantId).eq('round_id', roundId);
    const byUser = new Map((existing ?? []).map((r) => [String(r.user_id), r]));
    const at = new Date(this.#now()).toISOString();
    let created = 0;
    let amended = 0;

    for (const e of entries) {
      const prior = byUser.get(e.user_id);
      if (prior) {
        await this.#db.from('onyx_drive_results').update({
          outcome: e.outcome, note: e.note ?? null, recorded_by: recordedBy, recorded_at: at,
        }).eq('id', prior.id);
        amended += 1;
      } else {
        await this.#db.from('onyx_drive_results').insert({
          tenant_id: tenantId, round_id: roundId, drive_id: Number(round.drive_id),
          user_id: e.user_id, outcome: e.outcome, note: e.note ?? null,
          recorded_by: recordedBy, recorded_at: at,
        });
        created += 1;
      }
    }
    return { created, amended };
  }

  /**
   * CAR-04c's acceptance criterion: a drive's rounds and outcomes reconcile
   * with the offers recorded.
   *
   * Both sides are computed from their own tables and compared here, so a
   * mismatch is visible rather than assumed away. It is reported, not corrected:
   * an offer made outside the last round is a real thing that happens, and the
   * platform's job is to say so.
   */
  async driveSummary(tenantId: number, driveId: number) {
    const { data: drive } = await this.#db.from('onyx_drives')
      .select(DRIVE_COLUMNS).eq('tenant_id', tenantId).eq('id', driveId).maybeSingle();
    if (!drive) throw new HttpError(404, 'Drive not found.');

    const { data: rounds } = await this.#db.from('onyx_drive_rounds')
      .select(ROUND_COLUMNS).eq('tenant_id', tenantId).eq('drive_id', driveId).order('sort');
    const { data: results } = await this.#db.from('onyx_drive_results')
      .select(RESULT_COLUMNS).eq('tenant_id', tenantId).eq('drive_id', driveId);
    const rows = results ?? [];

    const byRound = (rounds ?? []).map((r) => {
      const mine = rows.filter((x) => Number(x.round_id) === Number(r.id));
      return {
        round_id: Number(r.id),
        name: r.name,
        sort: r.sort,
        attended: mine.filter((x) => x.outcome !== 'absent').length,
        absent: mine.filter((x) => x.outcome === 'absent').length,
        passed: mine.filter((x) => x.outcome === 'passed').length,
        failed: mine.filter((x) => x.outcome === 'failed').length,
      };
    });

    // Who cleared the last round, against who was actually offered a job.
    const last = byRound[byRound.length - 1];
    const cleared = last
      ? rows.filter((x) => Number(x.round_id) === last.round_id && x.outcome === 'passed')
        .map((x) => String(x.user_id))
      : [];

    const offered = drive.job_id
      ? ((await this.#db.from('onyx_job_applications')
        .select(APPLICATION_COLUMNS)
        .eq('tenant_id', tenantId).eq('job_id', Number(drive.job_id))
        .in('status', ['offered', 'hired'])).data ?? []).map((a) => String(a.user_id))
      : [];

    const offeredSet = new Set(offered);
    const clearedSet = new Set(cleared);
    return {
      drive,
      rounds: byRound,
      cleared_final_round: cleared.length,
      offers: offered.length,
      reconciles: cleared.length === offered.length
        && cleared.every((u) => offeredSet.has(u)),
      // Named rather than merely counted: "two do not reconcile" is not
      // actionable, "these two" is.
      offered_without_clearing: offered.filter((u) => !clearedSet.has(u)),
      cleared_without_offer: cleared.filter((u) => !offeredSet.has(u)),
    };
  }
}
