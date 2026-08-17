import type { Metadata } from 'next';
import { requireRole, apiAuthSafe } from '@/lib/session';
import { DashboardShell } from '@/components/dashboard-shell';
import { INSTRUCTOR_NAV, ADMIN_NAV } from '@/lib/nav';
import { TutorOffers } from '@/components/tutor-offers';
import type { Offer, Slot, Term } from '@/components/tutoring-admin';

export const metadata: Metadata = { title: 'Tutoring' };
export const dynamic = 'force-dynamic';

/** TB-02 / TB-03 -- an instructor's tutoring subjects and availability. */
export default async function InstructorTutoring() {
  const session = await requireRole('instructor', 'admin');
  const [offers, slots, categories, subjects] = await Promise.all([
    apiAuthSafe<Offer[]>('/api/tutor/me/subjects'),
    apiAuthSafe<Slot[]>('/api/tutor/me/schedules'),
    apiAuthSafe<Term[]>('/api/tutor/categories'),
    apiAuthSafe<Term[]>('/api/tutor/subjects'),
  ]);

  return (
    <DashboardShell role={session.app_role} email={session.email}
      nav={session.app_role === 'admin' ? ADMIN_NAV : INSTRUCTOR_NAV} title="Tutoring">
      {(categories ?? []).length === 0 ? (
        <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          An admin needs to add tutor categories and subjects before you can offer sessions.
        </p>
      ) : (
        <TutorOffers offers={offers ?? []} slots={slots ?? []}
          categories={categories ?? []} subjects={subjects ?? []} />
      )}
    </DashboardShell>
  );
}
