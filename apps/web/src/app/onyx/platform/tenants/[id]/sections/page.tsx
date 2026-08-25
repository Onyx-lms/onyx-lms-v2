import type { Metadata } from 'next';
import { requirePlatformSession } from '@/lib/onyx-platform-session';
import { attempt, Unavailable, SCROLLER } from '@/lib/onyx-platform-tenant';
import Link from 'next/link';
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
  { params }: { params: Promise<{ id: string }> },
) {
  await requirePlatformSession();
  const { id } = await params;
  const tenantId = Number(id);
  const base = '/api/onyx/platform/tenants/' + encodeURIComponent(id);
  const at = '/onyx/platform/tenants/' + tenantId;

  const [sections, people] = await Promise.all([
    attempt<SectionRow[]>(base + '/sections'),
    /*
     * Only the people in NO division.
     *
     * `section_id=none` is a question the API already answers, and asking it
     * is the difference between this page listing the twelve people who need
     * placing and listing all 1,440 with a dropdown on each. The count beside
     * the heading is then a count of the right set, too -- filtering a page of
     * 200 answered "how many of these two hundred" when the question is "how
     * many of the roll".
     */
    attempt<PeoplePayload>(base + '/people?role=student&limit=200&section_id=none'),
  ]);

  if (sections === null) return <Unavailable what="sections" />;
  const live = sections.filter((sx) => sx.status === 1);
  const assigned = sections.reduce((n, sx) => n + (sx.member_count ?? 0), 0);
  const placeless = people?.people ?? [];
  const unassigned = people?.total ?? placeless.length;

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
            in no division at all
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
        <SectionHead title="Who is where" />
        <p className="mb-2 max-w-3xl text-[13px] leading-relaxed text-muted">
          Open a division to see its roll, move people between divisions, and see what has
          been set for it. Every student on it opens onto their own record.
        </p>
        <div tabIndex={0} role="region" aria-label="Divisions" className={SCROLLER}>
          <DataTable
            caption="Each teaching division and how many people are in it."
            head={
              <>
                <th scope="col">Division</th>
                <th scope="col">Code</th>
                <th scope="col">People</th>
                <th scope="col">State</th>
                <th scope="col">&nbsp;</th>
              </>
            }
          >
            {sections.length === 0 ? (
              <EmptyRow colSpan={5} icon="layers">
                No divisions yet. Add them above — until there are some, every paper is set
                for the whole cohort and a student registering cannot say where they are.
              </EmptyRow>
            ) : sections.map((sx) => (
              <tr key={sx.id} className="align-top">
                <td>
                  <Link href={at + '/sections/' + sx.id} className="font-semibold hover:underline">
                    {sx.name}
                  </Link>
                </td>
                <td className="font-mono text-[12.5px] text-muted">{sx.code}</td>
                <td className="tabular-nums">{sx.member_count ?? 0}</td>
                <td>
                  {sx.status === 1
                    ? <Pill tone="good">Running</Pill>
                    : <Pill tone="neutral">Retired</Pill>}
                </td>
                <td className="text-right">
                  <Link href={at + '/sections/' + sx.id}
                    className="inline-flex min-h-[30px] items-center gap-1 rounded-lg border
                               border-line px-2.5 text-[12.5px] font-semibold
                               hover:bg-brand-50">
                    Open the roll
                  </Link>
                </td>
              </tr>
            ))}
          </DataTable>
        </div>
      </section>

      {/*
        * The people in NO division, and only them.
        *
        * The whole roll used to sit here with a picker on every row -- right
        * for placing somebody, useless at 1,440 students, and it buried the
        * one group that actually needs acting on. A learner in no division is
        * dealt only the papers set for everybody, so they quietly miss any
        * examination set for a division, and nothing anywhere says so.
        */}
      {placeless.length ? (
        <section>
          <SectionHead title={'Nobody has placed these ' + placeless.length} />
          <div tabIndex={0} role="region" aria-label="Students with no section"
            className={SCROLLER}>
            <DataTable
              caption="Students in no teaching division, and the picker to put that right."
              head={
                <>
                  <th scope="col">Student</th>
                  <th scope="col">Roll no.</th>
                  <th scope="col">Division</th>
                </>
              }
            >
              {placeless.map((p) => (
                <tr key={p.user_id} className="align-top">
                  <td>
                    <Link href={at + '/students/' + p.user_id}
                      className="font-semibold hover:underline">{p.name}</Link>
                    <div className="break-all text-[12.5px] text-muted">{p.email}</div>
                  </td>
                  <td className="font-mono text-[13px] tabular-nums">
                    {p.roll_number ?? <span className="font-sans text-muted">—</span>}
                  </td>
                  <td>
                    {live.length ? (
                      <SectionPicker
                        basePath={'onyx/platform/tenants/' + tenantId + '/members'}
                        membershipId={p.membership_id}
                        sections={live}
                        current={null}
                      />
                    ) : <Pill tone="late">No sections yet</Pill>}
                  </td>
                </tr>
              ))}
            </DataTable>
          </div>
        </section>
      ) : null}

    </div>
  );
}
