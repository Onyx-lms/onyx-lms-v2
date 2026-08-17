import Link from 'next/link';
import type { Metadata } from 'next';
import { requireSession, apiAuthSafe } from '@/lib/session';
import { apiSafe, type SiteSettings } from '@/lib/api';
import { DashboardShell } from '@/components/dashboard-shell';
import { STUDENT_NAV, INSTRUCTOR_NAV, ADMIN_NAV } from '@/lib/nav';
import { StatTile } from '@/components/stat-tile';
import { currency } from '@/lib/format';

export const metadata: Metadata = { title: 'Dashboard' };
export const dynamic = 'force-dynamic';

interface Purchase {
  kind: 'course' | 'bootcamp' | 'team_package' | 'tuition';
  id: number; reference: number; amount: number;
  invoice: string | null; created_at: string | null;
}
interface Summary {
  counts: { courses: number; certificates: number; purchases: number };
  spent: number;
  recent_purchases: Purchase[];
}
interface Enrolled {
  id: number; title: string | null; slug: string | null; progress?: number;
  thumbnail?: string | null; completed?: boolean;
}

const LABEL: Record<Purchase['kind'], string> = {
  course: 'Course', bootcamp: 'Workshop',
  team_package: 'Classroom package', tuition: 'Tuition session',
};

const navFor = (role: string) =>
  role === 'admin' ? ADMIN_NAV : role === 'instructor' ? INSTRUCTOR_NAV : STUDENT_NAV;

/** REV-08 -- the learner's home: what I own, what I finished, what I spent. */
export default async function StudentDashboard() {
  const session = await requireSession();
  const [summary, courses, settings] = await Promise.all([
    apiAuthSafe<Summary>('/api/me/dashboard'),
    apiAuthSafe<Enrolled[]>('/api/me/courses'),
    apiSafe<SiteSettings>('/api/settings'),
  ]);
  const position = settings?.currency_position ?? 'left';
  const enrolled = courses ?? [];

  return (
    <DashboardShell role={session.app_role} email={session.email}
      nav={navFor(session.app_role)} title="Dashboard">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="My courses" value={summary?.counts.courses ?? 0} />
        <StatTile label="Certificates" value={summary?.counts.certificates ?? 0} />
        <StatTile label="Purchases" value={summary?.counts.purchases ?? 0} />
        <StatTile label="Spent" value={currency(summary?.spent ?? 0, position)} />
      </div>

      <section className="mt-8">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Continue learning</h2>
          <Link href="/my-courses" className="text-sm text-brand-600 hover:underline">
            All my courses
          </Link>
        </div>
        {enrolled.length === 0 ? (
          <p className="mt-3 rounded-lg border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">
            You are not enrolled in anything yet.{' '}
            <Link href="/courses" className="text-brand-700 underline">Browse courses</Link>
          </p>
        ) : (
          <ul className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {enrolled.slice(0, 6).map((c) => {
              const pct = Math.min(100, Math.max(0, c.progress ?? 0));
              return (
                <li key={c.id} className="card group flex flex-col transition duration-300 ease-out hover:-translate-y-1 hover:shadow-lift">
                  <Link href={'/play-course/' + c.slug}
                    className="relative block aspect-video w-full overflow-hidden bg-gradient-to-br from-brand-700 to-brand-900">
                    {c.thumbnail ? (
                      <img src={c.thumbnail} alt=""
                        className="h-full w-full object-cover transition duration-500 ease-out group-hover:scale-105"
                        loading="lazy" />
                    ) : (
                      <span aria-hidden className="absolute inset-0 bg-gradient-to-br from-brand-600 via-brand-700 to-brand-900" />
                    )}
                    <span aria-hidden className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/60 via-black/5 to-black/10" />
                    <span className="absolute inset-0 flex items-center justify-center">
                      <span aria-hidden
                        className="grid h-10 w-10 scale-95 place-items-center rounded-full bg-white/90 text-brand-700 opacity-90 shadow-card transition duration-300 ease-out group-hover:scale-105 group-hover:opacity-100">
                        <svg viewBox="0 0 24 24" width="15" height="15">
                          <path d="M8 5.5v13l11-6.5z" fill="currentColor" />
                        </svg>
                      </span>
                    </span>
                    <span aria-hidden className="absolute inset-x-0 bottom-0 h-1.5 bg-white/25">
                      <span className={`block h-full ${c.completed ? 'bg-emerald-400' : 'bg-brand-400'}`}
                        style={{ width: pct + '%' }} />
                    </span>
                  </Link>

                  <div className="flex flex-1 flex-col gap-2 p-4">
                    <h3 className="font-medium leading-snug line-clamp-2">
                      <Link href={'/play-course/' + c.slug} className="hover:text-brand-600">{c.title}</Link>
                    </h3>
                    {typeof c.progress === 'number' && (
                      <>
                        <div className="h-2 rounded-full bg-slate-100">
                          <div className={`h-2 rounded-full ${c.completed ? 'bg-emerald-500' : 'bg-brand-600'}`}
                            style={{ width: pct + '%' }} />
                        </div>
                        <p className="text-xs text-muted">{c.completed ? 'Completed' : `${Math.round(pct)}% complete`}</p>
                      </>
                    )}
                    <Link href={'/play-course/' + c.slug} className="btn-primary mt-auto inline-block text-center text-sm">
                      {pct > 0 ? 'Continue' : 'Start learning'}
                    </Link>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {(summary?.recent_purchases.length ?? 0) > 0 && (
        <section className="mt-10">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Recent purchases</h2>
            <Link href="/purchase-history" className="text-sm text-brand-600 hover:underline">
              All purchases
            </Link>
          </div>
          <ul className="mt-3 divide-y divide-slate-100 rounded-lg border border-slate-200">
            {summary!.recent_purchases.map((p) => (
              <li key={p.kind + p.id} className="flex items-center justify-between px-4 py-3 text-sm">
                <div>
                  <div className="font-medium">{LABEL[p.kind]}</div>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {p.invoice}
                    {p.created_at ? ' - ' + new Date(p.created_at).toLocaleDateString() : ''}
                  </p>
                </div>
                <span className="font-medium">{currency(p.amount, position)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </DashboardShell>
  );
}
