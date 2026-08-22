import { Card, DataTable, EmptyRow, Pill, SectionHead } from '@/components/onyx-ui';

/**
 * Who has signed up for one Live Class.
 *
 * This is not a report bolted onto a payment feature -- it is the half that
 * makes the other half worth having. A domain grants no access, so the entire
 * consequence of somebody registering is that a person in the office has to
 * contact them. A payment that produced a row nobody looked at would be worse
 * than no payment button at all: the learner has been charged and, as far as
 * they can tell, nothing happened.
 *
 * So it carries a name, an email and a phone number, and it shows PENDING rows
 * as well as captured ones. A payment the bank has not confirmed is exactly the
 * case somebody needs to see -- hiding it would make a person who may well have
 * been charged invisible to the only people who could find out.
 */

export interface DomainRegistration {
  id: number;
  user_id: string;
  name: string;
  email: string;
  phone: string;
  amount_minor: number;
  currency: string;
  gateway: string;
  status: string;
  created_at: string;
}

const STATUS: Record<string, { label: string; tone: 'good' | 'soon' | 'late' }> = {
  captured: { label: 'Paid', tone: 'good' },
  pending: { label: 'Awaiting the bank', tone: 'soon' },
  failed: { label: 'Failed', tone: 'late' },
};

function money(minor: number, currency: string): string {
  if (!minor) return 'Free';
  return currency + ' ' + Math.floor(minor / 100).toLocaleString('en-IN')
    + '.' + String(minor % 100).padStart(2, '0');
}

/** A date somebody can act on, not an ISO string. */
function when(value: string): string {
  const t = Date.parse(value);
  if (Number.isNaN(t)) return '—';
  return new Date(t).toLocaleDateString('en-IN',
    { day: 'numeric', month: 'short', year: 'numeric' });
}

export function DomainRegistrations({ rows }: { rows: DomainRegistration[] }) {
  const paid = rows.filter((r) => r.status === 'captured');
  const owed = paid.reduce((t, r) => t + r.amount_minor, 0);
  const currency = rows[0]?.currency ?? 'INR';

  return (
    <section>
      <SectionHead title="Who has registered" />
      <Card className="p-0">
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 border-b border-line
                        px-4 py-3 text-[13px]">
          <span className="font-semibold text-ink">
            {paid.length} registered
          </span>
          {owed ? (
            <span className="text-muted">{money(owed, currency)} taken</span>
          ) : null}
          {rows.length > paid.length ? (
            <span className="text-amber-700">
              {rows.length - paid.length} not confirmed by the bank
            </span>
          ) : null}
        </div>

        <DataTable
          caption={"Everybody who has registered for this Live Class"}
          head={
            <>
              <th scope="col">Name</th>
              <th scope="col">Email</th>
              <th scope="col">Phone</th>
              <th scope="col">Paid</th>
              <th scope="col">When</th>
              <th scope="col">Status</th>
            </>
          }
        >
          {rows.length ? rows.map((r) => (
            <tr key={r.id}>
              <td className="font-semibold text-ink">{r.name}</td>
              <td>
                {/* A mailto, because the entire point of this list is that
                    somebody has to get in touch. */}
                {r.email
                  ? <a href={'mailto:' + r.email} className="text-brand-700 hover:underline">
                    {r.email}
                  </a>
                  : <span className="text-muted">—</span>}
              </td>
              <td>
                {r.phone
                  ? <a href={'tel:' + r.phone} className="text-brand-700 hover:underline">
                    {r.phone}
                  </a>
                  : <span className="text-muted">Not given</span>}
              </td>
              <td className="tabular-nums">{money(r.amount_minor, r.currency)}</td>
              <td className="whitespace-nowrap">{when(r.created_at)}</td>
              <td>
                <Pill tone={STATUS[r.status]?.tone ?? 'neutral'}>
                  {STATUS[r.status]?.label ?? r.status}
                </Pill>
              </td>
            </tr>
          )) : (
            <EmptyRow colSpan={6} icon="users">
              Nobody has registered for this yet. It appears here the moment somebody does.
            </EmptyRow>
          )}
        </DataTable>
      </Card>
    </section>
  );
}
