import type { Metadata } from 'next';
import Link from 'next/link';
import { requireRole, apiAuthSafe } from '@/lib/session';
import { DashboardShell } from '@/components/dashboard-shell';
import { ADMIN_NAV } from '@/lib/nav';
import { PayoutQueue, type PayoutRow } from '@/components/payout-panel';

export const metadata: Metadata = { title: 'Payouts' };
export const dynamic = 'force-dynamic';

/** REV-04 -- the admin payout queue. */
export default async function AdminPayouts(
  { searchParams }: { searchParams: Promise<Record<string, string | undefined>> },
) {
  const session = await requireRole('admin');
  const params = await searchParams;
  const status = params['status'];
  const rows = (await apiAuthSafe<PayoutRow[]>(
    '/api/admin/payouts' + (status !== undefined ? '?status=' + status : ''))) ?? [];

  return (
    <DashboardShell role={session.app_role} email={session.email}
      nav={ADMIN_NAV} title="Payouts">
      <nav className="mb-4 flex gap-3 text-sm">
        <Link href="/admin/payouts?status=0"
          className={status === '0' ? 'font-medium text-brand-700' : 'text-slate-600'}>
          Pending
        </Link>
        <Link href="/admin/payouts?status=1"
          className={status === '1' ? 'font-medium text-brand-700' : 'text-slate-600'}>
          Paid
        </Link>
        <Link href="/admin/payouts"
          className={status === undefined ? 'font-medium text-brand-700' : 'text-slate-600'}>
          All
        </Link>
      </nav>
      <PayoutQueue rows={rows} />
    </DashboardShell>
  );
}
