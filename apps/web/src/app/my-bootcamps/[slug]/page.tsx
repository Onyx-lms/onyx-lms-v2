import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { requireSession, apiAuthSafe } from '@/lib/session';
import { DashboardShell } from '@/components/dashboard-shell';
import { STUDENT_NAV, INSTRUCTOR_NAV, ADMIN_NAV } from '@/lib/nav';
import { ResourceLink } from '@/components/resource-link';

export const metadata: Metadata = { title: 'Workshop' };
export const dynamic = 'force-dynamic';

interface Resource { id: number; title: string | null; upload_type: string | null }
interface LiveClass {
  id: number; title: string | null; start_time: number | null; end_time: number | null;
  provider: string | null; startable: boolean;
}
interface Module {
  id: number; title: string | null; open: boolean;
  live_classes: LiveClass[]; resources: Resource[];
}

const navFor = (role: string) =>
  role === 'admin' ? ADMIN_NAV : role === 'instructor' ? INSTRUCTOR_NAV : STUDENT_NAV;

function when(seconds: number | null): string {
  return seconds ? new Date(Number(seconds) * 1000).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : '';
}

export default async function MyBootcampPage({ params }: { params: Promise<{ slug: string }> }) {
  const session = await requireSession();
  const { slug } = await params;
  const payload = await apiAuthSafe<{
    bootcamp: Record<string, unknown>; modules: Module[];
  }>('/api/my-bootcamps/' + encodeURIComponent(slug));
  if (!payload) notFound();

  return (
    <DashboardShell role={session.app_role} email={session.email}
      nav={navFor(session.app_role)} title={String(payload.bootcamp['title'] ?? 'Workshop')}>
      {payload.modules.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-300 p-10 text-center text-sm text-slate-500">
          The programme is being prepared.
        </p>
      ) : (
        <div className="space-y-4">
          {payload.modules.map((m) => (
            <section key={m.id} className="card p-4">
              <header className="flex items-center justify-between">
                <h2 className="font-medium">{m.title}</h2>
                {!m.open && (
                  <span className="chip border-slate-200 bg-slate-50 text-xs">Not open yet</span>
                )}
              </header>

              {m.open && m.live_classes.length > 0 && (
                <ul className="mt-3 space-y-2 text-sm">
                  {m.live_classes.map((c) => (
                    <li key={c.id} className="flex items-center justify-between">
                      <span>
                        {c.title}
                        <span className="ml-2 text-xs text-slate-500">{when(c.start_time)}</span>
                      </span>
                      {c.startable ? (
                        <Link href={'/bootcamp-class/' + c.id} className="btn-primary px-3 py-1 text-xs">
                          Join now
                        </Link>
                      ) : (
                        <span className="text-xs text-slate-400">Not open</span>
                      )}
                    </li>
                  ))}
                </ul>
              )}

              {m.open && m.resources.length > 0 && (
                <ul className="mt-3 space-y-1 text-sm">
                  {m.resources.map((r) => (
                    <li key={r.id}>
                      <ResourceLink id={r.id} title={r.title} kind={r.upload_type} />
                    </li>
                  ))}
                </ul>
              )}

              {m.open && m.live_classes.length === 0 && m.resources.length === 0 && (
                <p className="mt-3 text-sm text-slate-500">Nothing in this module yet.</p>
              )}
            </section>
          ))}
        </div>
      )}
    </DashboardShell>
  );
}
