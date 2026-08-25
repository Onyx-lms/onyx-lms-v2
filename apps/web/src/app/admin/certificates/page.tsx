import Link from 'next/link';
import type { Metadata } from 'next';
import { requireRole, apiAuthSafe } from '@/lib/session';
import { DashboardShell } from '@/components/dashboard-shell';
import { ADMIN_NAV } from '@/lib/nav';
import { CertificateAdmin } from '@/components/certificate-admin';

export const metadata: Metadata = { title: 'Certificates' };

interface Row {
  id: number; identifier: string; created_at: string | null;
  user: { name: string | null; email: string } | null;
  course: { title: string | null; slug: string | null } | null;
}
interface Paged<T> { data: T[]; total: number }

/** CERT-02 -- issued certificates. */
export default async function AdminCertificates(
  { searchParams }: { searchParams: Promise<{ search?: string }> },
) {
  const session = await requireRole('admin');
  const { search = '' } = await searchParams;
  const qs = search ? '?search=' + encodeURIComponent(search) : '';
  const list = await apiAuthSafe<Paged<Row>>('/api/admin/certificates' + qs);

  return (
    <DashboardShell role={session.app_role} email={session.email}
      nav={ADMIN_NAV} title="Certificates">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <form className="flex gap-2">
          <input name="search" defaultValue={search} placeholder="Certificate id"
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm" />
          <button className="btn-ghost">Search</button>
        </form>
        <p className="text-sm text-slate-500">{list?.total ?? 0} issued</p>
      </div>

      <div className="mt-4"><CertificateAdmin /></div>

      <div className="mt-6 overflow-x-auto rounded-lg border border-slate-200">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Student</th>
              <th className="px-4 py-3">Course</th>
              <th className="px-4 py-3">Certificate id</th>
              <th className="px-4 py-3">Issued</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {(list?.data ?? []).length === 0 && (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                No certificates issued yet.
              </td></tr>
            )}
            {(list?.data ?? []).map((r) => (
              <tr key={r.id}>
                <td className="px-4 py-3">
                  <div className="font-medium">{r.user?.name ?? '-'}</div>
                  <div className="text-xs text-slate-500">{r.user?.email}</div>
                </td>
                <td className="px-4 py-3">{r.course?.title ?? '-'}</td>
                <td className="px-4 py-3 font-mono text-xs">
                  <Link href={'/certificate/' + r.identifier} className="hover:text-brand-600">
                    {r.identifier}
                  </Link>
                </td>
                <td className="px-4 py-3 text-slate-600">
                  {r.created_at ? new Date(r.created_at).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' }) : '-'}
                </td>
                <td className="px-4 py-3 text-right">
                  <CertificateAdmin mode="row" certificateId={r.id} identifier={r.identifier} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </DashboardShell>
  );
}
