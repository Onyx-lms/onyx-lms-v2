import Link from 'next/link';
import type { Metadata } from 'next';
import { requireSession, apiAuthSafe } from '@/lib/session';
import { DashboardShell } from '@/components/dashboard-shell';
import { STUDENT_NAV, INSTRUCTOR_NAV, ADMIN_NAV } from '@/lib/nav';

export const metadata: Metadata = { title: 'My workshops' };
export const dynamic = 'force-dynamic';

interface Purchase {
  id: number; invoice: string | null; price: number | null; created_at: string | null;
  bootcamp: { id: number; title: string | null; slug: string | null;
              thumbnail: string | null; short_description: string | null } | null;
}

const navFor = (role: string) =>
  role === 'admin' ? ADMIN_NAV : role === 'instructor' ? INSTRUCTOR_NAV : STUDENT_NAV;

export default async function MyBootcamps() {
  const session = await requireSession();
  const purchases = (await apiAuthSafe<Purchase[]>('/api/my-bootcamps')) ?? [];

  return (
    <DashboardShell role={session.app_role} email={session.email}
      nav={navFor(session.app_role)} title="My workshops">
      {purchases.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-300 p-10 text-center text-sm text-slate-500">
          You have not joined a workshop yet.{' '}
          <Link href="/bootcamps" className="text-brand-700 underline">Browse workshops</Link>
        </p>
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {purchases.filter((p) => p.bootcamp).map((p) => (
            <article key={p.id} className="card overflow-hidden">
              {p.bootcamp!.thumbnail && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={p.bootcamp!.thumbnail} alt="" className="h-36 w-full object-cover" />
              )}
              <div className="p-4">
                <h2 className="font-semibold leading-snug">
                  <Link href={'/my-bootcamps/' + p.bootcamp!.slug} className="hover:text-brand-600">
                    {p.bootcamp!.title}
                  </Link>
                </h2>
                <p className="mt-1 text-xs text-slate-500">{p.bootcamp!.short_description}</p>
                {p.invoice && (
                  <p className="mt-2 text-xs text-slate-400">Invoice {p.invoice}</p>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
    </DashboardShell>
  );
}
