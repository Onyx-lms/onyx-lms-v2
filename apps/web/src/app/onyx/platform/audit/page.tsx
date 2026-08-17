import Link from 'next/link';
import type { Metadata } from 'next';
import { OnyxPlatformShell } from '@/components/onyx-platform-shell';
import { requirePlatformSession, platformApi } from '@/lib/onyx-platform-session';
import { ago } from '@/lib/onyx-platform-tenant';
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

  const [rows, filters] = await Promise.all([
    platformApi<AuditRow[]>('/api/onyx/platform/audit?' + qs.toString()),
    platformApi<{ actions: string[]; entityTypes: string[] }>('/api/onyx/platform/audit/filters'),
  ]);
  const { actions, entityTypes } = filters;
  const filtered = Boolean(q.action || q.entity_type);

  return (
    <OnyxPlatformShell
      email={session.email}
      title="Audit log"
      subtitle="Every write a platform admin has made, across every institution -- the most privileged reads are logged too."
    >
      <div className="space-y-5">
        <form method="get"
          className="flex flex-wrap items-end gap-3 rounded-2xl border border-line bg-white p-3.5">
          <div>
            <label className="block text-[13px] font-semibold text-slate-700" htmlFor="af-entity">
              Entity
            </label>
            <select id="af-entity" name="entity_type" defaultValue={q.entity_type ?? ''}
              className="mt-1 block min-h-[42px] rounded-xl border border-line bg-white px-3
                         text-[14px] focus:border-slate-500 focus:outline-none
                         focus:ring-2 focus:ring-ink/20">
              <option value="">Any entity</option>
              {entityTypes.map((e) => (
                <option key={e} value={e}>{ENTITY_LABEL[e] ?? e}</option>
              ))}
            </select>
          </div>
          <div className="min-w-[220px]">
            <label className="block text-[13px] font-semibold text-slate-700" htmlFor="af-action">
              Action
            </label>
            <select id="af-action" name="action" defaultValue={q.action ?? ''}
              className="mt-1 block min-h-[42px] w-full rounded-xl border border-line bg-white
                         px-3 text-[14px] focus:border-slate-500 focus:outline-none
                         focus:ring-2 focus:ring-ink/20">
              <option value="">Any action</option>
              {actions.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
          <button type="submit"
            className="min-h-[42px] rounded-xl bg-brand-600 px-4 text-[14px] font-bold text-white
                       hover:bg-brand-700">
            Filter
          </button>
          {filtered ? (
            <Link href="/onyx/platform/audit"
              className="inline-flex min-h-[42px] items-center px-1 text-[13px] font-semibold
                         text-muted hover:text-brand-700 hover:underline">
              Clear
            </Link>
          ) : null}
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
                    {ENTITY_LABEL[r.entity_type] ?? r.entity_type}
                    {r.entity_id != null ? (
                      <span className="text-muted"> #{r.entity_id}</span>
                    ) : null}
                    {r.entity_type === 'tenant' && r.entity_id != null ? (
                      <>
                        {' · '}
                        <Link href={'/onyx/platform/tenants/' + r.entity_id}
                          className="font-semibold text-brand-700 hover:underline">
                          Open
                        </Link>
                      </>
                    ) : null}
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
