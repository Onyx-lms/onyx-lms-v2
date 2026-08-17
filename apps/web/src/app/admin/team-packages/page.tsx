import Link from 'next/link';
import type { Metadata } from 'next';
import { requireRole, apiAuthSafe } from '@/lib/session';
import { DashboardShell } from '@/components/dashboard-shell';
import { ADMIN_NAV, INSTRUCTOR_NAV } from '@/lib/nav';
import { TeamPackageAdmin, type PackageRow, type CourseOption }
  from '@/components/team-package-admin';

export const metadata: Metadata = { title: 'Classroom packages' };
export const dynamic = 'force-dynamic';

interface Paged<T> { data: T[]; total: number }

export default async function AdminTeamPackages() {
  const session = await requireRole('admin', 'instructor');
  const [list, courses] = await Promise.all([
    apiAuthSafe<Paged<PackageRow>>('/api/manage/team-packages'),
    apiAuthSafe<Paged<CourseOption>>('/api/authoring/courses?per_page=100'),
  ]);
  const rows = list?.data ?? [];

  return (
    <DashboardShell role={session.app_role} email={session.email}
      nav={session.app_role === 'admin' ? ADMIN_NAV : INSTRUCTOR_NAV}
      title="Classroom packages">
      <TeamPackageAdmin courses={courses?.data ?? []} />

      {rows.length === 0 ? (
        <p className="mt-6 rounded-lg border border-dashed border-slate-300 p-10 text-center text-sm text-slate-500">
          No packages yet.
        </p>
      ) : (
        <ul className="mt-6 divide-y divide-slate-100 rounded-lg border border-slate-200">
          {rows.map((p) => (
            <li key={p.id} className="flex items-center justify-between px-4 py-3 text-sm">
              <div>
                <div className="font-medium">
                  {p.status ? (
                    <Link href={'/team-package/' + p.slug} className="hover:text-brand-600">
                      {p.title}
                    </Link>
                  ) : p.title}
                </div>
                <p className="mt-0.5 text-xs text-slate-500">
                  {p.course?.title ?? 'No course'}
                  {' - '}{p.allocation} seats
                  {' - '}{p.pricing_type ? 'paid' : 'free'}
                  {' - '}{p.course_privacy}
                  {' - '}{p.status ? 'published' : 'hidden'}
                </p>
              </div>
              <TeamPackageAdmin mode="row" pkg={p} />
            </li>
          ))}
        </ul>
      )}
    </DashboardShell>
  );
}
