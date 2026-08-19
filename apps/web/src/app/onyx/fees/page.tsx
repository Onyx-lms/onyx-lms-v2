import type { Metadata } from 'next';
import { OnyxShell } from '@/components/onyx-shell';
import { navFor } from '@/lib/onyx-nav';
import { requireOnyxSession, onyxApi, onyxApiSafe, type Me } from '@/lib/onyx-session';
import { money, type Invoice, type PayableGateway } from '@/lib/onyx-campus';
import { PayInvoice } from '@/components/onyx-pay';
import { ReceiptsReport, type ReceiptsPayload } from '@/components/onyx-receipts';
import { ConfirmPayment } from '@/components/onyx-pay-return';
import {
  Banner, Card, DataTable, Empty, EmptyRow, Hero, ListRow, Meter, Pill, RowList,
  SectionHead, relativeDue,
} from '@/components/onyx-ui';

export const metadata: Metadata = { title: 'Fees' };

const STATUS_LABEL: Record<Invoice['status'], string> = {
  issued: 'Due', part_paid: 'Partly paid', paid: 'Paid', void: 'Void',
};

/** Whole days between a due date and now, negative once it has passed. */
function daysUntil(due: string, now = Date.now()): number {
  const startOf = (ms: number) => {
    const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime();
  };
  return Math.round((startOf(Date.parse(due)) - startOf(now)) / 86_400_000);
}

/**
 * CMP-03 -- a learner's own invoices, and paying them.
 *
 * Nothing about anyone else's fees. The page was read-only until CMP-03b was
 * finished: it could state a debt and offered no way to settle it, which is the
 * one thing a fees page is for.
 *
 * What is still owed is a list, not a table -- a student is choosing one
 * instalment to settle, not comparing four down a column. What has been paid is
 * a table, because there they are scanning for the one receipt a landlord or a
 * sponsor asked for.
 */
