import Link from 'next/link';
import type { Metadata } from 'next';
import { requireSession, apiAuthSafe } from '@/lib/session';
import { DashboardShell } from '@/components/dashboard-shell';
import { STUDENT_NAV, INSTRUCTOR_NAV, ADMIN_NAV } from '@/lib/nav';

export const metadata: Metadata = { title: 'My classrooms' };
export const dynamic = 'force-dynamic';

interface Purchase {
  id: number; invoice: string | null; price: number | null; seats_used: number;
  package: { id: number; title: string | null; slug: string | null;
             thumbnail: string | null; allocation: number | null } | null;
}

const navFor = (role: string) =>
  role === 'admin' ? ADMIN_NAV : role === 'instructor' ? INSTRUCTOR_NAV : STUDENT_NAV;

export default async function MyTeamPackages() {
  const session = await requireSession();
  const purchases = (await apiAuthSafe<Purchase[]>('/api/my-team-packages')) ?? [];

  return (
    <DashboardShell role={session.app_role} email={session.email}
      nav={navFor(session.app_role)} title="My classrooms">
      {purchases.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-300 p-10 text-center text-sm text-slate-500">
          You have no classroom packages yet.{' '}
          <Link href="/team-packages" className="text-brand-700 underline">Browse packages</Link>
        </p>
      ) : (
        <ul className="space-y-3">
          {purchases.filter((p) => p.package).map((p) => (
            <li key={p.id} className="card flex items-center justify-between p-4">
              <div>
                <div className="font-medium">{p.package!.title}</div>
                <p className="mt-1 text-xs text-slate-500">
                  {p.seats_used} of {p.package!.allocation} seats filled
                  {p.invoice ? ' - invoice ' + p.invoice : ''}
                </p>
              </div>
              <Link href={'/my-team-packages/' + p.package!.id} className="btn-primary text-sm">
                Manage seats
              </Link>
            </li>
          ))}
        </ul>
      )}
    </DashboardShell>
  );
}
