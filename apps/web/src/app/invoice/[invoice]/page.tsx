import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { requireSession, apiAuthSafe } from '@/lib/session';
import { currency } from '@/lib/format';

export const metadata: Metadata = { title: 'Invoice' };

interface Invoice {
  invoice: string; issued_at: string | null; payment_type: string | null; coupon: string | null;
  items: { course: { id: number; title: string | null; slug: string | null } | null;
           amount: number; tax: number }[];
  subtotal: number; tax: number; total: number;
}

/** PAY-06 -- one invoice per order, readable only by its owner. */
export default async function InvoicePage({ params }: { params: Promise<{ invoice: string }> }) {
  await requireSession();
  const { invoice: number } = await params;
  const invoice = await apiAuthSafe<Invoice>(`/api/payment/invoice/${encodeURIComponent(number)}`);
  if (!invoice) notFound();

  return (
    <div className="container-page max-w-2xl py-10">
      <div className="card p-8">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-semibold">Invoice</h1>
            <p className="mt-1 font-mono text-sm text-slate-500">{invoice.invoice}</p>
          </div>
          <div className="text-right text-sm text-slate-600">
            {invoice.issued_at && <div>{new Date(invoice.issued_at).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' })}</div>}
            <div className="capitalize">{invoice.payment_type}</div>
          </div>
        </div>

        <table className="mt-8 w-full text-sm">
          <thead className="border-b border-slate-200 text-left text-xs uppercase text-slate-500">
            <tr><th className="pb-2">Course</th><th className="pb-2 text-right">Amount</th></tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {invoice.items.map((item, i) => (
              <tr key={i}>
                <td className="py-3">
                  {item.course?.slug ? (
                    <Link href={`/course/${item.course.slug}`} className="hover:text-brand-600">
                      {item.course.title}
                    </Link>
                  ) : (item.course?.title ?? 'Course')}
                </td>
                <td className="py-3 text-right">{currency(item.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <dl className="mt-6 space-y-1 border-t border-slate-200 pt-4 text-sm">
          <div className="flex justify-between"><dt>Subtotal</dt><dd>{currency(invoice.subtotal)}</dd></div>
          {invoice.coupon && (
            <div className="flex justify-between text-slate-500">
              <dt>Coupon</dt><dd className="font-mono">{invoice.coupon}</dd>
            </div>
          )}
          <div className="flex justify-between"><dt>Tax</dt><dd>{currency(invoice.tax)}</dd></div>
          <div className="flex justify-between border-t border-slate-200 pt-2 text-base font-semibold">
            <dt>Total paid</dt><dd>{currency(invoice.total)}</dd>
          </div>
        </dl>
      </div>

      <div className="mt-4 flex gap-3">
        <Link href="/purchase-history" className="btn-ghost">All purchases</Link>
        <Link href="/my-courses" className="btn-ghost">My courses</Link>
      </div>
    </div>
  );
}
