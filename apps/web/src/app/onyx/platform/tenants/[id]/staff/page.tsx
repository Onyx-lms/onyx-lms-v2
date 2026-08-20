import type { Metadata } from 'next';
import { requirePlatformSession } from '@/lib/onyx-platform-session';
import {
  attempt, ago, SCROLLER, AccountState, RosterHeader, RosterSearch, matchesPerson, Unavailable,
  type PeoplePayload,
} from '@/lib/onyx-platform-tenant';
import {
  CreateProfileForm, MemberEditToggle,
} from '@/components/onyx-platform-forms';
import { DataTable, EmptyRow, Pill } from '@/components/onyx-ui';

export const metadata: Metadata = { title: 'Other roles' };

/**
 * The five membership roles that are neither Students nor Faculty -- each of
 * those two gets its own tab because each has its own facts worth a column
 * (a student's batch, a faculty member's course count). These five do not,
 * so one shared table covers all of them rather than five near-empty tabs.
 *
 * This tab did not exist before: an operator could create a profile for any
 * of these roles (the platform console's own "Create a profile" already
 * offers all seven), and could edit or remove one once they knew its
 * membership id -- but had no way to see who already held one, short of
 * opening the Students or Faculty tab and hoping. Same data, same edit and
 * remove controls those two tabs already have, just reachable now.
 */
const ROLES = ['exams', 'placement', 'employer', 'guardian', 'admin'] as const;
const ROLE_LABEL: Record<string, string> = {
  exams: 'Examinations', placement: 'Placement', employer: 'Employer',
  guardian: 'Parent or guardian', admin: 'Administrator',
};

export default async function OnyxPlatformOtherRolesPage(
  { params, searchParams }: {
    params: Promise<{ id: string }>;
    searchParams: Promise<{ q?: string }>;
  },
) {
  await requirePlatformSession();
  const { id } = await params;
  const { q } = await searchParams;
  const tenantId = Number(id);

  const results = await Promise.all(ROLES.map((role) => attempt<PeoplePayload>(
    '/api/onyx/platform/tenants/' + encodeURIComponent(id) + '/people?role=' + role)));
  const anyFailed = results.some((r) => r === null);
  const people = results.flatMap((r) => r?.people ?? [])
    .filter((p) => matchesPerson(p, q ?? ''))
    .sort((a, b) => a.role.localeCompare(b.role) || a.name.localeCompare(b.name));

  return (
    <div className="min-w-0 space-y-4">

      {anyFailed ? <Unavailable what="staff and guardian list" /> : (
        <>
          {/* No `only` here, unlike Students and Faculty: this tab is five
              roles at once, so the kind genuinely is still an open question
              and the picker earns its place. */}
          {/* Summed across the five reads, not one payload's `total`: this tab
              is five role queries stitched together. */}
          <RosterHeader
            count={q ? people.length : results.reduce((n, r) => n + (r?.total ?? 0), 0)}
            noun="person" plural="people"
            aside={<RosterSearch q={q} placeholder="Name, email or role" />}
            action={<CreateProfileForm lockedTenant={{ id: tenantId }} defaultType="exams"
              cta="Add someone" />}
          />
          <div tabIndex={0} role="region" aria-label="Other roles" className={SCROLLER}>
            <DataTable
              caption="Examinations staff, placement staff, employer contacts, guardians and
                       other administrators at this institution."
              head={
                <>
                  <th scope="col">Member</th>
                  <th scope="col">Role</th>
                  <th scope="col">Account</th>
                  <th scope="col">Joined</th>
                  <th scope="col">&nbsp;</th>
                </>
              }
            >
              {people.length === 0 ? (
                <EmptyRow colSpan={5} icon="user">
                  Nobody holds one of these roles here yet. &ldquo;Add someone&rdquo;
                  above this table creates one.
                </EmptyRow>
              ) : people.map((p) => (
                <tr key={p.user_id} className="align-top">
                  <td>
                    <div className="font-semibold">{p.name}</div>
                    <div className="break-all text-[12.5px] text-muted">{p.email}</div>
                  </td>
                  <td><Pill tone="brand">{ROLE_LABEL[p.role] ?? p.role}</Pill></td>
                  <td><AccountState status={p.account_status} /></td>
                  <td className="whitespace-nowrap text-[12.5px] text-muted">{ago(p.joined_at)}</td>
                  <td className="text-right">
                    <MemberEditToggle tenantId={tenantId} person={p} />
                  </td>
                </tr>
              ))}
            </DataTable>
          </div>
        </>
      )}
    </div>
  );
}
