import Link from 'next/link';
import type { Metadata } from 'next';
import { requirePlatformSession } from '@/lib/onyx-platform-session';
import {
  attempt, ago, SCROLLER, Unavailable, AccountState, WhenCell,
  type AcademicsPayload, type PeoplePayload,
} from '@/lib/onyx-platform-tenant';
import { SectionPicker, type SectionRow } from '@/components/onyx-sections';
import {
  Card, DataTable, EmptyRow, Icon, Pill, SectionHead,
} from '@/components/onyx-ui';

export const metadata: Metadata = { title: 'Section' };

/**
 * One teaching division: who is in it, and what has been set for it.
 *
 * The sections screen listed every division and then, underneath, every
 * student at the institution with a picker on each row — which is the right
 * screen for PLACING people and the wrong one for looking at a division. At
 * 1,440 students it was 1,440 rows under a list of 24 names, and "show me
 * Alpha-CSE" meant reading a dropdown on every row.
 *
 * So a division is now a destination. Its roll is here, each student opens to
 * their own record, and the papers and sittings set for this division are
 * beside them — because "what is Alpha-CSE sitting" is the other half of the
 * same question and lived on a different screen entirely.
 */
export default async function OnyxPlatformSectionPage(
  { params }: { params: Promise<{ id: string; sectionId: string }> },
) {
  await requirePlatformSession();
  const { id, sectionId } = await params;
  const tenantId = Number(id);
  const base = '/api/onyx/platform/tenants/' + encodeURIComponent(id);
  const at = '/onyx/platform/tenants/' + tenantId;

  const [sections, people, academics] = await Promise.all([
    attempt<SectionRow[]>(base + '/sections'),
    attempt<PeoplePayload>(base + '/people?role=student&limit=200&section_id='
      + encodeURIComponent(sectionId)),
    attempt<AcademicsPayload>(base + '/academics?limit=200'),
  ]);

  if (sections === null) return <Unavailable what="sections" />;
  const section = sections.find((sx) => Number(sx.id) === Number(sectionId));
  if (!section) return <Unavailable what="section" />;

  const students = people?.people ?? [];
  const live = sections.filter((sx) => sx.status === 1);

  // What has been set for THIS division. A paper for everybody is not "set for
  // Alpha-CSE" -- it is set for the institution, and saying otherwise here
  // would make every division look like it had the same timetable.
  const papers = (academics?.assessments ?? [])
    .filter((a) => Number(a.section_id) === Number(sectionId));
  const exams = (academics?.exams ?? [])
    .filter((e) => Number(e.section_id) === Number(sectionId));

  return (
    <div className="min-w-0 space-y-5">
      <Link href={at + '/sections'}
        className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-brand-700
                   hover:underline">
        <Icon name="chevron" className="h-4 w-4 rotate-180" />
        All sections
      </Link>

      <Card className="p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-[19px] font-bold text-ink">{section.name}</h2>
            <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[12.5px] text-muted">
              <span className="font-mono">{section.code}</span>
              <span>·</span>
              <span className="tabular-nums">
                {people?.total ?? students.length} on the roll
              </span>
            </div>
          </div>
          {section.status === 1
            ? <Pill tone="good">Running</Pill>
            : <Pill tone="neutral">Retired</Pill>}
        </div>
      </Card>

      <section>
        <SectionHead title={'Students · ' + (people?.total ?? students.length)} />
        {people?.capped ? (
          <p className="mb-2 text-[12.5px] text-muted">
            Showing the first {students.length}. Search the roll to reach the rest.
          </p>
        ) : null}
        <div tabIndex={0} role="region" aria-label="Students in this section" className={SCROLLER}>
          <DataTable
            caption="Everybody in this teaching division. Open one to see their whole record."
            head={
              <>
                <th scope="col">Student</th>
                <th scope="col">Roll no.</th>
                <th scope="col">Enrolments</th>
                <th scope="col">Account</th>
                <th scope="col" className="hidden sm:table-cell">Joined</th>
                <th scope="col">Move</th>
              </>
            }
          >
            {students.length === 0 ? (
              <EmptyRow colSpan={6} icon="users">
                Nobody is in this division yet. Place people into it from the sections
                screen, or they can choose it themselves while registering.
              </EmptyRow>
            ) : students.map((p) => (
              <tr key={p.user_id} className="align-top">
                <td>
                  {/* Opens onto everything the institution has of them: what
                      they are enrolled in, what they have sat, what they were
                      given for it. */}
                  <Link href={at + '/students/' + p.user_id}
                    className="font-semibold hover:underline">
                    {p.name}
                  </Link>
                  <div className="break-all text-[12.5px] text-muted">{p.email}</div>
                </td>
                <td className="font-mono text-[13px] tabular-nums">
                  {p.roll_number ?? <span className="font-sans text-muted">—</span>}
                </td>
                <td className="tabular-nums">{p.enrollment_count ?? 0}</td>
                <td><AccountState status={p.account_status} /></td>
                <td className="hidden whitespace-nowrap text-[12.5px] text-muted sm:table-cell">
                  {p.joined_at ? ago(p.joined_at) : '—'}
                </td>
                <td>
                  {/* Kept on the row: moving somebody is what an operator
                      opening a division most often came to do, and a dialog
                      per person turns a morning's work into an afternoon's. */}
                  <SectionPicker
                    basePath={'onyx/platform/tenants/' + tenantId + '/members'}
                    membershipId={p.membership_id}
                    sections={live}
                    current={p.section?.id ?? null}
                  />
                </td>
              </tr>
            ))}
          </DataTable>
        </div>
      </section>

      <section>
        <SectionHead title="Set for this division" />
        {papers.length === 0 && exams.length === 0 ? (
          <Card className="p-5 text-center text-[13px] leading-relaxed text-muted">
            Nothing is set for this division on its own. That does not mean they sit
            nothing — a paper set for the whole institution is sat by everybody, this
            division included, and appears under Examinations rather than here.
          </Card>
        ) : (
          <div tabIndex={0} role="region" aria-label="Set for this section" className={SCROLLER}>
            <DataTable
              caption="Papers and sittings set for this division alone."
              head={
                <>
                  <th scope="col">What</th>
                  <th scope="col">Kind</th>
                  <th scope="col">When</th>
                  <th scope="col">Course</th>
                </>
              }
            >
              {exams.map((e) => (
                <tr key={'e' + e.id} className="align-top">
                  <td>
                    <Link href={at + '/examinations/' + e.id}
                      className="font-semibold hover:underline">{e.title}</Link>
                  </td>
                  <td><Pill tone="brand">Examination</Pill></td>
                  <td><WhenCell at={e.starts_at} status={e.status} /></td>
                  <td className="font-mono text-[12.5px]">{e.course?.code ?? '—'}</td>
                </tr>
              ))}
              {papers.map((a) => (
                <tr key={'a' + a.id} className="align-top">
                  <td>
                    <Link href={at + '/assessments/' + a.id}
                      className="font-semibold hover:underline">{a.title}</Link>
                  </td>
                  <td><Pill tone="neutral">Assessment</Pill></td>
                  <td><WhenCell at={a.closes_at} status={a.status} /></td>
                  <td className="font-mono text-[12.5px]">{a.course?.code ?? '—'}</td>
                </tr>
              ))}
            </DataTable>
          </div>
        )}
      </section>
    </div>
  );
}
