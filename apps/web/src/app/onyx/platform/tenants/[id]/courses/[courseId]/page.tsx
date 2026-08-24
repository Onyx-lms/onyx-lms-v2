import Link from 'next/link';
import type { Metadata } from 'next';
import { requirePlatformSession } from '@/lib/onyx-platform-session';
import { attempt, Unavailable, money } from '@/lib/onyx-platform-tenant';
import {
  AddModuleForm, ModuleRowActions, AddLessonForm, LessonRemoveButton,
  ConsoleEnrolForm, ConsoleWithdrawButton,
} from '@/components/onyx-platform-forms';
import type { PeoplePayload } from '@/lib/onyx-platform-tenant';
import {
  Card, Icon, Pill, SectionHead, State, type IconName,
} from '@/components/onyx-ui';

export const metadata: Metadata = { title: 'Course' };

/** A lesson wears the icon of what it actually is. */
const ICON_OF: Record<string, IconName> = {
  video: 'play', document: 'file', image: 'file', text: 'book', link: 'external',
};

interface Lesson {
  id: number; module_id: number; title: string; type: string;
  duration_seconds: number | null; sort: number; is_preview: number;
}
/** One enrolled learner, as AcademicsService.roster returns them. */
interface RosterRow {
  id: number; user_id: string; status: number;
  user: { id: string; name: string; email: string } | null;
}
interface Outline {
  course: {
    id: number; code: string; title: string; credits: number; status: number;
    access: string | null; price_minor: number | null; currency: string | null; slug: string;
  };
  modules: { id: number; title: string; summary: string | null; sort: number;
    lessons: Lesson[] }[];
}

/**
 * One course, opened from the console.
 *
 * The console could create a course, rename it and delete it, and never look
 * inside one -- so "add a module" had nowhere to happen, and an operator
 * setting up an institution had to sign in as that institution to build its
 * first course structure.
 *
 * Modules and lessons are both authored here, files included. The upload does
 * not pass through this server: the browser takes a signed ticket and PUTs
 * straight to storage, which is the only way a lecture recording is possible
 * at all -- Vercel rejects request bodies over about 4.5 MB.
 *
 * The lesson composer sits INSIDE the module it adds to rather than once at
 * the top, so there is never a question of which module a file is going into.
 */
