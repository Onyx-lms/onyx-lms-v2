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

export const metadata: Metadata = { title: 'Students' };

export default async function OnyxPlatformStudentsPage(
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
    '/api/onyx/platform/tenants/' + encodeURIComponent(id) + '/people?role=student');
  const all = people?.people ?? [];
  const students = all.filter((p) => matchesPerson(p, q ?? ''));

  return (
    <div className="min-w-0 space-y-4">

      {people === null ? <Unavailable what="roll" /> : (
        <>
          <RosterHeader
            count={q ? students.length : people.total} noun="student"
            aside={<RosterSearch q={q} placeholder="Name, email or batch" />}
            action={<CreateProfileForm lockedTenant={{ id: tenantId }} only="student" />}
          />
          <div tabIndex={0} role="region" aria-label="Students" className={SCROLLER}>
            <DataTable
              caption="Students at this institution, with their batch and how much they are enrolled in."
              head={
                <>
                  <th scope="col">Student</th>
                  <th scope="col">Batch</th>
                  {/* Least essential above sm -- a phone reads Student, Batch,
                      Enrolments, Account and the actions without them. */}
                  <th scope="col" className="hidden sm:table-cell">Programme</th>
                  <th scope="col">Enrolments</th>
                  <th scope="col">Account</th>
                  <th scope="col" className="hidden sm:table-cell">Joined</th>
                  <th scope="col">&nbsp;</th>
                </>
              }
            >
              {students.length === 0 ? (
                <EmptyRow colSpan={7} icon="users">
                  {q
                    ? 'Nobody on this roll matches “' + q + '”.'
                    : 'No students yet. A new institution starts with its administrator and nobody else — students arrive once someone invites or imports them.'}
                </EmptyRow>
              ) : students.map((p) => (
                <tr key={p.user_id} className="align-top">
                  <td>
                    <div className="font-semibold">{p.name}</div>
                    <div className="break-all text-[12.5px] text-muted">{p.email}</div>
                  </td>
                  <td>{p.batch
                    ? <Pill tone="brand">{p.batch.code}</Pill>
                    : <span className="text-[12.5px] text-muted">Unassigned</span>}
                  </td>
                  <td className="hidden text-[13px] sm:table-cell">
                    {p.programme?.name ?? <span className="text-muted">—</span>}
                  </td>
                  <td className="tabular-nums">{p.enrollment_count}</td>
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
