import type { Metadata } from 'next';
import { OnyxPlatformShell } from '@/components/onyx-platform-shell';
import { OAuthClientManageToggle } from '@/components/onyx-platform-forms';
import { requirePlatformSession, platformApi } from '@/lib/onyx-platform-session';
import { Empty, Pill } from '@/components/onyx-ui';

export const metadata: Metadata = { title: 'OAuth clients' };

interface OAuthClient {
  client_id: string;
  client_name?: string;
  client_type: 'public' | 'confidential';
  redirect_uris: string[];
  grant_types: string[];
  registration_type: 'dynamic' | 'manual';
  created_at: string;
}

/**
 * OAuth Server Mode -- visibility, not registration (F-08 v2,
 * docs/ADR-011-supabase-auth-migration.md). A third-party app registers
 * itself against Supabase Auth's own /oauth/clients/register endpoint
 * directly; nothing on this page performs registration. This exists so a
 * platform admin can see what has registered against the project and take
 * one away if it should not have -- the same shape as the platform-admins
 * page, one door over.
 */
export default async function OnyxOAuthClientsPage() {
  const session = await requirePlatformSession();
  const clients = await platformApi<OAuthClient[]>('/api/onyx/platform/oauth-clients');

  return (
    <OnyxPlatformShell
      email={session.email}
      title="OAuth clients"
      subtitle={clients.length === 0
        ? 'No third-party app has registered yet.'
        : clients.length + ' registered ' + (clients.length === 1 ? 'client' : 'clients') + '.'}
    >
      <div className="space-y-6">
        <div className="rounded-2xl border border-line bg-white px-4 py-3 text-sm text-muted">
          Any app can register itself here through Supabase&rsquo;s own OAuth
          endpoint — that is what Dynamic Client Registration means. This
          page does not create a registration; it shows who already has one,
          so it can be taken away if it should not have it. A registered
          client can request a signed-in user&rsquo;s consent to act on
          their behalf; it never gets a password, and every request it
          makes is still governed by that user&rsquo;s own tenant role and
          RLS, exactly as if they had signed in directly.
        </div>

        <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line
                       bg-white shadow-card">
          {clients.map((c) => (
            <li key={c.client_id} className="flex flex-wrap items-center gap-3 px-4 py-3.5">
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span className="truncate text-[15px] font-semibold">
                    {c.client_name ?? 'Unnamed client'}
                  </span>
                  <Pill tone={c.client_type === 'confidential' ? 'brand' : 'neutral'}>
                    {c.client_type}
                  </Pill>
                </span>
                <span className="block truncate text-[12.5px] text-muted">
                  {c.client_id}
                  {' · '}
                  {c.redirect_uris[0] ?? 'no redirect URI'}
                  {c.redirect_uris.length > 1 ? ' +' + (c.redirect_uris.length - 1) + ' more' : ''}
                </span>
                <span className="block truncate text-[12px] text-faint">
                  {c.registration_type === 'dynamic' ? 'Self-registered' : 'Registered manually'}
                  {' · '}
                  {new Date(c.created_at).toLocaleDateString(undefined,
                    { day: 'numeric', month: 'short', year: 'numeric' })}
                </span>
              </span>
              <OAuthClientManageToggle client={c} />
            </li>
          ))}
          {clients.length === 0 ? (
            <li><Empty icon="shield">Nobody has registered an OAuth client yet.</Empty></li>
          ) : null}
        </ul>
      </div>
    </OnyxPlatformShell>
  );
}
