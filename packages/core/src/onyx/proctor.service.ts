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
import { randomUUID } from 'node:crypto';
import { HttpError } from '../http/errors.ts';
import { peopleFor } from './directory.ts';
import { increment } from './metrics.ts';
import type { AuditService } from './audit.service.ts';

const EVENT_COLUMNS = 'id, tenant_id, attempt_id, kind, weight, detail, media_path, at, client_at, review, reviewed_by, reviewed_at, review_note';
const ATTEMPT_COLUMNS = 'id, tenant_id, assessment_id, user_id, attempt, status, started_at, expires_at, submitted_at, integrity_flags, integrity_status, consented_at, breach_count, terminated_at, terminated_reason';

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

/**
 * What counts as LEAVING THE PAPER.
 *
 * One kind today, and the narrowness is the point: the rule an institution
 * asked for is about switching away from the examination, and a candidate must
 * be able to predict what will end their paper. Pasting is suspicious and
 * weighted accordingly; it is not "you left". A set rather than a constant so
 * a second kind can be added deliberately, by somebody who has thought about
 * what a candidate would be told.
 *
 * `tab_focus` is not here, obviously -- coming back is not an offence, and the
 * client already collapses a switch into ONE departure rather than the two
 * events a browser fires for it.
 */
export const BREACH_KINDS = ['tab_blur'];

/**
 * What a candidate is told, in the words they are told it in.
 *
 * Written here rather than on the screen because the count and the sentence
 * have to agree, and a message assembled in the browser from a number the
 * server sent is a message that eventually says "warning 3 of 2".
 */
export function breachWarning(count: number, limit: number): string {
  const left = limit - count;
  if (left <= 0) {
    return 'You left the examination ' + count + ' times. Your paper has been handed in.';
  }
  if (left === 1) {
    return 'You left the examination. This is your final warning — leave it once more and '
      + 'your paper will be handed in automatically.';
  }
  return 'You left the examination. This is warning ' + count + ' of ' + limit
    + '. If you leave ' + left + ' more times your paper will be handed in automatically.';
}

/**
 * How a paper is stopped, handed in rather than imported.
 *
 * Ending an attempt is AssessService's job -- it owns scoring, the paper and
 * the clock -- and importing it here would make the two services a cycle. So
 * the DECISION lives here, where the departures are counted, and the EFFECT
 * arrives as one function, wired up where both services already exist. The
 * same shape the notifier below uses, and for the same reason.
 */
