/**
 * ASS-02 -- remote proctoring.
 *
 * "Camera and screen monitoring with tab-switch detection and reviewable
 * integrity flags for each attempt."
 *
 * What this stores, and what it deliberately does not:
 *
 *   * It stores **events** -- a tab lost focus at 14:03:22, a paste happened,
 *     the camera stopped. Each is timestamped by the server and reviewable.
 *   * It does **not** store a continuous recording of a learner's room. The
 *     proposal asks for monitoring and reviewable flags, not a video archive,
 *     and keeping hours of footage of somebody's home is a decision with
 *     consequences nobody asked for. Where a still genuinely helps a human
 *     decide, one can be attached to a single event.
 *   * Consent is per attempt and recorded before the paper is dealt. Monitoring
 *     somebody who has not been asked is not proctoring.
 *
 * A flag is evidence, not a verdict. Nothing here fails anybody: it raises
 * events for an invigilator, and an invigilator decides. The alternative --
 * auto-voiding an attempt because a laptop lid closed -- is how proctoring gets
 * a deserved bad name.
 */
import type { OnyxDb } from './db.ts';
import { HttpError } from '../http/errors.ts';
import { increment } from './metrics.ts';
import type { AuditService } from './audit.service.ts';

const EVENT_COLUMNS = 'id, tenant_id, attempt_id, kind, weight, detail, media_path, at, client_at, review, reviewed_by, reviewed_at, review_note';
const ATTEMPT_COLUMNS = 'id, tenant_id, assessment_id, user_id, attempt, status, started_at, expires_at, submitted_at, integrity_flags, integrity_status, consented_at';

/**
 * What each kind of event is worth.
 *
 * Zero means "recorded, not suspicious". The weights are deliberately modest:
 * one tab switch is a notification popping up, five in ten minutes is a
 * pattern, and the difference between those is what an invigilator is for.
 */
export const EVENT_WEIGHTS: Record<string, number> = {
  consent: 0,
  camera_on: 0,
  camera_off: 2,
  screen_on: 0,
  screen_off: 2,
  tab_focus: 0,
  tab_blur: 1,
  paste: 2,
  copy: 1,
  fullscreen_exit: 1,
  no_face: 1,
  multiple_faces: 3,
  snapshot: 0,
};

export const EVENT_KINDS = Object.keys(EVENT_WEIGHTS);

/** Above this, an attempt goes to the review queue. */
export const REVIEW_THRESHOLD = 5;

/** The part of NotifyService this needs. Narrow, so a test can pass a fake. */
export interface ProctorNotifier {
  notify(tenantId: number, input: {
    userId: string; kind: 'assessment.integrity_review';
    title: string; body?: string | null; link?: string | null;
  }): Promise<unknown>;
}

export class ProctorService {
  #db: OnyxDb;
  #audit: AuditService;
  #notify: ProctorNotifier | null;
  #now: () => number;

  /**
   * `notify` goes LAST, after `now`, and deliberately so.
   *
   * It was briefly inserted third, ahead of `now`. Nothing failed to compile --
   * both are optional -- but every existing caller passing a clock as the third
   * argument silently handed it over as the notifier, and `now` quietly fell
   * back to the real Date.now. The unit tests' fake clock stopped working and an
   * event recorded 90 seconds in reported an offset of zero. New optional
   * parameters belong at the end.
   */
  constructor(db: OnyxDb, audit: AuditService, now: () => number = Date.now,
    notify: ProctorNotifier | null = null) {
    this.#db = db;
    this.#audit = audit;
    this.#now = now;
    this.#notify = notify;
  }

