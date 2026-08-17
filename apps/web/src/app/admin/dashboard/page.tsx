import Link from 'next/link';
import type { Metadata } from 'next';
import { requireRole, apiAuthSafe } from '@/lib/session';
import { DashboardShell } from '@/components/dashboard-shell';
import { ADMIN_NAV } from '@/lib/nav';
import { StatTile } from '@/components/stat-tile';
import { apiSafe, type SiteSettings } from '@/lib/api';
import { currency } from '@/lib/format';
import { RevenueChart, RevenueTable, type Totals } from '@/components/revenue-table';

export const metadata: Metadata = { title: 'Admin dashboard' };
export const dynamic = 'force-dynamic';

interface Paged<T> { data: T[]; total: number }

export default async function AdminDashboard() {
  const session = await requireRole('admin');
  const [admins, instructors, students, courses, approvals, money, settings] = await Promise.all([
    apiAuthSafe<Paged<unknown>>('/api/admin/users?role=admin&per_page=1'),
    apiAuthSafe<Paged<unknown>>('/api/admin/users?role=instructor&per_page=1'),
    apiAuthSafe<Paged<unknown>>('/api/admin/users?role=student&per_page=1'),
    apiAuthSafe<Paged<unknown>>('/api/authoring/courses?per_page=1'),
    apiAuthSafe<Paged<unknown>>('/api/admin/course-approvals?per_page=1'),
    // REV-06: revenue tiles and the 12-month chart.
    apiAuthSafe<{ totals: Totals; months: { month: string; gross: number }[];
                  counts: { users: number; courses: number; enrolments: number } }>(
      '/api/admin/dashboard'),
    apiSafe<SiteSettings>('/api/settings'),
  ]);
  const position = settings?.currency_position ?? 'left';

  return (
    <DashboardShell role={session.app_role} email={session.email} nav={ADMIN_NAV} title="Dashboard">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Students" value={students?.total ?? 0} />
        <StatTile label="Instructors" value={instructors?.total ?? 0} />
        <StatTile label="Administrators" value={admins?.total ?? 0} />
        <StatTile label="Courses" value={courses?.total ?? 0} />
      </div>

      {money && (
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile label="Enrolments" value={money.counts.enrolments} />
          <StatTile label="Sales" value={money.totals.sales} />
          <StatTile label="Gross revenue" value={currency(money.totals.gross, position)} />
          <StatTile label="Platform share" value={currency(money.totals.admin, position)} />
        </div>
      )}

      {money && money.totals.sales > 0 && (
        <section className="mt-8">
          <h2 className="text-sm font-semibold">Revenue, last 12 months</h2>
          <div className="card mt-3 p-4">
            <RevenueChart months={money.months} position={position} />
          </div>
          <div className="card mt-4 p-4">
            <RevenueTable totals={money.totals} position={position} />
          </div>
        </section>
      )}

      {(approvals?.total ?? 0) > 0 && (
        <div className="mt-6 rounded-lg border border-amber-200 bg-amber-50 p-4">
          <p className="text-sm text-amber-900">
            {approvals!.total} course{approvals!.total === 1 ? '' : 's'} waiting for approval.
          </p>
          <Link href="/admin/approvals" className="mt-2 inline-block text-sm text-amber-900 underline">
            Review now
          </Link>
        </div>
      )}

      <div className="mt-8 grid gap-4 sm:grid-cols-3">
        <Link href="/admin/users" className="card p-5 hover:border-brand-300">
          <div className="font-medium">Manage users</div>
          <p className="mt-1 text-sm text-slate-600">Create and edit admins, instructors and students.</p>
        </Link>
        <Link href="/admin/courses" className="card p-5 hover:border-brand-300">
          <div className="font-medium">Manage courses</div>
          <p className="mt-1 text-sm text-slate-600">Every course on the platform.</p>
        </Link>
        <Link href="/admin/approvals" className="card p-5 hover:border-brand-300">
          <div className="font-medium">Course approvals</div>
          <p className="mt-1 text-sm text-slate-600">Publish or reject submitted courses.</p>
        </Link>
      </div>
    </DashboardShell>
  );
}
