import type { Metadata } from 'next';
import { requireRole, apiAuthSafe } from '@/lib/session';
import { DashboardShell } from '@/components/dashboard-shell';
import { ADMIN_NAV } from '@/lib/nav';
import { TaxonomyAdmin, type Term } from '@/components/tutoring-admin';

export const metadata: Metadata = { title: 'Tutor taxonomy' };
export const dynamic = 'force-dynamic';

/** TB-01 -- the categories and subjects tutors can offer. */
export default async function AdminTutoring() {
  const session = await requireRole('admin');
  const [categories, subjects] = await Promise.all([
    apiAuthSafe<Term[]>('/api/admin/tutor/categories'),
    apiAuthSafe<Term[]>('/api/admin/tutor/subjects'),
  ]);

  return (
    <DashboardShell role={session.app_role} email={session.email}
      nav={ADMIN_NAV} title="Tutor taxonomy">
      <p className="mb-4 max-w-2xl text-sm text-slate-600">
        Tutors pick one category and one subject for each thing they teach, and
        set their own price. Hiding one keeps existing offers intact but stops
        new ones.
      </p>
      <div className="grid gap-4 lg:grid-cols-2">
        <TaxonomyAdmin kind="categories" rows={categories ?? []} />
        <TaxonomyAdmin kind="subjects" rows={subjects ?? []} />
      </div>
    </DashboardShell>
  );
}
