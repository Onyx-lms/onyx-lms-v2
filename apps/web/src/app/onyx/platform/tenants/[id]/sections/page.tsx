import type { Metadata } from 'next';
import { requirePlatformSession } from '@/lib/onyx-platform-session';
import { attempt, Unavailable, SCROLLER } from '@/lib/onyx-platform-tenant';
import { SectionManager, SectionPicker, type SectionRow } from '@/components/onyx-sections';
import { Card, DataTable, EmptyRow, Pill, SectionHead } from '@/components/onyx-ui';
import type { PeoplePayload } from '@/lib/onyx-platform-tenant';

export const metadata: Metadata = { title: 'Sections' };

/**
 * The teaching divisions an institution runs, and who is in them.
 *
 * A section is the group a learner is actually taught with — Alpha, Beta and
 * Gamma at one institution, Section A, B and C at most others. Timetables are
 * drawn per section and examinations are sat per section, so "which section" is
 * the first question a programme office asks about a student, and the product
 * had no idea the concept existed.
 *
 * Reachable from the console because the institution's own administrator is
 * often the person who has NOT set them up: the divisions exist on a timetable
 * long before anybody types them into a product.
 *
 * The roll is on the same page as the sections themselves, and the picker is on
 * the row. Moving people between divisions is what somebody actually comes here
 * to do, and a dialog per person turns a morning's work into an afternoon's.
 */
export default async function OnyxPlatformSectionsPage(
  { params, searchParams }: {
    params: Promise<{ id: string }>;
    searchParams: Promise<{ section?: string }>;
  },
) {
  await requirePlatformSession();
  const { id } = await params;
  const { section } = await searchParams;
  const tenantId = Number(id);
  const base = '/api/onyx/platform/tenants/' + encodeURIComponent(id);

  const [sections, people] = await Promise.all([
    attempt<SectionRow[]>(base + '/sections'),
    attempt<PeoplePayload>(base + '/people?role=student&limit=200'
      + (section ? '&section_id=' + encodeURIComponent(section) : '')),
  ]);

  if (sections === null) return <Unavailable what="sections" />;
  const live = sections.filter((sx) => sx.status === 1);
  const assigned = sections.reduce((n, sx) => n + (sx.member_count ?? 0), 0);
  const students = people?.people ?? [];
  const unassigned = students.filter((p) => !p.section).length;

  return (
    <div className="min-w-0 space-y-5">
      <div className="grid gap-3 sm:grid-cols-3">
        <Card className="p-3.5">
          <div className="text-[22px] font-bold tabular-nums">{live.length}</div>
          <div className="text-[12.5px] text-muted">
            {live.length === 1 ? 'section running' : 'sections running'}
          </div>
        </Card>
        <Card className="p-3.5">
          <div className="text-[22px] font-bold tabular-nums">{assigned}</div>
          <div className="text-[12.5px] text-muted">people in one</div>
        </Card>
        <Card className="p-3.5">
          <div className="text-[22px] font-bold tabular-nums">{unassigned}</div>
          <div className="text-[12.5px] text-muted">
            {/* The number worth acting on. A learner in no section is dealt
                only the papers set for everybody, so they quietly miss any
                examination set for a division. */}
            on this page with no section
          </div>
        </Card>
      </div>

      <section>
        <SectionHead title="Sections" />
        <Card className="p-4">
          <p className="mb-3 max-w-2xl text-[12.5px] leading-relaxed text-muted">
            The divisions this institution teaches in. A student picks one while registering,
            and a paper or an examination can be set for one division or for everybody.
            Renaming one is safe; retiring one takes it off every picker while the record of
            who was in it stays intact.
          </p>
          <SectionManager basePath={'onyx/platform/tenants/' + tenantId + '/sections'}
            sections={sections} canSeed />
        </Card>
      </section>

      <section>
        <SectionHead title={'Students · ' + students.length} />
        <div tabIndex={0} role="region" aria-label="Students by section" className={SCROLLER}>
          <DataTable
            caption="Every student, and the teaching division they are in."
            head={
              <>
                <th scope="col">Student</th>
                <th scope="col">Roll no.</th>
                <th scope="col">Section</th>
              </>
            }
          >
            {students.length === 0 ? (
              <EmptyRow colSpan={3} icon="users">
                No students to place yet.
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
                  {live.length ? (
                    <SectionPicker
                      basePath={'onyx/platform/tenants/' + tenantId + '/members'}
                      membershipId={p.membership_id}
                      sections={live}
                      current={p.section?.id ?? null}
                    />
                  ) : <Pill tone="late">No sections yet</Pill>}
                </td>
              </tr>
            ))}
          </DataTable>
        </div>
      </section>
    </div>
  );
}
