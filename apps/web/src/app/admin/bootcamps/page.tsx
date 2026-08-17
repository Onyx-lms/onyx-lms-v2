import Link from 'next/link';
import type { Metadata } from 'next';
import { requireRole, apiAuthSafe } from '@/lib/session';
import { DashboardShell } from '@/components/dashboard-shell';
import { ADMIN_NAV } from '@/lib/nav';
import { BootcampAdmin, type BootcampRow, type CategoryOption } from '@/components/bootcamp-admin';

export const metadata: Metadata = { title: 'Workshops' };
export const dynamic = 'force-dynamic';

interface Paged<T> { data: T[]; total: number }

export default async function AdminBootcamps() {
  const session = await requireRole('admin');
  const [list, categories] = await Promise.all([
    apiAuthSafe<Paged<BootcampRow>>('/api/manage/bootcamps'),
    apiAuthSafe<CategoryOption[]>('/api/bootcamps/categories'),
  ]);
  const rows = list?.data ?? [];
  const pending = rows.filter((r) => r.pending);

  return (
    <DashboardShell role={session.app_role} email={session.email}
      nav={ADMIN_NAV} title="Workshops">
      <BootcampAdmin categories={categories ?? []} canPublish />

      {pending.length > 0 && (
        <p className="mt-6 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          {pending.length} {pending.length === 1 ? 'workshop is' : 'workshops are'} waiting for approval.
        </p>
      )}

      {rows.length === 0 ? (
        <p className="mt-6 rounded-lg border border-dashed border-slate-300 p-10 text-center text-sm text-slate-500">
          No workshops yet.
        </p>
      ) : (
        <ul className="mt-6 divide-y divide-slate-100 rounded-lg border border-slate-200">
          {rows.map((b) => (
            <li key={b.id} className="flex items-center justify-between px-4 py-3 text-sm">
              <div>
                <div className="font-medium">
                  {b.status ? (
                    <Link href={'/bootcamp/' + b.slug} className="hover:text-brand-600">{b.title}</Link>
                  ) : b.title}
                </div>
                <p className="mt-0.5 text-xs text-slate-500">
                  {b.category?.title ?? 'Uncategorised'}
                  {b.instructor?.name ? ' - ' + b.instructor.name : ''}
                  {' - '}{b.status ? 'Published' : b.pending ? 'Pending approval' : 'Unpublished'}
                </p>
              </div>
              <BootcampAdmin mode="row" bootcamp={b} canPublish />
            </li>
          ))}
        </ul>
      )}
    </DashboardShell>
  );
}