export default async function OnyxPlatformCoursePage(
  { params }: { params: Promise<{ id: string; courseId: string }> },
) {
  await requirePlatformSession();
  const { id, courseId } = await params;
  const tenantId = Number(id);
  const base = '/api/onyx/platform/tenants/' + encodeURIComponent(id);
  const [outline, roster, people] = await Promise.all([
    attempt<Outline>(base + '/courses/' + encodeURIComponent(courseId) + '/outline'),
    attempt<RosterRow[]>(base + '/courses/' + encodeURIComponent(courseId) + '/roster'),
    attempt<PeoplePayload>(base + '/people?role=student&limit=200'),
  ]);

  if (outline === null) return <Unavailable what="course" />;
  const { course, modules } = outline;
  const lessonCount = modules.reduce((n, m) => n + m.lessons.length, 0);

  return (
    <div className="min-w-0 space-y-5">
      <Link href={'/onyx/platform/tenants/' + tenantId + '/courses'}
        className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-brand-700
                   hover:underline">
        <Icon name="chevron" className="h-4 w-4 rotate-180" />
        All courses
      </Link>

      <Card className="p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="font-mono text-[12.5px] font-semibold text-brand-700">
              {course.code}
            </div>
            <h2 className="text-[19px] font-bold text-ink">{course.title}</h2>
            <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[12.5px] text-muted">
              <span className="tabular-nums">{course.credits} credits</span>
              <span>·</span>
              <span className="tabular-nums">
                {modules.length} {modules.length === 1 ? 'module' : 'modules'}
              </span>
              <span>·</span>
              <span className="tabular-nums">
                {lessonCount} {lessonCount === 1 ? 'lesson' : 'lessons'}
              </span>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {course.access === 'locked' ? (
              <Pill tone="brand">
                {money(Number(course.price_minor ?? 0), course.currency ?? 'INR')}
              </Pill>
            ) : null}
            {course.status === 1 ? <State tone="on">Open</State> : <State tone="idle">Draft</State>}
          </div>
        </div>
      </Card>

      {/* Who is on it, before what is in it. A course with an empty roster is
          an examination nobody can sit, and that is worth seeing on the way
          past rather than discovering when a paper deals to no one. */}
      <section>
        <SectionHead title={'Enrolled · ' + (roster ?? []).length} />
        <Card className="p-4">
          <ConsoleEnrolForm tenantId={tenantId} courseId={course.id}
            students={(people?.people ?? []).map((p) => ({
              user_id: p.user_id, name: p.name, roll_number: p.roll_number,
            }))} />

          {roster === null ? (
            <p className="mt-3 text-[13px] text-muted">The roster could not be loaded.</p>
          ) : roster.length === 0 ? (
            <p className="mt-3 text-[13px] text-muted">
              Nobody is on this course yet. Until somebody is, an examination on it has no
              candidates and its paper deals to no one.
            </p>
          ) : (
            <ul className="mt-3 divide-y divide-line">
              {roster.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-3 py-2">
                  <span className="min-w-0 flex-1">
                    <span className="text-[13.5px] font-semibold">
                      {r.user?.name ?? 'Unknown'}
                    </span>
                    {r.user?.email ? (
                      <span className="ml-2 text-[12.5px] text-muted">{r.user.email}</span>
                    ) : null}
                  </span>
                  <ConsoleWithdrawButton tenantId={tenantId} courseId={course.id}
                    userId={r.user_id} name={r.user?.name ?? 'this learner'} />
                </li>
              ))}
            </ul>
          )}
        </Card>
      </section>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <SectionHead title="Modules" />
        <AddModuleForm tenantId={tenantId} courseId={course.id} />
      </div>

      {modules.length === 0 ? (
        <Card className="p-6 text-center">
          <p className="text-[14px] font-semibold text-ink">Nothing has been built yet.</p>
          <p className="mx-auto mt-1.5 max-w-md text-[13px] leading-relaxed text-muted">
            A course is a sequence of modules, and each module holds the lessons a learner
            works through. Add the first one above.
          </p>
        </Card>
      ) : (
        <ol className="space-y-3">
          {modules.map((m, i) => (
            <li key={m.id}>
              <Card className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2.5">
                      {/* Numbered, because a course IS an order -- "02" tells
                          somebody where a module sits in a way a bare title
                          does not. */}
                      <span className="font-mono text-[13px] font-bold tabular-nums
                                       text-accent-700">
                        {String(i + 1).padStart(2, '0')}
                      </span>
                      <span className="text-[15px] font-bold text-ink">{m.title}</span>
                    </div>
                    {m.summary ? (
                      <p className="mt-1 text-[13px] leading-relaxed text-muted">{m.summary}</p>
                    ) : null}
                  </div>
                  <ModuleRowActions tenantId={tenantId} module={m} />
                </div>

                {m.lessons.length ? (
                  <ul className="mt-3 divide-y divide-line border-t border-line pt-1">
                    {m.lessons.map((l) => (
                      <li key={l.id} className="flex items-center gap-2.5 py-2 text-[13px]">
                        <Icon name={ICON_OF[l.type] ?? 'file'}
                          className="h-3.5 w-3.5 shrink-0 text-muted" />
                        {/* The lesson opens. An operator who has just
                            uploaded a file needs to see that the right one
                            went up, and a row saying "document" is not
                            evidence of anything. */}
                        <Link
                          href={'/onyx/platform/tenants/' + tenantId + '/lessons/' + l.id}
                          className="min-w-0 flex-1 truncate text-ink hover:underline">
                          {l.title}
                        </Link>
                        <span className="shrink-0 text-[12px] text-muted">{l.type}</span>
                        {l.is_preview ? <Pill tone="neutral">Preview</Pill> : null}
                        <LessonRemoveButton tenantId={tenantId} lesson={l} />
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-3 border-t border-line pt-3 text-[12.5px] text-muted">
                    No lessons in this module yet.
                  </p>
                )}

                {/* The lesson composer lives INSIDE the module it adds to, so
                    there is never a question of which one a file is going
                    into. */}
                <div className="mt-2 border-t border-line pt-3">
                  <AddLessonForm tenantId={tenantId} courseId={course.id} moduleId={m.id} />
                </div>
              </Card>
            </li>
          ))}
        </ol>
      )}


    </div>
  );
}
