import type { Metadata } from 'next';
import { OnyxPlatformShell } from '@/components/onyx-platform-shell';
import { GrantAdminForm, AdminManageToggle } from '@/components/onyx-platform-forms';
import { requirePlatformSession, platformApi } from '@/lib/onyx-platform-session';
import { Empty, Pill } from '@/components/onyx-ui';

export const metadata: Metadata = { title: 'Operators' };

interface AdminRow {
  id: number; user_id: number; created_at: string;
  user: { id: number; name: string; email: string } | null;
}

/** Who else can do everything this page can. */
export default async function OnyxPlatformAdminsPage() {
  const session = await requirePlatformSession();
  const admins = await platformApi<AdminRow[]>('/api/onyx/platform/admins');

  return (
    <OnyxPlatformShell
      email={session.email}
      breadcrumb={[{ label: 'Platform' }, { label: 'Operators' }]}
      title="Operators"
      subtitle={admins.length === 1
        ? 'One operator.'
        : admins.length + ' operators.'}
      action={<GrantAdminForm />}
    >
      <div className="space-y-6">
        {/* Everyone on this list can suspend an institution and grant this
            power to somebody else, so the list is short on purpose and the
            page says as much rather than leaving it to be inferred. */}
        <div className="rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm
                        text-amber-900">
          Everyone here can create, suspend and read every institution on the platform, and
          can grant that to anyone else. The last one cannot be revoked — a platform with no
          operator is one nobody can get back into.
        </div>

        <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line
                       bg-white shadow-card">
          {admins.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center gap-3 px-4 py-3.5">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full
                               bg-gradient-to-br from-brand-500 to-brand-700 text-[13px]
                               font-bold text-white" aria-hidden="true">
                {(a.user?.name ?? a.user?.email ?? '?').slice(0, 2).toUpperCase()}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15px] font-semibold">
                  {a.user?.name ?? 'User #' + a.user_id}
                </span>
                <span className="block truncate text-[12.5px] text-muted">
                  {a.user?.email}
                  {' · granted '}
                  {new Date(a.created_at).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric' })}
                </span>
              </span>
              {admins.length > 1
                ? <AdminManageToggle admin={{
                  id: a.id,
                  name: a.user?.name ?? 'User #' + a.user_id,
                  email: a.user?.email ?? '—',
                  granted_at: a.created_at,
                }} />
                : <Pill tone="neutral">Last operator</Pill>}
            </li>
          ))}
          {admins.length === 0 ? (
            <li><Empty icon="shield">Nobody holds platform admin yet.</Empty></li>
          ) : null}
        </ul>
      </div>
    </OnyxPlatformShell>
  );
}
