import type { Metadata } from 'next';
import { OnyxShell } from '@/components/onyx-shell';
import { navFor } from '@/lib/onyx-nav';
import { requireOnyxPageRole, onyxApi, onyxApiSafe, type Me } from '@/lib/onyx-session';
import { PermissionMatrix, type CapabilityRow } from '@/components/onyx-permissions';
import { PersonPermissions, type PersonRow } from '@/components/onyx-person-permissions';
import { SectionHead } from '@/components/onyx-ui';

export const metadata: Metadata = { title: 'Roles and permissions' };

interface PermissionsPayload {
  capabilities: CapabilityRow[];
  areas: string[];
  mine: string[];
}

interface Member {
  id: number; user_id: string; role: string; roll_number: string | null;
  user: { name: string | null; email: string | null } | null;
}

/**
 * Who may do what — by role, and by person.
 *
 * This used to be a section on Settings, which put "how this institution runs"
 * and "who is allowed to run it" on one page under one heading. They are
 * different questions asked by different people at different times: settings
 * are about the site, permissions are about authority. So permissions have
 * their own screen and Settings keeps the rest.
 *
 * The two halves answer two different questions and both are needed:
 *
 *   * **The matrix** is the standing rule — what faculty may do, what the
 *     examinations office may do. It is where the answer for most people
 *     lives, and changing it changes it for everybody in that role at once.
 *
 *   * **A person** is the exception, and exceptions are what institutions
 *     actually ask for: the lecturer who also runs the timetable, the one
 *     exams officer trusted with fee structures. Before this, granting that
 *     meant promoting their whole role.
 *
 * The matrix first, because it is the rule and the person is the exception to
 * it — reading them the other way round invites somebody to solve a
 * one-person problem by changing what a role means.
 */
export default async function OnyxPermissionsPage() {
  await requireOnyxPageRole('admin');
  const [me, permissions, members] = await Promise.all([
    onyxApi<Me>('/api/onyx/me'),
    onyxApi<PermissionsPayload>('/api/onyx/permissions'),
    onyxApiSafe<Member[]>('/api/onyx/members'),
  ]);

  const canEdit = permissions.mine.includes('settings.manage');
  const people: PersonRow[] = (members ?? []).map((m) => ({
    id: m.id,
    user_id: m.user_id,
    role: m.role,
    name: m.user?.name ?? null,
    email: m.user?.email ?? null,
    roll_number: m.roll_number ?? null,
  }));

  return (
    <OnyxShell
      me={me}
      nav={navFor(me.role)}
      title="Roles and permissions"
      subtitle="What each role may do here, and what has been decided about one person."
    >
      <div className="space-y-8">
        <section>
          <SectionHead title="By role" />
          <PermissionMatrix
            capabilities={permissions.capabilities}
            areas={permissions.areas}
            canEdit={canEdit}
            scope={{ endpoint: '/api/proxy/onyx/permissions' }}
          />
        </section>

        <section>
          <SectionHead title="By person" />
          <p className="mb-3 max-w-2xl text-[13px] leading-relaxed text-muted">
            For the exceptions. Search by name, roll number or email, and give or take a
            capability from that one person — their role, and everybody else who shares it,
            is left alone. Anything a role may never hold is not offered here either.
          </p>
          {canEdit ? (
            <PersonPermissions people={people} />
          ) : (
            <p className="text-[13px] text-muted">
              Changing permissions is itself a permission, and yours does not include it.
            </p>
          )}
        </section>
      </div>
    </OnyxShell>
  );
}
