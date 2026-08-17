/**
 * LRN-04 -- assignment workflows.
 *
 * "Create, submit, grade and return assignments with rubrics, deadline handling
 * and structured feedback."
 *
 * Three decisions shape everything here:
 *
 *   * **A rubric's criteria must sum to the assignment total.** A rubric that
 *     does not add up is a grading dispute waiting to happen, so it is refused
 *     at publish rather than discovered at appeal.
 *   * **Grading and returning are separate acts.** A cohort is graded over a
 *     week and released at once. A score that leaks the moment it is entered
 *     turns marking into a live broadcast, so nothing is visible to the learner
 *     until it is returned.
 *   * **A draft is a first-class row.** LRN-04c asks that a dropped connection
 *     never costs a learner their work, which means the draft is saved server
 *     side under the same row the submission will become.
 */
import type { OnyxDb } from './db.ts';
import type { LatePolicy, SubmissionStatus } from '@onyx/types';
import { HttpError } from '../http/errors.ts';
import type { AcademicsService } from './academics.service.ts';

const ASSIGNMENT_COLUMNS = 'id, tenant_id, course_id, title, instructions, attachment_path, due_at, total_points, late_policy, late_penalty_percent, allow_resubmission, status, created_by, created_at';
const CRITERION_COLUMNS = 'id, tenant_id, assignment_id, title, description, points, sort';
const SUBMISSION_COLUMNS = 'id, tenant_id, assignment_id, user_id, body, file_path, status, attempt, submitted_at, is_late, score, feedback, graded_by, graded_at, returned_at, updated_at';
const SCORE_COLUMNS = 'id, tenant_id, submission_id, criterion_id, points, comment';

export const LATE_POLICIES: LatePolicy[] = ['reject', 'accept', 'penalty'];

/** What a learner is allowed to see of their own submission before it is returned. */
function forLearner<T extends { status: SubmissionStatus; returned_at: string | null }>(row: T) {
  if (row.returned_at) return row;
  // Graded but not returned looks exactly like submitted, because to the
  // learner it is: nothing has been said to them yet.
  return {
    ...row,
    status: (row.status === 'graded' ? 'submitted' : row.status) as SubmissionStatus,
    score: null, feedback: null, graded_by: null, graded_at: null,
  };
}

export class AssignmentsService {
  #db: OnyxDb;
  #academics: AcademicsService;
  #now: () => number;

  constructor(db: OnyxDb, academics: AcademicsService, now: () => number = Date.now) {
    this.#db = db;
    this.#academics = academics;
    this.#now = now;
  }

  // ---- LRN-04a: authoring ----

