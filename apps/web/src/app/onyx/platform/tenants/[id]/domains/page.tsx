import type { Metadata } from 'next';
import { requirePlatformSession } from '@/lib/onyx-platform-session';
import { attempt, SCROLLER, RosterHeader, Unavailable, money } from '@/lib/onyx-platform-tenant';
import {
  CreateDomainForm, DomainRowActions, type ConsoleDomain,
} from '@/components/onyx-platform-forms';
import { DataTable, EmptyRow, State } from '@/components/onyx-ui';

export const metadata: Metadata = { title: 'Live Classes' };

/**
 * Live Classes, from the platform console.
 *
 * The institution side has had these since domains shipped. The console had no
 * route to any of them and no menu entry, so an operator standing an
 * institution up had to sign in AS that institution to add one -- which is
 * exactly the thing a platform console exists to avoid.
 *
 * Drafts are shown alongside published ones, and said to be drafts. The
 * learner-facing list hides them, which is right there and wrong here: an
 * operator asking "what has this institution got" needs the answer to include
 * the half-finished.
 */
export default async function OnyxPlatformDomainsPage(
  { params }: { params: Promise<{ id: string }> },
) {
  await requirePlatformSession();
  const { id } = await params;
  const tenantId = Number(id);
  const domains = await attempt<ConsoleDomain[]>(
    '/api/onyx/platform/tenants/' + encodeURIComponent(id) + '/domains');
  const rows = domains ?? [];

  return (
    <div className="min-w-0 space-y-4">
      <RosterHeader
        count={rows.length} noun="Live Class"
        action={<CreateDomainForm tenantId={tenantId} />}
      />

      {domains === null ? <Unavailable what="Live Classes" /> : (
        <div tabIndex={0} role="region" aria-label="Live Classes" className={SCROLLER}>
          <DataTable
            caption="Live Classes this institution offers, with what each costs and whether learners can see it."
            head={
              <>
                <th scope="col">Live Class</th>
                <th scope="col">Duration</th>
                <th scope="col">Certificate</th>
                <th scope="col">Price</th>
                <th scope="col">Visible</th>
                <th scope="col">&nbsp;</th>
              </>
            }
          >
            {rows.length === 0 ? (
              <EmptyRow colSpan={6} icon="video">
                No Live Classes yet. These are the cohort-based programmes an institution
                runs alongside its courses — each with its own curriculum, duration and price.
              </EmptyRow>
            ) : rows.map((d) => (
              <tr key={d.id} className="align-top">
                <td>
                  <div className="font-semibold">{d.title}</div>
                  {d.summary ? (
                    <div className="mt-0.5 line-clamp-2 text-[12.5px] text-muted">{d.summary}</div>
                  ) : null}
                </td>
                <td className="text-[13px]">
                  {d.duration_label || <span className="text-muted">—</span>}
                </td>
                <td className="text-[13px]">
                  {d.certificate || <span className="text-muted">None</span>}
                </td>
                <td className="tabular-nums">
                  {d.price_minor ? money(d.price_minor, d.currency) : 'Free'}
                </td>
                <td>
                  {d.status === 1
                    ? <State tone="on">Published</State>
                    : <State tone="idle">Draft</State>}
                </td>
                <td className="text-right">
                  <DomainRowActions tenantId={tenantId} domain={d} />
                </td>
              </tr>
            ))}
          </DataTable>
        </div>
      )}
    </div>
  );
}