export default async function OnyxFeesPage(
  { searchParams }: {
    searchParams: Promise<{ paid?: string; cancelled?: string; ref?: string }>;
  },
) {
  await requireOnyxSession();
  const { paid: paidInvoice, cancelled, ref } = await searchParams;

  const [me, invoices, gateways, receipts] = await Promise.all([
    onyxApi<Me>('/api/onyx/me'),
    onyxApi<Invoice[]>('/api/onyx/invoices'),
    // Absent rather than fatal: an institution that has not set up a gateway
    // still has a fees page, it just has nothing to click.
    onyxApiSafe<PayableGateway[]>('/api/onyx/gateways'),
    // Everything this learner has actually paid -- invoices settled AND courses
    // bought. The page used to show invoices alone, so a course somebody had
    // paid for appeared nowhere on the one screen about what they have paid.
    onyxApiSafe<ReceiptsPayload>('/api/onyx/my/receipts'),
  ]);

  const open = invoices.filter((i) => i.status === 'issued' || i.status === 'part_paid');
  const settled = invoices.filter((i) => i.status === 'paid' || i.status === 'void');

  const outstanding = open.reduce((sum, i) => sum + (i.total_minor - i.paid_minor), 0);
  const billed = invoices.filter((i) => i.status !== 'void')
    .reduce((sum, i) => sum + i.total_minor, 0);
  const paidSoFar = invoices.reduce((sum, i) => sum + i.paid_minor, 0);
  const currency = invoices[0]?.currency;

  // Overdue is said before anything else and in words: a learner who owes
  // something they did not know about needs telling, not leaving to work it
  // out from a red row four sections down.
  const overdue = open.filter((i) => i.due_at !== null && daysUntil(i.due_at) < 0)
    .sort((a, b) => Date.parse(a.due_at!) - Date.parse(b.due_at!));
  const overdueTotal = overdue.reduce((sum, i) => sum + (i.total_minor - i.paid_minor), 0);
  const oldest = overdue[0];

  // The next thing to settle: the earliest due date among what is still open.
  const next = [...open].filter((i) => i.due_at !== null)
    .sort((a, b) => Date.parse(a.due_at!) - Date.parse(b.due_at!))[0] ?? open[0];

  return (
    <OnyxShell me={me} nav={navFor(me.role)} title="Fees"
      subtitle={outstanding > 0 ? money(outstanding) + ' outstanding' : 'Nothing outstanding.'}>

      {/* The gateway sends the browser back here. What it says happened is not
          evidence -- the ledger below is, and it is read fresh on this render.
          So the banner reports where the payer has been, and the table reports
          what is true. */}
      {ref ? (
        <ConfirmPayment reference={ref} />
      ) : paidInvoice ? (
        <div className="mb-4">
          <Banner tone="good" icon="check">
            Thank you. If the invoice below still shows as due, the payment is still being
            confirmed by the bank — it usually takes a minute, and nothing has been lost.
          </Banner>
        </div>
      ) : null}
      {cancelled ? (
        <div className="mb-4">
          <Banner tone="info" icon="alert">
            That payment was cancelled. Nothing has been charged.
          </Banner>
        </div>
      ) : null}

      {oldest ? (
        <div className="mb-4">
          <Banner tone="late" icon="alert">
            <strong className="font-bold">
              {money(overdueTotal, oldest.currency)} {overdue.length === 1 ? 'is' : 'are'}{' '}
              past due.
            </strong>{' '}
            {oldest.number} is {relativeDue(oldest.due_at).text.toLowerCase()}. If paying is a
            problem, say so before a reminder becomes a charge.
          </Banner>
        </div>
      ) : null}

      {invoices.length > 0 ? (
        <Hero
          eyebrow="Outstanding balance"
          title={money(outstanding, currency)}
          sub={next && outstanding > 0
            ? 'Next: ' + next.number + ' · ' + relativeDue(next.due_at).text
            : 'Everything raised so far has been settled.'}
        >
          <div className="flex flex-wrap items-baseline gap-x-2 text-sm">
            <span className="font-bold">{money(paidSoFar, currency)} paid</span>
            <span className="text-white/70">of {money(billed, currency)} billed</span>
          </div>
          <div className="mt-2">
            <Meter tone="light" percent={billed ? (paidSoFar / billed) * 100 : 0}
              label={money(paidSoFar, currency) + ' paid of ' + money(billed, currency)} />
          </div>
        </Hero>
      ) : null}

      <div className="mt-6 grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1fr)_310px]">
        <div className="min-w-0">
          <SectionHead title="Still to pay" />
          {open.length === 0 ? (
            <Card className="mb-7">
              <Empty icon="check">
                {invoices.length === 0
                  ? 'No invoices have been raised yet.'
                  : 'Every invoice raised to you has been settled.'}
              </Empty>
            </Card>
          ) : (
            <div className="mb-7">
              <RowList label="Invoices still to pay">
                {open.map((i) => {
                  const due = i.total_minor - i.paid_minor;
                  const when = relativeDue(i.due_at);
                  return (
                    <ListRow
                      key={i.id}
                      icon={when.tone === 'late' ? 'alert' : 'clock'}
                      tone={when.tone === 'late' ? 'late' : 'brand'}
                      title={i.number}
                      meta={i.paid_minor > 0
                        ? money(i.paid_minor, i.currency) + ' of '
                          + money(i.total_minor, i.currency) + ' paid so far'
                        : 'Issued ' + new Date(i.issued_at).toLocaleDateString(undefined,
                          { day: 'numeric', month: 'short', year: 'numeric' })}
                      chips={<Pill tone={when.tone}>{when.text}</Pill>}
                      trailing={
                        <div className="flex flex-col items-end gap-1.5">
                          <span className="text-[15px] font-extrabold tabular-nums">
                            {money(due, i.currency)}
                          </span>
                          {i.status !== 'void' ? (
                            <PayInvoice
                              invoiceId={i.id}
                              gateways={gateways ?? []}
                              outstanding={money(due, i.currency)}
                            />
                          ) : null}
                        </div>
                      }
                    />
                  );
                })}
              </RowList>
            </div>
          )}

          {/* Everything paid, in one place -- the invoices below are only half
              of what a learner has actually handed over now that a course can
              be bought outright. Courses first, because that is the payment
              they made themselves and are most likely to be looking for. */}
          {receipts && receipts.rows.length ? (
            <div className="mb-6">
              <SectionHead title="What you have paid" />
              <ReceiptsReport data={receipts} showLearner={false}
                emptyNote="Nothing paid yet." />
            </div>
          ) : null}

          <SectionHead title="Settled" />
          {/* tabIndex makes the horizontal scroll reachable by keyboard: a
              region that only scrolls with a wheel strands anyone on a
              keyboard at whatever columns happen to fit. */}
          <div className="min-w-0" tabIndex={0} role="region" aria-label="Invoices already settled">
            <DataTable
              caption="Invoices you have already settled, newest first"
              head={
                <>
                  <th scope="col">Invoice</th>
                  <th scope="col" className="text-right">Total</th>
                  <th scope="col" className="text-right">Paid</th>
                  <th scope="col">Status</th>
                  <th scope="col">Issued</th>
                </>
              }
            >
              {settled.map((i) => (
                <tr key={i.id}>
                  <td className="whitespace-nowrap font-semibold">{i.number}</td>
                  <td className="text-right tabular-nums">{money(i.total_minor, i.currency)}</td>
                  <td className="text-right tabular-nums">{money(i.paid_minor, i.currency)}</td>
                  <td>
                    <Pill tone={i.status === 'paid' ? 'good' : 'neutral'}>
                      {STATUS_LABEL[i.status]}
                    </Pill>
                  </td>
                  <td className="whitespace-nowrap text-muted">
                    {new Date(i.issued_at).toLocaleDateString(undefined,
                      { day: 'numeric', month: 'short', year: 'numeric' })}
                  </td>
                </tr>
              ))}
              {settled.length === 0 ? (
                <EmptyRow colSpan={5} icon="wallet">
                  {invoices.length === 0
                    ? 'No invoices have been raised yet.'
                    : 'Nothing has been settled yet.'}
                </EmptyRow>
              ) : null}
            </DataTable>
          </div>
        </div>

        <aside className="min-w-0">
          <SectionHead title="What you have been charged" />
          <Card className="p-4">
            <dl className="divide-y divide-line text-[13.5px]">
              <div className="flex items-baseline justify-between gap-3 pb-2">
                <dt className="text-muted">Billed</dt>
                <dd className="font-bold tabular-nums">{money(billed, currency)}</dd>
              </div>
              <div className="flex items-baseline justify-between gap-3 py-2">
                <dt className="text-muted">Paid</dt>
                <dd className="font-bold tabular-nums">{money(paidSoFar, currency)}</dd>
              </div>
              <div className="flex items-baseline justify-between gap-3 py-2">
                <dt className="text-muted">Outstanding</dt>
                <dd className="font-bold tabular-nums">{money(outstanding, currency)}</dd>
              </div>
              <div className="flex items-baseline justify-between gap-3 pt-2">
                <dt className="text-muted">Invoices</dt>
                <dd className="font-bold tabular-nums">{invoices.length}</dd>
              </div>
            </dl>
            <p className="mt-3 text-[12px] text-muted">
              An invoice copies its lines from the fee structure at the moment it is issued, so
              changing the schedule later cannot rewrite a bill already raised to you.
            </p>
          </Card>
        </aside>
      </div>
    </OnyxShell>
  );
}
