/**
 * LRN-03 -- attendance.
 *
 * "Session attendance capture via QR or manual roster with per-learner and
 * per-cohort attendance analytics."
 *
 * The QR design, because it is the part that can be cheated:
 *
 *   * The code is never stored. It is an HMAC of a per-session secret and the
 *     current time window, recomputed on both sides. A leaked database gives
 *     an attacker no codes, only secrets that stop working when a session ends.
 *   * It rotates every `qr_window_seconds` (15 by default), so a photograph of
 *     the projector is worthless half a minute later.
 *   * The current window and the one immediately before it are accepted --
 *     RFC 6238's one-step tolerance, for the reason that RFC gives: a person
 *     reads the code near the end of a window and the request lands after the
 *     boundary. This replaced a current-window-only rule that looked stricter
 *     and was not: it also refused codes that were still on the screen, and it
 *     charged the learner for the server's own round trips. The guarantee is
 *     stated as a number rather than a rule -- **a code is dead at most
 *     `2 x qr_window_seconds` after it appeared**, which is the same half a
 *     minute the old 30-second single window gave.
 *   * The endpoint takes no learner id. Who is marked present comes from the
 *     token, so one learner physically cannot mark another.
 *
 * None of that stops someone sending a photo of the screen to a friend outside
 * the room. It is a deterrent with a 30-second half-life, not proof of
 * presence, and it should not be described as more than that.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { OnyxDb } from './db.ts';
import type { AttendanceStatus } from '@onyx/types';
import { HttpError } from '../http/errors.ts';
import { csvDocument } from '../format/csv.ts';
import type { AcademicsService } from './academics.service.ts';

const SESSION_COLUMNS = 'id, tenant_id, course_id, title, scheduled_at, duration_minutes, status, qr_window_seconds, created_by, created_at';
const RECORD_COLUMNS = 'id, tenant_id, session_id, user_id, status, method, note, marked_by, marked_at';

export const ATTENDANCE_STATUSES: AttendanceStatus[] = ['present', 'absent', 'late', 'excused'];

/** Counted as having attended. Late is still there; excused is neither. */
const ATTENDED: AttendanceStatus[] = ['present', 'late'];

export class AttendanceService {
  #db: OnyxDb;
  #academics: AcademicsService;
  /** Injectable so tests can move time without waiting for it. */
  #now: () => number;

  constructor(db: OnyxDb, academics: AcademicsService, now: () => number = Date.now) {
    this.#db = db;
    this.#academics = academics;
    this.#now = now;
  }

  // ---- LRN-03a: sessions ----

