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

export const metadata: Metadata = { title: 'Faculty' };

export default async function OnyxPlatformFacultyPage(
  { params, searchParams }: {
    params: Promise<{ id: string }>;
    searchParams: Promise<{ q?: string }>;
  },
) {
  await requirePlatformSession();
  const { id } = await params;
  const { q } = await searchParams;
  const tenantId = Number(id);
  const people = await attempt<PeoplePayload>(
    '/api/onyx/platform/tenants/' + encodeURIComponent(id) + '/people?role=faculty');
  const all = people?.people ?? [];
  const faculty = all.filter((p) => matchesPerson(p, q ?? ''));

  return (
    <div className="min-w-0 space-y-4">

      {people === null ? <Unavailable what="staff list" /> : (
        <>
          <RosterHeader
            count={q ? faculty.length : people.total} noun="faculty member"
            aside={<RosterSearch q={q} placeholder="Name or email" />}
            action={<CreateProfileForm lockedTenant={{ id: tenantId }} only="faculty" />}
          />
          <div tabIndex={0} role="region" aria-label="Faculty" className={SCROLLER}>
            <DataTable
              caption="Teaching staff at this institution and how many courses each one is attached to."
              head={
                <>
                  <th scope="col">Member</th>
                  <th scope="col">Role</th>
                  <th scope="col">Courses</th>
                  <th scope="col">Account</th>
                  <th scope="col" className="hidden sm:table-cell">Joined</th>
                  <th scope="col">&nbsp;</th>
                </>
              }
            >
              {faculty.length === 0 ? (
                <EmptyRow colSpan={6} icon="user">
                  Nobody teaches here yet. Courses can exist without faculty, but
                  nothing on them will be marked until somebody is attached.
                </EmptyRow>
              ) : faculty.map((p) => (
                <tr key={p.user_id} className="align-top">
                  <td>
                    <div className="font-semibold">{p.name}</div>
                    <div className="break-all text-[12.5px] text-muted">{p.email}</div>
                  </td>
                  <td><Pill tone="brand">{p.role}</Pill></td>
                  <td className="tabular-nums">{p.teaching_count}</td>
                  <td><AccountState status={p.account_status} /></td>
                  <td className="hidden whitespace-nowrap text-[12.5px] text-muted sm:table-cell">
                    {ago(p.joined_at)}
                  </td>
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
