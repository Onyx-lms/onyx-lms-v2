import type { Metadata } from 'next';
import { requireRole, apiAuthSafe } from '@/lib/session';
import { apiSafe, type SiteSettings } from '@/lib/api';
import { DashboardShell } from '@/components/dashboard-shell';
import { INSTRUCTOR_NAV, ADMIN_NAV } from '@/lib/nav';
import { PayoutRequest, type Balance, type PayoutRow } from '@/components/payout-panel';
import { RevenueTable, type Totals } from '@/components/revenue-table';

export const metadata: Metadata = { title: 'Earnings' };
export const dynamic = 'force-dynamic';

/** REV-02 / REV-04 / REV-05 -- what I earned, and getting paid for it. */
export default async function InstructorPayouts() {
  const session = await requireRole('instructor', 'admin');
  const [payouts, revenue, settings] = await Promise.all([
    apiAuthSafe<{ balance: Balance; requests: PayoutRow[] }>('/api/instructor/payouts'),
    apiAuthSafe<{ totals: Totals }>('/api/instructor/revenue'),
    apiSafe<SiteSettings>('/api/settings'),
  ]);
  const position = settings?.currency_position ?? 'left';

  return (
    <DashboardShell role={session.app_role} email={session.email}
      nav={session.app_role === 'admin' ? ADMIN_NAV : INSTRUCTOR_NAV} title="Earnings">
      {revenue && (
        <section className="mb-6">
          <h2 className="mb-3 text-sm font-semibold">Where it came from</h2>
          <RevenueTable totals={revenue.totals} position={position} showAdmin={false} />
        </section>
      )}
      {payouts && (
        <PayoutRequest balance={payouts.balance} requests={payouts.requests} />
      )}
    </DashboardShell>
  );
}
