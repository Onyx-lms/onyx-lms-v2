/**
 * Telling people things.
 *
 * Onyx had no outbound channel at all -- no email, no in-app inbox -- and four
 * requirement descriptions assume one: inviting a tenant's first administrator,
 * the employer invitation flow, guardian "notifications on key events", and an
 * escalated question reaching a named owner within its SLA. Each of those was
 * somebody being told out of band, or not at all.
 *
 * Three decisions shape this.
 *
 * **The row is the notification; email is a copy.** An institution with no SMTP
 * configured, a bounced address or a spam filter must not mean the person is
 * never told. So every notification is written to `onyx_notifications` first
 * and mailed second, and someone who never receives the mail still finds the
 * thing waiting when they next sign in.
 *
 * **Notifying never throws.** Exactly the rule `AuditService` follows, for
 * exactly the same reason: this describes work that has already happened. A
 * ticket that was assigned is assigned whether or not the owner could be told,
 * and raising here would roll back the thing being announced. Failures go to
 * `#onError`, which means a broken notification path is silent -- so the E2E
 * asserts rows exist, the same way O01 does for audit.
 *
 * **A learner cannot notify anybody.** There is no route that takes a
 * recipient. Notifications are raised by services as a consequence of work, so
 * the set of things this product can send you is a closed list in code rather
 * than a message box pointed at your inbox.
 */
import type { OnyxDb } from './db.ts';
import { increment } from './metrics.ts';

const COLUMNS = 'id, tenant_id, user_id, kind, title, body, link, read_at, emailed, created_at';

/**
 * What Onyx can tell you about. A closed list so the inbox can group them and
 * so adding one is a deliberate act rather than a free-text string.
 */
export type NotificationKind =
  | 'membership.invited'
  | 'employer.invited'
  | 'guardian.linked'
  | 'guardian.consent_changed'
  | 'ticket.assigned'
  | 'ticket.answered'
  | 'ticket.overdue'
  | 'assignment.returned'
  | 'results.published'
  | 'certificate.issued'
  | 'invoice.issued'
  | 'discussion.mentioned'
  /** A paper was put on the calendar for a course. Sent to that course's
   *  faculty (other than whoever just scheduled it) and everyone enrolled --
   *  the calendar entry existing is not the same as anyone having been told. */
  | 'exam.scheduled'
  /**
   * An attempt has crossed the review threshold while it is still being sat.
   * Sent to invigilating staff, not to the candidate: telling somebody
   * mid-paper that they are under suspicion is its own kind of interference.
   */
  | 'assessment.integrity_review';

export interface NotificationInput {
  userId: string;
  kind: NotificationKind;
  title: string;
  body?: string | null;
  /** Relative, always. An absolute URL here is a redirect somebody else chose. */
  link?: string | null;
  /** Sent by email too, when the institution has SMTP and we know an address. */
  email?: { to: string; subject?: string; html?: string } | null;
}

/** What the mailer has to be able to do. Kept narrow so tests can pass a fake. */
export interface NotifyMailer {
  send(message: { to: string; subject: string; html: string }):
    Promise<{ sent: boolean } | unknown>;
}

export class NotifyService {
  #db: OnyxDb;
  #mail: NotifyMailer | null;
  #onError: (message: string) => void;
  #now: () => number;

  constructor(db: OnyxDb, opts: {
    mail?: NotifyMailer | null;
    onError?: (message: string) => void;
    now?: () => number;
  } = {}) {
    this.#db = db;
    this.#mail = opts.mail ?? null;
    this.#onError = opts.onError ?? (() => {});
    this.#now = opts.now ?? Date.now;
  }

  /**
   * Raise one notification. Never throws.
   *
   * Returns the row when it was written and null when it was not, so a caller
   * that wants to know can ask -- but no caller is obliged to check, which is
   * the point.
   */
  async notify(tenantId: number, input: NotificationInput) {
    let row: Record<string, unknown> | null = null;
    try {
      const { data, error } = await this.#db.from('onyx_notifications').insert({
        tenant_id: tenantId,
        user_id: input.userId,
        kind: input.kind,
        title: input.title.slice(0, 255),
        body: input.body ?? null,
        link: input.link ?? null,
        // Stated rather than left to the column default, so the row this
        // method returns has the same shape as the row a later read gets.
        read_at: null,
        emailed: 0,
      }).select(COLUMNS).maybeSingle();
      if (error) throw new Error(error.message);
      row = data as Record<string, unknown> | null;
    } catch (e) {
      increment('onyx_notification_failures_total', { stage: 'write' });
      this.#onError('onyx notification write failed: '
        + (e instanceof Error ? e.message : String(e)));
      return null;
    }

    // The email is a copy of a record that already exists, so a failure here
    // costs the copy and not the notification.
    if (input.email?.to && this.#mail) {
      try {
        const result = await this.#mail.send({
          to: input.email.to,
          subject: input.email.subject ?? input.title,
          html: input.email.html ?? defaultHtml(input),
        });
        const sent = Boolean((result as { sent?: boolean } | null)?.sent);
        if (sent && row) {
          await this.#db.from('onyx_notifications')
            .update({ emailed: 1 }).eq('id', Number(row.id));
        }
      } catch (e) {
        increment('onyx_notification_failures_total', { stage: 'email' });
        this.#onError('onyx notification email failed: '
          + (e instanceof Error ? e.message : String(e)));
      }
    }

    increment('onyx_notifications_total', { kind: input.kind });
    return row;
  }

  /** The same notification to several people. One row each -- see the migration. */
  async notifyAll(tenantId: number, recipients: NotificationInput[]) {
    for (const r of recipients) await this.notify(tenantId, r);
  }

  /** Somebody's own inbox. Newest first, and never anyone else's. */
  async inbox(tenantId: number, userId: string, opts: { limit?: number } = {}) {
    const { data } = await this.#db.from('onyx_notifications')
      .select(COLUMNS)
      .eq('tenant_id', tenantId).eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(Math.min(opts.limit ?? 50, 200));
    return data ?? [];
  }

  /** What the header badge asks for on every page load, so it stays cheap. */
  async unreadCount(tenantId: number, userId: string): Promise<number> {
    const { data } = await this.#db.from('onyx_notifications')
      .select('id')
      .eq('tenant_id', tenantId).eq('user_id', userId).is('read_at', null);
    return (data ?? []).length;
  }

  /** Marks one, or everything. Only ever the caller's own. */
  async markRead(tenantId: number, userId: string, id?: number) {
    const at = new Date(this.#now()).toISOString();
    let q = this.#db.from('onyx_notifications')
      .update({ read_at: at })
      .eq('tenant_id', tenantId).eq('user_id', userId).is('read_at', null);
    if (id) q = q.eq('id', id);
    await q;
    return { ok: true as const, at };
  }
}

/**
 * The fallback email body.
 *
 * Deliberately plain: no images, no tracking, no layout that breaks in a client
 * nobody tests against. A notification email's job is to say the thing and
 * offer the link, and anything else is a reason for it to land in spam.
 */
function defaultHtml(input: NotificationInput): string {
  const escape = (v: string) => v
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const parts = ['<p style="font:16px/1.5 system-ui,sans-serif">'
    + '<strong>' + escape(input.title) + '</strong></p>'];
  if (input.body) {
    parts.push('<p style="font:15px/1.6 system-ui,sans-serif">'
      + escape(input.body) + '</p>');
  }
  if (input.link) {
    parts.push('<p style="font:15px/1.6 system-ui,sans-serif">Sign in to Onyx to see it.</p>');
  }
  return parts.join('\n');
}
