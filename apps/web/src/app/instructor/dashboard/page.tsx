import Link from 'next/link';
import type { Metadata } from 'next';
import { requireRole, apiAuthSafe } from '@/lib/session';
import { DashboardShell } from '@/components/dashboard-shell';
import { INSTRUCTOR_NAV } from '@/lib/nav';
import { StatTile } from '@/components/stat-tile';
import { apiSafe, type SiteSettings } from '@/lib/api';
import { currency } from '@/lib/format';
import { RevenueChart, RevenueTable, type Totals } from '@/components/revenue-table';
import type { Balance } from '@/components/payout-panel';

export const metadata: Metadata = { title: 'Instructor dashboard' };
export const dynamic = 'force-dynamic';

interface Paged<T> { data: T[]; total: number }
interface Course { id: number; title: string | null; slug: string | null; status: string | null }

export default async function InstructorDashboard() {
  const session = await requireRole('instructor', 'admin');
  // REV-07: courses plus the four revenue streams and the payout balance.
  const [courses, money, settings] = await Promise.all([
    apiAuthSafe<Paged<Course>>('/api/authoring/courses?per_page=100'),
    apiAuthSafe<{ totals: Totals; months: { month: string; gross: number }[]; balance: Balance }>(
      '/api/instructor/revenue'),
    apiSafe<SiteSettings>('/api/settings'),
  ]);
  const position = settings?.currency_position ?? 'left';
  const rows = courses?.data ?? [];
  const byStatus = (s: string) => rows.filter((c) => c.status === s).length;

  return (
    <DashboardShell role={session.app_role} email={session.email}
      nav={INSTRUCTOR_NAV} title="Dashboard">
      <div className="grid gap-4 sm:grid-cols-3">
        <StatTile label="Total courses" value={courses?.total ?? 0} />
        <StatTile label="Published" value={byStatus('active')} />
        <StatTile label="Drafts" value={byStatus('draft') + byStatus('pending')} />
      </div>

      {money && (
        <>
          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            <StatTile label="Sales" value={money.totals.sales} />
            <StatTile label="Earned" value={currency(money.totals.instructor, position)} />
            <StatTile label="Available to request"
              value={currency(money.balance.requestable, position)}
              hint={money.balance.pending > 0
                ? currency(money.balance.pending, position) + ' awaiting payment' : undefined} />
          </div>

          {money.totals.sales > 0 && (
            <section className="mt-8">
              <h2 className="text-sm font-semibold">Earnings, last 12 months</h2>
              <div className="card mt-3 p-4">
                <RevenueChart months={money.months} position={position} />
              </div>
              <div className="card mt-4 p-4">
                <RevenueTable totals={money.totals} position={position} showAdmin={false} />
              </div>
            </section>
          )}
        </>
      )}

      <section className="mt-8">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Recent courses</h2>
          <Link href="/instructor/courses" className="text-sm text-brand-600 hover:underline">
            View all
          </Link>
        </div>
        {rows.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">You have not created a course yet.</p>
        ) : (
          <ul className="mt-3 divide-y divide-slate-200 rounded-lg border border-slate-200">
            {rows.slice(0, 5).map((c) => (
              <li key={c.id} className="flex items-center justify-between px-4 py-3">
                <Link href={`/instructor/courses/${c.id}`} className="text-sm hover:text-brand-600">
                  {c.title}
                </Link>
                <span className="chip border-slate-200 bg-slate-50 text-slate-600">{c.status}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </DashboardShell>
  );
}