  /**
   * Records one event from a candidate's own session.
   *
   * The attempt comes from the caller's token, never from the body, so nobody
   * can post events onto somebody else's paper. `client_at` is kept beside the
   * server's time rather than instead of it: a divergence between the two is
   * itself worth seeing.
   */
  async record(tenantId: number, attemptId: number, userId: string, input: {
    kind: string; detail?: unknown; client_at?: string | null; media_path?: string | null;
  }) {
    const attempt = await this.#attempt(tenantId, attemptId);
    if (String(attempt.user_id) !== userId) throw new HttpError(403, 'That is not your attempt.');
    if (!EVENT_KINDS.includes(input.kind)) throw new HttpError(422, 'That is not an event kind.');
    // Events after the paper is in are noise, and accepting them would let a
    // candidate pad their own log.
    if (attempt.status !== 'in_progress') throw new HttpError(422, 'That attempt is finished.');

    const weight = EVENT_WEIGHTS[input.kind] ?? 0;
    const { data, error } = await this.#db.from('onyx_proctor_events').insert({
      tenant_id: tenantId,
      attempt_id: attemptId,
      kind: input.kind,
      weight,
      detail: (input.detail ?? null) as never,
      media_path: input.media_path ?? null,
      at: new Date(this.#now()).toISOString(),
      client_at: input.client_at ?? null,
      review: weight > 0 ? 'open' : 'dismissed',
    }).select(EVENT_COLUMNS).maybeSingle();
    if (error) throw new HttpError(500, 'Could not record that: ' + error.message);

