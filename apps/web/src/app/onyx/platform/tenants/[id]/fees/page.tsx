import type { Metadata } from 'next';
import { requirePlatformSession } from '@/lib/onyx-platform-session';
import {
  attempt, SCROLLER, TenantBackLink, Unavailable, Workflow, money, type FeesPayload,
} from '@/lib/onyx-platform-tenant';
import {
  CreateFeeHeadForm, CreateFeeStructureForm, FeeStructureStatusButtons,
} from '@/components/onyx-platform-forms';
import { Card, DataTable, Empty, EmptyRow, Pill, StatTile } from '@/components/onyx-ui';

export const metadata: Metadata = { title: 'Fees' };

/** CMP-03 -- fee heads, structures and what is outstanding, previously
 * invisible in the platform console entirely (only derived counts existed,
 * nowhere on the calendar). */
export default async function OnyxPlatformFeesPage(
  { params }: { params: Promise<{ id: string }> },
) {
  await requirePlatformSession();
  const { id } = await params;
  const tenantId = Number(id);
  const fees = await attempt<FeesPayload>(
    '/api/onyx/platform/tenants/' + encodeURIComponent(id) + '/fees');

  if (fees === null) {
    return (
      <div className="min-w-0 space-y-4">
        <TenantBackLink tenantId={tenantId} />
        <Unavailable what="fees" />
      </div>
    );
  }

  return (
    <div className="min-w-0 space-y-6">
      <TenantBackLink tenantId={tenantId} />
      <div className="grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <StatTile label="Fee heads" value={fees.heads.length} note="categories of charge" />
        <StatTile label="Structures" value={fees.structures.length} note="fee plans defined" />
        <StatTile label="Outstanding" value={money(fees.outstanding.total_minor)}
          note={fees.outstanding.invoices.length + ' unpaid invoice'
            + (fees.outstanding.invoices.length === 1 ? '' : 's')} />
      </div>

      <section className="min-w-0 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-[11.5px] font-bold uppercase tracking-[.085em] text-muted">
            Fee heads &middot; {fees.heads.length}
          </h2>
        </div>
        <CreateFeeHeadForm tenantId={tenantId} />
        {fees.heads.length === 0 ? (
          <Card className="p-0"><Empty icon="wallet">No fee heads defined yet.</Empty></Card>
        ) : (
          <div tabIndex={0} role="region" aria-label="Fee heads" className={SCROLLER}>
            <DataTable
              caption="The categories of charge this institution's fee structures are built from."
              head={<><th scope="col">Code</th><th scope="col">Name</th><th scope="col">Category</th></>}
            >
              {fees.heads.map((h) => (
                <tr key={h.id}>
                  <td className="font-mono text-[12.5px] font-semibold">{h.code}</td>
                  <td className="font-semibold">{h.name}</td>
                  <td><Pill tone="neutral">{h.category}</Pill></td>
                </tr>
              ))}
            </DataTable>
          </div>
        )}
      </section>

      <section className="min-w-0 space-y-3">
        <h2 className="text-[11.5px] font-bold uppercase tracking-[.085em] text-muted">
          Fee structures &middot; {fees.structures.length}
        </h2>
        <CreateFeeStructureForm tenantId={tenantId}
          heads={fees.heads.map((h) => ({ id: h.id, code: h.code, name: h.name }))} />
        {fees.structures.length === 0 ? (
          <Card className="p-0"><Empty icon="wallet">No fee structures yet.</Empty></Card>
        ) : (
          <div tabIndex={0} role="region" aria-label="Fee structures" className={SCROLLER}>
            <DataTable
              caption="Fee plans defined at this institution, their total and status."
              head={
                <>
                  <th scope="col">Structure</th>
                  <th scope="col">Instalments</th>
                  <th scope="col">Total</th>
                  <th scope="col">Status</th>
                  <th scope="col">&nbsp;</th>
                </>
              }
            >
              {fees.structures.map((s) => (
                <tr key={s.id} className="align-top">
                  <td className="font-semibold">{s.name}</td>
                  <td className="tabular-nums">{s.instalments}</td>
                  <td className="tabular-nums">{money(s.total_minor, s.currency)}</td>
                  <td><Workflow status={s.status} /></td>
                  <td className="text-right">
                    <FeeStructureStatusButtons tenantId={tenantId} structureId={s.id} status={s.status} />
                  </td>
                </tr>
              ))}
            </DataTable>
          </div>
        )}
      </section>

      <section className="min-w-0 space-y-3">
        <h2 className="text-[11.5px] font-bold uppercase tracking-[.085em] text-muted">
          Outstanding invoices &middot; {fees.outstanding.invoices.length}
        </h2>
        {fees.outstanding.invoices.length === 0 ? (
          <Card className="p-0"><Empty icon="wallet">Nothing owed right now.</Empty></Card>
        ) : (
          <div tabIndex={0} role="region" aria-label="Outstanding invoices" className={SCROLLER}>
            <DataTable
              caption="Invoices issued but not fully paid, oldest due date first."
              head={
                <>
                  <th scope="col">Student</th>
                  <th scope="col">Invoice</th>
                  <th scope="col">Balance</th>
                  <th scope="col">Status</th>
                  <th scope="col">Due</th>
                </>
              }
            >
              {fees.outstanding.invoices.map((inv) => (
                <tr key={inv.id} className="align-top">
                  <td>
                    <div className="font-semibold">{inv.student?.name ?? 'Unknown'}</div>
                    <div className="break-all text-[12.5px] text-muted">{inv.student?.email}</div>
                  </td>
                  <td className="font-mono text-[12.5px]">{inv.number}</td>
                  <td className="font-semibold tabular-nums">{money(inv.balance_minor)}</td>
                  <td>
                    {inv.overdue
                      ? <Pill tone="late">Overdue</Pill>
                      : <Workflow status={inv.status} />}
                  </td>
                  <td className="whitespace-nowrap text-[12.5px] text-muted">
                    {inv.due_at ? new Date(inv.due_at).toLocaleDateString() : '—'}
                  </td>
                </tr>
              ))}
            </DataTable>
          </div>
        )}
      </section>
    </div>
  );
}
