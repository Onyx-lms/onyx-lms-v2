import Link from 'next/link';
import type { Metadata } from 'next';
import { requireRole, apiAuthSafe } from '@/lib/session';
import { DashboardShell } from '@/components/dashboard-shell';
import { ADMIN_NAV } from '@/lib/nav';
import { SettingsForm } from '@/components/settings-form';
import { SETTING_TABS, TAB_LABEL, SETTING_FIELDS, type SettingTab }
  from '@/lib/setting-fields';

export const metadata: Metadata = { title: 'Settings' };
export const dynamic = 'force-dynamic';

/** SET-01 / SET-02 / SET-04 / SET-05 -- the admin settings screens. */
export default async function AdminSettings(
  { searchParams }: { searchParams: Promise<Record<string, string | undefined>> },
) {
  const session = await requireRole('admin');
  const params = await searchParams;
  const tab = (SETTING_TABS as readonly string[]).includes(params['tab'] ?? '')
    ? (params['tab'] as SettingTab) : 'system';
  const values = (await apiAuthSafe<Record<string, unknown>>(
    '/api/admin/settings/' + tab)) ?? {};

  return (
    <DashboardShell role={session.app_role} email={session.email}
      nav={ADMIN_NAV} title="Settings">
      <nav className="mb-5 flex flex-wrap gap-3 text-sm">
        {SETTING_TABS.map((t) => (
          <Link key={t} href={'/admin/settings?tab=' + t}
            className={t === tab
              ? 'font-medium text-brand-700' : 'text-slate-600 hover:text-brand-600'}>
            {TAB_LABEL[t]}
          </Link>
        ))}
      </nav>
      <SettingsForm group={tab} fields={SETTING_FIELDS[tab]} values={values} />
    </DashboardShell>
  );
}
