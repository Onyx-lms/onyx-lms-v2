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
import { SectionFilter, type SectionRow } from '@/components/onyx-sections';

export const metadata: Metadata = { title: 'Students' };

export default async function OnyxPlatformStudentsPage(
  { params, searchParams }: {
    params: Promise<{ id: string }>;
    searchParams: Promise<{ q?: string; section?: string }>;
  },
) {
  await requirePlatformSession();
  const { id } = await params;
  const { q, section } = await searchParams;
  const tenantId = Number(id);
  const base = '/api/onyx/platform/tenants/' + encodeURIComponent(id);

  /*
   * Filtered on the server, not in the browser.
   *
   * The roll is paged, so filtering the page that arrived would answer "which
   * of these two hundred are in Alpha" when the question is "which of the
   * whole roll" — and the count beside the heading would be a count of the
   * wrong set.
   */
  const query = '?role=student&limit=200'
    + (section ? '&section_id=' + encodeURIComponent(section) : '');
  const [people, sections] = await Promise.all([
    attempt<PeoplePayload>(base + query),
    attempt<SectionRow[]>(base + '/sections'),
  ]);
  const all = people?.people ?? [];
  const students = all.filter((p) => matchesPerson(p, q ?? ''));

  return (
    <div className="min-w-0 space-y-4">

      {people === null ? <Unavailable what="roll" /> : (
        <>
          <RosterHeader
            count={q ? students.length : people.total} noun="student"
            aside={
              <div className="flex flex-wrap items-center gap-2">
                <RosterSearch q={q} placeholder="Name, roll number, email or batch" />
                <SectionFilter sections={sections ?? []} current={section} />
              </div>
            }
            action={<CreateProfileForm lockedTenant={{ id: tenantId }} only="student" />}
          />
          <div tabIndex={0} role="region" aria-label="Students" className={SCROLLER}>
            <DataTable
              caption="Students at this institution, with their batch and how much they are enrolled in."
              head={
                <>
                  <th scope="col">Student</th>
                  {/* Beside the name, because it identifies the same person
                      and is what somebody holding a register is reading
                      from. */}
                  <th scope="col">Roll no.</th>
                  {/* Before Batch, because it is the finer division and the
                      one a programme office is actually working from: a
                      timetable is drawn per section, not per cohort. */}
                  <th scope="col">Section</th>
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
                <EmptyRow colSpan={9} icon="users">
                  {q || section
                    ? 'Nobody on this roll matches that.'
                    : 'No students yet. A new institution starts with its administrator and nobody else — students arrive once someone invites or imports them.'}
                </EmptyRow>
              ) : students.map((p) => (
                <tr key={p.user_id} className="align-top">
                  <td>
                    <div className="font-semibold">{p.name}</div>
                    <div className="break-all text-[12.5px] text-muted">{p.email}</div>
                  </td>
                  <td className="font-mono text-[13px] tabular-nums">
                    {p.roll_number ?? <span className="text-muted">—</span>}
                  </td>
                  <td>
                    {p.section
                      ? <Pill tone="neutral">{p.section.name}</Pill>
                      : <span className="text-[12.5px] text-muted">No section</span>}
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
