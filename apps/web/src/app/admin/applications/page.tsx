import Link from 'next/link';
import type { Metadata } from 'next';
import { requireRole, apiAuthSafe } from '@/lib/session';
import { DashboardShell } from '@/components/dashboard-shell';
import { ADMIN_NAV } from '@/lib/nav';
import { ApplicationQueue, type Application } from '@/components/admin-lists';

export const metadata: Metadata = { title: 'Instructor applications' };
export const dynamic = 'force-dynamic';

/** SET-09 -- review who wants to teach. */
export default async function AdminApplications(
  { searchParams }: { searchParams: Promise<Record<string, string | undefined>> },
) {
  const session = await requireRole('admin');
  const params = await searchParams;
  const status = params['status'];
  const rows = (await apiAuthSafe<Application[]>(
    '/api/admin/instructor-applications' + (status !== undefined ? '?status=' + status : ''))) ?? [];

  return (
    <DashboardShell role={session.app_role} email={session.email}
      nav={ADMIN_NAV} title="Instructor applications">
      <nav className="mb-4 flex gap-3 text-sm">
        <Link href="/admin/applications?status=0"
          className={status === '0' ? 'font-medium text-brand-700' : 'text-slate-600'}>
          Pending
        </Link>
        <Link href="/admin/applications?status=1"
          className={status === '1' ? 'font-medium text-brand-700' : 'text-slate-600'}>
          Approved
        </Link>
        <Link href="/admin/applications"
          className={status === undefined ? 'font-medium text-brand-700' : 'text-slate-600'}>
          All
        </Link>
      </nav>
      <p className="mb-4 text-sm text-slate-600">
        Approving promotes the applicant to instructor immediately. Turn the form
        off entirely under Settings &rarr; Website.
      </p>
      <ApplicationQueue rows={rows} />
    </DashboardShell>
  );
}
