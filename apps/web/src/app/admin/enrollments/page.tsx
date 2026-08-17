import type { Metadata } from 'next';
import { requireRole, apiAuthSafe } from '@/lib/session';
import { DashboardShell } from '@/components/dashboard-shell';
import { ADMIN_NAV } from '@/lib/nav';
import { EnrollmentAdmin } from '@/components/enrollment-admin';

export const metadata: Metadata = { title: 'Enrolments' };

interface Row {
  id: number; enrollment_type: string | null; expiry_date: string | null;
  created_at: string | null;
  user: { id: number; name: string | null; email: string } | null;
  course: { id: number; title: string | null } | null;
}

/** E-06: enrolment history plus manual enrolment. */
export default async function AdminEnrollments() {
  const session = await requireRole('admin');
  const list = await apiAuthSafe<{ total: number; data: Row[] }>('/api/admin/enrollments');

  return (
    <DashboardShell role={session.app_role} email={session.email}
      nav={ADMIN_NAV} title="Enrolments">
      <EnrollmentAdmin />

      <p className="mt-8 text-sm text-slate-500">{list?.total ?? 0} enrolments</p>
      <div className="mt-2 overflow-x-auto rounded-lg border border-slate-200">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Student</th>
              <th className="px-4 py-3">Course</th>
              <th className="px-4 py-3">Type</th>
              <th className="px-4 py-3">Expires</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {(list?.data ?? []).map((r) => (
              <tr key={r.id}>
                <td className="px-4 py-3">
                  <div className="font-medium">{r.user?.name ?? `User #${r.id}`}</div>
                  <div className="text-xs text-slate-500">{r.user?.email}</div>
                </td>
                <td className="px-4 py-3">{r.course?.title ?? '-'}</td>
                <td className="px-4 py-3">
                  <span className="chip border-slate-200 bg-slate-50 text-slate-600">
                    {r.enrollment_type}
                  </span>
                </td>
                <td className="px-4 py-3 text-slate-600">
                  {r.expiry_date ? new Date(r.expiry_date).toLocaleDateString() : 'Never'}
                </td>
                <td className="px-4 py-3 text-right">
                  <EnrollmentAdmin mode="delete" enrollmentId={r.id} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </DashboardShell>
  );
}
