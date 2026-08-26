import type { Metadata } from 'next';
import { OnyxShell } from '@/components/onyx-shell';
import { OnyxPeople, type Member } from '@/components/onyx-people';
import { navFor } from '@/lib/onyx-nav';
import { requireOnyxPageRole, onyxApi, onyxApiSafe, type Me } from '@/lib/onyx-session';
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
  { searchParams }: { searchParams: Promise<{ role?: string; q?: string }> },
) {
  const claims = await requireOnyxPageRole('admin', 'faculty');
  const { role, q } = await searchParams;
  /*
   * A PAGE of the roster, and a count of the whole of it.
   *
   * This used to fetch every member and render every one. At 1,445 people that
   * was 1.8MB of HTML -- a browser parsing 1,445 table rows before anybody
   * could read the first name -- and it was not even the whole roster: the
   * read had no range, so it silently stopped at a thousand and 445 people
   * were missing with nothing saying so.
   *
   * So the server searches and the server counts. `PAGE` rows arrive, the
   * heading says how many there are in all, and the search box is a GET form
   * -- the query lives in the URL, survives a reload, and can be sent to a
   * colleague, which a box that filters an array in the browser cannot do.
   */
  const PAGE = 100;
  const query = '?limit=' + PAGE
    + (role ? '&role=' + encodeURIComponent(role) : '')
    + (q ? '&search=' + encodeURIComponent(q) : '');
  const [me, members, counts, sections] = await Promise.all([
    onyxApi<Me>('/api/onyx/me'),
    onyxApi<Member[]>('/api/onyx/members' + query),
    onyxApiSafe<{ total: number; by_role: Record<string, number> }>(
      '/api/onyx/members/count' + (role ? '?role=' + encodeURIComponent(role) : '')),
    // For the add form's division picker. Safe if it fails: an institution
    // that runs no sections simply is not offered one.
    onyxApiSafe<{ id: number; name: string; status: number }[]>('/api/onyx/sections'),
  ]);
  /** How many there are in all, which is not how many are on this page. */
  const total = counts?.total ?? members.length;
  const capped = members.length >= PAGE && total > members.length;
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
  /*
   * Counted by the server, not by the rows on this page.
   *
   * The strip used to tally the array it had been handed, which was right
   * while that array was everybody and became a lie the moment it was a page:
   * "100 students" under a heading saying 1,440.
   */
  const count = (...roles: Member['role'][]) =>
    roles.reduce((sum, r) => sum + (counts?.by_role?.[r] ?? 0), 0);

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
        initialRole={initialRole} tenantName={me.tenant.name}
        search={q ?? ''}
        total={total}
        capped={capped}
        sections={(sections ?? []).filter((sx) => sx.status === 1)
          .map((sx) => ({ id: Number(sx.id), name: String(sx.name) }))} />

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
                // A uuid, so NOT numeric: CreatePanel runs Number() over a
                // numeric field and a uuid becomes NaN, which JSON sends as null and
                // the route refuses. Left over from when user ids were bigints.
                wide: true,
                options: members.filter((m) => m.role === 'guardian' && m.user)
                  .map((m) => ({ value: String(m.user!.id), label: m.user!.name })) },
              { name: 'student_user_id', label: 'Student', type: 'select', required: true,
                // A uuid, so NOT numeric: CreatePanel runs Number() over a
                // numeric field and a uuid becomes NaN, which JSON sends as null and
                // the route refuses. Left over from when user ids were bigints.
                wide: true,
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