  async create(tenantId: number, courseId: number, createdBy: string, input: {
    title: string; instructions?: string | null; due_at?: string | null;
    total_points?: number; late_policy?: LatePolicy; late_penalty_percent?: number;
    allow_resubmission?: boolean; attachment_path?: string | null;
  }) {
    await this.#academics.course(tenantId, courseId);
    const policy = input.late_policy ?? 'accept';
    if (!LATE_POLICIES.includes(policy)) throw new HttpError(422, 'That is not a late policy.');
    const penalty = input.late_penalty_percent ?? 0;
    if (penalty < 0 || penalty > 100) throw new HttpError(422, 'A penalty is a percentage.');
    if (policy === 'penalty' && penalty === 0) {
      throw new HttpError(422, 'A penalty policy needs a penalty.');
    }
    const total = input.total_points ?? 100;
    if (total <= 0) throw new HttpError(422, 'An assignment has to be worth something.');

    const { data, error } = await this.#db.from('onyx_assignments').insert({
      tenant_id: tenantId,
      course_id: courseId,
      title: input.title.trim(),
      instructions: input.instructions ?? null,
      attachment_path: input.attachment_path ?? null,
      due_at: input.due_at ?? null,
      total_points: total,
      late_policy: policy,
      late_penalty_percent: penalty,
      allow_resubmission: input.allow_resubmission === false ? 0 : 1,
      status: 'draft',
      created_by: createdBy,
    }).select(ASSIGNMENT_COLUMNS).maybeSingle();
    if (error) throw new HttpError(500, 'Could not create the assignment: ' + error.message);
    return data!;
  }

  async assignment(tenantId: number, id: number) {
    const { data } = await this.#db.from('onyx_assignments')
      .select(ASSIGNMENT_COLUMNS).eq('tenant_id', tenantId).eq('id', id).maybeSingle();
    if (!data) throw new HttpError(404, 'Assignment not found.');
    return data;
  }

  async list(tenantId: number, courseId: number, opts: { publishedOnly?: boolean } = {}) {
    let q = this.#db.from('onyx_assignments')
      .select(ASSIGNMENT_COLUMNS).eq('tenant_id', tenantId).eq('course_id', courseId);
    if (opts.publishedOnly) q = q.eq('status', 'published');
    const { data } = await q.order('due_at');
    return data ?? [];
  }

  /**
   * The bulk twin of `list()` -- one query across several courses, rows
   * carrying `course_id` for a caller to group. Written for a dashboard
   * scanning everything due across a dozen courses, which used to mean a
   * `list()`-shaped call per course.
   */
  async listBulk(tenantId: number, courseIds: number[], opts: { publishedOnly?: boolean } = {}) {
    if (!courseIds.length) return [];
    let q = this.#db.from('onyx_assignments')
      .select(ASSIGNMENT_COLUMNS).eq('tenant_id', tenantId).in('course_id', courseIds);
    if (opts.publishedOnly) q = q.eq('status', 'published');
    const { data } = await q.order('due_at');
    return data ?? [];
  }

  // ---- rubrics ----

  async setRubric(tenantId: number, assignmentId: number, criteria: {
    title: string; description?: string | null; points: number;
  }[]) {
    const assignment = await this.assignment(tenantId, assignmentId);
    if (assignment.status === 'published') {
      // Changing the weights under work already submitted regrades it silently.
      throw new HttpError(422, 'This assignment is published; its rubric is fixed.');
    }
    if (!criteria.length) throw new HttpError(422, 'A rubric needs at least one criterion.');
    if (criteria.some((c) => c.points <= 0)) {
      throw new HttpError(422, 'Every criterion has to be worth something.');
    }

    const sum = criteria.reduce((t, c) => t + c.points, 0);
    if (sum !== assignment.total_points) {
      throw new HttpError(422,
        'The criteria add up to ' + sum + ', but the assignment is worth '
        + assignment.total_points + '.');
    }

    await this.#db.from('onyx_rubric_criteria')
      .delete().eq('tenant_id', tenantId).eq('assignment_id', assignmentId);
    const { error } = await this.#db.from('onyx_rubric_criteria').insert(
      criteria.map((c, i) => ({
        tenant_id: tenantId, assignment_id: assignmentId,
        title: c.title.trim(), description: c.description ?? null,
        points: c.points, sort: i,
      })));
    if (error) throw new HttpError(500, 'Could not save the rubric: ' + error.message);
    return this.rubric(tenantId, assignmentId);
  }

  async rubric(tenantId: number, assignmentId: number) {
    const { data } = await this.#db.from('onyx_rubric_criteria')
      .select(CRITERION_COLUMNS)
      .eq('tenant_id', tenantId).eq('assignment_id', assignmentId).order('sort');
    return data ?? [];
  }

  /** Publishing is what makes an assignment visible to a cohort. */
  async publish(tenantId: number, assignmentId: number) {
    const assignment = await this.assignment(tenantId, assignmentId);
    if (assignment.status === 'published') return assignment;

    const criteria = await this.rubric(tenantId, assignmentId);
    if (criteria.length) {
      const sum = criteria.reduce((t, c) => t + Number(c.points), 0);
      if (sum !== assignment.total_points) {
        throw new HttpError(422, 'The rubric no longer adds up to the total.');
      }
    }
    await this.#db.from('onyx_assignments')
      .update({ status: 'published', updated_at: new Date(this.#now()).toISOString() })
      .eq('tenant_id', tenantId).eq('id', assignmentId);
    return { ...assignment, status: 'published' };
  }

  // ---- LRN-04b/c: the learner's side ----

  async mySubmission(tenantId: number, assignmentId: number, userId: string) {
    const { data } = await this.#db.from('onyx_assignment_submissions')
      .select(SUBMISSION_COLUMNS)
      .eq('tenant_id', tenantId).eq('assignment_id', assignmentId).eq('user_id', userId)
      .maybeSingle();
    if (!data) return null;
    const scores = data.returned_at ? await this.#scores(tenantId, Number(data.id)) : [];
    return { ...forLearner(data), rubric_scores: scores };
  }

  /**
   * LRN-04c -- autosave.
   *
   * Saves without submitting, into the row the submission will become. It is
   * separate from submit() rather than a flag on it, because a draft must never
   * be able to become a submission by accident: the acceptance criterion is
   * that a dropped connection costs nothing, not that it submits early.
   *
   * The read-then-insert below has a real window: the browser fires this on
   * every blur, and clicking Submit blurs the textarea a moment before the
   * click itself lands, so an ordinary "type, then click Submit" can send a
   * draft save and a submit within milliseconds of each other. Both can pass
   * the `existing` check before either has committed, and the loser's insert
   * hits `onyx_assignment_submissions_unique` -- not a conflict the person
   * caused, so it is folded into the update the winner already made rather
   * than shown as a failed save.
   */
  async saveDraft(tenantId: number, assignmentId: number, userId: string, body: string) {
    const assignment = await this.#openAssignment(tenantId, assignmentId, userId);
    const existing = await this.#submission(tenantId, assignmentId, userId);
    const now = new Date(this.#now()).toISOString();

    if (existing) {
      if (existing.status !== 'draft') {
        throw new HttpError(422, 'This has already been submitted.');
      }
      await this.#db.from('onyx_assignment_submissions')
        .update({ body, updated_at: now }).eq('id', existing.id);
      return { ...existing, body, updated_at: now };
    }

    const { data, error } = await this.#db.from('onyx_assignment_submissions').insert({
      tenant_id: tenantId, assignment_id: assignment.id, user_id: userId,
      body, status: 'draft', attempt: 1,
    }).select(SUBMISSION_COLUMNS).maybeSingle();
    if (error && /duplicate key|unique/i.test(error.message)) {
      const race = await this.#submission(tenantId, assignmentId, userId);
      if (race && race.status === 'draft') {
        await this.#db.from('onyx_assignment_submissions')
          .update({ body, updated_at: now }).eq('id', race.id);
        return { ...race, body, updated_at: now };
      }
      if (race) throw new HttpError(422, 'This has already been submitted.');
    }
    if (error) throw new HttpError(500, 'Could not save your draft: ' + error.message);
    return data!;
  }

  async submit(tenantId: number, assignmentId: number, userId: string, input: {
    body?: string | null; file_path?: string | null;
  }) {
    const assignment = await this.#openAssignment(tenantId, assignmentId, userId);
    if (!input.body?.trim() && !input.file_path) {
      throw new HttpError(422, 'There is nothing to submit.');
    }

    const now = this.#now();
    const late = Boolean(assignment.due_at) && now > Date.parse(assignment.due_at!);
    if (late && assignment.late_policy === 'reject') {
      throw new HttpError(422, 'The deadline for this assignment has passed.');
    }

    const at = new Date(now).toISOString();
    const existing = await this.#submission(tenantId, assignmentId, userId);

    if (existing && existing.status !== 'draft') {
      if (!assignment.allow_resubmission) {
        throw new HttpError(422, 'This assignment does not allow resubmission.');
      }
      // Resubmission raises the attempt and clears the grade: a score attached
      // to work that has since been replaced is worse than no score.
      const { error } = await this.#db.from('onyx_assignment_submissions').update({
        body: input.body ?? existing.body,
        file_path: input.file_path ?? existing.file_path,
        status: 'submitted',
        attempt: Number(existing.attempt) + 1,
        submitted_at: at, is_late: late ? 1 : 0,
        score: null, feedback: null, graded_by: null, graded_at: null, returned_at: null,
        updated_at: at,
      }).eq('id', existing.id);
      if (error) throw new HttpError(500, 'Could not resubmit: ' + error.message);
      await this.#db.from('onyx_submission_scores')
        .delete().eq('tenant_id', tenantId).eq('submission_id', existing.id);
      return this.mySubmission(tenantId, assignmentId, userId);
    }

    if (existing) {
      await this.#db.from('onyx_assignment_submissions').update({
        body: input.body ?? existing.body,
        file_path: input.file_path ?? existing.file_path,
        status: 'submitted', submitted_at: at, is_late: late ? 1 : 0, updated_at: at,
      }).eq('id', existing.id);
      return this.mySubmission(tenantId, assignmentId, userId);
    }

    const { error } = await this.#db.from('onyx_assignment_submissions').insert({
      tenant_id: tenantId, assignment_id: assignmentId, user_id: userId,
      body: input.body ?? null, file_path: input.file_path ?? null,
      status: 'submitted', attempt: 1, submitted_at: at, is_late: late ? 1 : 0,
    });
    // Same footrace as saveDraft(), the other way around: the autosave this
    // submit's own blur just triggered can win the race between the read
    // above and this insert. The row it created is the draft this submit was
    // always going to become, so that becomes an update instead of a failure.
    if (error && /duplicate key|unique/i.test(error.message)) {
      const race = await this.#submission(tenantId, assignmentId, userId);
      if (race && race.status === 'draft') {
        await this.#db.from('onyx_assignment_submissions').update({
          body: input.body ?? race.body,
          file_path: input.file_path ?? race.file_path,
          status: 'submitted', submitted_at: at, is_late: late ? 1 : 0, updated_at: at,
        }).eq('id', race.id);
        return this.mySubmission(tenantId, assignmentId, userId);
      }
    }
    if (error) throw new HttpError(500, 'Could not submit: ' + error.message);
    return this.mySubmission(tenantId, assignmentId, userId);
  }

  // ---- the faculty side ----

  /** Everything handed in, for marking. Faculty see scores; learners do not. */
  async submissions(tenantId: number, assignmentId: number) {
    const { data } = await this.#db.from('onyx_assignment_submissions')
      .select(SUBMISSION_COLUMNS)
      .eq('tenant_id', tenantId).eq('assignment_id', assignmentId)
      .neq('status', 'draft')
      .order('submitted_at');
    return data ?? [];
  }

  /**
   * Grading against the rubric.
   *
   * When a rubric exists the score is its sum, not a number typed alongside it.
   * Two numbers that are meant to agree eventually will not.
   */
  async grade(tenantId: number, submissionId: number, gradedBy: string, input: {
    scores?: { criterion_id: number; points: number; comment?: string | null }[];
    score?: number;
    feedback?: string | null;
  }) {
    const submission = await this.#submissionById(tenantId, submissionId);
    if (submission.status === 'draft') throw new HttpError(422, 'That has not been submitted yet.');
    const assignment = await this.assignment(tenantId, Number(submission.assignment_id));
    const criteria = await this.rubric(tenantId, Number(submission.assignment_id));

    let total: number;
    if (criteria.length) {
      if (!input.scores?.length) throw new HttpError(422, 'This assignment is graded by rubric.');
      const byId = new Map(criteria.map((c) => [Number(c.id), c]));
      const seen = new Set<number>();
      for (const s of input.scores) {
        const criterion = byId.get(Number(s.criterion_id));
        if (!criterion) throw new HttpError(422, 'That criterion is not on this rubric.');
        if (seen.has(Number(s.criterion_id))) {
          throw new HttpError(422, 'The same criterion was scored twice.');
        }
        seen.add(Number(s.criterion_id));
        if (s.points < 0 || s.points > Number(criterion.points)) {
          throw new HttpError(422,
            '"' + criterion.title + '" is out of ' + criterion.points + '.');
        }
      }
      if (seen.size !== criteria.length) {
        throw new HttpError(422, 'Every criterion has to be scored.');
      }
      total = input.scores.reduce((t, s) => t + s.points, 0);

      await this.#db.from('onyx_submission_scores')
        .delete().eq('tenant_id', tenantId).eq('submission_id', submissionId);
      await this.#db.from('onyx_submission_scores').insert(input.scores.map((s) => ({
        tenant_id: tenantId, submission_id: submissionId,
        criterion_id: s.criterion_id, points: s.points, comment: s.comment ?? null,
      })));
    } else {
      if (input.score === undefined) throw new HttpError(422, 'A score is required.');
      if (input.score < 0 || input.score > assignment.total_points) {
        throw new HttpError(422, 'This assignment is out of ' + assignment.total_points + '.');
      }
      total = input.score;
    }

    // The late penalty is applied once, here, so it is visible in the stored
    // score rather than recomputed differently by whatever reads it next.
    if (submission.is_late && assignment.late_policy === 'penalty') {
      total = Math.max(0,
        Math.round((total * (1 - assignment.late_penalty_percent / 100)) * 100) / 100);
    }

    const at = new Date(this.#now()).toISOString();
    const { error } = await this.#db.from('onyx_assignment_submissions').update({
      score: total, feedback: input.feedback ?? null,
      status: 'graded', graded_by: gradedBy, graded_at: at, updated_at: at,
    }).eq('id', submissionId);
    if (error) throw new HttpError(500, 'Could not save the grade: ' + error.message);
    return { ...submission, score: total, status: 'graded' as const, graded_at: at };
  }

  /** Releasing a grade to the learner. Until this, they see nothing. */
  async returnToLearner(tenantId: number, submissionId: number) {
    const submission = await this.#submissionById(tenantId, submissionId);
    if (submission.status !== 'graded') throw new HttpError(422, 'That has not been graded yet.');
    const at = new Date(this.#now()).toISOString();
    await this.#db.from('onyx_assignment_submissions')
      .update({ status: 'returned', returned_at: at, updated_at: at }).eq('id', submissionId);
    return { ...submission, status: 'returned' as const, returned_at: at };
  }

  /** Returns a whole assignment at once, which is how marking actually ends. */
  async returnAll(tenantId: number, assignmentId: number) {
    const graded = (await this.submissions(tenantId, assignmentId))
      .filter((s) => s.status === 'graded');
    for (const s of graded) await this.returnToLearner(tenantId, Number(s.id));
    return { returned: graded.length };
  }

  /**
   * Marking-queue counts for several assignments at once: how many are
   * handed in, waiting, marked-but-not-returned, and done.
   *
   * A marking screen needs one assignment's full submissions; a dashboard
   * scanning a dozen assignments for "how many are waiting" only needs
   * these four numbers per assignment, so this reads every relevant
   * submission in one query and folds the counts in memory instead of
   * calling `assignment()` (and its embedded submissions) once per
   * assignment. Keyed by assignment id -- a plain object, not a Map, since
   * this crosses into a JSON response.
   */
  async submissionCountsBulk(tenantId: number, assignmentIds: number[]) {
    const counts: Record<number, { total: number; waiting: number; held: number; done: number }> = {};
    if (!assignmentIds.length) return counts;
    const { data } = await this.#db.from('onyx_assignment_submissions')
      .select('assignment_id, status')
      .eq('tenant_id', tenantId).neq('status', 'draft').in('assignment_id', assignmentIds);
    for (const s of data ?? []) {
      const id = Number(s.assignment_id);
      const c = counts[id] ?? (counts[id] = { total: 0, waiting: 0, held: 0, done: 0 });
      c.total += 1;
      if (s.status === 'submitted') c.waiting += 1;
      if (s.status === 'graded') c.held += 1;
      if (s.status === 'graded' || s.status === 'returned') c.done += 1;
    }
    return counts;
  }

  async submissionDetail(tenantId: number, submissionId: number) {
    const submission = await this.#submissionById(tenantId, submissionId);
    return { ...submission, rubric_scores: await this.#scores(tenantId, submissionId) };
  }

  // ---- internals ----

  async #openAssignment(tenantId: number, assignmentId: number, userId: string) {
    const assignment = await this.assignment(tenantId, assignmentId);
    // An unpublished assignment does not exist as far as a learner is
    // concerned, so this is a 404 rather than a 403.
    if (assignment.status !== 'published') throw new HttpError(404, 'Assignment not found.');
    await this.#academics.assertEnrolled(tenantId, Number(assignment.course_id), userId);
    return assignment;
  }

  async #submission(tenantId: number, assignmentId: number, userId: string) {
    const { data } = await this.#db.from('onyx_assignment_submissions')
      .select(SUBMISSION_COLUMNS)
      .eq('tenant_id', tenantId).eq('assignment_id', assignmentId).eq('user_id', userId)
      .maybeSingle();
    return data ?? null;
  }

  async #submissionById(tenantId: number, id: number) {
    const { data } = await this.#db.from('onyx_assignment_submissions')
      .select(SUBMISSION_COLUMNS).eq('tenant_id', tenantId).eq('id', id).maybeSingle();
    if (!data) throw new HttpError(404, 'Submission not found.');
    return data;
  }

  async #scores(tenantId: number, submissionId: number) {
    const { data } = await this.#db.from('onyx_submission_scores')
      .select(SCORE_COLUMNS).eq('tenant_id', tenantId).eq('submission_id', submissionId);
    return data ?? [];
  }
}
