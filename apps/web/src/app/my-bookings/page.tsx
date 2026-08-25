import Link from 'next/link';
import type { Metadata } from 'next';
import { requireSession, apiAuthSafe } from '@/lib/session';
import { DashboardShell } from '@/components/dashboard-shell';
import { STUDENT_NAV, INSTRUCTOR_NAV, ADMIN_NAV } from '@/lib/nav';

export const metadata: Metadata = { title: 'My sessions' };
export const dynamic = 'force-dynamic';

interface Booking {
  id: number; invoice: string | null; price: number | null;
  start_time: number | null; end_time: number | null;
  tab: 'live' | 'upcoming' | 'archive'; startable: boolean;
  tutor: { id: number; name: string | null } | null;
  student: { id: number; name: string | null } | null;
  schedule: { duration: number | null } | null;
}
interface Payload { live: Booking[]; upcoming: Booking[]; archive: Booking[] }

const navFor = (role: string) =>
  role === 'admin' ? ADMIN_NAV : role === 'instructor' ? INSTRUCTOR_NAV : STUDENT_NAV;

const when = (seconds: number | null) =>
  seconds ? new Date(Number(seconds) * 1000).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : '';

function Group({ title, rows, asTutor }: {
  title: string; rows: Booking[]; asTutor: boolean;
}) {
  if (rows.length === 0) return null;
  return (
    <section className="mt-6">
      <h2 className="text-sm font-semibold">{title}</h2>
      <ul className="mt-3 divide-y divide-slate-100 rounded-lg border border-slate-200">
        {rows.map((b) => (
          <li key={b.id} className="flex items-center justify-between px-4 py-3 text-sm">
            <div>
              <div className="font-medium">
                {asTutor ? b.student?.name ?? 'Student' : b.tutor?.name ?? 'Tutor'}
              </div>
              <p className="mt-0.5 text-xs text-slate-500">
                {when(b.start_time)}
                {b.schedule?.duration ? ' - ' + b.schedule.duration + ' minutes' : ''}
                {b.invoice ? ' - ' + b.invoice : ''}
              </p>
            </div>
            {b.tab === 'archive' ? (
              <span className="text-xs text-slate-400">Finished</span>
            ) : b.tab === 'live' ? (
              <Link href={'/tuition/' + b.id} className="btn-primary px-3 py-1 text-xs">
                Join now
              </Link>
            ) : (
              <span className="text-xs text-slate-400">Not open yet</span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

export default async function MyBookings(
  { searchParams }: { searchParams: Promise<Record<string, string | undefined>> },
) {
  const session = await requireSession();
  const params = await searchParams;
  const asTutor = params['as'] === 'tutor';
  const data = await apiAuthSafe<Payload>('/api/my-bookings' + (asTutor ? '?as=tutor' : ''));
  const empty = !data || (data.live.length + data.upcoming.length + data.archive.length) === 0;

  return (
    <DashboardShell role={session.app_role} email={session.email}
      nav={navFor(session.app_role)} title="My sessions">
      {session.app_role !== 'student' && (
        <nav className="flex gap-3 text-sm">
          <Link href="/my-bookings"
            className={!asTutor ? 'font-medium text-brand-700' : 'text-slate-600'}>
            As a student
          </Link>
          <Link href="/my-bookings?as=tutor"
            className={asTutor ? 'font-medium text-brand-700' : 'text-slate-600'}>
            As a tutor
          </Link>
        </nav>
      )}

      {empty ? (
        <p className="mt-6 rounded-lg border border-dashed border-slate-300 p-10 text-center text-sm text-slate-500">
          No sessions yet.{' '}
          <Link href="/tutors" className="text-brand-700 underline">Find a tutor</Link>
        </p>
      ) : (
        <>
          <Group title="Happening now" rows={data!.live} asTutor={asTutor} />
          <Group title="Upcoming" rows={data!.upcoming} asTutor={asTutor} />
          <Group title="Past" rows={data!.archive} asTutor={asTutor} />
        </>
      )}
    </DashboardShell>
  );
}
