import Link from 'next/link';
import type { Metadata } from 'next';
import { requirePlatformSession } from '@/lib/onyx-platform-session';
import {
  attempt, SCROLLER, TenantBackLink, Unavailable, type AcademicsPayload,
} from '@/lib/onyx-platform-tenant';
import { CreateCourseForm, CourseEditToggle, CourseDeleteButton } from '@/components/onyx-platform-forms';
import { DataTable, EmptyRow, Icon, State } from '@/components/onyx-ui';

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
      <TenantBackLink tenantId={tenantId} />
      <div className="flex flex-wrap items-center gap-3">
        <CreateCourseForm tenantId={tenantId} />
        {/* An assignment belongs to a course, not to its own top-level nav
            entry -- same as courses/[id]/page.tsx shows them to faculty and
            students. This is where a platform admin reaches them too. */}
        <Link href={'/onyx/platform/tenants/' + tenantId + '/assignments'}
          className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-brand-700
                     hover:underline">
          <Icon name="edit" className="h-4 w-4" />
          All assignments, across every course
        </Link>
      </div>

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
                  <div className="font-mono text-[12.5px] font-semibold text-brand-700">{c.code}</div>
                  <div className="font-semibold">{c.title}</div>
                </td>
                <td className="text-[13px]">{c.programme ?? <span className="text-muted">—</span>}</td>
                <td className="tabular-nums">{c.credits}</td>
                <td className="tabular-nums">{c.enrollment_count}</td>
                <td className="tabular-nums">{c.faculty_count}</td>
                <td>
                  {c.status === 1 ? <State tone="on">Open</State> : <State tone="idle">Draft</State>}
                </td>
                <td className="text-right">
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    <CourseEditToggle tenantId={tenantId} course={c} />
                    <CourseDeleteButton tenantId={tenantId} course={c} />
                  </div>
                </td>
              </tr>
            ))}
          </DataTable>
        </div>
      )}
    </div>
  );
}
