import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { requireRole, apiAuthSafe } from '@/lib/session';
import { DashboardShell } from '@/components/dashboard-shell';
import { INSTRUCTOR_NAV } from '@/lib/nav';
import { CourseBuilder } from '@/components/course-builder';
import { LiveClassAdmin, type LiveClass } from '@/components/live-class-admin';

export const metadata: Metadata = { title: 'Course builder' };

export default async function CourseBuilderPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireRole('instructor', 'admin');
  const { id } = await params;
  const payload = await apiAuthSafe<{
    course: Record<string, unknown>;
    curriculum: {
      id: number; title: string; sort: string;
      lessons: { id: number; title: string | null; lesson_type: string | null;
                 duration: string | null; is_free: number | null }[];
    }[];
    total_duration: string;
    total_lesson: number;
  }>(`/api/authoring/courses/${id}`);
  if (!payload) notFound();

  // LC-01: the schedule sits alongside the curriculum, as the "live-class" tab
  // did in the original course editor.
  const liveClasses = (await apiAuthSafe<LiveClass[]>(
    `/api/courses/${id}/live-classes`)) ?? [];

  return (
    <DashboardShell role={session.app_role} email={session.email}
      nav={INSTRUCTOR_NAV} title={String(payload.course.title ?? 'Course')}>
      <div className="mb-4 flex flex-wrap items-center gap-3 text-sm text-slate-600">
        <span className="chip border-slate-200 bg-slate-50">{String(payload.course.status)}</span>
        <span>{payload.total_lesson} lessons</span>
        <span>{payload.total_duration}</span>
        {payload.course.status === 'active' && (
          <Link href={`/course/${payload.course.slug}`} className="text-brand-600 hover:underline">
            View public page
          </Link>
        )}
      </div>
      <CourseBuilder courseId={Number(id)} course={payload.course} curriculum={payload.curriculum} />

      <section className="mt-10">
        <h2 className="text-lg font-semibold">Live classes</h2>
        <div className="mt-3">
          <LiveClassAdmin courseId={Number(id)} />
        </div>
        {liveClasses.length === 0 ? (
          <p className="mt-4 text-sm text-slate-500">Nothing scheduled yet.</p>
        ) : (
          <ul className="mt-4 divide-y divide-slate-100 rounded-lg border border-slate-200">
            {liveClasses.map((c) => (
              <li key={c.id} className="flex items-center justify-between px-4 py-3 text-sm">
                <div>
                  <div className="font-medium">{c.class_topic}</div>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {c.class_date_and_time
                      ? new Date(c.class_date_and_time).toLocaleString()
                      : 'No date'}
                    {' - '}{c.provider}
                    {c.join_window.open ? ' - open now' : ''}
                  </p>
                </div>
                <LiveClassAdmin mode="row" liveClass={c} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </DashboardShell>
  );
}
