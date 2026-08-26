/**
 * LRN-06b -- escalation to a mentor, and tickets with a visible SLA.
 *
 * "Escalation from a thread to a mentor, and a support ticket path with SLA
 * visibility for unresolved questions." The acceptance criterion is that an
 * escalated question "reaches a named owner and its age is visible", which is
 * really two requirements about failure:
 *
 *   * **A ticket with no owner is the failure this exists to prevent.** So the
 *     unowned queue is not a filter somebody has to remember to apply -- it is
 *     what the mentor view opens on, sorted by how late it already is.
 *   * **Age is measured against a promise, not a clock.** "Raised 3 days ago"
 *     means nothing without knowing what was promised. Every ticket carries the
 *     SLA it was raised under, so changing the policy tomorrow cannot re-date
 *     the backlog.
 *
 * The SLA is stored on the row for that reason, rather than read from settings
 * at display time. It is the same argument as the invoice lines in CMP-03: a
 * document that recomputes itself disagrees with the copy already issued.
 */
import type { OnyxDb } from './db.ts';
import type { Role, TicketPriority, TicketStatus, TicketEventKind } from '@onyx/types';
import { HttpError } from '../http/errors.ts';
import type { AuditService } from './audit.service.ts';

const TICKET_COLUMNS = 'id, tenant_id, discussion_id, course_id, raised_by, owner_id, subject, body, priority, status, sla_minutes, due_at, first_response_at, resolved_at, created_at, updated_at';
const EVENT_COLUMNS = 'id, tenant_id, ticket_id, actor_id, kind, note, detail, created_at';

/**
 * Who may pick a ticket up, see the queue, and close things.
 *
 * Administration, and whoever an institution has deliberately put on the rota.
 *
 * This was `['admin', 'faculty']`, which meant every lecturer saw every
 * question anybody at the institution had ever asked -- fee queries, timetable
 * complaints, account problems, the lot. Help is the SUPPORT desk: a course
 * question belongs in the course, where LRN-06a's threaded Q&A already puts
 * it in front of the lecturer who teaches it.
 *
 * A role list would only move the same problem, so the answer is the
 * capability the product already has. `support.assign` is held by admin out of
 * the box and by nobody else, and an institution that genuinely wants a
 * lecturer on the support rota grants it to them -- one decision, made once,
 * visible on the permissions screen, rather than a rule compiled in here.
 *
 * `viewer.worksQueue` is that answer, resolved by the route (which can reach
 * the permissions) and passed in. It falls back to the role for the internal
 * callers that have a role and no request behind them.
 */
/**
 * Who is asking, and whether they work the support queue.
 *
 * `worksQueue` is resolved by the route from the `support.assign` capability
 * -- only a route can reach the permissions -- and is optional so the internal
 * callers that have a role and no request behind them still compile, falling
 * back to the role.
 */
export interface QueueViewer { userId: string; role: Role; worksQueue?: boolean }

const isMentor = (viewer: { role: Role; worksQueue?: boolean }) => (
  viewer.worksQueue ?? (viewer.role === 'admin')
);

/**
 * How long each priority gets, in minutes.
 *
 * These are the defaults an institution starts with; the number is copied onto
 * the ticket at raise time, so an institution that changes them later changes
 * only what happens next.
 */
export const SLA_MINUTES: Record<TicketPriority, number> = {
  urgent: 120,        // two hours
  high: 480,          // one working day, roughly
  normal: 1440,       // a day
  low: 4320,          // three days
};

export const TICKET_PRIORITIES: TicketPriority[] = ['low', 'normal', 'high', 'urgent'];

export interface TicketView {
  id: number;
  subject: string;
  /** The question as it was asked. See #view for why the queue carries it. */
  body: string;
  status: TicketStatus;
  priority: TicketPriority;
  owner_id: string | null;
  owner_name: string | null;
  raised_by: string;
  raised_by_name: string | null;
  created_at: string;
  due_at: string;
  /** Minutes since it was raised. The "age is visible" half of the criterion. */
  age_minutes: number;
  /** Negative once it is late. Nulled out once resolved -- a closed ticket has no clock. */
  minutes_remaining: number | null;
  breached: boolean;
  first_response_at: string | null;
  resolved_at: string | null;
}

