import Link from 'next/link';
import type { Metadata } from 'next';
import { OnyxPlatformShell } from '@/components/onyx-platform-shell';
import { requirePlatformSession, platformApi } from '@/lib/onyx-platform-session';
import { ago, plural } from '@/lib/onyx-platform-tenant';
import { DataTable, Empty, Icon, Pill } from '@/components/onyx-ui';

export const metadata: Metadata = { title: 'Audit log' };

interface AuditRow {
  id: number; actor_id: number | null; action: string; entity_type: string;
  entity_id: number | null; before: unknown; after: unknown; created_at: string;
  actor: { id: number; name: string; email: string } | null;
}

/** "tenant.created" -> "Institution created". Read off the verb after the
 * dot, since every action here is "<entity>.<what happened>" -- the entity
 * half is already its own column. */
function verb(action: string): string {
  const part = action.includes('.') ? action.slice(action.indexOf('.') + 1) : action;
  return part.replace(/_/g, ' ');
}

const ENTITY_LABEL: Record<string, string> = {
  tenant: 'Institution', platform_admin: 'Platform admin', membership: 'Membership',
  user: 'Account', exam_mark: 'Exam mark', assessment_attempt: 'Assessment attempt',
  submission: 'Submission', course: 'Course', assignment: 'Assignment',
  assessment: 'Assessment', exam: 'Exam', fee_head: 'Fee head', fee_structure: 'Fee structure',
};

/** Every action here reads as a sentence: who, did what, to which record --
 * the shape audit trails take everywhere from PlanetScale to Cloudflare to
 * Zoho, because "actor / verb / object / when" is the one order a person
 * scanning for "did someone touch this" actually reads in. */
