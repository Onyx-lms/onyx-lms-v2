/**
 * LRN-05 and LRN-06a -- progress, nudges, and course discussion.
 *
 * "Personalised progress and nudges", and "discussion and doubt resolution, so
 * no learner is stuck alone."
 *
 * **Nothing about a nudge is stored.** The acceptance criterion is that the
 * nudge changes when the underlying signal changes, and a stored nudge fails
 * that by construction: it is a sentence written about a moment, and the moment
 * moves. Everything here is computed at read time from rows that already exist
 * -- lesson progress, submissions, attendance, attempts -- so there is no
 * second copy of the truth to go stale, and no job to re-run when it does.
 *
 * The cost is that the dashboard is several queries rather than one row. That
 * is the right trade for a page one person opens a few times a day, and the
 * wrong one for a report over a cohort, which is why the cohort view in
 * assess-analytics aggregates instead.
 */
import type { OnyxDb } from './db.ts';
import type { Role, DiscussionStatus } from '@onyx/types';
import { HttpError } from '../http/errors.ts';
import type { AcademicsService } from './academics.service.ts';
import type { AuditService } from './audit.service.ts';

const STAFF: Role[] = ['admin', 'faculty'];
const isStaff = (role: Role) => STAFF.includes(role);

const DISCUSSION_COLUMNS = 'id, tenant_id, course_id, lesson_id, author_id, title, body, status, resolved_at, resolved_by, answer_post_id, reply_count, last_post_at, created_at, updated_at';
const POST_COLUMNS = 'id, tenant_id, discussion_id, parent_id, author_id, body, votes, is_answer, edited_at, created_at';

/** A day, in the institution's terms. Streaks are counted in dates, not hours. */
const DAY_MS = 86_400_000;
const dayKey = (iso: string) => iso.slice(0, 10);

/**
 * The date part of a "because" line, in the words a person would use.
 *
 * These strings are shown verbatim under each nudge, so an ISO timestamp --
 * which is what this used to interpolate -- put
 * "due 2026-08-08T22:35:56.508+00:00" on the dashboard of every learner with
 * an assignment outstanding.
 */
function dueInWords(due: string | null | undefined, now: number): string {
  if (!due) return 'no due date';
  const t = Date.parse(due);
  if (!Number.isFinite(t)) return 'no due date';
  const startOf = (ms: number) => { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); };
  const days = Math.round((startOf(t) - startOf(now)) / 86_400_000);
  if (days < 0) return Math.abs(days) === 1 ? 'due yesterday' : `due ${Math.abs(days)} days ago`;
  if (days === 0) return 'due today';
  if (days === 1) return 'due tomorrow';
  return `due in ${days} days`;
}

export interface Nudge {
  /** Stable across renders so the UI can key on it; not stored anywhere. */
  kind: string;
  /** What the learner should do, in the second person. */
  message: string;
  href: string | null;
  /** low | normal | high -- ordering only, no styling implied. */
  urgency: 'low' | 'normal' | 'high';
  /** The row that produced it, so "why am I being told this" has an answer. */
  because: string;
}

export interface ProgressSummary {
  courses: { total: number; enrolled: number };
  lessons: { completed: number; total: number; percent: number };
  assignments: { due: number; overdue: number; submitted: number };
  attendance: { attended: number; sessions: number; percent: number };
  practice: { solved: number; attempted: number };
  streak: { current: number; longest: number; active_today: boolean };
  nudges: Nudge[];
}

export class EngageService {
  #db: OnyxDb;
  #academics: AcademicsService;
  #audit: AuditService;
  #now: () => number;

  constructor(db: OnyxDb, academics: AcademicsService, audit: AuditService,
    now: () => number = Date.now) {
    this.#db = db;
    this.#academics = academics;
    this.#audit = audit;
    this.#now = now;
  }

  // -------------------------------------------------------------------------
  // LRN-05: progress, streaks and nudges
  // -------------------------------------------------------------------------

