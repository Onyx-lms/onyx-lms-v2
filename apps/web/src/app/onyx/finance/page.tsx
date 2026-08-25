import type { Metadata } from 'next';
import { OnyxShell } from '@/components/onyx-shell';
import { navFor } from '@/lib/onyx-nav';
import { requireOnyxPageRole, onyxApi, onyxApiSafe, type Me } from '@/lib/onyx-session';
import { money } from '@/lib/onyx-campus';
import { CreatePanel } from '@/components/onyx-create';
import { ReceiptsReport, type ReceiptsPayload } from '@/components/onyx-receipts';
import { BuildFeeStructure } from '@/components/onyx-manage';
import { ConfigureGateways } from '@/components/onyx-pay';
import type { GatewayConfigSummary } from '@/lib/onyx-campus';
import {
  Buckets, Card, DataTable, EmptyRow, ListRow, RowList, SectionHead, StackBar,
  StatTile, relativeDue,
} from '@/components/onyx-ui';
import { dayNumber } from '@/lib/onyx-time';

export const metadata: Metadata = { title: 'Finance' };

interface Outstanding {
  total_minor: number;
  invoices: {
    id: number; number: string; name: string | null; currency: string;
    balance_minor: number; due_at: string | null; overdue: boolean;
  }[];
}

/** Whole days a due date is in the past. Zero when it is not. */
function daysLate(due: string | null, now = Date.now()): number {
  if (!due) return 0;
  const t = Date.parse(due);
  if (!Number.isFinite(t)) return 0;
  const startOf = (ms: number) => {
    // Institution midnight, not the runtime's -- see lib/onyx-time.ts.
    return dayNumber(ms) * 86_400_000;
  };
  return Math.max(0, Math.round((startOf(now) - startOf(t)) / 86_400_000));
}