  async createSession(tenantId: number, courseId: number, createdBy: string, input: {
    title: string; scheduled_at: string; duration_minutes?: number; qr_window_seconds?: number;
  }) {
    await this.#academics.course(tenantId, courseId);
    // 15, not 30: a code is valid for its own window and the one after it, so
    // 15 keeps the longest life of a photographed code at about half a minute.
    const window = input.qr_window_seconds ?? 15;
    if (window < 10 || window > 300) {
      throw new HttpError(422, 'A code window must be between 10 and 300 seconds.');
    }

    const { data, error } = await this.#db.from('onyx_attendance_sessions').insert({
      tenant_id: tenantId,
      course_id: courseId,
      title: input.title.trim(),
      scheduled_at: input.scheduled_at,
      duration_minutes: input.duration_minutes ?? 60,
      status: 'open',
      qr_secret: randomBytes(24).toString('hex'),
      qr_window_seconds: window,
      created_by: createdBy,
    }).select(SESSION_COLUMNS).maybeSingle();
    if (error) throw new HttpError(500, 'Could not create the session: ' + error.message);
    // SESSION_COLUMNS already omits qr_secret. Deleting it as well means a
    // careless edit to that list cannot turn into a leaked secret.
    const { qr_secret, ...session } = (data ?? {}) as Record<string, unknown>;
    void qr_secret;
    return session as NonNullable<typeof data>;
  }

  async sessions(tenantId: number, courseId: number) {
    const { data } = await this.#db.from('onyx_attendance_sessions')
      .select(SESSION_COLUMNS)
      .eq('tenant_id', tenantId).eq('course_id', courseId)
      .order('scheduled_at', { ascending: false });
    return data ?? [];
  }

  /** The bulk twin of `sessions()` -- one query across several courses. */
  async sessionsBulk(tenantId: number, courseIds: number[]) {
    if (!courseIds.length) return [];
    const { data } = await this.#db.from('onyx_attendance_sessions')
      .select(SESSION_COLUMNS).eq('tenant_id', tenantId).in('course_id', courseIds)
      .order('scheduled_at', { ascending: false });
    return data ?? [];
  }

  async session(tenantId: number, id: number) {
    const { data } = await this.#db.from('onyx_attendance_sessions')
      .select(SESSION_COLUMNS).eq('tenant_id', tenantId).eq('id', id).maybeSingle();
    if (!data) throw new HttpError(404, 'Session not found.');
    return data;
  }

  async closeSession(tenantId: number, id: number) {
    await this.session(tenantId, id);
    await this.#db.from('onyx_attendance_sessions')
      .update({ status: 'closed', updated_at: new Date(this.#now()).toISOString() })
      .eq('tenant_id', tenantId).eq('id', id);
    return { id, status: 'closed' };
  }

  /** The roster to mark: everyone enrolled, with whatever is recorded so far. */
  async roster(tenantId: number, sessionId: number) {
    const session = await this.session(tenantId, sessionId);
    const [enrolled, records] = await Promise.all([
      this.#academics.roster(tenantId, Number(session.course_id)),
      this.records(tenantId, sessionId),
    ]);
    const byUser = new Map(records.map((r) => [String(r.user_id), r]));
    return {
      session,
      roster: enrolled.map((e) => ({
        user_id: String(e.user_id),
        record: byUser.get(String(e.user_id)) ?? null,
      })),
    };
  }

  async records(tenantId: number, sessionId: number) {
    const { data } = await this.#db.from('onyx_attendance_records')
      .select(RECORD_COLUMNS).eq('tenant_id', tenantId).eq('session_id', sessionId);
    return data ?? [];
  }

  /**
   * Faculty marking the roster.
   *
   * Everyone is written in one call because attendance is taken for a room, not
   * a person -- and a half-marked roster is indistinguishable from a room where
   * half the class was absent.
   */
  async mark(tenantId: number, sessionId: number, markedBy: string, entries: {
    user_id: string; status: AttendanceStatus; note?: string | null;
  }[]) {
    const session = await this.session(tenantId, sessionId);
    for (const e of entries) {
      if (!ATTENDANCE_STATUSES.includes(e.status)) {
        throw new HttpError(422, '"' + e.status + '" is not an attendance status.');
      }
    }

    const enrolled = new Set(
      (await this.#academics.roster(tenantId, Number(session.course_id)))
        .map((e) => String(e.user_id)));
    const stray = entries.find((e) => !enrolled.has(String(e.user_id)));
    if (stray) throw new HttpError(422, 'Someone in that list is not enrolled in this course.');

    const existing = new Map(
      (await this.records(tenantId, sessionId)).map((r) => [String(r.user_id), r]));
    const at = new Date(this.#now()).toISOString();
    let created = 0;
    let amended = 0;

    for (const e of entries) {
      const prior = existing.get(String(e.user_id));
      if (prior) {
        await this.#db.from('onyx_attendance_records').update({
          status: e.status, note: e.note ?? null, method: 'manual',
          marked_by: markedBy, marked_at: at,
        }).eq('id', prior.id);
        amended += 1;
      } else {
        await this.#db.from('onyx_attendance_records').insert({
          tenant_id: tenantId, session_id: sessionId, user_id: e.user_id,
          status: e.status, method: 'manual', note: e.note ?? null,
          marked_by: markedBy, marked_at: at,
        });
        created += 1;
      }
    }
    return { created, amended };
  }

  // ---- LRN-03b: QR self check-in ----

  /**
   * The code to put on screen, and how long it lasts.
   *
   * Faculty-facing: a learner who could read this could mark themselves present
   * from anywhere.
   */
  async currentCode(tenantId: number, sessionId: number) {
    // Stamped once, before any I/O. Reading the clock again after two database
    // round trips dated the code from a moment that had already passed, so the
    // countdown was short by however long the round trips took.
    const at = this.#now();
    const session = await this.session(tenantId, sessionId);
    if (session.status !== 'open') throw new HttpError(422, 'This session is closed.');

    const secret = await this.#secret(tenantId, sessionId);
    const window = Number(session.qr_window_seconds);
    const seconds = Math.floor(at / 1000);
    return {
      code: this.#code(secret, sessionId, Math.floor(seconds / window)),
      // How long the code on screen stays valid, so the display can count down
      // rather than refresh at an arbitrary moment.
      expires_in_seconds: window - (seconds % window),
      window_seconds: window,
    };
  }

  /**
   * A learner marking themselves present.
   *
   * `userId` comes from the caller's token. There is no parameter for it, so
   * "a learner cannot mark another learner" is structural rather than checked.
   */
  async checkIn(tenantId: number, sessionId: number, userId: string, code: string) {
    // The window this code is judged against is fixed by when the request
    // ARRIVED, not by when the three lookups below happen to finish. Deriving
    // it afterwards charged the learner for the server's own latency: against a
    // remote database the round trips alone could push a code that was still on
    // the projector into the next window, and it was refused as expired.
    const at = this.#now();
    const session = await this.session(tenantId, sessionId);
    if (session.status !== 'open') throw new HttpError(422, 'This session is closed.');
    await this.#academics.assertEnrolled(tenantId, Number(session.course_id), userId);

    const secret = await this.#secret(tenantId, sessionId);
    const window = Number(session.qr_window_seconds);
    const counter = Math.floor(at / 1000 / window);

    // The current window and the one immediately before it, which is RFC 6238's
    // one-step tolerance and exists for the same reason: a person reads a code
    // near the end of its window and the request lands after the boundary. The
    // exposure that buys back is bounded and paid for -- the default window is
    // 15 seconds rather than 30, so the longest a photographed code can live is
    // still about half a minute. Both are compared, and neither comparison is
    // allowed to short-circuit the other.
    const currentOk = constantTimeEqual(code.trim(), this.#code(secret, sessionId, counter));
    const previousOk = constantTimeEqual(code.trim(), this.#code(secret, sessionId, counter - 1));
    if (!currentOk && !previousOk) {
      // Deliberately the same message for a wrong code and an expired one:
      // distinguishing them tells someone with an old screenshot that they are
      // otherwise on the right track.
      throw new HttpError(422, 'That code is not valid right now.');
    }

    const existing = (await this.records(tenantId, sessionId))
      .find((r) => String(r.user_id) === userId);
    if (existing) {
      // A code is shared by the whole room for its window, so replay protection
      // is per learner: they are already marked, and a second scan changes
      // nothing. Faculty can still amend it afterwards.
      throw new HttpError(422, 'You are already marked for this session.');
    }

    // The same arrival stamp the code was judged against, so a learner is never
    // marked late by the latency of their own check-in.
    const late = this.#isLate(session, at);
    const { data, error } = await this.#db.from('onyx_attendance_records').insert({
      tenant_id: tenantId, session_id: sessionId, user_id: userId,
      status: late ? 'late' : 'present',
      method: 'qr',
      // marked_by is the learner themselves. Recording that is the difference
      // between a record and an assertion.
      marked_by: userId,
      marked_at: new Date(at).toISOString(),
    }).select(RECORD_COLUMNS).maybeSingle();
    if (error?.code === '23505') throw new HttpError(422, 'You are already marked for this session.');
    if (error) throw new HttpError(500, 'Could not record your attendance: ' + error.message);
    return data!;
  }

  // ---- LRN-03c: analytics ----

  /**
   * Attendance percentages.
   *
   * The definition, stated once so it cannot drift: **present and late count as
   * attended; excused sessions are removed from the denominator rather than
   * counted against anyone; a session with no record at all counts as absent.**
   *
   * That last clause matters. Treating an unmarked session as "no data" makes
   * every percentage flattering, and a shortfall report that never flags anyone
   * is worse than none.
   */
  async courseAnalytics(tenantId: number, courseId: number, threshold = 75) {
    const [sessions, roster] = await Promise.all([
      this.sessions(tenantId, courseId),
      this.#academics.roster(tenantId, courseId),
    ]);
    if (!sessions.length) {
      return { sessions: 0, threshold, learners: [], cohort: { held: 0, percent: 0, below: 0 } };
    }

    const ids = sessions.map((s) => Number(s.id));
    const { data } = await this.#db.from('onyx_attendance_records')
      .select(RECORD_COLUMNS).eq('tenant_id', tenantId).in('session_id', ids);
    const records = data ?? [];

    const learners = roster.map((e) => {
      const userId = String(e.user_id);
      const mine = records.filter((r) => String(r.user_id) === userId);
      const excused = mine.filter((r) => r.status === 'excused').length;
      const attended = mine.filter((r) => ATTENDED.includes(r.status as AttendanceStatus)).length;
      const counted = sessions.length - excused;
      const percent = counted > 0 ? Math.round((attended / counted) * 1000) / 10 : 100;
      return {
        user_id: userId,
        held: sessions.length,
        attended,
        excused,
        // Everything not attended and not excused, including sessions where
        // nobody marked them at all.
        absent: counted - attended,
        percent,
        below_threshold: percent < threshold,
      };
    });

    const below = learners.filter((l) => l.below_threshold).length;
    const cohortPercent = learners.length
      ? Math.round((learners.reduce((sum, l) => sum + l.percent, 0) / learners.length) * 10) / 10
      : 0;

    return {
      sessions: sessions.length,
      threshold,
      learners,
      cohort: { held: sessions.length, percent: cohortPercent, below },
    };
  }

  /**
   * The cohort half of `courseAnalytics()` -- `{ sessions, cohort }` only,
   * no per-learner breakdown -- for several courses in one round trip.
   *
   * A dashboard scanning a dozen taught courses for "who has fallen below
   * the threshold" only reads `cohort.below`; it never needed the
   * per-learner rows `courseAnalytics()` builds, and calling it once per
   * course was two queries (sessions, then records) times every course.
   * This reads sessions and records for the whole set in two queries total,
   * then computes the same percentages `courseAnalytics()` does, per
   * course, in memory. Keyed by course id -- a plain object, since this
   * crosses into a JSON response.
   */
  async cohortBulk(tenantId: number, courseIds: number[], threshold = 75) {
    const results: Record<number, {
      sessions: number; threshold: number;
      cohort: { held: number; percent: number; below: number };
    }> = {};
    if (!courseIds.length) return results;

    type SessionRow = Awaited<ReturnType<AttendanceService['sessionsBulk']>>[number];
    type RosterRow = Awaited<ReturnType<AcademicsService['rosterBulk']>>[number];
    type RecordRow = { session_id: number | string; user_id: number | string; status: string };

    const [sessions, roster] = await Promise.all([
      this.sessionsBulk(tenantId, courseIds),
      this.#academics.rosterBulk(tenantId, courseIds),
    ]);
    const sessionsByCourse = new Map<number, SessionRow[]>();
    for (const s of sessions) {
      const c = Number(s.course_id);
      const list = sessionsByCourse.get(c) ?? [];
      list.push(s);
      sessionsByCourse.set(c, list);
    }
    const rosterByCourse = new Map<number, RosterRow[]>();
    for (const e of roster) {
      const c = Number(e.course_id);
      const list = rosterByCourse.get(c) ?? [];
      list.push(e);
      rosterByCourse.set(c, list);
    }

    const sessionIds = sessions.map((s) => Number(s.id));
    const { data: recordData } = sessionIds.length
      ? await this.#db.from('onyx_attendance_records')
        .select(RECORD_COLUMNS).eq('tenant_id', tenantId).in('session_id', sessionIds)
      : { data: [] as RecordRow[] };
    const records: RecordRow[] = recordData ?? [];
    const recordsBySession = new Map<number, RecordRow[]>();
    for (const r of records) {
      const s = Number(r.session_id);
      const list = recordsBySession.get(s) ?? [];
      list.push(r);
      recordsBySession.set(s, list);
    }

    for (const courseId of courseIds) {
      const courseSessions = sessionsByCourse.get(courseId) ?? [];
      const courseRoster = rosterByCourse.get(courseId) ?? [];
      if (!courseSessions.length) {
        results[courseId] = { sessions: 0, threshold, cohort: { held: 0, percent: 0, below: 0 } };
        continue;
      }
      const held = courseSessions.length;
      // Every record from this course's sessions, grouped by learner once,
      // rather than re-filtered out of the full record set per learner.
      const byUser = new Map<string, RecordRow[]>();
      for (const s of courseSessions) {
        for (const r of recordsBySession.get(Number(s.id)) ?? []) {
          const u = String(r.user_id);
          const list = byUser.get(u) ?? [];
          list.push(r);
          byUser.set(u, list);
        }
      }
      const percents = courseRoster.map((e) => {
        const mine = byUser.get(String(e.user_id)) ?? [];
        const excused = mine.filter((r) => r.status === 'excused').length;
        const attended = mine.filter((r) => ATTENDED.includes(r.status as AttendanceStatus)).length;
        const counted = held - excused;
        return counted > 0 ? Math.round((attended / counted) * 1000) / 10 : 100;
      });

      const below = percents.filter((p) => p < threshold).length;
      const cohortPercent = percents.length
        ? Math.round((percents.reduce((sum, p) => sum + p, 0) / percents.length) * 10) / 10
        : 0;
      results[courseId] = { sessions: held, threshold, cohort: { held, percent: cohortPercent, below } };
    }
    return results;
  }

  /**
   * One learner's own figure, across every course they are enrolled in --
   * alongside where their cohort stands, per LRN-03's "per-learner and
   * per-cohort attendance analytics." `courseAnalytics()` always computed
   * the cohort average; this just stopped throwing it away before it reached
   * the one person asking "is this normal for my class, or just me." Only
   * the average and a headcount travel across, never another learner's own
   * figure -- nothing here is more exposed than a class average already is.
   */
  async learnerSummary(tenantId: number, userId: string, threshold = 75) {
    const enrollments = await this.#academics.enrollmentsFor(tenantId, userId);
    const out = [];
    for (const e of enrollments) {
      const analytics = await this.courseAnalytics(tenantId, Number(e.course_id), threshold);
      const mine = analytics.learners.find((l) => l.user_id === userId);
      if (mine) {
        out.push({
          course_id: Number(e.course_id), ...mine,
          cohort_percent: analytics.cohort.percent,
          cohort_size: analytics.learners.length,
        });
      }
    }
    return out;
  }

  /** LRN-03c export: one row per learner per session, flat enough for a sheet. */
  async exportRows(tenantId: number, courseId: number) {
    const [sessions, roster] = await Promise.all([
      this.sessions(tenantId, courseId),
      this.#academics.roster(tenantId, courseId),
    ]);
    if (!sessions.length || !roster.length) return [];

    const { data } = await this.#db.from('onyx_attendance_records')
      .select(RECORD_COLUMNS).eq('tenant_id', tenantId)
      .in('session_id', sessions.map((s) => Number(s.id)));
    const byKey = new Map((data ?? []).map((r) => [r.session_id + ':' + r.user_id, r]));

    return roster.flatMap((e) => sessions.map((s) => {
      const record = byKey.get(s.id + ':' + e.user_id);
      return {
        session_id: Number(s.id),
        session: s.title,
        scheduled_at: s.scheduled_at,
        user_id: String(e.user_id),
        // An unmarked session is an absence, consistently with the percentages.
        status: record?.status ?? 'absent',
        method: record?.method ?? null,
      };
    }));
  }

  /**
   * The same export as a CSV file.
   *
   * LRN-03c asks for an export, and a registrar's export is a file they open in
   * a spreadsheet, not a JSON array. The names come from the caller rather than
   * a join here: this service knows nothing about who a user is, and the one
   * place that does already loads the roster for other reasons.
   */
  async exportCsv(tenantId: number, courseId: number, opts: {
    names?: Map<string, { name: string; email: string }>;
  } = {}): Promise<string> {
    const rows = await this.exportRows(tenantId, courseId);
    const header = ['session_id', 'session', 'scheduled_at', 'user_id', 'name', 'email', 'status', 'method'];
    return csvDocument(header, rows.map((r) => {
      const who = opts.names?.get(r.user_id);
      return [
        r.session_id, r.session, r.scheduled_at, r.user_id,
        who?.name ?? '', who?.email ?? '', r.status, r.method ?? '',
      ];
    }));
  }

  // ---- internals ----

  /**
   * The secret is read on its own and never returned by any other method, so a
   * response cannot leak it by accident.
   */
  async #secret(tenantId: number, sessionId: number): Promise<string> {
    const { data } = await this.#db.from('onyx_attendance_sessions')
      .select('qr_secret').eq('tenant_id', tenantId).eq('id', sessionId).maybeSingle();
    if (!data?.qr_secret) throw new HttpError(422, 'This session has no check-in code.');
    return data.qr_secret;
  }

  #code(secret: string, sessionId: number, counter: number): string {
    return createHmac('sha256', secret)
      .update(sessionId + ':' + counter)
      .digest('hex')
      .slice(0, 8)
      .toUpperCase();
  }

  /** Late once the session is more than a quarter of the way through. */
  #isLate(session: { scheduled_at: string; duration_minutes: number }, now: number): boolean {
    const start = Date.parse(session.scheduled_at);
    if (Number.isNaN(start)) return false;
    const grace = (Number(session.duration_minutes) || 60) * 60_000 * 0.25;
    return now > start + grace;
  }
}

/** Compares without leaking where the difference is. */
function constantTimeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  if (x.length !== y.length) return false;
  return timingSafeEqual(x, y);
}
