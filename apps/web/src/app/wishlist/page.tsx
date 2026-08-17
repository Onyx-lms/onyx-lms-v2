import Link from 'next/link';
import type { Metadata } from 'next';
import { requireSession, apiAuthSafe } from '@/lib/session';
import { DashboardShell } from '@/components/dashboard-shell';
import { STUDENT_NAV } from '@/lib/nav';
import { CourseCard } from '@/components/course-card';
import type { CourseCard as Course } from '@/lib/api';

export const metadata: Metadata = { title: 'Wishlist' };

export default async function WishlistPage() {
  const session = await requireSession();
  const courses = (await apiAuthSafe<Course[]>('/api/wishlist')) ?? [];

  return (
    <DashboardShell role={session.app_role} email={session.email}
      nav={[...STUDENT_NAV, { href: '/wishlist', label: 'Wishlist' }]} title="Wishlist">
      {courses.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 p-10 text-center">
          <p className="text-sm text-slate-600">Nothing saved yet.</p>
          <Link href="/courses" className="btn-primary mt-4">Browse courses</Link>
        </div>
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {courses.map((c) => <CourseCard key={c.id} course={c} currencyPosition="left" />)}
        </div>
      )}
    </DashboardShell>
  );
}