/** CMP-03 -- what is owed, institution-wide. Administrators only. */
export default async function OnyxFinancePage() {
  const claims = await requireOnyxPageRole('admin');
  const [me, outstanding, heads, structures, members, receipts] = await Promise.all([
    onyxApi<Me>('/api/onyx/me'),
    onyxApi<Outstanding>('/api/onyx/finance/outstanding'),
    onyxApiSafe<{ id: number; code: string; name: string }[]>('/api/onyx/fee-heads'),
    onyxApiSafe<{ id: number; name: string; status: string }[]>('/api/onyx/fee-structures'),
    onyxApiSafe<{ user_id: number; role: string; user: { name: string } | null }[]>(
      '/api/onyx/members'),
    // What has actually come in, both ways it arrives -- fee payments settling
    // an invoice, and locked courses bought outright. Safe rather than fatal:
    // arrears are the rest of this page's job and should not disappear because
    // the takings could not be read.
    onyxApiSafe<ReceiptsPayload>('/api/onyx/finance/receipts'),
  ]);
  // CMP-03b: where this institution's fees settle to. Its own merchant
  // account, not the platform's -- two institutions are two merchants.
  const gateways = await onyxApiSafe<GatewayConfigSummary[]>('/api/onyx/admin/gateways');
  const learners = (members ?? []).filter((m) => m.role === 'student');
  const issuable = (structures ?? []).filter((s) => s.status === 'published');

  const rows = outstanding.invoices;
  const currency = rows[0]?.currency;
  const overdue = rows.filter((i) => i.overdue);
  const overdueTotal = overdue.reduce((sum, i) => sum + i.balance_minor, 0);

  /**
   * Ageing, which is the collections view.
   *
   * What matters is not that a total is owed but how long the oldest part of
   * it has been owed, and a single figure hides exactly that. The bar gives
   * the shape; the rows underneath give the amounts, in the same order.
   */
  const band = (i: Outstanding['invoices'][number]) => {
    if (!i.overdue) return 0;
    const late = daysLate(i.due_at);
    return late <= 30 ? 1 : late <= 60 ? 2 : 3;
  };
  const ageing = [
    { label: 'Not yet due', dotClass: 'bg-brand-400', barClass: 'bg-brand-400' },
    { label: '0–30 days overdue', dotClass: 'bg-accent-500', barClass: 'bg-accent-500' },
    { label: '30–60 days overdue', dotClass: 'bg-accent-600', barClass: 'bg-accent-600' },
    { label: '60+ days overdue', dotClass: 'bg-red-600', barClass: 'bg-red-600' },
  ].map((b, n) => {
    const inBand = rows.filter((i) => band(i) === n);
    return {
      ...b,
      count: inBand.length,
      amount: inBand.reduce((sum, i) => sum + i.balance_minor, 0),
    };
  });

  const oldest = rows.reduce((n, i) => Math.max(n, daysLate(i.due_at)), 0);

  // Chasing is per person, not per invoice: one learner with three unpaid
  // instalments is one phone call, not three.
  const byPerson = new Map<string, { name: string; count: number; amount: number; late: number }>();
  for (const i of overdue) {
    const key = i.name ?? 'Unnamed';
    const seen = byPerson.get(key)
      ?? { name: key, count: 0, amount: 0, late: 0 };
    seen.count += 1;
    seen.amount += i.balance_minor;
    seen.late = Math.max(seen.late, daysLate(i.due_at));
    byPerson.set(key, seen);
  }
  const worst = [...byPerson.values()].sort((a, b) => b.amount - a.amount).slice(0, 6);

  return (
    <OnyxShell me={me} nav={navFor(me.role)} title="Finance"
      subtitle={money(outstanding.total_minor) + ' outstanding across '
        + rows.length + ' invoice'
        + (rows.length === 1 ? '' : 's')}>

      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Outstanding" value={money(outstanding.total_minor, currency)}
          note={rows.length + ' invoice' + (rows.length === 1 ? '' : 's') + ' unsettled'} />
        <StatTile label="Overdue" value={money(overdueTotal, currency)}
          note={overdue.length + ' past their due date'} />
        <StatTile label="Oldest debt" value={oldest === 0 ? '—' : oldest + ' d'}
          note={oldest === 0 ? 'nothing is late' : 'since the earliest due date passed'} />
        <StatTile label="Learners" value={byPerson.size}
          note="with something overdue" />
      </div>

      {/* What has come in, before what has not.
          The tiles above are arrears -- money the institution is waiting for.
          This is the other half, and it is the half an administrator is asked
          about: who has paid, for what, and what reference did they get. Both
          kinds of payment are here, because "what have we taken this term"
          does not distinguish between a fee and a course sale. */}
      <section className="mb-6">
        <SectionHead title="Payments received" />
        {receipts ? (
          <ReceiptsReport data={receipts} />
        ) : (
          <Card className="p-4 text-[13px] text-muted">
            The payment report could not be read just now. Nothing has changed — reload to
            try again.
          </Card>
        )}
      </section>

      {/* CMP-03: "configure fee structures, generate invoices, process
          online payments, issue receipts and reconcile accounts". The third of
          those was the one with nothing behind it. */}
      <SectionHead title="Raise, record and configure" />
      <div className="mb-3">
        <ConfigureGateways configured={gateways ?? []} tenantId={claims.tenant_id} />
      </div>

      <div className="mb-3 flex flex-wrap items-start gap-3">
        <BuildFeeStructure heads={heads ?? []} />
        {/* An invoice copies its lines from the structure at issue time, so
            editing the fees later cannot rewrite a bill already paid. */}
        <CreatePanel
          title="Raise an invoice" cta="Raise an invoice" icon="wallet" compact
          endpoint="invoices"
          fields={[
            { name: 'user_id', label: 'Learner', type: 'select', required: true,
              // A uuid, so NOT numeric: CreatePanel runs Number() over a
              // numeric field and a uuid becomes NaN, which JSON sends as null and
              // the route refuses. Left over from when user ids were bigints.
              wide: true,
              options: learners.map((m) => ({ value: String(m.user_id),
                label: m.user?.name ?? 'User ' + m.user_id })) },
            { name: 'structure_id', label: 'Fee structure', type: 'select', required: true,
              numeric: true, wide: true,
              options: issuable.map((s) => ({ value: String(s.id), label: s.name })),
              help: issuable.length ? undefined : 'Build a fee structure first.' },
            { name: 'instalment_no', label: 'Instalment', type: 'number', min: 1, max: 12,
              fallback: 1 },
            { name: 'due_at', label: 'Due', type: 'datetime' },
          ]}
        />
      </div>

      <div className="mb-7 grid gap-3 lg:grid-cols-2">
        <CreatePanel
          title="New fee head" cta="Add a fee head" icon="wallet" compact
          endpoint="fee-heads"
          fields={[
            { name: 'code', label: 'Code', required: true, placeholder: 'TUITION' },
            { name: 'name', label: 'Name', required: true, placeholder: 'Tuition' },
            { name: 'category', label: 'Category', type: 'select', fallback: 'tuition',
              options: ['tuition', 'exam', 'hostel', 'transport', 'library', 'misc']
                .map((c) => ({ value: c, label: c })) },
            { name: 'refundable', label: 'Refundable', type: 'checkbox' },
          ]}
        />
        <CreatePanel
          title="Record a payment" cta="Record a payment" icon="wallet" compact
          endpoint="payments"
          fields={[
            { name: 'invoice_id', label: 'Invoice id', type: 'number', required: true, min: 1 },
            { name: 'gateway', label: 'Gateway', required: true, fallback: 'manual',
              placeholder: 'manual' },
            { name: 'reference', label: 'Reference', required: true,
              help: 'Unique per gateway — a replayed webhook with the same reference never credits twice.' },
            { name: 'amount_minor', label: 'Amount (paise)', type: 'number', required: true, min: 1 },
          ]}
        />
      </div>

      {/* min-w-0 on both columns. A grid item's automatic minimum size is its
          content's minimum, and a table's minimum is the whole table -- so
          without this the single-column phone layout inherits the width of the
          widest invoice row and the page scrolls sideways. */}
      <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1fr)_310px]">
        <div className="min-w-0">
          <SectionHead title="Ageing breakdown" />
          <Card className="mb-7 p-4">
            <StackBar parts={ageing.map((b) => ({
              value: b.amount, className: b.barClass,
            }))} />
            <Buckets rows={ageing.map((b) => ({
              label: b.label,
              dotClass: b.dotClass,
              count: b.count + (b.count === 1 ? ' invoice' : ' invoices'),
              amount: money(b.amount, currency),
            }))} />
            <p className="mt-3 border-t border-line pt-3 text-[12.5px] text-muted">
              {overdueTotal > 0
                ? money(overdueTotal, currency) + ' is past its due date across '
                  + byPerson.size + ' learner' + (byPerson.size === 1 ? '' : 's') + '.'
                : 'Nothing has passed its due date.'}
            </p>
          </Card>

          <SectionHead title="Outstanding invoices" />
          {/* tabIndex makes the horizontal scroll reachable by keyboard: a
              region that only scrolls with a wheel or a trackpad swipe strands
              anyone on a keyboard at whatever columns happen to fit. */}
          <div className="min-w-0" tabIndex={0} role="region" aria-label="Outstanding invoices">
            <DataTable
              caption="Every unsettled invoice at this institution"
              head={
                <>
                  <th scope="col">Invoice</th>
                  <th scope="col">Learner</th>
                  <th scope="col" className="text-right">Balance</th>
                  <th scope="col">Due</th>
                </>
              }
            >
              {rows.map((i) => {
                const when = relativeDue(i.due_at);
                return (
                  <tr key={i.id}>
                    <td className="whitespace-nowrap font-semibold">{i.number}</td>
                    <td>{i.name ?? <span className="text-muted">Unnamed</span>}</td>
                    <td className="text-right font-bold tabular-nums">
                      {money(i.balance_minor, i.currency)}
                    </td>
                    <td className="whitespace-nowrap">
                      {/* The state is a word first. Red on its own is not a
                          state anyone can be asked to read. */}
                      <span className={'inline-flex items-center gap-1.5 font-semibold '
                        + (i.overdue ? 'text-red-700' : 'text-muted')}>
                        <span aria-hidden
                          className={'h-2 w-2 shrink-0 rounded-full '
                            + (i.overdue ? 'bg-red-600' : 'bg-slate-300')} />
                        {i.overdue ? 'Overdue' : when.text}
                      </span>
                      {i.overdue ? (
                        <span className="ml-1.5 text-[12.5px] text-muted">{when.text}</span>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 ? (
                <EmptyRow colSpan={4} icon="wallet">Nothing outstanding.</EmptyRow>
              ) : null}
            </DataTable>
          </div>
        </div>

        <aside className="min-w-0">
          <SectionHead title="Largest overdue" />
          {worst.length === 0 ? (
            <Card className="p-4">
              <p className="text-[13px] text-muted">Nobody is behind on their fees.</p>
            </Card>
          ) : (
            <RowList label="Learners with the most overdue">
              {worst.map((p) => (
                <ListRow
                  key={p.name}
                  icon="wallet"
                  tone={p.late > 30 ? 'late' : 'neutral'}
                  title={p.name}
                  meta={p.count + (p.count === 1 ? ' invoice' : ' invoices')
                    + ' · ' + p.late + ' days'}
                  trailing={
                    <span className="text-[14px] font-extrabold tabular-nums">
                      {money(p.amount, currency)}
                    </span>
                  }
                />
              ))}
            </RowList>
          )}
        </aside>
      </div>
    </OnyxShell>
  );
}
