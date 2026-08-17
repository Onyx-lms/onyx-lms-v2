import type { Metadata } from 'next';
import { requireSession, apiAuthSafe } from '@/lib/session';
import { DashboardShell } from '@/components/dashboard-shell';
import { STUDENT_NAV, INSTRUCTOR_NAV, ADMIN_NAV } from '@/lib/nav';
import { InstructorApplicationForm, type MyApplication }
  from '@/components/instructor-application-form';

export const metadata: Metadata = { title: 'Become an instructor' };
export const dynamic = 'force-dynamic';

const navFor = (role: string) =>
  role === 'admin' ? ADMIN_NAV : role === 'instructor' ? INSTRUCTOR_NAV : STUDENT_NAV;

/** SET-09 -- the student-facing application. */
export default async function BecomeInstructor() {
  const session = await requireSession();
  const payload = await apiAuthSafe<{
    open: boolean; note: string | null; application: MyApplication | null;
  }>('/api/me/instructor-application');

  return (
    <DashboardShell role={session.app_role} email={session.email}
      nav={navFor(session.app_role)} title="Become an instructor">
      {session.app_role === 'instructor' || session.app_role === 'admin' ? (
        <p className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
          You can already publish courses.
        </p>
      ) : (
        <InstructorApplicationForm
          open={payload?.open ?? false}
          note={payload?.note ?? null}
          application={payload?.application ?? null}
        />
      )}
    </DashboardShell>
  );
}
