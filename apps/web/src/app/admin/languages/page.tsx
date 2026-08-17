import type { Metadata } from 'next';
import { requireRole, apiAuthSafe } from '@/lib/session';
import { DashboardShell } from '@/components/dashboard-shell';
import { ADMIN_NAV } from '@/lib/nav';
import { LanguageList, type Language } from '@/components/admin-lists';

export const metadata: Metadata = { title: 'Languages' };
export const dynamic = 'force-dynamic';

/** SET-06 -- the language manager. */
export default async function AdminLanguages() {
  const session = await requireRole('admin');
  const languages = (await apiAuthSafe<Language[]>('/api/admin/languages')) ?? [];

  return (
    <DashboardShell role={session.app_role} email={session.email}
      nav={ADMIN_NAV} title="Languages">
      <p className="mb-4 max-w-2xl text-sm text-slate-600">
        A new language starts with a copy of every known phrase so there is
        something to translate. The site language cannot be deleted while it is
        in use.
      </p>
      <LanguageList rows={languages} />
    </DashboardShell>
  );
}
