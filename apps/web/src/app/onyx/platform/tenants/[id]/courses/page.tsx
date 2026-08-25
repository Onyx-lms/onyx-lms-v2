import Link from 'next/link';
import type { Metadata } from 'next';
import { requirePlatformSession } from '@/lib/onyx-platform-session';
import {
  attempt, SCROLLER, RosterHeader, Unavailable, AccessPill, type AcademicsPayload,
} from '@/lib/onyx-platform-tenant';
import { CreateCourseForm, CourseEditToggle } from '@/components/onyx-platform-forms';
import { DataTable, EmptyRow, Icon, Pill, State } from '@/components/onyx-ui';

export const metadata: Metadata = { title: 'Courses' };

export default async function OnyxPlatformCoursesPage(
  { params }: { params: Promise<{ id: string }> },
) {
  await requirePlatformSession();
  const { id } = await params;
  const tenantId = Number(id);
  const academics = await attempt<AcademicsPayload>(
    '/api/onyx/platform/tenants/' + encodeURIComponent(id) + '/academics?limit=200');
  const courses = academics?.courses ?? [];

  return (
    <div className="min-w-0 space-y-4">
      {/* An assignment belongs to a course, not to its own top-level nav entry
          -- same as courses/[id]/page.tsx shows them to faculty and students.
          This is where a platform admin reaches them too, so the link sits
          between the count and the action rather than on a line of its own. */}
      <RosterHeader count={courses.length} noun="course"
        action={<CreateCourseForm tenantId={tenantId} />}
        aside={(
          <Link href={'/onyx/platform/tenants/' + tenantId + '/assignments'}
            className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-brand-700
                       hover:underline">
            <Icon name="edit" className="h-4 w-4" />
            All assignments, across every course
          </Link>
        )} />

      {academics === null ? <Unavailable what="course list" /> : (
        <div tabIndex={0} role="region" aria-label="Courses" className={SCROLLER}>
          <DataTable
            caption="Courses this institution runs, with credits and how many people are on each."
            head={
              <>
                <th scope="col">Course</th>
                <th scope="col">Programme</th>
                <th scope="col">Credits</th>
                <th scope="col">Enrolled</th>
                <th scope="col">Faculty</th>
                <th scope="col">Joining</th>
                <th scope="col">Status</th>
                <th scope="col">&nbsp;</th>
              </>
            }
          >
            {courses.length === 0 ? (
              <EmptyRow colSpan={7} icon="book">
                No courses. This institution has been created but nothing has been
                set up to teach yet.
              </EmptyRow>
            ) : courses.map((c) => (
              <tr key={c.id} className="align-top">
                <td>
                  {/* The course opens. It did not before: the console could
                      make one, rename it and delete it, and never look
                      inside -- so there was nowhere for "add a module" to
                      happen. */}
                  <Link href={'/onyx/platform/tenants/' + tenantId + '/courses/' + c.id}
                    className="group inline-block">
                    <div className="font-mono text-[12.5px] font-semibold text-brand-700">
                      {c.code}
                    </div>
                    <div className="font-semibold group-hover:underline">{c.title}</div>
                  </Link>
                </td>
                <td className="text-[13px]">{c.programme ?? <span className="text-muted">—</span>}</td>
                <td className="tabular-nums">{c.credits}</td>
                <td className="tabular-nums">{c.enrollment_count}</td>
                <td className="tabular-nums">
                  {/* A zero here is a fault, not a number.

                      `assertCanTeach` refuses every faculty-facing route on a
                      course nobody is assigned to, so an unassigned course
                      cannot have its register taken, its work marked or its
                      examinations invigilated. Printed as a bare "0" that read
                      as ordinary, which is how twenty-five courses can sit
                      unassigned without anybody noticing. */}
                  {c.faculty_count === 0
                    ? <Pill tone="late">Nobody</Pill>
                    : c.faculty_count}
                </td>
                <td>
                  <AccessPill access={c.access} priceMinor={c.price_minor}
                    currency={c.currency} />
                </td>
                <td>
                  {/* "Published", not "Open": status is whether the course is
                      visible at all, and access beside it is whether joining is
                      free. One word for both meanings, on one row, is what made
                      an operator set a course "Open" and then find nobody could
                      join it. */}
                  {c.status === 1
                    ? <State tone="on">Published</State>
                    : <State tone="idle">Draft</State>}
                </td>
                <td className="text-right">
                  <CourseEditToggle tenantId={tenantId} course={c} />
                </td>
              </tr>
            ))}
          </DataTable>
        </div>
      )}
    </div>
  );
}
