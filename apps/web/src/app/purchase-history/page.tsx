import Link from 'next/link';
import type { Metadata } from 'next';
import { requireSession, apiAuthSafe } from '@/lib/session';
import { DashboardShell } from '@/components/dashboard-shell';
import { STUDENT_NAV, INSTRUCTOR_NAV, ADMIN_NAV } from '@/lib/nav';
import { currency } from '@/lib/format';

export const metadata: Metadata = { title: 'Purchase history' };
export const dynamic = 'force-dynamic';

interface Row {
  id: number; payment_type: string | null; amount: number | null; tax: number | null;
  coupon: string | null; invoice: string | null; created_at: string | null;
  course: { id: number; title: string | null; slug: string | null } | null;
}

interface OtherPurchase {
  kind: 'course' | 'bootcamp' | 'team_package' | 'tuition';
  id: number; amount: number; invoice: string | null; created_at: string | null;
}

const OTHER_LABEL: Record<string, string> = {
  bootcamp: 'Workshop', team_package: 'Classroom package', tuition: 'Tuition session',
};

const navFor = (role: string) =>
  role === 'admin' ? ADMIN_NAV : role === 'instructor' ? INSTRUCTOR_NAV : STUDENT_NAV;

export default async function PurchaseHistory() {
  const session = await requireSession();
  // REV-03: courses come from payment_histories; the other three product types
  // each live in their own table, which the unified endpoint merges.
  const [rows, everything] = await Promise.all([
    apiAuthSafe<Row[]>('/api/payment/history'),
    apiAuthSafe<OtherPurchase[]>('/api/me/purchases'),
  ]);
  const courseRows = rows ?? [];
  const others = (everything ?? []).filter((p) => p.kind !== 'course');

  return (
    <DashboardShell role={session.app_role} email={session.email}
      nav={navFor(session.app_role)} title="Purchase history">
      {courseRows.length === 0 && others.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-300 p-10 text-center text-sm text-slate-500">
          You have not bought anything yet.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="rows-linked w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Course</th>
                <th className="px-4 py-3">Paid</th>
                <th className="px-4 py-3">Method</th>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3 text-right">Invoice</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {courseRows.map((r) => (
                <tr key={r.id}>
                  <td className="px-4 py-3">
                    {r.course?.slug ? (
                      <Link href={`/course/${r.course.slug}`} className="font-medium hover:text-brand-600">
                        {r.course.title}
                      </Link>
                    ) : (r.course?.title ?? '-')}
                  </td>
                  <td className="px-4 py-3">{currency(Number(r.amount ?? 0))}</td>
                  <td className="px-4 py-3 capitalize text-slate-600">{r.payment_type}</td>
                  <td className="px-4 py-3 text-slate-600">
                    {r.created_at ? new Date(r.created_at).toLocaleDateString() : '-'}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {r.invoice && (
                      <Link href={`/invoice/${r.invoice}`} className="text-xs text-brand-600 hover:underline">
                        View
                      </Link>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {others.length > 0 && (
        <section className="mt-8">
          <h2 className="text-sm font-semibold">Workshops, classrooms and sessions</h2>
          <ul className="mt-3 divide-y divide-slate-100 rounded-lg border border-slate-200">
            {others.map((p) => (
              <li key={p.kind + p.id}
                className="flex items-center justify-between px-4 py-3 text-sm">
                <div>
                  <div className="font-medium">{OTHER_LABEL[p.kind] ?? p.kind}</div>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {p.invoice}
                    {p.created_at ? ' - ' + new Date(p.created_at).toLocaleDateString() : ''}
                  </p>
                </div>
                <span className="font-medium">{currency(p.amount)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </DashboardShell>
  );
}