export default async function OnyxPlatformAuditPage(
  { searchParams }: { searchParams: Promise<{ action?: string; entity_type?: string }> },
) {
  const session = await requirePlatformSession();
  const q = await searchParams;
  const qs = new URLSearchParams();
  if (q.action) qs.set('action', q.action);
  if (q.entity_type) qs.set('entity_type', q.entity_type);
  qs.set('limit', '200');

  const [rows, filters, tenants] = await Promise.all([
    platformApi<AuditRow[]>('/api/onyx/platform/audit?' + qs.toString()),
    platformApi<{ actions: string[]; entityTypes: string[] }>('/api/onyx/platform/audit/filters'),
    // Read so the log can NAME what was acted on. It listed "Institution #194"
    // beside a link that 404'd, because #194 was a tenant somebody had since
    // deleted -- an audit trail whose whole job is to say what happened, saying
    // it in primary keys and offering a door to nowhere.
    platformApi<{ id: number; name: string }[]>('/api/onyx/platform/tenants'),
  ]);
  const { actions, entityTypes } = filters;
  const filtered = Boolean(q.action || q.entity_type);
  const liveTenants = new Map(tenants.map((t) => [t.id, t.name]));

  /** The record's name: from the platform today, else from what was recorded. */
  const nameOf = (r: AuditRow): string | null => {
    if (r.entity_type === 'tenant' && r.entity_id != null) {
      const live = liveTenants.get(r.entity_id);
      if (live) return live;
    }
    const after = r.after as Record<string, unknown> | null;
    const before = r.before as Record<string, unknown> | null;
    for (const src of [after, before]) {
      const n = src?.name ?? src?.title ?? src?.email;
      if (typeof n === 'string' && n) return n;
    }
    return null;
  };

  return (
    <OnyxPlatformShell
      email={session.email}
      title="Audit log"
      breadcrumb={[{ href: '/onyx/platform', label: 'Platform' }, { label: 'Audit log' }]}
      subtitle={'Every write a platform admin has made, across every institution — the most '
        + 'privileged reads are logged too.'}
    >
      <div className="space-y-4">
        {/* One line of controls, matching the Institutions directory's filter
            row. This was a boxed panel with stacked labels, which made the
            filter the largest object on a page whose subject is the table
            under it. */}
        <form method="get" className="flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor="af-entity">Entity</label>
          <select id="af-entity" name="entity_type" defaultValue={q.entity_type ?? ''}
            className="min-h-[40px] rounded-xl border border-line bg-white px-3 text-[14px]
                       focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-ink/20">
            <option value="">Any entity</option>
            {entityTypes.map((e) => (
              <option key={e} value={e}>{ENTITY_LABEL[e] ?? e}</option>
            ))}
          </select>
          <label className="sr-only" htmlFor="af-action">Action</label>
          <select id="af-action" name="action" defaultValue={q.action ?? ''}
            className="min-h-[40px] min-w-[200px] rounded-xl border border-line bg-white px-3
                       text-[14px] focus:border-slate-500 focus:outline-none focus:ring-2
                       focus:ring-ink/20">
            <option value="">Any action</option>
            {actions.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
          <button type="submit"
            className="min-h-[40px] rounded-xl border border-line bg-white px-4 text-[14px]
                       font-bold hover:border-brand-300 hover:text-brand-700">
            Filter
          </button>
          {filtered ? (
            <Link href="/onyx/platform/audit"
              className="inline-flex min-h-[40px] items-center px-1 text-[13px] font-semibold
                         text-muted hover:text-brand-700 hover:underline">
              Clear
            </Link>
          ) : null}
          <span className="flex-1" />
          <span className="text-[12.5px] text-muted">
            {rows.length === 200 ? 'Showing the 200 most recent' : plural(rows.length, 'event')}
          </span>
        </form>

        {rows.length === 0 ? (
          <Empty icon="flag">
            {filtered ? 'Nothing matches that filter.' : 'Nothing has been recorded yet.'}
          </Empty>
        ) : (
          <div tabIndex={0} role="region" aria-label="Audit log">
            <DataTable
              caption="Every platform-admin action recorded, most recent first."
              head={
                <>
                  <th scope="col">Actor</th>
                  <th scope="col">Action</th>
                  <th scope="col">Entity</th>
                  <th scope="col">When</th>
                  <th scope="col">&nbsp;</th>
                </>
              }
            >
              {rows.map((r) => (
                <tr key={r.id} className="align-top">
                  <td>
                    {r.actor ? (
                      <>
                        <div className="font-semibold">{r.actor.name}</div>
                        <div className="break-all text-[12.5px] text-muted">{r.actor.email}</div>
                      </>
                    ) : (
                      <span className="text-[12.5px] text-muted">System</span>
                    )}
                  </td>
                  <td>
                    <Pill tone="neutral">{verb(r.action)}</Pill>
                  </td>
                  <td className="text-[13px]">
                    {/* Name first, kind and key underneath: an operator
                        scanning for "who touched Meridian" reads names, and
                        needs the id only once they have found the row. */}
                    <div className="font-semibold">
                      {nameOf(r) ?? (ENTITY_LABEL[r.entity_type] ?? r.entity_type)}
                    </div>
                    <div className="text-[12px] text-muted">
                      {ENTITY_LABEL[r.entity_type] ?? r.entity_type}
                      {r.entity_id != null ? ' #' + r.entity_id : ''}
                      {/* Only where there is still something to open. A link to
                          a deleted institution is a 404 dressed as an action. */}
                      {r.entity_type === 'tenant' && r.entity_id != null
                        && liveTenants.has(r.entity_id) ? (
                          <>
                            {' · '}
                            <Link href={'/onyx/platform/tenants/' + r.entity_id}
                              className="font-semibold text-brand-700 hover:underline">
                              Open
                            </Link>
                          </>
                        ) : r.entity_type === 'tenant' ? (
                          <span className="text-muted"> · deleted</span>
                        ) : null}
                    </div>
                  </td>
                  <td className="whitespace-nowrap text-[12.5px] text-muted">
                    {ago(r.created_at)}
                  </td>
                  <td>
                    {(r.before !== null && r.before !== undefined)
                      || (r.after !== null && r.after !== undefined) ? (
                      <details className="group">
                        <summary
                          className="inline-flex cursor-pointer list-none items-center gap-1
                                     text-[12.5px] font-semibold text-brand-700 hover:underline
                                     [&::-webkit-details-marker]:hidden">
                          Details
                          <Icon name="chevron"
                            className="h-3 w-3 rotate-90 transition group-open:-rotate-90" />
                        </summary>
                        <div className="mt-2 max-w-xs space-y-1.5 rounded-lg bg-slate-50 p-2.5
                                        text-[11.5px]">
                          {r.before != null ? (
                            <div>
                              <div className="font-bold uppercase tracking-[.06em] text-muted">
                                Before
                              </div>
                              <pre className="whitespace-pre-wrap break-words font-mono">
                                {JSON.stringify(r.before)}
                              </pre>
                            </div>
                          ) : null}
                          {r.after != null ? (
                            <div>
                              <div className="font-bold uppercase tracking-[.06em] text-muted">
                                After
                              </div>
                              <pre className="whitespace-pre-wrap break-words font-mono">
                                {JSON.stringify(r.after)}
                              </pre>
                            </div>
                          ) : null}
                        </div>
                      </details>
                    ) : (
                      <span className="text-[12.5px] text-muted">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </DataTable>
          </div>
        )}
      </div>
    </OnyxPlatformShell>
  );
}
