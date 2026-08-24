import Link from 'next/link';
import type { Metadata } from 'next';
import { requirePlatformSession } from '@/lib/onyx-platform-session';
import {
  attempt, SCROLLER, Unavailable, money, ago,
} from '@/lib/onyx-platform-tenant';
import { Card, DataTable, EmptyRow, Icon, Pill, SectionHead, State } from '@/components/onyx-ui';

export const metadata: Metadata = { title: 'Live Class' };

interface Registration {
  id: number; user_id: string | null; name: string | null; email: string | null;
  phone: string | null; amount_minor: number; currency: string; gateway: string | null;
  reference: string | null; status: string; created_at: string;
  student: { name: string; email: string } | null;
}
interface DomainDetail {
  domain: {
    id: number; title: string; summary: string; curriculum_url: string;
    certificate: string; duration_label: string; price_minor: number;
    currency: string; status: number;
  };
  registrations: Registration[];
  summary: { total: number; paid: number; taken_minor: number };
}

/** Paid reads as paid; anything else is said in its own words rather than as green. */
const TONE: Record<string, 'good' | 'late' | 'neutral'> = {
  paid: 'good', captured: 'good', pending: 'late', failed: 'late',
};

/**
 * One Live Class, and who signed up.
 *
 * The console listed a Live Class and could not say who had registered for it,
 * which is the only question anybody opens the row to ask.
 */
export default async function OnyxPlatformDomainPage(
  { params }: { params: Promise<{ id: string; domainId: string }> },
) {
  await requirePlatformSession();
  const { id, domainId } = await params;
  const tenantId = Number(id);
  const data = await attempt<DomainDetail>(
    '/api/onyx/platform/tenants/' + encodeURIComponent(id)
    + '/domains/' + encodeURIComponent(domainId));

  if (data === null) return <Unavailable what="Live Class" />;
  const { domain, registrations, summary } = data;

  return (
    <div className="min-w-0 space-y-5">
      <Link href={'/onyx/platform/tenants/' + tenantId + '/domains'}
        className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-brand-700
                   hover:underline">
        <Icon name="chevron" className="h-4 w-4 rotate-180" />
        All Live Classes
      </Link>

      <Card className="p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-[19px] font-bold text-ink">{domain.title}</h2>
            {domain.summary ? (
              <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-muted">
                {domain.summary}
              </p>
            ) : null}
            <div className="mt-2 flex flex-wrap items-center gap-2 text-[12.5px] text-muted">
              {domain.duration_label ? <span>{domain.duration_label}</span> : null}
              {domain.certificate ? <><span>·</span><span>{domain.certificate}</span></> : null}
              <span>·</span>
              <span className="tabular-nums">
                {domain.price_minor ? money(domain.price_minor, domain.currency) : 'Free'}
              </span>
            </div>
          </div>
          {domain.status === 1
            ? <State tone="on">Published</State>
            : <State tone="idle">Draft</State>}
        </div>
        {domain.curriculum_url ? (
          <a href={domain.curriculum_url} target="_blank" rel="noopener noreferrer"
            className="mt-3 inline-flex items-center gap-1.5 text-[13px] font-semibold
                       text-brand-700 hover:underline">
            <Icon name="external" className="h-4 w-4" />
            The curriculum
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
        ) : null}
      </Card>

      <div className="grid gap-3 sm:grid-cols-3">
        <Card className="p-3.5">
          <div className="text-[22px] font-bold tabular-nums">{summary.total}</div>
          <div className="text-[12.5px] text-muted">registered</div>
        </Card>
        <Card className="p-3.5">
          <div className="text-[22px] font-bold tabular-nums">{summary.paid}</div>
          <div className="text-[12.5px] text-muted">of them paid</div>
        </Card>
        <Card className="p-3.5">
          <div className="text-[22px] font-bold tabular-nums">
            {money(summary.taken_minor, domain.currency)}
          </div>
          <div className="text-[12.5px] text-muted">taken</div>
        </Card>
      </div>

      <section>
        <SectionHead title="Who registered" />
        <div tabIndex={0} role="region" aria-label="Registrations" className={SCROLLER}>
          <DataTable
            caption="Everyone who signed up for this Live Class, what they paid and how."
            head={
              <>
                <th scope="col">Person</th>
                <th scope="col">Contact</th>
                <th scope="col">Paid</th>
                <th scope="col">How</th>
                <th scope="col">State</th>
                <th scope="col">When</th>
              </>
            }
          >
            {registrations.length === 0 ? (
              <EmptyRow colSpan={6} icon="users">
                Nobody has registered yet.
              </EmptyRow>
            ) : registrations.map((r) => (
              <tr key={r.id} className="align-top">
                <td>
                  {/* The name they registered under, which is not always the
                      name on their account -- somebody registering a colleague
                      is a real thing, and showing only the account would hide
                      it. */}
                  <div className="font-semibold">{r.name ?? r.student?.name ?? 'Unknown'}</div>
                  {r.student && r.student.name !== r.name ? (
                    <div className="text-[12px] text-muted">account: {r.student.name}</div>
                  ) : null}
                </td>
                <td className="text-[12.5px]">
                  <div className="break-all">{r.email ?? r.student?.email ?? '—'}</div>
                  {r.phone ? <div className="text-muted">{r.phone}</div> : null}
                </td>
                <td className="tabular-nums">
                  {r.amount_minor ? money(r.amount_minor, r.currency) : 'Free'}
                </td>
                <td className="text-[12.5px] text-muted">{r.gateway ?? '—'}</td>
                <td><Pill tone={TONE[r.status] ?? 'neutral'}>{r.status}</Pill></td>
                <td className="whitespace-nowrap text-[12.5px] text-muted">
                  {ago(r.created_at)}
                </td>
              </tr>
            ))}
          </DataTable>
        </div>
      </section>
    </div>
  );
}
