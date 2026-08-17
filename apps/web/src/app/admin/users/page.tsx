import Link from 'next/link';
import type { Metadata } from 'next';
import { requireRole, apiAuthSafe } from '@/lib/session';
import { DashboardShell } from '@/components/dashboard-shell';
import { ADMIN_NAV } from '@/lib/nav';
import { UserRowActions } from '@/components/user-row-actions';
import { NewUserButton } from '@/components/new-user-button';

export const metadata: Metadata = { title: 'Users' };

interface User {
  id: number; name: string | null; email: string; role: string;
  status: number | null; email_verified_at: string | null;
}
interface Paged<T> { data: T[]; total: number; current_page: number; last_page: number }

const ROLES = ['', 'admin', 'instructor', 'student'] as const;

export default async function AdminUsers(
  { searchParams }: { searchParams: Promise<{ role?: string; search?: string; page?: string }> },
) {
  const session = await requireRole('admin');
  const { role = '', search = '', page = '1' } = await searchParams;
  const qs = new URLSearchParams({ page, per_page: '15' });
  if (role) qs.set('role', role);
  if (search) qs.set('search', search);
  const users = await apiAuthSafe<Paged<User>>('/api/admin/users?' + qs);

  return (
    <DashboardShell role={session.app_role} email={session.email} nav={ADMIN_NAV} title="Users">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-2">
          {ROLES.map((r) => (
            <Link key={r || 'all'} href={`/admin/users${r ? `?role=${r}` : ''}`}
              className={`chip ${role === r ? 'border-brand-300 bg-brand-50 text-brand-700' : 'border-slate-200 bg-white text-slate-600'}`}>
              {r || 'all'}
            </Link>
          ))}
        </div>
        <form className="flex gap-2">
          {role && <input type="hidden" name="role" value={role} />}
          <input name="search" defaultValue={search} placeholder="Name or email"
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm" />
          <button className="btn-ghost">Search</button>
        </form>
      </div>

      <div className="mt-4"><NewUserButton /></div>

      <div className="mt-4 overflow-x-auto rounded-lg border border-slate-200">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Email</th>
              <th className="px-4 py-3">Role</th>
              <th className="px-4 py-3">Verified</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {(users?.data ?? []).map((u) => (
              <tr key={u.id}>
                <td className="px-4 py-3 font-medium">{u.name}</td>
                <td className="px-4 py-3 text-slate-600">{u.email}</td>
                <td className="px-4 py-3">
                  <span className="chip border-slate-200 bg-slate-50 text-slate-600">{u.role}</span>
                </td>
                <td className="px-4 py-3 text-slate-600">{u.email_verified_at ? 'Yes' : 'No'}</td>
                <td className="px-4 py-3 text-right">
                  <UserRowActions id={u.id} role={u.role} isSelf={u.id === session.user_id} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {users && users.last_page > 1 && (
        <nav className="mt-6 flex gap-2">
          {Array.from({ length: users.last_page }, (_, i) => i + 1).map((p) => (
            <Link key={p} href={`/admin/users?page=${p}${role ? `&role=${role}` : ''}`}
              className={`btn ${p === users.current_page ? 'bg-brand-600 text-white' : 'btn-ghost'}`}>{p}</Link>
          ))}
        </nav>
      )}
    </DashboardShell>
  );
}
