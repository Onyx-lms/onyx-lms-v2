import type { Metadata } from 'next';
import { requireRole, apiAuthSafe } from '@/lib/session';
import { DashboardShell } from '@/components/dashboard-shell';
import { ADMIN_NAV } from '@/lib/nav';
import { ApprovalActions } from '@/components/approval-actions';

export const metadata: Metadata = { title: 'Course approvals' };

interface Approval {
  id: number; course_id: number; user_id: number;
  message: string | null; read_status: number | null; created_at: string | null;
}
interface Paged<T> { data: T[]; total: number }

/** B-08: the admin queue for instructor-submitted courses. */
export default async function AdminApprovals() {
  const session = await requireRole('admin');
  const approvals = await apiAuthSafe<Paged<Approval>>('/api/admin/course-approvals');
  const pending = (approvals?.data ?? []).filter((a) => !a.read_status);

  return (
    <DashboardShell role={session.app_role} email={session.email}
      nav={ADMIN_NAV} title="Course approvals">
      {pending.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-300 p-10 text-center text-sm text-slate-500">
          Nothing waiting for approval.
        </p>
      ) : (
        <ul className="space-y-3">
          {pending.map((a) => (
            <li key={a.id} className="card flex items-center justify-between p-4">
              <div>
                <div className="font-medium">Course #{a.course_id}</div>
                <p className="mt-1 text-sm text-slate-600">{a.message}</p>
                <p className="mt-1 text-xs text-slate-500">
                  Submitted by user #{a.user_id}
                  {a.created_at ? ` on ${new Date(a.created_at).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' })}` : ''}
                </p>
              </div>
              <ApprovalActions courseId={a.course_id} />
            </li>
          ))}
        </ul>
      )}
    </DashboardShell>
  );
}