  /**
   * Every date on which this person did something that counts as learning.
   *
   * Completing a lesson, submitting an assignment and submitting code all
   * count. Opening a page does not -- a streak that rewards logging in is a
   * streak about logging in.
   */
  async #activeDays(tenantId: number, userId: string): Promise<Set<string>> {
    const [lessons, assignments, code] = await Promise.all([
      this.#db.from('onyx_lesson_progress').select('completed_at')
        .eq('tenant_id', tenantId).eq('user_id', userId).not('completed_at', 'is', null),
      this.#db.from('onyx_assignment_submissions').select('submitted_at')
        .eq('tenant_id', tenantId).eq('user_id', userId).not('submitted_at', 'is', null),
      this.#db.from('onyx_code_submissions').select('created_at')
        .eq('tenant_id', tenantId).eq('user_id', userId),
    ]);

    const days = new Set<string>();
    for (const r of lessons.data ?? []) if (r.completed_at) days.add(dayKey(r.completed_at));
    for (const r of assignments.data ?? []) if (r.submitted_at) days.add(dayKey(r.submitted_at));
    for (const r of code.data ?? []) if (r.created_at) days.add(dayKey(r.created_at));
    return days;
  }

  /**
   * Current and longest run of consecutive active days.
   *
   * The current streak counts back from today, and from yesterday if today has
   * nothing yet -- otherwise every streak in the world would break at midnight
   * and be reported broken all morning.
   */
  #streak(days: Set<string>): { current: number; longest: number; active_today: boolean } {
    const today = dayKey(new Date(this.#now()).toISOString());
    const activeToday = days.has(today);

    let current = 0;
    let cursor = this.#now();
    if (!activeToday) cursor -= DAY_MS; // yesterday still counts as unbroken
    while (days.has(dayKey(new Date(cursor).toISOString()))) {
      current += 1;
      cursor -= DAY_MS;
    }

    const sorted = [...days].sort();
    let longest = 0;
    let run = 0;
    let previous: number | null = null;
    for (const day of sorted) {
      const t = Date.parse(day + 'T00:00:00Z');
      run = previous !== null && t - previous === DAY_MS ? run + 1 : 1;
      previous = t;
      if (run > longest) longest = run;
    }

    return { current, longest, active_today: activeToday };
  }

  async summary(tenantId: number, userId: string): Promise<ProgressSummary> {
    const enrolments = await this.#academics.enrollmentsFor(tenantId, userId);
    const courseIds = enrolments.map((e) => Number(e.course_id));
    const now = this.#now();

    const [lessonRows, progressRows, assignmentRows, submissionRows,
      sessionRows, attendanceRows, codeRows, days] = await Promise.all([
      courseIds.length
        ? this.#db.from('onyx_lessons').select('id, module_id')
          .eq('tenant_id', tenantId).in('course_id', courseIds)
        : Promise.resolve({ data: [] as { id: number }[] }),
      this.#db.from('onyx_lesson_progress').select('lesson_id, completed_at')
        .eq('tenant_id', tenantId).eq('user_id', userId),
      courseIds.length
        ? this.#db.from('onyx_assignments')
          .select('id, course_id, title, due_at, status')
          .eq('tenant_id', tenantId).in('course_id', courseIds).eq('status', 'published')
        : Promise.resolve({ data: [] as { id: number; course_id: number; title: string; due_at: string | null; status: string }[] }),
      this.#db.from('onyx_assignment_submissions').select('assignment_id, submitted_at')
        .eq('tenant_id', tenantId).eq('user_id', userId),
      courseIds.length
        ? this.#db.from('onyx_attendance_sessions').select('id')
          .eq('tenant_id', tenantId).in('course_id', courseIds)
        : Promise.resolve({ data: [] as { id: number }[] }),
      this.#db.from('onyx_attendance_records').select('session_id, status')
        .eq('tenant_id', tenantId).eq('user_id', userId),
      // `mode: 'submit'` and the score, not just the status. A Run checks the
      // visible cases while you work and is not an attempt at the problem.
      this.#db.from('onyx_code_submissions').select('problem_id, status, score, max_score')
        .eq('tenant_id', tenantId).eq('user_id', userId).eq('mode', 'submit'),
      this.#activeDays(tenantId, userId),
    ]);

    const totalLessons = (lessonRows.data ?? []).length;
    const completed = (progressRows.data ?? []).filter((p) => p.completed_at).length;

    const submitted = new Set((submissionRows.data ?? [])
      .filter((s) => s.submitted_at).map((s) => Number(s.assignment_id)));
    const outstanding = (assignmentRows.data ?? []).filter((a) => !submitted.has(Number(a.id)));
    const overdue = outstanding.filter((a) => a.due_at && Date.parse(a.due_at) < now);

    const sessions = (sessionRows.data ?? []).length;
    const attended = (attendanceRows.data ?? [])
      .filter((r) => r.status === 'present' || r.status === 'late').length;

    // Not `status === 'accepted'`. No row has ever held that value -- the
    // column is queued | running | done | failed -- so this filter matched
    // nothing and the dashboard's "Solved" tile read 0 for every learner who
    // had ever solved anything. Solved is derived, and this is the same rule
    // codelab.service and career.service use: graded, and every mark earned.
    const solvedProblems = new Set((codeRows.data ?? [])
      .filter((c) => c.status === 'done'
        && Number(c.max_score) > 0 && Number(c.score) >= Number(c.max_score))
      .map((c) => Number(c.problem_id)));
    const attemptedProblems = new Set((codeRows.data ?? []).map((c) => Number(c.problem_id)));

    const streak = this.#streak(days);

    const summary: ProgressSummary = {
      courses: { total: courseIds.length, enrolled: courseIds.length },
      lessons: {
        completed,
        total: totalLessons,
        percent: totalLessons ? Math.round((completed / totalLessons) * 100) : 0,
      },
      assignments: {
        due: outstanding.length,
        overdue: overdue.length,
        submitted: submitted.size,
      },
      attendance: {
        attended,
        sessions,
        percent: sessions ? Math.round((attended / sessions) * 100) : 0,
      },
      practice: { solved: solvedProblems.size, attempted: attemptedProblems.size },
      streak,
      nudges: [],
    };

    summary.nudges = this.#nudges(summary, {
      overdue: overdue.map((a) => ({ id: Number(a.id), title: String(a.title), due_at: a.due_at })),
      nextDue: outstanding
        .filter((a) => a.due_at && Date.parse(a.due_at) >= now)
        .sort((a, b) => Date.parse(a.due_at!) - Date.parse(b.due_at!))[0],
      courseId: courseIds[0] ?? null,
    });

    return summary;
  }

  /**
   * The next best thing to do, from the signals above.
   *
   * Ordered deliberately: something already late outranks something merely due,
   * which outranks anything about a habit. At most four, because a list of
   * fifteen suggestions is a list of none.
   */
  #nudges(s: ProgressSummary, ctx: {
    overdue: { id: number; title: string; due_at: string | null }[];
    nextDue?: { id: number; title: string; due_at: string | null };
    courseId: number | null;
  }): Nudge[] {
    const out: Nudge[] = [];

    if (s.courses.enrolled === 0) {
      return [{
        kind: 'enrol',
        message: 'You are not enrolled in any course yet. The catalogue is the place to start.',
        href: '/onyx/courses',
        urgency: 'high',
        because: 'no enrolments',
      }];
    }

    for (const a of ctx.overdue.slice(0, 2)) {
      out.push({
        kind: 'assignment-overdue',
        message: '"' + a.title + '" is past its due date. Submitting late is better than not.',
        href: '/onyx/assignments/' + a.id,
        urgency: 'high',
        because: '"' + a.title + '", ' + dueInWords(a.due_at, this.#now()),
      });
    }

    if (!ctx.overdue.length && ctx.nextDue) {
      out.push({
        kind: 'assignment-due',
        message: '"' + ctx.nextDue.title + '" is your next deadline.',
        href: '/onyx/assignments/' + ctx.nextDue.id,
        urgency: 'normal',
        because: '"' + ctx.nextDue.title + '", ' + dueInWords(ctx.nextDue.due_at, this.#now()),
      });
    }

    // Attendance is a warning rather than a task: there is nothing to click,
    // and a learner below three quarters usually already knows.
    if (s.attendance.sessions >= 4 && s.attendance.percent < 75) {
      out.push({
        kind: 'attendance-low',
        message: 'Your attendance is ' + s.attendance.percent + '%. Most programmes expect 75%.',
        href: null,
        urgency: 'high',
        because: s.attendance.attended + ' of ' + s.attendance.sessions + ' sessions',
      });
    }

    if (s.lessons.total > 0 && s.lessons.completed < s.lessons.total) {
      out.push({
        kind: 'continue',
        message: 'You are ' + s.lessons.percent + '% through your lessons. Pick up where you left off.',
        href: ctx.courseId ? '/onyx/courses/' + ctx.courseId : '/onyx/courses',
        urgency: 'normal',
        because: s.lessons.completed + ' of ' + s.lessons.total + ' lessons',
      });
    }

    if (!s.streak.active_today) {
      out.push({
        kind: 'streak',
        message: s.streak.current > 0
          ? 'You are on a ' + s.streak.current + '-day streak. Nothing today yet.'
          : 'Nothing done today. A short session is enough to start a streak.',
        href: '/onyx/practice',
        urgency: 'low',
        because: 'streak ' + s.streak.current + ', inactive today',
      });
    }

    return out.slice(0, 4);
  }

  // -------------------------------------------------------------------------
  // LRN-06a: threaded course Q&A
  // -------------------------------------------------------------------------

  /** Staff read any course; everyone else has to be in it. */
  async #assertCanRead(tenantId: number, courseId: number, userId: string, role: Role) {
    await this.#academics.course(tenantId, courseId);
    if (isStaff(role)) return;
    await this.#academics.assertEnrolled(tenantId, courseId, userId);
  }

  async discussions(tenantId: number, courseId: number, viewer: { userId: string; role: Role },
    filters: { status?: DiscussionStatus; q?: string } = {}) {
    await this.#assertCanRead(tenantId, courseId, viewer.userId, viewer.role);

    let query = this.#db.from('onyx_discussions').select(DISCUSSION_COLUMNS)
      .eq('tenant_id', tenantId).eq('course_id', courseId);
    if (filters.status) query = query.eq('status', filters.status);
    // A resolved thread stays searchable -- that is the acceptance criterion,
    // so the search deliberately does not filter by status.
    if (filters.q) {
      const term = '%' + filters.q.replace(/[%_]/g, '') + '%';
      query = query.or('title.ilike.' + term + ',body.ilike.' + term);
    }

    const { data } = await query.order('last_post_at', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false });
    return data ?? [];
  }

  /**
   * Open discussions across several courses at once -- for a dashboard's
   * "any question with no reply" scan, which would otherwise call
   * `discussions()` once per taught course. The per-course read/enrolment
   * check `discussions()` makes (`#assertCanRead`) is skipped here: the
   * caller already teaches every course in the list -- it came from
   * `teachingFor()` -- which is the same authority `#assertCanRead` would
   * grant a teacher of the course, one at a time.
   */
  async openDiscussionsBulk(tenantId: number, courseIds: number[]) {
    if (!courseIds.length) return [];
    const { data } = await this.#db.from('onyx_discussions').select(DISCUSSION_COLUMNS)
      .eq('tenant_id', tenantId).eq('status', 'open').in('course_id', courseIds)
      .order('last_post_at', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false });
    return data ?? [];
  }

  async discussion(tenantId: number, id: number, viewer: { userId: string; role: Role }) {
    const { data } = await this.#db.from('onyx_discussions').select(DISCUSSION_COLUMNS)
      .eq('tenant_id', tenantId).eq('id', id).maybeSingle();
    if (!data) throw new HttpError(404, 'No such discussion.');
    await this.#assertCanRead(tenantId, Number(data.course_id), viewer.userId, viewer.role);

    const { data: posts } = await this.#db.from('onyx_discussion_posts').select(POST_COLUMNS)
      .eq('tenant_id', tenantId).eq('discussion_id', id)
      .order('created_at', { ascending: true });

    const people = await this.#names(tenantId, [
      String(data.author_id),
      ...(posts ?? []).map((p) => String(p.author_id)),
    ]);

    return {
      ...data,
      author: people.get(String(data.author_id)) ?? null,
      posts: (posts ?? []).map((p) => ({
        ...p,
        author: people.get(String(p.author_id)) ?? null,
        vote_count: Array.isArray(p.votes) ? p.votes.length : 0,
        // `votes` holds the uuid of everyone who voted -- mapped through
        // String() because the column's declared type has not caught up
        // with the auth migration yet, not because the values are numeric.
        voted: Array.isArray(p.votes) ? p.votes.map(String).includes(viewer.userId) : false,
        // The voter list is how one-vote-per-person is enforced, not something
        // the room is entitled to read.
        votes: undefined,
      })),
    };
  }

  async #names(tenantId: number, ids: string[]) {
    const unique = [...new Set(ids.filter(Boolean))];
    if (!unique.length) return new Map<string, { id: string; name: string }>();
    const { data } = await this.#db.from('onyx_users').select('id, name').in('id', unique);
    void tenantId;
    return new Map((data ?? []).map((u) => [String(u.id), { id: String(u.id), name: String(u.name) }]));
  }

  async ask(tenantId: number, courseId: number, author: { userId: string; role: Role }, input: {
    title: string; body: string; lesson_id?: number | null; mentions?: string[];
  }) {
    await this.#assertCanRead(tenantId, courseId, author.userId, author.role);
    const title = input.title.trim();
    const body = input.body.trim();
    if (title.length < 3) throw new HttpError(422, 'A question needs a title.');
    if (!body) throw new HttpError(422, 'A question needs a body.');

    const { data, error } = await this.#db.from('onyx_discussions').insert({
      tenant_id: tenantId,
      course_id: courseId,
      lesson_id: input.lesson_id ?? null,
      author_id: author.userId,
      title,
      body,
      status: 'open',
      reply_count: 0,
      last_post_at: new Date(this.#now()).toISOString(),
    }).select(DISCUSSION_COLUMNS).maybeSingle();
    if (error || !data) {
      throw new HttpError(500, 'Could not post the question: ' + (error?.message ?? 'no row'));
    }

    await this.#mention(tenantId, Number(data.id), null, input.mentions ?? [], author.userId);
    await this.#audit.record(
      { tenant_id: tenantId, user_id: author.userId },
      { action: 'discussion.asked', entityType: 'discussion', entityId: Number(data.id),
        after: { title } });
    return data;
  }

  async reply(tenantId: number, discussionId: number, author: { userId: string; role: Role },
    input: { body: string; parent_id?: number | null; mentions?: string[] }) {
    const thread = await this.#thread(tenantId, discussionId);
    await this.#assertCanRead(tenantId, Number(thread.course_id), author.userId, author.role);
    if (thread.status === 'closed') {
      throw new HttpError(409, 'This thread is closed.');
    }

    const body = input.body.trim();
    if (!body) throw new HttpError(422, 'A reply needs a body.');

    if (input.parent_id) {
      // One level of nesting. A reply to a reply attaches to the same parent
      // rather than growing a third level nobody can read on a phone.
      const { data: parent } = await this.#db.from('onyx_discussion_posts')
        .select('id, discussion_id, parent_id')
        .eq('tenant_id', tenantId).eq('id', input.parent_id).maybeSingle();
      if (!parent || Number(parent.discussion_id) !== discussionId) {
        throw new HttpError(422, 'That reply is not part of this thread.');
      }
    }

    const at = new Date(this.#now()).toISOString();
    const { data, error } = await this.#db.from('onyx_discussion_posts').insert({
      tenant_id: tenantId,
      discussion_id: discussionId,
      parent_id: input.parent_id ?? null,
      author_id: author.userId,
      body,
      votes: [],
      is_answer: false,
    }).select(POST_COLUMNS).maybeSingle();
    if (error || !data) {
      throw new HttpError(500, 'Could not post the reply: ' + (error?.message ?? 'no row'));
    }

    await this.#db.from('onyx_discussions').update({
      reply_count: Number(thread.reply_count ?? 0) + 1,
      last_post_at: at,
      updated_at: at,
    }).eq('tenant_id', tenantId).eq('id', discussionId);

    await this.#mention(tenantId, discussionId, Number(data.id), input.mentions ?? [], author.userId);
    return data;
  }

  /**
   * One vote per person, enforced by storing who rather than how many.
   *
   * Returns the new count. Voting twice removes the vote -- a toggle, because
   * a second click is far more often a mistake than an attempt to cheat, and
   * either way it cannot inflate the number.
   */
  async vote(tenantId: number, postId: number, userId: string, role: Role) {
    const { data: post } = await this.#db.from('onyx_discussion_posts')
      .select('id, discussion_id, author_id, votes')
      .eq('tenant_id', tenantId).eq('id', postId).maybeSingle();
    if (!post) throw new HttpError(404, 'No such post.');

    const thread = await this.#thread(tenantId, Number(post.discussion_id));
    await this.#assertCanRead(tenantId, Number(thread.course_id), userId, role);

    const votes: string[] = Array.isArray(post.votes) ? post.votes.map(String) : [];
    const already = votes.includes(userId);
    const next = already ? votes.filter((v) => v !== userId) : [...votes, userId];

    const { error } = await this.#db.from('onyx_discussion_posts')
      .update({ votes: next }).eq('tenant_id', tenantId).eq('id', postId);
    if (error) throw new HttpError(500, 'Could not record the vote: ' + error.message);

    return { votes: next.length, voted: !already };
  }

  /**
   * Mark a thread answered.
   *
   * The asker or staff, and nobody else -- a third learner deciding that a
   * question has been answered is how a thread stops getting replies while the
   * person who asked is still stuck.
   */
  async resolve(tenantId: number, discussionId: number, postId: number,
    actor: { userId: string; role: Role }) {
    const thread = await this.#thread(tenantId, discussionId);
    if (String(thread.author_id) !== actor.userId && !isStaff(actor.role)) {
      throw new HttpError(403, 'Only the person who asked, or staff, can mark this answered.');
    }

    const { data: post } = await this.#db.from('onyx_discussion_posts')
      .select('id, discussion_id')
      .eq('tenant_id', tenantId).eq('id', postId).maybeSingle();
    if (!post || Number(post.discussion_id) !== discussionId) {
      throw new HttpError(422, 'That reply is not part of this thread.');
    }

    const at = new Date(this.#now()).toISOString();
    // Only one answer at a time: clearing first means a re-resolve moves the
    // marker rather than leaving two.
    await this.#db.from('onyx_discussion_posts').update({ is_answer: false })
      .eq('tenant_id', tenantId).eq('discussion_id', discussionId);
    await this.#db.from('onyx_discussion_posts').update({ is_answer: true })
      .eq('tenant_id', tenantId).eq('id', postId);

    const { data } = await this.#db.from('onyx_discussions').update({
      status: 'resolved',
      resolved_at: at,
      resolved_by: actor.userId,
      answer_post_id: postId,
      updated_at: at,
    }).eq('tenant_id', tenantId).eq('id', discussionId).select(DISCUSSION_COLUMNS).maybeSingle();

    await this.#audit.record(
      { tenant_id: tenantId, user_id: actor.userId },
      { action: 'discussion.resolved', entityType: 'discussion', entityId: discussionId,
        before: { status: thread.status },
        after: { status: 'resolved', answer_post_id: postId } });
    return data;
  }

  /** Reopening is deliberately as easy as resolving: being wrong is common. */
  async reopen(tenantId: number, discussionId: number, actor: { userId: string; role: Role }) {
    const thread = await this.#thread(tenantId, discussionId);
    if (String(thread.author_id) !== actor.userId && !isStaff(actor.role)) {
      throw new HttpError(403, 'Only the person who asked, or staff, can reopen this.');
    }
    await this.#db.from('onyx_discussion_posts').update({ is_answer: false })
      .eq('tenant_id', tenantId).eq('discussion_id', discussionId);
    const { data } = await this.#db.from('onyx_discussions').update({
      status: 'open', resolved_at: null, resolved_by: null, answer_post_id: null,
      updated_at: new Date(this.#now()).toISOString(),
    }).eq('tenant_id', tenantId).eq('id', discussionId).select(DISCUSSION_COLUMNS).maybeSingle();
    return data;
  }

  async #thread(tenantId: number, id: number) {
    const { data } = await this.#db.from('onyx_discussions').select(DISCUSSION_COLUMNS)
      .eq('tenant_id', tenantId).eq('id', id).maybeSingle();
    if (!data) throw new HttpError(404, 'No such discussion.');
    return data;
  }

  async #mention(tenantId: number, discussionId: number, postId: number | null,
    userIds: string[], by: string) {
    const targets = [...new Set(userIds.map(String))].filter((id) => id && id !== by);
    if (!targets.length) return;

    // A mention of somebody outside the institution is silently dropped rather
    // than refused: it is a typo in a message body, not an error worth losing
    // the message over.
    const { data: members } = await this.#db.from('onyx_memberships').select('user_id')
      .eq('tenant_id', tenantId).eq('status', 1).in('user_id', targets);
    const inside = new Set((members ?? []).map((m) => String(m.user_id)));

    const rows = targets.filter((id) => inside.has(id)).map((id) => ({
      tenant_id: tenantId, discussion_id: discussionId, post_id: postId, user_id: id,
    }));
    if (rows.length) await this.#db.from('onyx_discussion_mentions').insert(rows);
  }

  /** What a learner has been pulled into and has not looked at yet. */
  /**
   * Where somebody named you.
   *
   * Returns the thread's title, not just its id. The row on its own says
   * "discussion #10", which is not something a person can act on -- and this
   * endpoint had no screen for exactly as long as that was all it returned. One
   * extra query for the whole page rather than one per mention.
   */
  async mentions(tenantId: number, userId: string) {
    const { data } = await this.#db.from('onyx_discussion_mentions')
      .select('id, discussion_id, post_id, read_at, created_at')
      .eq('tenant_id', tenantId).eq('user_id', userId)
      .order('created_at', { ascending: false }).limit(50);

    const rows = data ?? [];
    if (!rows.length) return [];

    const ids = [...new Set(rows.map((m) => Number(m.discussion_id)))];
    const { data: threads } = await this.#db.from('onyx_discussions')
      .select('id, title, course_id, status')
      .eq('tenant_id', tenantId).in('id', ids);
    const byId = new Map((threads ?? []).map((d) => [Number(d.id), d]));

    return rows.map((m) => {
      const thread = byId.get(Number(m.discussion_id));
      return {
        id: Number(m.id),
        discussion_id: Number(m.discussion_id),
        post_id: m.post_id === null ? null : Number(m.post_id),
        read_at: m.read_at,
        created_at: m.created_at,
        // Null when the thread has since been deleted. The mention is still
        // shown -- "somebody named you in something that is gone" is a true
        // thing to say, and dropping the row would be a silent hole.
        title: thread ? String(thread.title) : null,
        course_id: thread ? Number(thread.course_id) : null,
        resolved: thread ? thread.status === 'resolved' : false,
      };
    });
  }

  async readMentions(tenantId: number, userId: string) {
    await this.#db.from('onyx_discussion_mentions')
      .update({ read_at: new Date(this.#now()).toISOString() })
      .eq('tenant_id', tenantId).eq('user_id', userId).is('read_at', null);
    return { ok: true };
  }
}
