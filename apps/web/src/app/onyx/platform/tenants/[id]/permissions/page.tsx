import type { Metadata } from 'next';
import { requirePlatformSession } from '@/lib/onyx-platform-session';
import { attempt, Unavailable } from '@/lib/onyx-platform-tenant';
import { PermissionMatrix, type CapabilityRow } from '@/components/onyx-permissions';
import { PersonPermissions, type PersonRow } from '@/components/onyx-person-permissions';
import { SectionHead } from '@/components/onyx-ui';

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

  /*
   * Everybody at the institution, so one of them can be found by name or by
   * roll number.
   *
   * The matrix answers "what may faculty do". It cannot answer the question
   * institutions actually ask, which is always about somebody in particular --
   * the lecturer who also runs the timetable, the one exams officer trusted
   * with the fee structures. Answering those through the matrix means
   * promoting everybody who shares their role.
   */
  const people = (await attempt<{
    people: {
      membership_id: number; user_id: string; name: string; email: string;
      role: string; roll_number: string | null;
    }[];
  }>('/api/onyx/platform/tenants/' + encodeURIComponent(id) + '/people?limit=200'))?.people ?? [];

  const roster: PersonRow[] = people.map((p) => ({
    id: p.membership_id,
    user_id: p.user_id,
    role: p.role,
    name: p.name,
    email: p.email,
    roll_number: p.roll_number,
  }));

  return (
    <div className="min-w-0 space-y-6">
      {data === null ? <Unavailable what="permissions" /> : (
        <>
          <section>
            <SectionHead title="By role" />
            <p className="mb-3 max-w-2xl text-[13px] leading-relaxed text-muted">
              Two decisions on one screen. <strong>Enabled</strong> is the platform’s:
              whether this institution may do the thing at all, administrators included.
              The role ticks are the institution’s own, and it may edit them itself.
            </p>
            <PermissionMatrix
              capabilities={data.capabilities}
              areas={data.areas}
              canEdit
              scope={{
                endpoint: '/api/proxy/onyx/platform/tenants/' + tenantId + '/permissions',
                institution: data.tenant?.name,
              }}
              /*
               * The operator's own column, and the only place it exists. An
               * institution editing its own matrix cannot reach this: what the
               * platform withholds is not the customer's to grant back.
               */
              platform={{
                endpoint: '/api/proxy/onyx/platform/tenants/' + tenantId
                  + '/permissions/denials',
              }}
            />
          </section>

          <section>
            <SectionHead title="By person" />
            <p className="mb-3 max-w-2xl text-[13px] leading-relaxed text-muted">
              Find somebody by name, roll number or email, and give or take one capability
              from them without touching anybody else who shares their role. A grant is
              recorded against the person, so the same human can be faculty here and a
              student elsewhere without carrying it across.
            </p>
            {roster.length === 0 ? (
              <p className="text-[13px] text-muted">
                This institution has no members yet.
              </p>
            ) : (
              <PersonPermissions
                people={roster}
                basePath={'/api/proxy/onyx/platform/tenants/' + tenantId + '/members'}
              />
            )}
          </section>
        </>
      )}
    </div>
  );
}
