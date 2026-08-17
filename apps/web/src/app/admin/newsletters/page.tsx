import type { Metadata } from 'next';
import { requireRole, apiAuthSafe } from '@/lib/session';
import { DashboardShell } from '@/components/dashboard-shell';
import { ADMIN_NAV } from '@/lib/nav';
import { NewsletterPanel, type Campaign, type Subscriber } from '@/components/admin-lists';

export const metadata: Metadata = { title: 'Newsletters' };
export const dynamic = 'force-dynamic';

/** SET-07 -- campaigns and subscribers. */
export default async function AdminNewsletters() {
  const session = await requireRole('admin');
  const data = await apiAuthSafe<{ campaigns: Campaign[]; subscribers: Subscriber[] }>(
    '/api/admin/newsletters');

  return (
    <DashboardShell role={session.app_role} email={session.email}
      nav={ADMIN_NAV} title="Newsletters">
      <p className="mb-4 max-w-2xl text-sm text-slate-600">
        Sending goes out in batches and reports how many landed. One address that
        bounces does not stop the rest of the run.
      </p>
      <NewsletterPanel campaigns={data?.campaigns ?? []} subscribers={data?.subscribers ?? []} />
    </DashboardShell>
  );
}
