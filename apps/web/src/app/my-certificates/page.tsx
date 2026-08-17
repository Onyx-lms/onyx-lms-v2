import Link from 'next/link';
import type { Metadata } from 'next';
import { requireSession, apiAuthSafe } from '@/lib/session';
import { DashboardShell } from '@/components/dashboard-shell';
import { STUDENT_NAV } from '@/lib/nav';

export const metadata: Metadata = { title: 'My certificates' };

interface Row {
  id: number; identifier: string; created_at: string | null;
  course: { title: string | null; slug: string | null } | null;
}

export default async function MyCertificates() {
  const session = await requireSession();
  const rows = (await apiAuthSafe<Row[]>('/api/me/certificates')) ?? [];

  return (
    <DashboardShell role={session.app_role} email={session.email}
      nav={STUDENT_NAV} title="My certificates">
      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 p-10 text-center">
          <p className="text-sm text-slate-600">
            Finish a course and your certificate appears here automatically.
          </p>
          <Link href="/my-courses" className="btn-primary mt-4">Keep learning</Link>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {rows.map((r) => (
            <article key={r.id} className="card p-5">
              <h2 className="font-semibold">{r.course?.title ?? 'Course'}</h2>
              <p className="mt-1 text-xs text-slate-500">
                Issued {r.created_at ? new Date(r.created_at).toLocaleDateString() : ''}
              </p>
              <p className="mt-2 font-mono text-xs text-slate-500">{r.identifier}</p>
              <div className="mt-4 flex gap-2">
                <Link href={'/certificate/' + r.identifier} className="btn-primary">View</Link>
                <Link href={'/verify/certificate/' + r.identifier} className="btn-ghost">
                  Share verification
                </Link>
              </div>
            </article>
          ))}
        </div>
      )}
    </DashboardShell>
  );
}