export class SupportService {
  #db: OnyxDb;
  #audit: AuditService;
  #now: () => number;

  constructor(db: OnyxDb, audit: AuditService, now: () => number = Date.now) {
    this.#db = db;
    this.#audit = audit;
    this.#now = now;
  }

  // -------------------------------------------------------------------------
  // Raising
  // -------------------------------------------------------------------------

  async raise(tenantId: number, raisedBy: string, input: {
    subject: string; body: string;
    priority?: TicketPriority; course_id?: number | null; discussion_id?: number | null;
  }) {
    const subject = input.subject.trim();
    const body = input.body.trim();
    if (subject.length < 3) throw new HttpError(422, 'A ticket needs a subject.');
    if (!body) throw new HttpError(422, 'A ticket needs a description.');

    const priority: TicketPriority = TICKET_PRIORITIES.includes(input.priority as TicketPriority)
      ? input.priority as TicketPriority
      : 'normal';
    const sla = SLA_MINUTES[priority];
    const now = this.#now();

    const { data, error } = await this.#db.from('onyx_tickets').insert({
      tenant_id: tenantId,
      discussion_id: input.discussion_id ?? null,
      course_id: input.course_id ?? null,
      raised_by: raisedBy,
      owner_id: null,
      subject,
      body,
      priority,
      status: 'open',
      sla_minutes: sla,
      due_at: new Date(now + sla * 60_000).toISOString(),
    }).select(TICKET_COLUMNS).maybeSingle();
    if (error || !data) {
      throw new HttpError(500, 'Could not raise the ticket: ' + (error?.message ?? 'no row'));
    }

    await this.#event(tenantId, Number(data.id), raisedBy, 'raised', null,
      { priority, sla_minutes: sla });
    await this.#audit.record(
      { tenant_id: tenantId, user_id: raisedBy },
      { action: 'ticket.raised', entityType: 'ticket', entityId: Number(data.id),
        after: { subject, priority } });
    return data;
  }

  /**
   * Escalate a thread nobody has answered.
   *
   * The thread keeps its replies and stays open -- escalation adds an owner,
   * it does not move the conversation somewhere the learner cannot see it.
   */
  async escalate(tenantId: number, discussionId: number, raisedBy: string, input: {
    note?: string; priority?: TicketPriority;
  } = {}) {
    const { data: thread } = await this.#db.from('onyx_discussions')
      .select('id, course_id, author_id, title, body, status')
      .eq('tenant_id', tenantId).eq('id', discussionId).maybeSingle();
    if (!thread) throw new HttpError(404, 'No such discussion.');
    if (thread.status === 'resolved') {
      throw new HttpError(409, 'That question has already been answered.');
    }

    // One open ticket per thread. Escalating twice is a person clicking again
    // because nothing happened, and answering that with a duplicate makes the
    // queue worse rather than the answer faster.
    const { data: existing } = await this.#db.from('onyx_tickets').select('id, status')
      .eq('tenant_id', tenantId).eq('discussion_id', discussionId)
      .in('status', ['open', 'assigned', 'answered']).maybeSingle();
    if (existing) {
      throw new HttpError(409, 'This question has already been escalated (ticket '
        + existing.id + ').');
    }

    return this.raise(tenantId, raisedBy, {
      subject: String(thread.title),
      body: (input.note ? input.note.trim() + '\n\n---\n\n' : '') + String(thread.body),
      priority: input.priority ?? 'high',
      course_id: Number(thread.course_id),
      discussion_id: discussionId,
    });
  }

  // -------------------------------------------------------------------------
  // The queue
  // -------------------------------------------------------------------------

  /**
   * What a mentor sees. Unowned first, then by how close each is to breaching.
   *
   * A learner asking for the same list gets only their own tickets, which is
   * why the viewer's role decides the filter rather than a query parameter.
   */
  async queue(tenantId: number, viewer: QueueViewer, filters: {
    status?: TicketStatus; mine?: boolean; unowned?: boolean;
  } = {}): Promise<TicketView[]> {
    let query = this.#db.from('onyx_tickets').select(TICKET_COLUMNS).eq('tenant_id', tenantId);

    if (!isMentor(viewer)) {
      query = query.eq('raised_by', viewer.userId);
    } else if (filters.mine) {
      query = query.eq('owner_id', viewer.userId);
    } else if (filters.unowned) {
      query = query.is('owner_id', null);
    }
    if (filters.status) query = query.eq('status', filters.status);

    const { data } = await query.order('due_at', { ascending: true }).limit(200);
    const rows = data ?? [];

    const names = await this.#names([
      ...rows.map((t) => t.owner_id ? String(t.owner_id) : null),
      ...rows.map((t) => String(t.raised_by)),
    ]);

    const views = rows.map((t) => this.#view(t, names));

    // Unowned first: the queue exists so that nothing sits without a name on
    // it, and burying those under a due-date sort defeats the point.
    return views.sort((a, b) => {
      const unowned = Number(b.owner_id === null) - Number(a.owner_id === null);
      if (unowned !== 0) return unowned;
      return Date.parse(a.due_at) - Date.parse(b.due_at);
    });
  }

  async ticket(tenantId: number, id: number, viewer: QueueViewer) {
    const row = await this.#row(tenantId, id);
    const mine = String(row.raised_by) === viewer.userId || String(row.owner_id) === viewer.userId;
    if (!mine && !isMentor(viewer)) {
      throw new HttpError(403, 'That ticket is not yours.');
    }

    const names = await this.#names([row.owner_id ? String(row.owner_id) : null, String(row.raised_by)]);
    const { data: events } = await this.#db.from('onyx_ticket_events').select(EVENT_COLUMNS)
      .eq('tenant_id', tenantId).eq('ticket_id', id).order('created_at', { ascending: true });

    return {
      ...this.#view(row, names),
      body: row.body,
      course_id: row.course_id,
      discussion_id: row.discussion_id,
      sla_minutes: row.sla_minutes,
      /*
       * The trail is between staff — EXCEPT the answer, which is the whole
       * point of the ticket.
       *
       * This stripped the note off every event for a learner, which is right
       * for the notes staff write to each other while working a problem and
       * exactly wrong for the one event whose entire purpose is to be read by
       * the person who asked. The effect was a learner watching their ticket
       * turn from "open" to "answered" and never seeing the answer: staff
       * wrote a reply into the void and the queue reported it delivered.
       *
       * So a `responded` event keeps its note for them, and everything else —
       * assignment, escalation, the running commentary — still does not. What
       * a learner may read is the reply they were sent, not the discussion
       * about them.
       */
      events: (events ?? []).map((e) => (isMentor(viewer) || e.kind === 'responded'
        ? e
        : { ...e, note: null, detail: {} })),
    };
  }

  // -------------------------------------------------------------------------
  // Working it
  // -------------------------------------------------------------------------

  async assign(tenantId: number, id: number, ownerId: string, actor: QueueViewer) {
    if (!isMentor(actor)) throw new HttpError(403, 'Only staff can assign a ticket.');
    const row = await this.#row(tenantId, id);

    // The owner has to be somebody who can act on it. Assigning to a learner
    // would satisfy "named owner" and satisfy nothing else.
    const { data: membership } = await this.#db.from('onyx_memberships').select('role')
      .eq('tenant_id', tenantId).eq('user_id', ownerId).eq('status', 1).maybeSingle();
    if (!membership) throw new HttpError(422, 'That person is not a member of this institution.');
    /*
     * The owner has to be STAFF, which is the rule the comment above is
     * actually about: assigning to a learner satisfies "named owner" and
     * nothing else.
     *
     * Not "must be able to work the queue", tempting as that reads. Whether
     * somebody holds `support.assign` is a permissions question this service
     * cannot answer -- and an institution that has just granted it to a
     * lecturer would find the grant refused here, by a rule compiled in, which
     * is the exact problem the capability was meant to solve.
     */
    const OWNERS: Role[] = ['admin', 'faculty', 'exams', 'placement'];
    if (!OWNERS.includes(membership.role as Role)) {
      throw new HttpError(422,
        'A ticket can only be owned by a member of staff, not by a learner.');
    }

    const { data } = await this.#db.from('onyx_tickets').update({
      owner_id: ownerId,
      status: row.status === 'open' ? 'assigned' : row.status,
      updated_at: new Date(this.#now()).toISOString(),
    }).eq('tenant_id', tenantId).eq('id', id).select(TICKET_COLUMNS).maybeSingle();

    await this.#event(tenantId, id, actor.userId, 'assigned', null, { owner_id: ownerId });
    await this.#audit.record(
      { tenant_id: tenantId, user_id: actor.userId },
      { action: 'ticket.assigned', entityType: 'ticket', entityId: id,
        before: { owner_id: row.owner_id }, after: { owner_id: ownerId } });
    return data;
  }

  /** Picking one up yourself, which is what actually happens. */
  async claim(tenantId: number, id: number, actor: QueueViewer) {
    return this.assign(tenantId, id, actor.userId, actor);
  }

  async respond(tenantId: number, id: number, actor: QueueViewer,
    note: string) {
    const row = await this.#row(tenantId, id);
    const body = note.trim();
    if (!body) throw new HttpError(422, 'A response needs some text.');

    const mine = String(row.raised_by) === actor.userId || String(row.owner_id) === actor.userId;
    if (!mine && !isMentor(actor)) throw new HttpError(403, 'That ticket is not yours.');

    const at = new Date(this.#now()).toISOString();
    const staffReplying = isMentor(actor);

    const patch: Record<string, unknown> = { updated_at: at };
    // First response is the metric an SLA is usually about, and it is only the
    // first one from staff -- a learner adding detail is not a response.
    if (staffReplying && !row.first_response_at) patch.first_response_at = at;
    if (staffReplying && (row.status === 'open' || row.status === 'assigned')) {
      patch.status = 'answered';
    }
    // A learner replying to an answered ticket reopens it: they are still stuck.
    if (!staffReplying && row.status === 'answered') patch.status = 'assigned';

    const { data } = await this.#db.from('onyx_tickets').update(patch)
      .eq('tenant_id', tenantId).eq('id', id).select(TICKET_COLUMNS).maybeSingle();

    await this.#event(tenantId, id, actor.userId,
      staffReplying ? 'responded' : 'commented', body, {});
    return data;
  }

  async resolve(tenantId: number, id: number, actor: QueueViewer,
    note?: string) {
    const row = await this.#row(tenantId, id);
    const mine = String(row.raised_by) === actor.userId;
    if (!mine && !isMentor(actor)) throw new HttpError(403, 'That ticket is not yours.');

    const at = new Date(this.#now()).toISOString();
    const { data } = await this.#db.from('onyx_tickets').update({
      status: 'resolved',
      resolved_at: at,
      first_response_at: row.first_response_at ?? (isMentor(actor) ? at : null),
      updated_at: at,
    }).eq('tenant_id', tenantId).eq('id', id).select(TICKET_COLUMNS).maybeSingle();

    await this.#event(tenantId, id, actor.userId, 'resolved', note?.trim() || null, {});
    await this.#audit.record(
      { tenant_id: tenantId, user_id: actor.userId },
      { action: 'ticket.resolved', entityType: 'ticket', entityId: id,
        before: { status: row.status }, after: { status: 'resolved' } });
    return data;
  }

  async reopen(tenantId: number, id: number, actor: QueueViewer,
    note?: string) {
    const row = await this.#row(tenantId, id);
    const mine = String(row.raised_by) === actor.userId;
    if (!mine && !isMentor(actor)) throw new HttpError(403, 'That ticket is not yours.');

    // Reopening does not restart the clock. The promise was made when the
    // question was first asked, and a ticket that resets its SLA every time it
    // is reopened can never breach.
    const { data } = await this.#db.from('onyx_tickets').update({
      status: row.owner_id ? 'assigned' : 'open',
      resolved_at: null,
      updated_at: new Date(this.#now()).toISOString(),
    }).eq('tenant_id', tenantId).eq('id', id).select(TICKET_COLUMNS).maybeSingle();

    await this.#event(tenantId, id, actor.userId, 'reopened', note?.trim() || null, {});
    return data;
  }

  /**
   * What is late, for whoever runs the mentors.
   *
   * Breach is measured against `due_at` and stops at `resolved_at`: a ticket
   * answered in time does not become breached by sitting closed over a weekend.
   */
  async breaches(tenantId: number, viewer: { role: Role }) {
    if (!isMentor(viewer)) throw new HttpError(403, 'Staff only.');
    const now = new Date(this.#now()).toISOString();
    const { data } = await this.#db.from('onyx_tickets').select(TICKET_COLUMNS)
      .eq('tenant_id', tenantId)
      .in('status', ['open', 'assigned', 'answered'])
      .lt('due_at', now)
      .order('due_at', { ascending: true });

    const rows = data ?? [];
    const names = await this.#names([
      ...rows.map((t) => t.owner_id ? String(t.owner_id) : null), ...rows.map((t) => String(t.raised_by)),
    ]);
    return {
      breached: rows.map((t) => this.#view(t, names)),
      unowned: rows.filter((t) => t.owner_id === null).length,
    };
  }

  // -------------------------------------------------------------------------

  #view(t: Record<string, unknown>, names: Map<string, string>): TicketView {
    const created = Date.parse(String(t.created_at));
    const now = this.#now();
    const resolvedAt = t.resolved_at ? String(t.resolved_at) : null;
    const endedAt = resolvedAt ? Date.parse(resolvedAt) : now;
    const due = Date.parse(String(t.due_at));

    return {
      id: Number(t.id),
      subject: String(t.subject),
      /*
       * The question as it was asked.
       *
       * The queue carried only a subject, so any screen listing tickets could
       * show a title and nothing else — and somebody deciding whether they can
       * answer has to read the problem. It is the raiser's own words, so a
       * learner reading their own list is shown nothing they did not write.
       */
      body: t.body === null || t.body === undefined ? '' : String(t.body),
      status: t.status as TicketStatus,
      priority: t.priority as TicketPriority,
      owner_id: t.owner_id === null || t.owner_id === undefined ? null : String(t.owner_id),
      owner_name: t.owner_id ? names.get(String(t.owner_id)) ?? null : null,
      raised_by: String(t.raised_by),
      raised_by_name: names.get(String(t.raised_by)) ?? null,
      created_at: String(t.created_at),
      due_at: String(t.due_at),
      age_minutes: Math.max(0, Math.round((endedAt - created) / 60_000)),
      minutes_remaining: resolvedAt ? null : Math.round((due - now) / 60_000),
      breached: endedAt > due,
      first_response_at: t.first_response_at ? String(t.first_response_at) : null,
      resolved_at: resolvedAt,
    };
  }

  async #row(tenantId: number, id: number) {
    const { data } = await this.#db.from('onyx_tickets').select(TICKET_COLUMNS)
      .eq('tenant_id', tenantId).eq('id', id).maybeSingle();
    if (!data) throw new HttpError(404, 'No such ticket.');
    return data;
  }

  async #names(ids: (string | null)[]) {
    const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))];
    if (!unique.length) return new Map<string, string>();
    const { data } = await this.#db.from('onyx_users').select('id, name').in('id', unique);
    return new Map((data ?? []).map((u) => [String(u.id), String(u.name)]));
  }

  async #event(tenantId: number, ticketId: number, actorId: string | null,
    kind: TicketEventKind, note: string | null, detail: Record<string, unknown>) {
    await this.#db.from('onyx_ticket_events').insert({
      tenant_id: tenantId, ticket_id: ticketId, actor_id: actorId, kind, note, detail,
    });
  }
}
