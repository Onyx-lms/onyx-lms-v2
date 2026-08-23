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
  | 'invoice.issued' | 'guardian.linked' | 'guardian.consent_changed'
  | 'course.faculty_assigned' | 'course.faculty_removed' | 'course.removed'
  // Including a price change, which is why this one exists: the edit route
  // recorded nothing at all until it was noticed.
  | 'course.updated'
  // Changing where an institution's fees settle to is a finance-grade event,
  // so it is logged like one. The entry names which credentials were written,
  // never their values.
  | 'gateway.configured'
  // Live Classes. A domain carries a price and a link that leaves the product,
  // so who changed one, and to what, is worth keeping.
  | 'domain.created' | 'domain.updated' | 'domain.deleted'
  | 'domain.registered'
  | 'member.approved' | 'member.declined';

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
