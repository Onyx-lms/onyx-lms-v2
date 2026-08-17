import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { requireSession, apiAuthSafe } from '@/lib/session';
import { DashboardShell } from '@/components/dashboard-shell';
import { STUDENT_NAV, INSTRUCTOR_NAV, ADMIN_NAV } from '@/lib/nav';
import { ClassroomSeats, type Member } from '@/components/classroom-seats';

export const metadata: Metadata = { title: 'Classroom' };
export const dynamic = 'force-dynamic';

interface Payload {
  package: { id: number; title: string | null; allocation: number | null;
             course_id: number | null; expiry_type: string | null };
  members: Member[];
  seats_used: number;
  seats_total: number;
}

const navFor = (role: string) =>
  role === 'admin' ? ADMIN_NAV : role === 'instructor' ? INSTRUCTOR_NAV : STUDENT_NAV;

export default async function ClassroomPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  const { id } = await params;
  const payload = await apiAuthSafe<Payload>(
    '/api/my-team-packages/' + encodeURIComponent(id) + '/members');
  if (!payload) notFound();

  return (
    <DashboardShell role={session.app_role} email={session.email}
      nav={navFor(session.app_role)} title={String(payload.package.title ?? 'Classroom')}>
      <p className="mb-4 text-sm text-slate-600">
        {payload.seats_used} of {payload.seats_total} seats filled. Adding someone
        enrols them on the course; removing them takes that access away again.
      </p>
      <ClassroomSeats
        packageId={payload.package.id}
        members={payload.members}
        seatsUsed={payload.seats_used}
        seatsTotal={payload.seats_total}
      />
    </DashboardShell>
  );
}
