import type { Metadata } from 'next';
import { requireRole, apiAuthSafe } from '@/lib/session';
import { DashboardShell } from '@/components/dashboard-shell';
import { ADMIN_NAV } from '@/lib/nav';
import { LiveClassSettingsForm, type LiveClassSettings } from '@/components/live-class-settings-form';

export const metadata: Metadata = { title: 'Live class settings' };
export const dynamic = 'force-dynamic';

/** LC-06 -- the Zoom credential screen. Secrets are write-only. */
export default async function LiveClassSettingsPage() {
  const session = await requireRole('admin');
  const settings = await apiAuthSafe<LiveClassSettings>('/api/admin/live-class-settings');

  return (
    <DashboardShell role={session.app_role} email={session.email}
      nav={ADMIN_NAV} title="Live class settings">
      <p className="mb-4 max-w-2xl text-sm text-slate-600">
        Jitsi classes work with no configuration at all. Zoom needs a
        Server-to-Server OAuth app to create meetings, and a Meeting SDK app if
        you want classes to run inside this site rather than in the Zoom client.
      </p>
      <LiveClassSettingsForm settings={settings} />
    </DashboardShell>
  );
}
