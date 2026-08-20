import type { Metadata } from 'next';
import { requirePlatformSession } from '@/lib/onyx-platform-session';
import { attempt, Unavailable } from '@/lib/onyx-platform-tenant';
import { PermissionMatrix, type CapabilityRow } from '@/components/onyx-permissions';

export const metadata: Metadata = { title: 'Permissions' };

interface Payload {
  capabilities: CapabilityRow[];
  areas: string[];
  tenant: { id: number; name: string };
}

/**
 * One institution's permission matrix, from the platform console.
 *
 * A platform admin already holds everything everywhere -- this is not how they
 * get their own reach. It is the same screen the institution's administrator
 * has, reachable when the person who needs it changed is on the phone rather
 * than in the console, which is most of what a support call about permissions
 * actually is.
 *
 * Saves are recorded in the PLATFORM audit log against the operator, not in
 * the institution's own log. An operator changing a customer's permissions
 * should be visible as an act of the platform.
 */
export default async function OnyxPlatformPermissionsPage(
  { params }: { params: Promise<{ id: string }> },
) {
  await requirePlatformSession();
  const { id } = await params;
  const tenantId = Number(id);
  const data = await attempt<Payload>(
    '/api/onyx/platform/tenants/' + encodeURIComponent(id) + '/permissions');

  return (
    <div className="min-w-0 space-y-4">
      {data === null ? <Unavailable what="permissions" /> : (
        <PermissionMatrix
          capabilities={data.capabilities}
          areas={data.areas}
          canEdit
          scope={{
            endpoint: '/api/proxy/onyx/platform/tenants/' + tenantId + '/permissions',
            institution: data.tenant?.name,
          }}
        />
      )}
    </div>
  );
}
