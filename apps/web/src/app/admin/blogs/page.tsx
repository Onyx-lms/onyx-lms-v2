import Link from 'next/link';
import type { Metadata } from 'next';
import { requireRole, apiAuthSafe } from '@/lib/session';
import { DashboardShell } from '@/components/dashboard-shell';
import { ADMIN_NAV } from '@/lib/nav';
import { BlogAdmin, type BlogCategoryOption } from '@/components/blog-admin';

export const metadata: Metadata = { title: 'Blog' };

interface Row {
  id: number; title: string | null; slug: string | null;
  status: number | null; is_popular: number | null; created_at: string | null;
  author?: { name: string | null } | null;
  category?: { title: string } | null;
}
interface Paged<T> { data: T[]; total: number }

/** R-04 / R-07: admin blog list, the pending queue and the create form. */
export default async function AdminBlogs() {
  const session = await requireRole('admin');
  const [posts, categories] = await Promise.all([
    apiAuthSafe<Paged<Row>>('/api/manage/blogs'),
    apiAuthSafe<BlogCategoryOption[]>('/api/blogs/categories'),
  ]);
  const rows = posts?.data ?? [];
  const pending = rows.filter((r) => !r.status);

  return (
    <DashboardShell role={session.app_role} email={session.email}
      nav={ADMIN_NAV} title="Blog">
      <BlogAdmin categories={categories ?? []} canPublish />

      {pending.length > 0 && (
        <p className="mt-6 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          {pending.length} {pending.length === 1 ? 'post is' : 'posts are'} waiting for approval.
        </p>
      )}

      {rows.length === 0 ? (
        <p className="mt-6 rounded-lg border border-dashed border-slate-300 p-10 text-center text-sm text-slate-500">
          No posts yet.
        </p>
      ) : (
        <table className="rows-linked mt-6 w-full text-sm">
          <thead className="border-b border-slate-200 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="py-2">Title</th>
              <th>Category</th>
              <th>Author</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="py-2">
                  {r.status ? (
                    <Link href={`/blog/${r.slug}`} className="hover:text-brand-600">{r.title}</Link>
                  ) : r.title}
                </td>
                <td className="text-slate-600">{r.category?.title ?? '-'}</td>
                <td className="text-slate-600">{r.author?.name ?? '-'}</td>
                <td>
                  <span className={r.status
                    ? 'rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700'
                    : 'rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700'}>
                    {r.status ? 'Published' : 'Pending'}
                  </span>
                </td>
                <td>
                  <BlogAdmin mode="row" blogId={r.id} status={r.status} canPublish />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </DashboardShell>
  );
}
