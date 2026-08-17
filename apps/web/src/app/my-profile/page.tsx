import type { Metadata } from 'next';
import { requireSession, apiAuth } from '@/lib/session';
import { DashboardShell } from '@/components/dashboard-shell';
import { STUDENT_NAV, INSTRUCTOR_NAV, ADMIN_NAV } from '@/lib/nav';
import { ProfileForm } from '@/components/profile-form';

export const metadata: Metadata = { title: 'My profile' };

interface Profile {
  id: number; name: string | null; email: string; role: string;
  phone: string | null; address: string | null; about: string | null;
  skills: string[]; educations: unknown[];
}

export default async function MyProfilePage() {
  const session = await requireSession();
  const profile = await apiAuth<Profile>('/api/me');
  const nav = session.app_role === 'admin' ? ADMIN_NAV
    : session.app_role === 'instructor' ? INSTRUCTOR_NAV : STUDENT_NAV;

  return (
    <DashboardShell role={session.app_role} email={session.email} nav={nav} title="My profile">
      <div className="grid gap-8 lg:grid-cols-2">
        <div className="card p-6">
          <h2 className="text-sm font-semibold text-slate-900">Details</h2>
          <ProfileForm profile={profile} />
        </div>
        <div className="card h-fit p-6">
          <h2 className="text-sm font-semibold text-slate-900">Change password</h2>
          <ProfileForm profile={profile} mode="password" />
        </div>
      </div>
    </DashboardShell>
  );
}
