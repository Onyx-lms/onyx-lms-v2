import type { Metadata } from 'next';
import { requireRole, apiAuthSafe } from '@/lib/session';
import { DashboardShell } from '@/components/dashboard-shell';
import { ADMIN_NAV } from '@/lib/nav';
import { CouponAdmin } from '@/components/coupon-admin';

export const metadata: Metadata = { title: 'Coupons' };

interface Coupon {
  id: number; code: string | null; discount: number | null;
  expiry: string | null; status: string | null;
}

function expiryLabel(expiry: string | null): string {
  if (!expiry) return 'Never';
  const raw = String(expiry).trim();
  const ms = /^\d+$/.test(raw) ? (Number(raw) < 1e12 ? Number(raw) * 1000 : Number(raw))
                               : Date.parse(raw);
  return Number.isNaN(ms) ? raw : new Date(ms).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' });
}

/** E-03: coupon administration. */
export default async function AdminCoupons() {
  const session = await requireRole('admin');
  const coupons = (await apiAuthSafe<Coupon[]>('/api/admin/coupons')) ?? [];
  const isActive = (s: string | null) =>
    ['1', 'active', 'true'].includes(String(s ?? '').toLowerCase());

  return (
    <DashboardShell role={session.app_role} email={session.email} nav={ADMIN_NAV} title="Coupons">
      <CouponAdmin />

      <div className="mt-8 overflow-x-auto rounded-lg border border-slate-200">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Code</th>
              <th className="px-4 py-3">Discount</th>
              <th className="px-4 py-3">Expires</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {coupons.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                No coupons yet.
              </td></tr>
            )}
            {coupons.map((c) => (
              <tr key={c.id}>
                <td className="px-4 py-3 font-mono font-medium">{c.code}</td>
                <td className="px-4 py-3">{c.discount}%</td>
                <td className="px-4 py-3 text-slate-600">{expiryLabel(c.expiry)}</td>
                <td className="px-4 py-3">
                  <span className={`chip ${isActive(c.status)
                    ? 'border-green-200 bg-green-50 text-green-700'
                    : 'border-slate-200 bg-slate-50 text-slate-500'}`}>
                    {isActive(c.status) ? 'active' : 'disabled'}
                  </span>
                </td>
                <td className="px-4 py-3 text-right">
                  <CouponAdmin mode="row" couponId={c.id} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-4 text-xs text-slate-500">
        A disabled coupon is rejected at checkout. The Laravel original applied
        disabled coupons because PHP treats the string &quot;0&quot; as falsy.
      </p>
    </DashboardShell>
  );
}
