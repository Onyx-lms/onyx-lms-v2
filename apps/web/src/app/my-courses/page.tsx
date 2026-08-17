import Link from 'next/link';
import type { Metadata } from 'next';
import { requireSession, apiAuthSafe } from '@/lib/session';
import { DashboardShell } from '@/components/dashboard-shell';
import { STUDENT_NAV } from '@/lib/nav';

export const metadata: Metadata = { title: 'My courses' };

interface EnrolledCourse {
  id: number; enrollment_id: number; title: string | null; slug: string | null;
  thumbnail: string | null; progress: number; completed: boolean;
  expired: boolean; expiry_date: string | null;
}

export default async function MyCoursesPage() {
  const session = await requireSession();
  const courses = (await apiAuthSafe<EnrolledCourse[]>('/api/me/courses')) ?? [];

  return (
    <DashboardShell role={session.app_role} email={session.email}
      nav={STUDENT_NAV} title="My courses">
      {courses.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 p-10 text-center">
          <p className="text-sm text-slate-600">You are not enrolled in any courses yet.</p>
          <Link href="/courses" className="btn-primary mt-4">Browse the catalogue</Link>
        </div>
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {courses.map((c) => {
            const pct = Math.min(100, Math.max(0, c.progress));
            const watchHref = c.expired ? `/course/${c.slug}` : `/play-course/${c.slug}`;
            return (
              <article key={c.enrollment_id}
                className="card group flex flex-col transition duration-300 ease-out hover:-translate-y-1 hover:shadow-lift">
                {/* Video holder: thumbnail, play glyph and a continue-watching strip. */}
                <Link href={watchHref}
                  className="relative block aspect-video w-full overflow-hidden bg-gradient-to-br from-brand-700 to-brand-900">
                  {c.thumbnail ? (
                    <img src={c.thumbnail} alt=""
                      className="h-full w-full object-cover transition duration-500 ease-out group-hover:scale-105"
                      loading="lazy" />
                  ) : (
                    <span aria-hidden className="absolute inset-0 bg-gradient-to-br from-brand-600 via-brand-700 to-brand-900" />
                  )}

                  <span aria-hidden
                    className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/65 via-black/5 to-black/10" />

                  {c.completed ? (
                    <span className="absolute left-3 top-3 chip border-transparent bg-white/95 font-semibold text-emerald-700 shadow-card">
                      Completed
                    </span>
                  ) : c.expired ? (
                    <span className="absolute left-3 top-3 chip border-transparent bg-white/95 font-semibold text-red-700 shadow-card">
                      Access expired
                    </span>
                  ) : pct > 0 ? (
                    <span className="absolute left-3 top-3 chip border-transparent bg-white/95 font-semibold text-brand-700 shadow-card">
                      In progress
                    </span>
                  ) : null}

                  <span className="absolute inset-0 flex items-center justify-center">
                    <span aria-hidden
                      className="grid h-12 w-12 scale-95 place-items-center rounded-full bg-white/90 text-brand-700 opacity-90 shadow-card transition duration-300 ease-out group-hover:scale-105 group-hover:opacity-100 group-hover:shadow-lift">
                      <svg viewBox="0 0 24 24" width="18" height="18">
                        <path d="M8 5.5v13l11-6.5z" fill="currentColor" />
                      </svg>
                    </span>
                  </span>

                  {!c.expired && (
                    <span aria-hidden className="absolute inset-x-0 bottom-0 h-1.5 bg-white/25">
                      <span className={`block h-full ${c.completed ? 'bg-emerald-400' : 'bg-brand-400'}`}
                        style={{ width: `${pct}%` }} />
                    </span>
                  )}
                </Link>

                <div className="flex flex-1 flex-col gap-3 p-4">
                  <h2 className="font-semibold leading-snug line-clamp-2">
                    <Link href={watchHref} className="hover:text-brand-600">{c.title}</Link>
                  </h2>

                  <div>
                    <div className="flex items-center justify-between text-xs text-muted">
                      <span>{c.completed ? 'Completed' : `${Math.round(pct)}% complete`}</span>
                    </div>
                    <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-slate-100">
                      <div className={`h-full rounded-full ${c.completed ? 'bg-emerald-500' : 'bg-brand-600'}`}
                        style={{ width: `${pct}%` }} />
                    </div>
                  </div>

                  {c.expired && (
                    <p className="text-xs text-red-600">
                      Access expired. You need to buy it again.
                    </p>
                  )}

                  <div className="mt-auto pt-1">
                    <Link href={c.expired ? `/course/${c.slug}` : watchHref}
                      className={c.expired ? 'btn-ghost w-full' : 'btn-primary w-full'}
                    >
                      {c.expired ? 'View course' : pct > 0 ? 'Continue' : 'Start learning'}
                    </Link>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </DashboardShell>
  );
}
