/**
 * F-05 -- audit logging.
 *
 * The proposal promises "audit logs capture sensitive actions across academics,
 * assessment and finance for accountability". That is only true if writing one
 * is easier than forgetting to, so this is a single call with the tenant and
 * actor already in hand from the claims.
 *
 * Recording is deliberately best-effort: a failure to write the log must not
 * roll back the grade change it was describing. Failures are surfaced through
 * the logger instead, where they are visible without being destructive.
 */
import type { OnyxDb } from './db.ts';

const COLUMNS = 'id, tenant_id, actor_id, action, entity_type, entity_id, before, after, ip, created_at';

/** The actions worth recording. A closed list, so the log stays searchable. */
export type AuditAction =
  | 'tenant.created' | 'tenant.updated'
  // Teaching divisions: Alpha/Beta/Gamma, Section A/B/C. Which section a
  // learner is in decides which papers they are dealt, so who changed one
  // and when is worth the same record as a role change.
  | 'section.created' | 'section.updated' | 'section.removed'
  // Who gave somebody a capability their role does not carry. The first
  // question asked after a person does something nobody expected them to be
  // able to do (0036).
  | 'member.permissions'
  | 'membership.created' | 'membership.role_changed' | 'membership.removed' | 'membership.updated'
  | 'user.updated'
  | 'enrolment.created' | 'enrolment.removed'
  | 'attendance.marked' | 'attendance.amended'
  | 'assignment.graded' | 'assignment.returned'
  | 'assessment.published' | 'assessment.grade_changed' | 'assessment.flag_reviewed'
  | 'certificate.issued' | 'certificate.revoked'
  | 'fee.updated' | 'invoice.written_off' | 'payment.recorded'
  | 'result.published' | 'transcript.generated'
  // O06 -- engagement
  | 'discussion.asked' | 'discussion.resolved'
  | 'ticket.raised' | 'ticket.assigned' | 'ticket.resolved'
  // O07 -- campus operations
  | 'timetable.published' | 'exam.scheduled' | 'exam.updated' | 'seating.allocated'
  | 'marks.entered' | 'marks.moderated' | 'marks.overridden' | 'assessment.updated'
  // Cancelling a paper. Refused once anybody has sat it, so this only ever
  // records the removal of one nobody's marks hang off.
  | 'assessment.deleted'
  | 'invoice.issued' | 'guardian.linked' | 'guardian.consent_changed'
  | 'course.faculty_assigned' | 'course.faculty_removed' | 'course.removed'
  // Including a price change, which is why this one exists: the edit route
  // recorded nothing at all until it was noticed.
  | 'course.updated'
  // What a course is MADE of. Renaming a module or deleting a lesson used to
  // be reachable only from the platform console, where it landed in the
  // operator's own log; now that a lecturer can do it too, it belongs in the
  // institution's -- "who took that lesson down" is a question asked about a
  // syllabus far more often than about a price.
  | 'module.updated' | 'module.deleted'
  | 'lesson.updated' | 'lesson.deleted'
  // Changing where an institution's fees settle to is a finance-grade event,
  // so it is logged like one. The entry names which credentials were written,
  // never their values.
  | 'gateway.configured'
  // Live Classes. A domain carries a price and a link that leaves the product,
  // so who changed one, and to what, is worth keeping.
  | 'domain.created' | 'domain.updated' | 'domain.deleted'
  | 'domain.registered'
  // Somebody watched a candidate's camera. Recorded because being watched is
  // an act that should be accountable afterwards, not only visible at the time.
  | 'proctor.watched'
  // The product ending somebody's examination with no person in the loop, and
  // a person putting them back into it. Two acts that must be answerable for.
  | 'attempt.terminated'
  | 'attempt.reinstated';

export interface AuditEntry {
  action: AuditAction;
  entityType: string;
  entityId?: number | null;
  before?: unknown;
  after?: unknown;
  ip?: string | null;
}

export class AuditService {
  #db: OnyxDb;
  #onError: (message: string) => void;

  constructor(db: OnyxDb, onError: (message: string) => void = () => {}) {
    this.#db = db;
    this.#onError = onError;
  }

  /** Records an action performed by the holder of these claims. */
  async record(
    claims: { tenant_id: number; user_id: string | null },
    entry: AuditEntry,
  ): Promise<void> {
    const { error } = await this.#db.from('onyx_audit_logs').insert({
      tenant_id: claims.tenant_id,
      // No actor rather than a fake one: actor_id references a real person, and
      // a placeholder id would fail the foreign key and lose the entry.
      actor_id: claims.user_id || null,
      action: entry.action,
      entity_type: entry.entityType,
      entity_id: entry.entityId ?? null,
      before: (entry.before ?? null) as never,
      after: (entry.after ?? null) as never,
      ip: entry.ip ?? null,
    });
    // Never throw: the audit row describes work that already happened, and
    // failing here would undo it.
    if (error) this.#onError('audit write failed (' + entry.action + '): ' + error.message);
  }

  /** System-initiated actions, with no human actor. */
  async recordSystem(tenantId: number, entry: AuditEntry): Promise<void> {
    await this.record({ tenant_id: tenantId, user_id: null }, entry);
  }

  /**
   * The log for one tenant, newest first. Never readable through PostgREST --
   * `onyx_audit_logs` has RLS with no select policy, so this service-role path is
   * the only way in, and the routes restrict it to admins.
   */
  async list(tenantId: number, filters: {
    action?: string; entityType?: string; entityId?: number; limit?: number;
  } = {}) {
    let query = this.#db.from('onyx_audit_logs')
      .select(COLUMNS).eq('tenant_id', tenantId);
    if (filters.action) query = query.eq('action', filters.action);
    if (filters.entityType) query = query.eq('entity_type', filters.entityType);
    if (filters.entityId !== undefined) query = query.eq('entity_id', filters.entityId);

    const { data } = await query
      .order('id', { ascending: false })
      .limit(Math.min(filters.limit ?? 100, 500));
    const rows = data ?? [];

    const ids = [...new Set(rows.map((r) => r.actor_id ? String(r.actor_id) : null).filter((v) => v !== null))];
    const { data: actors } = ids.length
      ? await this.#db.from('onyx_users').select('id, name, email').in('id', ids)
      : { data: [] };
    const byId = new Map((actors ?? []).map((u) => [u.id, u]));
    return rows.map((r) => ({ ...r, actor: byId.get(r.actor_id ? String(r.actor_id) : '') ?? null }));
  }
}
