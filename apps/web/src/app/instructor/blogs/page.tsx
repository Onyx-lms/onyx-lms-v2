import Link from 'next/link';
import type { Metadata } from 'next';
import { requireRole, apiAuthSafe } from '@/lib/session';
import { DashboardShell } from '@/components/dashboard-shell';
import { INSTRUCTOR_NAV } from '@/lib/nav';
import { BlogAdmin, type BlogCategoryOption } from '@/components/blog-admin';

export const metadata: Metadata = { title: 'My blog posts' };

interface Row {
  id: number; title: string | null; slug: string | null;
  status: number | null; created_at: string | null;
  category?: { title: string } | null;
}
interface Paged<T> { data: T[]; total: number }

/** R-04: an instructor's own posts. They always land as pending. */
export default async function InstructorBlogs() {
  const session = await requireRole('instructor', 'admin');
  const [posts, categories] = await Promise.all([
    apiAuthSafe<Paged<Row>>('/api/manage/blogs'),
    apiAuthSafe<BlogCategoryOption[]>('/api/blogs/categories'),
  ]);
  const rows = posts?.data ?? [];

  return (
    <DashboardShell role={session.app_role} email={session.email}
      nav={INSTRUCTOR_NAV} title="My blog posts">
      {posts === null ? (
        <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          Blog authoring is not available to instructors on this site.
        </p>
      ) : (
        <>
          <BlogAdmin categories={categories ?? []} />
          {rows.length === 0 ? (
            <p className="mt-6 rounded-lg border border-dashed border-slate-300 p-10 text-center text-sm text-slate-500">
              You have not written any posts yet.
            </p>
          ) : (
            <ul className="mt-6 divide-y divide-slate-100 rounded-lg border border-slate-200">
              {rows.map((r) => (
                <li key={r.id} className="flex items-center justify-between px-4 py-3 text-sm">
                  <div>
                    <div className="font-medium">
                      {r.status ? (
                        <Link href={`/blog/${r.slug}`} className="hover:text-brand-600">{r.title}</Link>
                      ) : r.title}
                    </div>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {r.category?.title ?? 'Uncategorised'} &middot;{' '}
                      {r.status ? 'Published' : 'Awaiting approval'}
                    </p>
                  </div>
                  <BlogAdmin mode="row" blogId={r.id} status={r.status} />
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </DashboardShell>
  );
}
