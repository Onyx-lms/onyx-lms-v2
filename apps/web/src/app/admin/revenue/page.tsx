import type { Metadata } from 'next';
import { requireRole, apiAuthSafe } from '@/lib/session';
import { apiSafe, type SiteSettings } from '@/lib/api';
import { DashboardShell } from '@/components/dashboard-shell';
import { ADMIN_NAV } from '@/lib/nav';
import { RevenueTable, type Totals } from '@/components/revenue-table';

export const metadata: Metadata = { title: 'Revenue' };
export const dynamic = 'force-dynamic';

/** REV-01 -- the platform revenue report, with a date range. */
export default async function AdminRevenue(
  { searchParams }: { searchParams: Promise<Record<string, string | undefined>> },
) {
  const session = await requireRole('admin');
  const params = await searchParams;
  const query = new URLSearchParams();
  if (params['from']) query.set('from', params['from']!);
  if (params['to']) query.set('to', params['to']!);

  const [totals, settings] = await Promise.all([
    apiAuthSafe<Totals>('/api/admin/revenue' + (query.toString() ? '?' + query : '')),
    apiSafe<SiteSettings>('/api/settings'),
  ]);
  const position = settings?.currency_position ?? 'left';

  return (
    <DashboardShell role={session.app_role} email={session.email}
      nav={ADMIN_NAV} title="Revenue">
      <form action="/admin/revenue" className="mb-6 flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-sm font-medium">From</label>
          <input name="from" type="date" defaultValue={params['from'] ?? ''}
            className="mt-1 rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="block text-sm font-medium">To</label>
          <input name="to" type="date" defaultValue={params['to'] ?? ''}
            className="mt-1 rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        </div>
        <button className="btn-primary" type="submit">Apply</button>
      </form>

      {totals ? <RevenueTable totals={totals} position={position} /> : (
        <p className="text-sm text-slate-500">No revenue recorded yet.</p>
      )}
    </DashboardShell>
  );
}
