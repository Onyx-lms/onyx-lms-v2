import Link from 'next/link';
import type { Metadata } from 'next';
import { OnyxPlatformShell } from '@/components/onyx-platform-shell';
import { requirePlatformSession, platformApi } from '@/lib/onyx-platform-session';
import {
  ActionLink, DataTable, EmptyRow, StatTile, StatusDot,
} from '@/components/onyx-ui';

export const metadata: Metadata = { title: 'Institutions' };

interface TenantRow {
  id: number; name: string; slug: string; status: number; plan: string | null;
  member_count: number; created_at: string;
}

/** Every institution on the platform, in one place -- what a tenant token can never show. */
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

  const [tenants, allTenants] = await Promise.all([
    platformApi<TenantRow[]>('/api/onyx/platform/tenants' + suffix),
    // Unfiltered, for the header stats and the plan-filter options -- a
    // filtered view should not make "12 institutions" read as the whole
    // platform when it is a search result.
    suffix ? platformApi<TenantRow[]>('/api/onyx/platform/tenants') : null,
  ]);
  const headline = allTenants ?? tenants;
  const suspended = headline.filter((t) => t.status !== 1).length;
  const members = headline.reduce((sum, t) => sum + Number(t.member_count), 0);
  const plans = [...new Set(headline.map((t) => t.plan).filter((p): p is string => Boolean(p)))].sort();
  const filtered = Boolean(q.search || q.status || q.plan);

  return (
    <OnyxPlatformShell
      email={session.email}
      title="Institutions"
      subtitle={headline.length === 1
        ? 'One institution on the platform.'
        : headline.length + ' institutions on the platform.'}
    >
      <div className="space-y-6">
        {/* Three numbers an operator checks before anything else: how many
            institutions there are, how many are switched off, and how many
            people are on the platform at all. Always the platform-wide
            totals, even while a filter narrows the table below. */}
        <div className="grid gap-3 sm:grid-cols-3">
          <StatTile label="Institutions" value={headline.length} />
          <StatTile label="Suspended" value={suspended}
            note={suspended ? 'not able to sign in' : 'all active'} />
          <StatTile label="Members" value={members} note="across every institution" />
        </div>

        {/* A GET form: the filter lives in the URL, so it survives a reload
            and can be linked to, and the page stays a server component. */}
        <form method="get"
          className="flex flex-wrap items-end gap-3 rounded-2xl border border-line bg-white p-3.5">
          <div className="min-w-[200px] flex-1">
            <label className="block text-[13px] font-semibold text-slate-700" htmlFor="pf-search">
              Search
            </label>
            <input id="pf-search" name="search" defaultValue={q.search ?? ''}
              placeholder="Name or address"
              className="mt-1 block min-h-[42px] w-full rounded-xl border border-line bg-white
                         px-3 text-[14px] focus:border-slate-500 focus:outline-none
                         focus:ring-2 focus:ring-ink/20" />
          </div>
          <div>
            <label className="block text-[13px] font-semibold text-slate-700" htmlFor="pf-status">
              Status
            </label>
            <select id="pf-status" name="status" defaultValue={q.status ?? ''}
              className="mt-1 block min-h-[42px] rounded-xl border border-line bg-white px-3
                         text-[14px] focus:border-slate-500 focus:outline-none
                         focus:ring-2 focus:ring-ink/20">
              <option value="">Any status</option>
              <option value="1">Active</option>
              <option value="0">Suspended</option>
            </select>
          </div>
          {plans.length > 0 ? (
            <div>
              <label className="block text-[13px] font-semibold text-slate-700" htmlFor="pf-plan">
                Plan
              </label>
              <select id="pf-plan" name="plan" defaultValue={q.plan ?? ''}
                className="mt-1 block min-h-[42px] rounded-xl border border-line bg-white px-3
                           text-[14px] focus:border-slate-500 focus:outline-none
                           focus:ring-2 focus:ring-ink/20">
                <option value="">Any plan</option>
                {plans.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
          ) : null}
          <button type="submit"
            className="min-h-[42px] rounded-xl bg-brand-600 px-4 text-[14px] font-bold text-white
                       hover:bg-brand-700">
            Filter
          </button>
          {filtered ? (
            <Link href="/onyx/platform"
              className="min-h-[42px] px-1 text-[13px] font-semibold text-muted
                         hover:text-brand-700 hover:underline inline-flex items-center">
              Clear
            </Link>
          ) : null}
        </form>

        {filtered ? (
          <p className="text-[13px] text-muted">
            Showing {tenants.length} of {headline.length} institution{headline.length === 1 ? '' : 's'}.
          </p>
        ) : null}

        <div tabIndex={0} role="region" aria-label="Institutions">
          <DataTable
            caption="Every institution on the platform"
            head={
              <>
                <th scope="col">Institution</th>
                <th scope="col">Address</th>
                <th scope="col">Plan</th>
                <th scope="col">Members</th>
                <th scope="col">Created</th>
                <th scope="col">Status</th>
                <th scope="col"><span className="sr-only">Open</span></th>
              </>
            }
          >
            {tenants.map((t) => (
              <tr key={t.id} className={t.status === 1 ? undefined : 'bg-red-50/40'}>
                <td>
                  <Link href={'/onyx/platform/tenants/' + t.id}
                    className="font-semibold hover:underline">
                    {t.name}
                  </Link>
                </td>
                <td className="font-mono text-[12.5px] text-muted">{t.slug}</td>
                <td className="text-[13px]">
                  {t.plan ?? <span className="text-muted">—</span>}
                </td>
                <td className="tabular-nums">{t.member_count}</td>
                <td className="whitespace-nowrap text-muted">
                  {new Date(t.created_at).toLocaleDateString(undefined,
                    { day: 'numeric', month: 'short', year: 'numeric' })}
                </td>
                <td><StatusDot on={t.status === 1} /></td>
                <td className="text-right">
                  <ActionLink href={'/onyx/platform/tenants/' + t.id} label="Open" tone="quiet" />
                </td>
              </tr>
            ))}
            {tenants.length === 0 ? (
              <EmptyRow colSpan={7} icon="building">
                {filtered
                  ? 'Nothing matches that filter.'
                  : 'No institutions yet. Creating one seeds its roles and its first administrator.'}
              </EmptyRow>
            ) : null}
          </DataTable>
        </div>
      </div>
    </OnyxPlatformShell>
  );
}