export interface BreachStopper {
  terminateForBreach(tenantId: number, attemptId: number, reason?: string): Promise<unknown>;
}

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
  #stop: BreachStopper | null = null;

  /**
   * Told about the thing that ends papers, after construction.
   *
   * A setter rather than a constructor argument because AssessService is built
   * from this one's siblings and the two would otherwise have to be ordered
   * around each other. Absent means the old behaviour exactly: departures are
   * counted and recorded, and nothing is ever stopped.
   */
  useStopper(stop: BreachStopper): void { this.#stop = stop; }

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
    // `status` is only moved to 'expired' by the sweep, so between the
    // deadline and the next sweep pass -- or indefinitely, if the sweep is not
    // scheduled in this environment -- an overdue attempt is still
    // 'in_progress' and was accepting events. `saveAnswer` has always checked
    // the clock as well as the status; this had not, which is how an integrity
    // timeline came to hold events an hour past the end of a ten-minute paper.
    // Refused rather than finalised: expiring an attempt belongs to the sweep,
    // and reaching into it from here would couple monitoring to marking.
    if (this.#now() > Date.parse(String(attempt.expires_at))) {
      throw new HttpError(422, 'That attempt is finished.');
    }

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

    const breach = await this.#countBreach(tenantId, attempt, input.kind);
    return { id: data!.id, kind: data!.kind, at: data!.at, ...breach };
  }

  /**
   * Counting the departures, warning twice, and stopping on the third.
   *
   * The whole rule is here, and it is short on purpose: a candidate has to be
   * able to hold it in their head. Leave the paper and you are told so, in
   * words, on your own screen. Do it once more and you are told it is the last
   * time. Do it again and the paper is handed in.
   *
   * The count lives on the ATTEMPT rather than being re-derived from the event
   * log, because it is read on every event and because the log is not the same
   * question: an invigilator dismissing a flag should not silently give
   * somebody another life, and a rule whose count moves when somebody else
   * clicks something is not a rule anybody can be held to.
   *
   * `breach_limit` of zero is off, which is what every paper written before
   * this existed has. Nothing is stopped, and the return says so -- so a
   * client written for the rule works unchanged against a paper without it.
   */
  async #countBreach(
    tenantId: number, attempt: Record<string, unknown>, kind: string,
  ): Promise<{
    breaches: number; breach_limit: number;
    warning: string | null; terminated: boolean;
  }> {
    const attemptId = Number(attempt.id);
    const off = { breaches: Number(attempt.breach_count ?? 0), breach_limit: 0,
      warning: null, terminated: false };
    if (!BREACH_KINDS.includes(kind)) return off;

    const { data: paper } = await this.#db.from('onyx_assessments')
      .select('id, breach_limit, proctoring')
      .eq('tenant_id', tenantId).eq('id', Number(attempt.assessment_id)).maybeSingle();
    const limit = Number(paper?.breach_limit ?? 0);
    // Not monitored, or the rule switched off: recorded and nothing more,
    // which is exactly what this service did before.
    if (!paper?.proctoring || limit <= 0) return off;

    const count = Number(attempt.breach_count ?? 0) + 1;
    await this.#db.from('onyx_assessment_attempts')
      .update({ breach_count: count }).eq('id', attemptId);

    if (count < limit) {
      return {
        breaches: count, breach_limit: limit, terminated: false,
        warning: breachWarning(count, limit),
      };
    }

    /*
     * The third departure ends it -- and is written down as a decision.
     *
     * Audited rather than merely logged: this is the product ending somebody's
     * examination without a person in the loop, and the one thing that makes
     * that acceptable is that it can be looked at afterwards, by name, with
     * the count that caused it.
     */
    if (this.#stop) await this.#stop.terminateForBreach(tenantId, attemptId, 'breach');
    await this.#audit.record(
      { tenant_id: tenantId, user_id: String(attempt.user_id) },
      { action: 'attempt.terminated', entityType: 'attempt', entityId: attemptId,
        after: { reason: 'breach', breaches: count, limit } });
    await this.#alertStopped(tenantId, attempt, count);
    increment('onyx_proctor_terminations_total', { reason: 'breach' });

    return {
      breaches: count, breach_limit: limit, terminated: true,
      warning: breachWarning(count, limit),
    };
  }

  /**
   * Tells the people who invigilate that a paper has just been stopped.
   *
   * Louder than the review-threshold alert and for a different reason: that one
   * says somebody should look eventually, this one says a candidate is sitting
   * in front of a stopped paper right now, and the only way it starts again is
   * if a person decides so. The link goes to the attempt, where that decision
   * is taken.
   */
  async #alertStopped(tenantId: number, attempt: Record<string, unknown>, count: number) {
    if (!this.#notify) return;
    try {
    const { data: staff } = await this.#db.from('onyx_memberships')
      .select('user_id, role').eq('tenant_id', tenantId)
      .in('role', ['admin', 'faculty', 'exams']);
    const who = await peopleFor(this.#db, tenantId, [String(attempt.user_id)]);
    const person = who.get(String(attempt.user_id));
    const named = person?.roll_number
      ? person.roll_number + ' · ' + person.name
      : person?.name ?? 'A candidate';
    for (const member of staff ?? []) {
      await this.#notify.notify(tenantId, {
        userId: String(member.user_id),
        kind: 'assessment.integrity_review',
        title: named + '’s paper was stopped',
        body: 'They left the examination ' + count + ' times, so it was handed in '
          + 'automatically. If that was not what it looked like, you can let them carry '
          + 'on from where they were.',
        link: '/onyx/attempts/' + Number(attempt.id) + '/integrity',
      });
    }
    // Best effort, like the review alert: a message that cannot be delivered
    // must not roll back the decision that earned it.
    } catch { /* the paper is stopped and recorded; the message is best effort */ }
  }

  /** ASS-02b -- the per-attempt integrity timeline. */
  async timeline(tenantId: number, attemptId: number) {
    const attempt = await this.#attempt(tenantId, attemptId);
    const { data } = await this.#db.from('onyx_proctor_events')
      .select(EVENT_COLUMNS).eq('tenant_id', tenantId).eq('attempt_id', attemptId).order('at');
    const events = data ?? [];

    return {
      attempt_id: attemptId,
      user_id: String(attempt.user_id),
      consented_at: attempt.consented_at,
      started_at: attempt.started_at,
      // When the paper was due. Without it a reviewer cannot tell a long
      // attempt from a long *finalisation*: `submitted_at` is stamped when
      // the attempt is closed out, so an attempt nobody swept promptly shows
      // an elapsed time bearing no relation to what the paper allowed.
      expires_at: attempt.expires_at,
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
    /*
     * Three things belong on this queue, and the third is new.
     *
     * Anything flagged, anything being sat right now -- and anything the rule
     * has STOPPED. A stopped paper is not in progress and may carry no flags
     * worth the name, so on the old filter it fell off the console entirely:
     * the product would end somebody's examination and the person who could
     * undo that would never see it. That is the one row on this screen with a
     * candidate sitting in front of it waiting for an answer.
     */
    let q = this.#db.from('onyx_assessment_attempts')
      .select(ATTEMPT_COLUMNS).eq('tenant_id', tenantId)
      .or('integrity_flags.gt.0,status.eq.in_progress,terminated_at.not.is.null');
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
      .select('id, require_camera, require_screen, proctoring, watch_camera')
      .eq('tenant_id', tenantId)
      .in('id', [...new Set(attempts.map((a) => Number(a.assessment_id)))]);
    const needs = new Map((papers ?? []).map((p) => [Number(p.id), {
      camera: Boolean(p.proctoring) && Boolean(p.require_camera),
      screen: Boolean(p.proctoring) && Boolean(p.require_screen),
      // Whether the queue may offer a live view at all. Off unless the paper
      // says so, because the candidates sitting it consented to what THIS
      // paper described -- see 0033's header.
      watch: Boolean(p.proctoring) && Boolean(p.watch_camera),
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

    const people = await peopleFor(this.#db, tenantId, attempts.map((a) => a.user_id));

    return attempts.map((a) => {
      const need = needs.get(Number(a.assessment_id))
        ?? { camera: false, screen: false, watch: false };
      return {
        attempt_id: Number(a.id),
        assessment_id: Number(a.assessment_id),
        // String, not Number. `user_id` became a Supabase Auth uuid in
        // 0014_auth_uuid_cutover, and `Number(uuid)` is NaN, which
        // `JSON.stringify` writes as `null` -- so every row of the
        // invigilation queue arrived carrying no identity at all, and the
        // screen resolved all of them to "Candidate #null". Not only the
        // flagged ones: every row.
        user_id: String(a.user_id),
        // Resolved here rather than left to the page to look up: an
        // invigilator walking a hall is matching what is on screen against a
        // hall ticket, and the number is what is on the ticket.
        name: people.get(String(a.user_id))?.name ?? null,
        roll_number: people.get(String(a.user_id))?.roll_number ?? null,
        status: a.status,
        integrity_flags: a.integrity_flags,
        integrity_status: a.integrity_status,
        open_events: open.get(Number(a.id)) ?? 0,
        requires_camera: need.camera,
        requires_screen: need.screen,
        watch_camera: need.watch,
        // null means "never reported either way". Paired with requires_*, that
        // reads as "required and silent" -- a paper being sat with no camera
        // event at all -- rather than being mistaken for "not required".
        camera_on: camera.get(Number(a.id)) ?? null,
        screen_on: screen.get(Number(a.id)) ?? null,
        tab_switches: away.get(Number(a.id)) ?? 0,
        /*
         * Stopped, and how close to it everybody else is.
         *
         * `breaches` is the count the RULE goes on -- reset when somebody is
         * reinstated -- which is deliberately not the same number as
         * `tab_switches`, the total ever recorded. An invigilator needs both:
         * one says how many lives are left, the other says what this candidate
         * has actually been doing all morning.
         */
        breaches: Number(a.breach_count ?? 0),
        terminated_at: a.terminated_at ?? null,
        terminated_reason: a.terminated_reason ?? null,
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

  // -------------------------------------------------------------------------
  // ASS-02b -- an invigilator watching a candidate's camera, live
  //
  // The video never comes near this service. What is here is the handful of
  // messages two browsers need in order to find each other -- an SDP offer, an
  // answer, some ICE candidates -- and they are deleted as soon as the other
  // side has read them. Migration 0033's header sets out why this goes through
  // the API rather than a Realtime channel, and what the arrangement cannot do.
  // -------------------------------------------------------------------------

  /**
   * How long a negotiation may take before its messages are stale.
   *
   * Generous for an exchange that normally completes in under two seconds, and
   * short enough that a candidate who closed their laptop mid-offer does not
   * leave an invigilator watching a spinner. Also the sweep window: anything
   * older than this is somebody's abandoned attempt at connecting.
   */
  static readonly SIGNAL_TTL_MS = 90_000;

  /**
   * An invigilator asks to watch. Returns the session both sides will use.
   *
   * A session id per watch rather than per attempt: two invigilators opening
   * the same candidate are two independent negotiations, and one reading the
   * other's answer would leave both with a half-built connection.
   *
   * Refused unless the paper actually says it may be watched. `watch_camera`
   * is off by default and the consent a candidate gave is the consent shown
   * for THIS paper -- an invigilator cannot decide at run time to watch
   * somebody who agreed to something narrower.
   */
  async startWatch(tenantId: number, attemptId: number, watcher: { userId: string }) {
    const attempt = await this.#attempt(tenantId, attemptId);
    const assessment = await this.#assessment(tenantId, Number(attempt.assessment_id));

    if (!assessment.watch_camera) {
      throw new HttpError(422,
        'This paper is not set up for live invigilation. Its candidates agreed to '
        + 'monitoring that does not include being watched.');
    }
    if (String(attempt.status) !== 'in_progress') {
      throw new HttpError(422, 'That attempt has finished. There is nothing live to watch.');
    }
    if (!attempt.consented_at) {
      throw new HttpError(422, 'That candidate has not consented to monitoring.');
    }

    await this.#sweep();
    const sessionId = randomUUID();
    // Recorded, because watching somebody is an act somebody should be able to
    // account for afterwards. The candidate is told on their own screen too.
    await this.#audit.record(
      { tenant_id: tenantId, user_id: watcher.userId },
      { action: 'proctor.watched', entityType: 'attempt', entityId: attemptId,
        after: { session_id: sessionId } });
    return { session_id: sessionId, ttl_ms: ProctorService.SIGNAL_TTL_MS };
  }

  /**
   * Is anybody watching this attempt right now, and under which session?
   *
   * The candidate's own screen asks this. It is what turns the camera on --
   * nothing streams until somebody is actually looking -- and what puts a
   * visible indicator in front of the person being watched. A live feed of
   * somebody's room with no sign on their own screen is not something this
   * product is going to do.
   */
  async watchState(tenantId: number, attemptId: number) {
    await this.#sweep();
    const since = new Date(this.#now() - ProctorService.SIGNAL_TTL_MS).toISOString();
    const { data } = await this.#db.from('onyx_proctor_signals')
      .select('session_id, created_at')
      .eq('tenant_id', tenantId).eq('attempt_id', attemptId)
      .eq('sender', 'watcher').eq('kind', 'offer')
      .gte('created_at', since)
      .order('id', { ascending: false }).limit(1).maybeSingle();
    return { watched: Boolean(data), session_id: data ? String(data.session_id) : null };
  }

  /**
   * One message from one side of the negotiation.
   *
   * The payload is opaque here on purpose: it is SDP or an ICE candidate, both
   * of which are the browsers' business rather than this service's. What is
   * checked is who may put it there, which the routes do, and that it is
   * bounded -- an unbounded jsonb column reachable by a candidate is a place to
   * put a megabyte.
   */
  async postSignal(tenantId: number, attemptId: number, input: {
    sessionId: string; sender: 'watcher' | 'candidate';
    kind: 'offer' | 'answer' | 'ice' | 'bye'; payload: unknown;
  }) {
    const size = JSON.stringify(input.payload ?? null).length;
    if (size > 16_000) throw new HttpError(422, 'That signalling message is too large.');

    const { error } = await this.#db.from('onyx_proctor_signals').insert({
      tenant_id: tenantId,
      attempt_id: attemptId,
      session_id: input.sessionId,
      sender: input.sender,
      kind: input.kind,
      payload: (input.payload ?? {}) as never,
      // Stamped from THIS service's clock rather than left to the column
      // default. watchState and the sweep both compare created_at against
      // , and a row timestamped by the database is being measured
      // against a different clock -- which is invisible in production and
      // makes the staleness rules untestable.
      created_at: new Date(this.#now()).toISOString(),
    });
    if (error) throw new HttpError(500, 'Could not pass that on: ' + error.message);
    return { ok: true };
  }

  /**
   * Everything the OTHER side has sent on this session since `after`.
   *
   * Each side reads only what the other wrote, which is what stops a poll
   * seeing its own offer and answering itself. Ordering is by id rather than
   * timestamp: two ICE candidates written in the same millisecond still have
   * an order, and applying them out of order is how a connection fails
   * intermittently on a fast network.
   */
  async pollSignals(tenantId: number, attemptId: number, input: {
    sessionId: string; sender: 'watcher' | 'candidate'; after?: number;
  }) {
    const from = input.sender === 'watcher' ? 'candidate' : 'watcher';
    const { data } = await this.#db.from('onyx_proctor_signals')
      .select('id, sender, kind, payload, created_at')
      .eq('tenant_id', tenantId).eq('attempt_id', attemptId)
      .eq('session_id', input.sessionId).eq('sender', from)
      .gt('id', input.after ?? 0)
      .order('id', { ascending: true }).limit(50);
    return data ?? [];
  }

  /**
   * Is this person the candidate sitting the attempt?
   *
   * Which end of a negotiation somebody is has to be derived from who they
   * are, never taken from a request body -- a candidate able to name
   * themselves the watcher could read an invigilator's half of the exchange,
   * and post an offer that makes their own screen believe somebody with
   * authority is watching.
   */
  async isCandidate(tenantId: number, attemptId: number, userId: string): Promise<boolean> {
    const attempt = await this.#attempt(tenantId, attemptId);
    return String(attempt.user_id) === userId;
  }

  /** Deletes signalling nobody is going to read. Cheap, and called on the way in. */
  async #sweep() {
    const cutoff = new Date(this.#now() - ProctorService.SIGNAL_TTL_MS).toISOString();
    try {
      await this.#db.from('onyx_proctor_signals').delete().lt('created_at', cutoff);
    } catch { /* housekeeping; never the reason a watch fails to start */ }
  }

  async #assessment(tenantId: number, id: number) {
    const { data } = await this.#db.from('onyx_assessments')
      .select('id, tenant_id, course_id, title, proctoring, require_camera, watch_camera')
      .eq('tenant_id', tenantId).eq('id', id).maybeSingle();
    if (!data) throw new HttpError(404, 'Assessment not found.');
    return data;
  }

  async #attempt(tenantId: number, id: number) {
    const { data } = await this.#db.from('onyx_assessment_attempts')
      .select(ATTEMPT_COLUMNS).eq('tenant_id', tenantId).eq('id', id).maybeSingle();
    if (!data) throw new HttpError(404, 'Attempt not found.');
    return data;
  }
}
