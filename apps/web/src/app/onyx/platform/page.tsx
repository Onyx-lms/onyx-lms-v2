import Link from 'next/link';
import type { Metadata } from 'next';
import { OnyxPlatformShell } from '@/components/onyx-platform-shell';
import { requirePlatformSession, platformApi } from '@/lib/onyx-platform-session';
import { attempt } from '@/lib/onyx-platform-tenant';
import { CreateTenantForm } from '@/components/onyx-platform-forms';
import { TrendBars } from '@/components/onyx-chart';
import {
  ActionLink, Card, DataTable, EmptyRow, Icon, ListRow, RowList, SectionHead,
  StatTile, StatusDot, Pill,
} from '@/components/onyx-ui';

export const metadata: Metadata = { title: 'Overview' };

interface TenantRow {
  id: number; name: string; slug: string; status: number; plan: string | null;
  member_count: number; created_at: string;
}
interface PlatformAuditRow {
  id: number; action: string; entity_type: string; entity_id: number | null;
  created_at: string; after: Record<string, unknown> | null;
  actor: { name: string; email: string } | null;
}

/** Initials, so a list of institutions reads as places rather than as rows. */
function Monogram({ name }: { name: string }) {
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2)
    .map((w) => w[0]!.toUpperCase()).join('');
  return (
    <span aria-hidden="true"
      className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-gradient-to-br
                 from-brand-500 to-brand-700 text-[11px] font-bold text-white">
      {initials}
    </span>
  );
}

/**
 * The operator's home.
 *
 * This was a filter form and a table called "Institutions" -- a directory, not
 * a console. It answered "which institutions exist" and nothing else: not
 * whether the platform is growing, not what anybody did today, not which
 * customer is the one to look at. An operator opening it in the morning had no
 * reason to stay on the page for more than the second it took to click through
 * to a tenant.
 *
 * It is now shaped like the thing it is: the platform in four numbers, the
 * shape of its growth, what has just happened, and then the directory --
 * with its search kept, because on a platform with a hundred customers that
 * table is still how you find one.
 *
 * Every figure comes from reads that already existed. Nothing here is
 * estimated, and where a number would need history this product does not keep,
 * it is not shown at all.
 */
