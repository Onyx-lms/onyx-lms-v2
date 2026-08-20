import type { Metadata } from 'next';
import { OnyxShell } from '@/components/onyx-shell';
import { OnyxPeople, type Member } from '@/components/onyx-people';
import { navFor } from '@/lib/onyx-nav';
import { requireOnyxPageRole, onyxApi, type Me } from '@/lib/onyx-session';
import { CreatePanel } from '@/components/onyx-create';
import { SectionHead, StatTile } from '@/components/onyx-ui';

export const metadata: Metadata = { title: 'People' };

const ROLE_TITLE: Partial<Record<Member['role'], string>> = {
  student: 'Students', faculty: 'Faculty',
};

/** F-04 / F-06 -- the roster. Faculty may read it; administrators may change it.
 * `?role=` narrows it to one role -- the Students and Faculty nav links land
 * here with it set, rather than needing their own pages for what is the same
 * roster with a different starting filter. */
export default async function OnyxPeoplePage(
  { searchParams }: { searchParams: Promise<{ role?: string }> },
) {
  const claims = await requireOnyxPageRole('admin', 'faculty');
  const { role } = await searchParams;
  const [me, members] = await Promise.all([
    onyxApi<Me>('/api/onyx/me'),
    onyxApi<Member[]>('/api/onyx/members'),
  ]);
  const initialRole = role as Member['role'] | undefined;

  /**
   * A headcount by role, which is the question the strip answers.
   *
   * Deliberately not a filter: the roster below has its own search, and two
   * controls answering "who is here" from the same data is how the same five
   * numbers end up on a screen twice and disagreeing. The account-state tabs
   * the design shows -- active, invited, suspended -- have nothing behind
   * them: `/api/onyx/members` returns a role and a user, and no lifecycle.
   */
  const count = (...roles: Member['role'][]) =>
    members.filter((m) => roles.includes(m.role)).length;

  return (
    <OnyxShell
      me={me}
      nav={navFor(me.role)}
      title={initialRole && ROLE_TITLE[initialRole] ? ROLE_TITLE[initialRole] : 'People'}
      subtitle={'Everyone at ' + me.tenant.name + '. Nobody from anywhere else.'}
    >
      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Students" value={count('student')} note="enrolled at this institution" />
        <StatTile label="Teaching" value={count('faculty')} note="faculty accounts" />
        <StatTile label="Staff" value={count('admin', 'exams', 'placement')}
          note="registry, exams, careers" />
        <StatTile label="Outside" value={count('guardian', 'employer')}
          note="guardians and employers" />
      </div>

      <SectionHead title="Roster" />
      <OnyxPeople members={members} canEdit={claims.tenant_role === 'admin'}
        initialRole={initialRole} tenantName={me.tenant.name} />

      {/* CMP-04: a guardian is a member of the institution in their own right,
          linked to a student. The link starts unaccepted -- the guardian
          confirms it themselves, so an administrator cannot quietly hand
          somebody's attendance and results to a third party. */}
      {claims.tenant_role === 'admin' ? (
        <div className="mt-7">
          <SectionHead title="Family links" />
          <CreatePanel
            title="Link a guardian to a student" cta="Link a guardian" icon="users" compact
            endpoint="guardians"
            fields={[
              { name: 'guardian_user_id', label: 'Guardian', type: 'select', required: true,
                numeric: true, wide: true,
                options: members.filter((m) => m.role === 'guardian' && m.user)
                  .map((m) => ({ value: String(m.user!.id), label: m.user!.name })) },
              { name: 'student_user_id', label: 'Student', type: 'select', required: true,
                numeric: true, wide: true,
                options: members.filter((m) => m.role === 'student' && m.user)
                  .map((m) => ({ value: String(m.user!.id), label: m.user!.name })) },
              { name: 'relationship', label: 'Relationship', placeholder: 'Parent' },
            ]}
          />
        </div>
      ) : null}
    </OnyxShell>
  );
}
