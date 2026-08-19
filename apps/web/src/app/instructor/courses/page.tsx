import Link from 'next/link';
import type { Metadata } from 'next';
import { requireRole, apiAuthSafe } from '@/lib/session';
import { DashboardShell } from '@/components/dashboard-shell';
import { INSTRUCTOR_NAV } from '@/lib/nav';
import { CourseRowActions } from '@/components/course-row-actions';
import { NewCourseButton } from '@/components/new-course-button';

export const metadata: Metadata = { title: 'My courses' };

interface Course {
  id: number; title: string | null; slug: string | null; status: string | null;
  is_paid: number | null; price: number | null; level: string | null;
}
interface Paged<T> { data: T[]; total: number; current_page: number; last_page: number }

/** B-09 -- the instructor course list. */
export default async function InstructorCourses(
  { searchParams }: { searchParams: Promise<{ page?: string; search?: string }> },
) {
  const session = await requireRole('instructor', 'admin');
  const { page = '1', search = '' } = await searchParams;
  const qs = new URLSearchParams({ page, per_page: '15' });
  if (search) qs.set('search', search);
  const courses = await apiAuthSafe<Paged<Course>>('/api/authoring/courses?' + qs);

  return (
    <DashboardShell role={session.app_role} email={session.email}
      nav={INSTRUCTOR_NAV} title="My courses">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <form className="flex gap-2">
          <input name="search" defaultValue={search} placeholder="Search courses"
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm outline-none focus:border-brand-500" />
          <button className="btn-ghost">Search</button>
        </form>
        <NewCourseButton />
      </div>

      {!courses || courses.data.length === 0 ? (
        <p className="mt-6 rounded-lg border border-dashed border-slate-300 p-10 text-center text-sm text-slate-500">
          No courses yet. Create your first one to get started.
        </p>
      ) : (
        <div className="mt-6 overflow-x-auto rounded-lg border border-slate-200">
          <table className="rows-linked w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Course</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Price</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {courses.data.map((c) => (
                <tr key={c.id}>
                  <td className="px-4 py-3">
                    <Link href={`/instructor/courses/${c.id}`} className="font-medium hover:text-brand-600">
                      {c.title}
                    </Link>
                    <div className="text-xs text-slate-500">{c.level}</div>
                  </td>
                  <td className="px-4 py-3">
                    <span className="chip border-slate-200 bg-slate-50 text-slate-600">{c.status}</span>
                  </td>
                  <td className="px-4 py-3">{c.is_paid ? c.price : 'Free'}</td>
                  <td className="px-4 py-3 text-right">
                    <CourseRowActions id={c.id} status={c.status ?? 'draft'} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {courses && courses.last_page > 1 && (
        <nav className="mt-6 flex gap-2">
          {Array.from({ length: courses.last_page }, (_, i) => i + 1).map((p) => (
            <Link key={p} href={`/instructor/courses?page=${p}`}
              className={`btn ${p === courses.current_page ? 'bg-brand-600 text-white' : 'btn-ghost'}`}>
              {p}
            </Link>
          ))}
        </nav>
      )}
    </DashboardShell>
  );
}