    if (weight > 0) await this.#rescore(tenantId, attemptId);
    increment('onyx_proctor_events_total', { kind: input.kind });
    return { id: data!.id, kind: data!.kind, at: data!.at };
  }

  /** ASS-02b -- the per-attempt integrity timeline. */
  async timeline(tenantId: number, attemptId: number) {
    const attempt = await this.#attempt(tenantId, attemptId);
    const { data } = await this.#db.from('onyx_proctor_events')
      .select(EVENT_COLUMNS).eq('tenant_id', tenantId).eq('attempt_id', attemptId).order('at');
    const events = data ?? [];

    return {
      attempt_id: attemptId,
      user_id: attempt.user_id,
      consented_at: attempt.consented_at,
      started_at: attempt.started_at,
      submitted_at: attempt.submitted_at,
      integrity_flags: attempt.integrity_flags,
      integrity_status: attempt.integrity_status,
      // Every monitored event, with the server's timestamp -- ASS-02a's
      // acceptance criterion is that each one is reviewable.
      events: events.map((e) => ({
        ...e,
        // How far into the attempt it happened, which is what an invigilator
        // actually reads.
        offset_seconds: Math.max(0,
          Math.round((Date.parse(e.at) - Date.parse(attempt.started_at)) / 1000)),
        // A client clock well out of step with the server's is itself a signal.
        clock_skew_seconds: e.client_at
          ? Math.round((Date.parse(e.client_at) - Date.parse(e.at)) / 1000)
          : null,
      })),
    };
  }

  /**
   * ASS-02b -- everything an invigilator has to look at, worst first.
   *
   * Includes every attempt that is STILL RUNNING, not only the ones that have
   * already tripped something. The filter used to be `integrity_flags > 0`,
   * which meant a candidate sitting cleanly was invisible: the one screen whose
   * job is to show who is sitting right now showed nobody until they
   * misbehaved, so "watch the room" was the one thing it could not do. A clean
   * sitting is exactly what an invigilator wants to confirm.
   *
   * Each row carries the live device state, derived from the last camera/screen
   * event, so the answer to "is their camera actually on?" is on the list
   * rather than one click away per candidate.
   */
  /**
   * `assessmentIds`, plural, so a faculty member's own view of this queue
   * can be narrowed to their own courses -- this used to take one optional
   * id and nothing ever passed it, so every faculty account reached
   * `/proctor/queue` and saw every flagged or running attempt at the
   * institution, on courses they had nothing to do with. An empty array
   * (as opposed to undefined) means "narrowed to nothing", not "no filter".
   */
  async reviewQueue(tenantId: number, assessmentIds?: number[]) {
    let q = this.#db.from('onyx_assessment_attempts')
      .select(ATTEMPT_COLUMNS).eq('tenant_id', tenantId)
      .or('integrity_flags.gt.0,status.eq.in_progress');
    if (assessmentIds) {
      if (!assessmentIds.length) return [];
      q = q.in('assessment_id', assessmentIds);
    }
    const { data } = await q.order('integrity_flags', { ascending: false });
    const attempts = data ?? [];
    if (!attempts.length) return [];

    // What each attempt's paper actually demands. Without this, "no camera
    // event" is indistinguishable from "this paper never wanted a camera", and
    // an invigilator reading "not required" about a paper that requires one is
    // worse informed than if the column were blank.
    const { data: papers } = await this.#db.from('onyx_assessments')
      .select('id, require_camera, require_screen, proctoring')
      .eq('tenant_id', tenantId)
      .in('id', [...new Set(attempts.map((a) => Number(a.assessment_id)))]);
    const needs = new Map((papers ?? []).map((p) => [Number(p.id), {
      camera: Boolean(p.proctoring) && Boolean(p.require_camera),
      screen: Boolean(p.proctoring) && Boolean(p.require_screen),
    }]));

    const { data: events } = await this.#db.from('onyx_proctor_events')
      .select(EVENT_COLUMNS).eq('tenant_id', tenantId)
      .in('attempt_id', attempts.map((a) => Number(a.id)))
      .order('at', { ascending: true });

    const open = new Map<number, number>();
    const camera = new Map<number, boolean>();
    const screen = new Map<number, boolean>();
    const away = new Map<number, number>();
    for (const e of events ?? []) {
      const id = Number(e.attempt_id);
      if (e.review === 'open') open.set(id, (open.get(id) ?? 0) + 1);
      // Ascending order, so the last write for each attempt wins and the map
      // ends up holding the most recent state.
      if (e.kind === 'camera_on') camera.set(id, true);
      if (e.kind === 'camera_off') camera.set(id, false);
      if (e.kind === 'screen_on') screen.set(id, true);
      if (e.kind === 'screen_off') screen.set(id, false);
      if (e.kind === 'tab_blur') away.set(id, (away.get(id) ?? 0) + 1);
    }

    return attempts.map((a) => {
      const need = needs.get(Number(a.assessment_id)) ?? { camera: false, screen: false };
      return {
        attempt_id: Number(a.id),
        assessment_id: Number(a.assessment_id),
        user_id: Number(a.user_id),
        status: a.status,
        integrity_flags: a.integrity_flags,
        integrity_status: a.integrity_status,
        open_events: open.get(Number(a.id)) ?? 0,
        requires_camera: need.camera,
        requires_screen: need.screen,
        // null means "never reported either way". Paired with requires_*, that
        // reads as "required and silent" -- a paper being sat with no camera
        // event at all -- rather than being mistaken for "not required".
        camera_on: camera.get(Number(a.id)) ?? null,
        screen_on: screen.get(Number(a.id)) ?? null,
        tab_switches: away.get(Number(a.id)) ?? 0,
        started_at: a.started_at,
      };
    });
  }

  /**
   * An invigilator's decision on one event.
   *
   * Audited, because ASS-02b's acceptance criterion is that the decision is --
   * and because "who cleared this" is the first question asked when a result is
   * challenged.
   */
  async review(tenantId: number, eventId: number, claims: { tenant_id: number; user_id: string }, input: {
    decision: 'dismissed' | 'upheld'; note?: string | null;
  }) {
    if (!['dismissed', 'upheld'].includes(input.decision)) {
      throw new HttpError(422, 'A flag is either dismissed or upheld.');
    }
    const { data: event } = await this.#db.from('onyx_proctor_events')
      .select(EVENT_COLUMNS).eq('tenant_id', tenantId).eq('id', eventId).maybeSingle();
    if (!event) throw new HttpError(404, 'Event not found.');

    const at = new Date(this.#now()).toISOString();
    await this.#db.from('onyx_proctor_events').update({
      review: input.decision, reviewed_by: claims.user_id,
      reviewed_at: at, review_note: input.note ?? null,
    }).eq('id', eventId);

    await this.#rescore(tenantId, Number(event.attempt_id));
    await this.#audit.record(claims, {
      action: 'assessment.flag_reviewed',
      entityType: 'proctor_event', entityId: eventId,
      before: { review: event.review },
      after: { review: input.decision, attempt_id: event.attempt_id, note: input.note ?? null },
    });
    return { id: eventId, review: input.decision, reviewed_at: at };
  }

  /** Closes off an attempt's integrity case one way or the other. */
  async settle(tenantId: number, attemptId: number, claims: { tenant_id: number; user_id: string }, input: {
    decision: 'cleared' | 'upheld'; note?: string | null;
  }) {
    if (!['cleared', 'upheld'].includes(input.decision)) {
      throw new HttpError(422, 'An attempt is either cleared or upheld.');
    }
    const attempt = await this.#attempt(tenantId, attemptId);
    await this.#db.from('onyx_assessment_attempts')
      .update({ integrity_status: input.decision, updated_at: new Date(this.#now()).toISOString() })
      .eq('id', attemptId);

    await this.#audit.record(claims, {
      action: 'assessment.flag_reviewed',
      entityType: 'assessment_attempt', entityId: attemptId,
      before: { integrity_status: attempt.integrity_status },
      after: { integrity_status: input.decision, note: input.note ?? null },
    });
    return { attempt_id: attemptId, integrity_status: input.decision };
  }

  /**
   * Recomputes an attempt's flag score from its open events.
   *
   * Dismissed events stop counting, which is the point of dismissing them. The
   * score is never a verdict -- `integrity_status` only moves to `review`, and
   * a human moves it from there.
   */
  async #rescore(tenantId: number, attemptId: number) {
    const { data } = await this.#db.from('onyx_proctor_events')
      .select(EVENT_COLUMNS).eq('tenant_id', tenantId).eq('attempt_id', attemptId);
    const score = (data ?? [])
      .filter((e) => e.review !== 'dismissed')
      .reduce((t, e) => t + Number(e.weight), 0);

    const attempt = await this.#attempt(tenantId, attemptId);
    // A decision already taken by a person is not overwritten by arithmetic.
    const settled = ['cleared', 'upheld'].includes(String(attempt.integrity_status));
    const status = settled
      ? attempt.integrity_status
      : (score >= REVIEW_THRESHOLD ? 'review' : (score > 0 ? 'flagged' : 'clean'));

    await this.#db.from('onyx_assessment_attempts')
      .update({ integrity_flags: score, integrity_status: status }).eq('id', attemptId);

    // Crossing the threshold is the moment worth telling somebody about.
    //
    // Nothing was ever pushed before: every flag was visible on the
    // invigilation console and nowhere else, so "reported to faculty" meant
    // "faculty could go and look", and a paper being sat right now could reach
    // the review threshold with nobody aware of it.
    //
    // Sent on the TRANSITION only, and only while the paper is still running:
    // one message when a pattern emerges, not one per tab switch, because an
    // alert that arrives five times an hour is an alert nobody reads. Below the
    // threshold the console remains the record -- a single tab switch is a
    // notification popping up, and interrupting an invigilator for it would
    // teach them to ignore the channel.
    if (status === 'review' && attempt.integrity_status !== 'review'
      && attempt.status === 'in_progress') {
      await this.#alertInvigilators(tenantId, attempt, score);
    }
  }

  /**
   * Tells the people who invigilate that an attempt needs a look.
   *
   * Staff are found by membership role rather than by course, because an exams
   * officer invigilating a hall is often not the person who teaches the paper.
   * Failure here is swallowed: a notification that cannot be delivered must not
   * roll back the flag that earned it.
   */
  async #alertInvigilators(tenantId: number, attempt: Record<string, unknown>, score: number) {
    if (!this.#notify) return;
    try {
      const { data: staff } = await this.#db.from('onyx_memberships')
        .select('user_id, role').eq('tenant_id', tenantId)
        .in('role', ['admin', 'faculty', 'exams']);
      const attemptId = Number(attempt.id);
      for (const s of staff ?? []) {
        await this.#notify.notify(tenantId, {
          userId: String(s.user_id),
          kind: 'assessment.integrity_review',
          title: 'Attempt ' + attemptId + ' has reached the review threshold',
          body: 'A paper being sat now has an integrity score of ' + score
            + '. Nothing here is a verdict -- it is a prompt to look.',
          link: '/onyx/attempts/' + attemptId + '/integrity',
        });
      }
    } catch { /* the flag is recorded; the message is best effort */ }
  }

  async #attempt(tenantId: number, id: number) {
    const { data } = await this.#db.from('onyx_assessment_attempts')
      .select(ATTEMPT_COLUMNS).eq('tenant_id', tenantId).eq('id', id).maybeSingle();
    if (!data) throw new HttpError(404, 'Attempt not found.');
    return data;
  }
}
