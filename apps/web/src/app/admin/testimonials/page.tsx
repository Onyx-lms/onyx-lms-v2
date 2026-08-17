import type { Metadata } from 'next';
import { requireRole, apiAuthSafe } from '@/lib/session';
import { DashboardShell } from '@/components/dashboard-shell';
import { ADMIN_NAV } from '@/lib/nav';
import { TestimonialAdmin, type UserOption } from '@/components/testimonial-admin';

export const metadata: Metadata = { title: 'Testimonials' };

interface Testimonial {
  id: number; rating: number; review: string | null; created_at: string | null;
  user?: { id: number; name: string | null } | null;
}
interface Paged<T> { data: T[] }

export default async function AdminTestimonials() {
  const session = await requireRole('admin');
  const [items, users] = await Promise.all([
    apiAuthSafe<Testimonial[]>('/api/admin/testimonials'),
    apiAuthSafe<Paged<UserOption>>('/api/admin/users?per_page=100'),
  ]);
  const rows = items ?? [];

  return (
    <DashboardShell role={session.app_role} email={session.email}
      nav={ADMIN_NAV} title="Testimonials">
      <TestimonialAdmin users={users?.data ?? []} />

      {rows.length === 0 ? (
        <p className="mt-6 rounded-lg border border-dashed border-slate-300 p-10 text-center text-sm text-slate-500">
          No testimonials yet. The home page shows nothing until you add one.
        </p>
      ) : (
        <ul className="mt-6 space-y-3">
          {rows.map((t) => (
            <li key={t.id} className="card flex items-start justify-between gap-4 p-4">
              <div>
                <p className="text-sm text-slate-700">&ldquo;{t.review}&rdquo;</p>
                <p className="mt-2 text-xs text-slate-500">
                  {t.user?.name ?? 'Deleted user'} &middot; {t.rating} / 5
                </p>
              </div>
              <TestimonialAdmin mode="row" testimonialId={t.id} />
            </li>
          ))}
        </ul>
      )}
    </DashboardShell>
  );
}
