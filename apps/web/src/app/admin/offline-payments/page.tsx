import type { Metadata } from 'next';
import { requireRole, apiAuthSafe } from '@/lib/session';
import { DashboardShell } from '@/components/dashboard-shell';
import { ADMIN_NAV } from '@/lib/nav';
import { OfflineReviewActions } from '@/components/offline-review-actions';
import { currency } from '@/lib/format';

export const metadata: Metadata = { title: 'Offline payments' };

interface Row {
  id: number; status: number | null; payable_amount: number | null;
  coupon: string | null; bank_no: string | null; phone_on: string | null;
  created_at: string | null; course_ids: number[];
  user: { id: number; name: string | null; email: string } | null;
}

const LABEL: Record<number, string> = { 0: 'pending', 1: 'accepted', 2: 'declined' };

/** PAY-15 -- the admin review queue. */
export default async function AdminOfflinePayments() {
  const session = await requireRole('admin');
  const rows = (await apiAuthSafe<Row[]>('/api/admin/offline-payments')) ?? [];

  return (
    <DashboardShell role={session.app_role} email={session.email}
      nav={ADMIN_NAV} title="Offline payments">
      {rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-300 p-10 text-center text-sm text-slate-500">
          No bank transfers submitted.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Student</th>
                <th className="px-4 py-3">Courses</th>
                <th className="px-4 py-3">Amount</th>
                <th className="px-4 py-3">Reference</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Review</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="px-4 py-3">
                    <div className="font-medium">{r.user?.name ?? 'Unknown'}</div>
                    <div className="text-xs text-slate-500">{r.user?.email}</div>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{r.course_ids.length}</td>
                  <td className="px-4 py-3">
                    {currency(Number(r.payable_amount ?? 0))}
                    {r.coupon && <div className="text-xs text-slate-500">coupon {r.coupon}</div>}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-600">
                    <div>{r.bank_no}</div>
                    <div>{r.phone_on}</div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`chip ${r.status === 1 ? 'border-green-200 bg-green-50 text-green-700'
                      : r.status === 2 ? 'border-red-200 bg-red-50 text-red-700'
                      : 'border-amber-200 bg-amber-50 text-amber-800'}`}>
                      {LABEL[Number(r.status ?? 0)] ?? 'pending'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {r.status === 0 && <OfflineReviewActions id={r.id} />}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-4 text-xs text-slate-500">
        Accepting runs the same fulfilment path as a card payment: revenue split,
        invoice and enrolment. Prices are re-read at acceptance rather than taken
        from the snapshot made when the student submitted.
      </p>
    </DashboardShell>
  );
}