export default async function OnyxPlatformPage(
  { searchParams }: { searchParams: Promise<{ search?: string; status?: string; plan?: string }> },
) {
  const session = await requirePlatformSession();
  const q = await searchParams;
  const qs = new URLSearchParams();
  if (q.search) qs.set('search', q.search);
  if (q.status) qs.set('status', q.status);
  if (q.plan) qs.set('plan', q.plan);
  const suffix = qs.toString() ? '?' + qs.toString() : '';

  const [tenants, allTenants, audit, admins] = await Promise.all([
    platformApi<TenantRow[]>('/api/onyx/platform/tenants' + suffix),
    // Unfiltered, for the header stats and the plan-filter options -- a
    // filtered view should not make "12 institutions" read as the whole
    // platform when it is a search result.
    suffix ? platformApi<TenantRow[]>('/api/onyx/platform/tenants') : null,
    // Safe rather than fatal: the console's whole job is looking at customers,
    // and losing that because an activity rail 500'd would be the wrong trade.
    attempt<PlatformAuditRow[]>('/api/onyx/platform/audit?limit=8'),
    attempt<{ id: number }[]>('/api/onyx/platform/admins'),
  ]);
  const headline = allTenants ?? tenants;
  const suspended = headline.filter((t) => t.status !== 1).length;
  const members = headline.reduce((sum, t) => sum + Number(t.member_count), 0);
  const plans = [...new Set(headline.map((t) => t.plan).filter((p): p is string => Boolean(p)))].sort();
  const filtered = Boolean(q.search || q.status || q.plan);

  /**
   * Institutions created per month, six months back.
   *
   * `created_at` is on every row of the list already read above, so this costs
   * nothing extra -- and it is the one genuine time series the platform has.
   * A month with none is drawn as a zero rather than skipped, because a gap in
   * a growth chart is information.
   */
  const now = new Date();
  const months: { key: string; label: string; full: string; value: number }[] = [];
  for (let back = 5; back >= 0; back -= 1) {
    const d = new Date(now.getFullYear(), now.getMonth() - back, 1);
    months.push({
      key: d.getFullYear() + '-' + d.getMonth(),
      label: d.toLocaleDateString(undefined, { month: 'short' }),
      full: d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }),
      value: 0,
    });
  }
  const monthAt = new Map(months.map((m) => [m.key, m]));
  for (const t of headline) {
    const d = new Date(t.created_at);
    const slot = monthAt.get(d.getFullYear() + '-' + d.getMonth());
    if (slot) slot.value += 1;
  }
  const newestFirst = [...headline]
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  const addedThisMonth = months[months.length - 1]!.value;
  const biggest = [...headline].sort((a, b) => b.member_count - a.member_count).slice(0, 4);

  return (
    <OnyxPlatformShell
      email={session.email}
      title="Platform overview"
      subtitle={new Date().toLocaleDateString(undefined,
        { weekday: 'long', day: 'numeric', month: 'long' })
        + ' · ' + headline.length + (headline.length === 1 ? ' institution' : ' institutions')
        + ' served'}
      action={<div className="w-full sm:w-auto"><CreateTenantForm /></div>}
    >
      <div className="space-y-6">
        {/* Four numbers about four different things -- how many customers,
            how many are switched off, how many people they carry between them,
            and whether the platform grew this month. Always platform-wide,
            even while the filter below narrows the table. */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatTile label="Institutions" value={headline.length}
            delta={addedThisMonth || undefined}
            note={addedThisMonth ? 'added this month' : 'none added this month'} />
          <StatTile label="Members" value={members} note="across every institution" />
          <StatTile label="Suspended" value={suspended}
            note={suspended ? 'nobody there can sign in' : 'all active'} />
          <StatTile label="Operators" value={admins?.length ?? '—'}
            note="platform admins with full reach" />
        </div>

        <div className="grid gap-5 xl:grid-cols-[minmax(0,1.5fr)_minmax(300px,1fr)] xl:items-start">
          <div className="min-w-0 space-y-5">
            <section>
              <SectionHead title="Institutions created" />
              <Card className="p-4">
                <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
                  <div className="text-[22px] font-extrabold leading-none tabular-nums">
                    {months.reduce((n, m) => n + m.value, 0)}
                    <span className="ml-1.5 text-[13px] font-semibold text-muted">
                      in the last 6 months
                    </span>
                  </div>
                  <div className="text-[12.5px] text-muted">
                    {headline.length} on the platform in total
                  </div>
                </div>
                <TrendBars points={months} title="Institutions created per month"
                  unit="institution" />
              </Card>
            </section>

            {/* The directory. Kept, because finding one customer among many is
                what an operator does here more than anything else -- but the
                filter is now one line above the table instead of a boxed form
                between the numbers and the data, and the action that adds a
                row sits on the table it adds to. */}
            <section>
              <div className="mb-2.5 flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-[11.5px] font-bold uppercase tracking-[.085em] text-muted">
                  Every institution
                </h2>
                {filtered ? (
                  <p className="text-[12.5px] text-muted">
                    Showing {tenants.length} of {headline.length}
                  </p>
                ) : null}
              </div>

              {/* A GET form: the filter lives in the URL, so it survives a
                  reload and can be linked to, and the page stays a server
                  component. */}
              <form method="get" className="mb-3 flex flex-wrap items-center gap-2">
                <label className="sr-only" htmlFor="pf-search">Search institutions</label>
                <div className="relative min-w-[220px] flex-1">
                  <Icon name="search"
                    className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2
                               text-faint" />
                  <input id="pf-search" name="search" defaultValue={q.search ?? ''}
                    placeholder="Search by name or address"
                    className="block min-h-[40px] w-full rounded-xl border border-line bg-white
                               pl-9 pr-3 text-[14px] focus:border-slate-500 focus:outline-none
                               focus:ring-2 focus:ring-ink/20" />
                </div>
                <label className="sr-only" htmlFor="pf-status">Status</label>
                <select id="pf-status" name="status" defaultValue={q.status ?? ''}
                  className="min-h-[40px] rounded-xl border border-line bg-white px-3 text-[14px]
                             focus:border-slate-500 focus:outline-none focus:ring-2
                             focus:ring-ink/20">
                  <option value="">Any status</option>
                  <option value="1">Active</option>
                  <option value="0">Suspended</option>
                </select>
                {plans.length > 0 ? (
                  <>
                    <label className="sr-only" htmlFor="pf-plan">Plan</label>
                    <select id="pf-plan" name="plan" defaultValue={q.plan ?? ''}
                      className="min-h-[40px] rounded-xl border border-line bg-white px-3
                                 text-[14px] focus:border-slate-500 focus:outline-none
                                 focus:ring-2 focus:ring-ink/20">
                      <option value="">Any plan</option>
                      {plans.map((p) => <option key={p} value={p}>{p}</option>)}
                    </select>
                  </>
                ) : null}
                <button type="submit"
                  className="min-h-[40px] rounded-xl border border-line bg-white px-4 text-[14px]
                             font-bold hover:border-brand-300 hover:text-brand-700">
                  Filter
                </button>
                {filtered ? (
                  <Link href="/onyx/platform"
                    className="inline-flex min-h-[40px] items-center px-1 text-[13px] font-semibold
                               text-muted hover:text-brand-700 hover:underline">
                    Clear
                  </Link>
                ) : null}
              </form>

              <div tabIndex={0} role="region" aria-label="Institutions">
                <DataTable
                  caption="Every institution on the platform"
                  head={
                    <>
                      <th scope="col">Institution</th>
                      <th scope="col" className="hidden sm:table-cell">Plan</th>
                      <th scope="col">Members</th>
                      <th scope="col" className="hidden sm:table-cell">Created</th>
                      <th scope="col">Status</th>
                      <th scope="col"><span className="sr-only">Open</span></th>
                    </>
                  }
                >
                  {tenants.map((t) => (
                    <tr key={t.id} className={t.status === 1 ? undefined : 'bg-red-50/40'}>
                      <td>
                        <span className="flex items-center gap-2.5">
                          <Monogram name={t.name} />
                          <span className="min-w-0">
                            <Link href={'/onyx/platform/tenants/' + t.id}
                              className="block truncate font-semibold hover:underline">
                              {t.name}
                            </Link>
                            <span className="block truncate font-mono text-[12px] text-muted">
                              {t.slug}
                            </span>
                          </span>
                        </span>
                      </td>
                      <td className="hidden text-[13px] sm:table-cell">
                        {t.plan
                          ? <Pill tone="neutral">{t.plan}</Pill>
                          : <span className="text-muted">—</span>}
                      </td>
                      <td className="tabular-nums">{t.member_count}</td>
                      <td className="hidden whitespace-nowrap text-muted sm:table-cell">
                        {new Date(t.created_at).toLocaleDateString(undefined,
                          { day: 'numeric', month: 'short', year: 'numeric' })}
                      </td>
                      <td><StatusDot on={t.status === 1} /></td>
                      <td className="text-right">
                        <ActionLink href={'/onyx/platform/tenants/' + t.id} label="Open"
                          tone="quiet" />
                      </td>
                    </tr>
                  ))}
                  {tenants.length === 0 ? (
                    <EmptyRow colSpan={6} icon="building">
                      {filtered
                        ? 'Nothing matches that filter.'
                        : 'No institutions yet. Creating one seeds its roles and its first administrator.'}
                    </EmptyRow>
                  ) : null}
                </DataTable>
              </div>
            </section>
          </div>

          {/* ------------------------------ right rail ------------------------------ */}
          <div className="min-w-0 space-y-5">
            <section>
              <SectionHead title="Recent activity"
                action={{ href: '/onyx/platform/audit', label: 'Full log' }} />
              {(audit ?? []).length ? (
                <RowList label="What has happened on the platform">
                  {(audit ?? []).map((row) => {
                    const [noun, verb] = row.action.split('.');
                    const name = typeof row.after?.name === 'string' ? row.after.name : null;
                    return (
                      <ListRow
                        key={row.id}
                        icon={noun === 'tenant' ? 'building' : noun === 'admin' ? 'shield' : 'flag'}
                        tone={verb === 'suspended' || verb === 'deleted' ? 'late' : 'brand'}
                        title={(verb ?? 'changed').replace(/_/g, ' ') + ' '
                          + (name ?? (noun ?? row.entity_type))}
                        meta={(row.actor?.name ?? 'The system') + ' · '
                          + new Date(row.created_at).toLocaleString(undefined,
                            { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                      />
                    );
                  })}
                </RowList>
              ) : (
                <Card className="p-4 text-[13px] text-muted">
                  Nothing has been recorded yet.
                </Card>
              )}
            </section>

            {/* Two short lists rather than two more tables: newest tells an
                operator who has just arrived and may need looking after, and
                largest tells them where the load actually is. Both are read
                off the list already fetched. */}
            <section>
              <SectionHead title="Newest institutions" />
              <RowList label="Most recently created institutions">
                {newestFirst.slice(0, 4).map((t) => (
                  <ListRow
                    key={t.id}
                    icon="building"
                    tone="neutral"
                    href={'/onyx/platform/tenants/' + t.id}
                    title={t.name}
                    meta={new Date(t.created_at).toLocaleDateString(undefined,
                      { day: 'numeric', month: 'short', year: 'numeric' })}
                    trailing={<span className="text-[13px] font-bold tabular-nums">
                      {t.member_count}
                    </span>}
                  />
                ))}
              </RowList>
            </section>

            <section>
              <SectionHead title="Largest institutions" />
              <RowList label="Institutions by member count">
                {biggest.map((t) => (
                  <ListRow
                    key={t.id}
                    icon="users"
                    tone="neutral"
                    href={'/onyx/platform/tenants/' + t.id}
                    title={t.name}
                    meta={t.plan ? 'plan: ' + t.plan : 'no plan set'}
                    trailing={<span className="text-[13px] font-bold tabular-nums">
                      {t.member_count}
                    </span>}
                  />
                ))}
              </RowList>
            </section>
          </div>
        </div>
      </div>
    </OnyxPlatformShell>
  );
}
