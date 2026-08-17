import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { apiSafe, type PageMetadata, type SiteSettings } from '@/lib/api';
import { coursePrice } from '@/lib/format';
import { CourseActions } from '@/components/course-actions';
import { getSession, apiAuthSafe } from '@/lib/session';

export const revalidate = 60;

interface Lesson { id: number; title: string | null; lesson_type: string | null; duration: string | null; is_free: number | null }
interface Section { id: number; title: string | null; lessons: Lesson[] }
interface CourseDetail {
  id: number; title: string | null; slug: string | null; short_description: string | null;
  description: string | null; thumbnail: string | null; level: string | null; language: string | null;
  is_paid: number | null; price: number | null; discount_flag: number | null; discounted_price: number | null;
  requirements: string[]; outcomes: string[]; faqs: unknown[];
  instructor: { id: number; name: string | null; photo: string | null; about: string | null } | null;
  curriculum: Section[]; total_lesson: number; total_enrollment: number;
  rating: { average: number; count: number; breakdown: Record<string, number> };
}

async function load(slug: string) {
  return apiSafe<{ course: CourseDetail; seo: PageMetadata }>(
    `/api/courses/${encodeURIComponent(slug)}`);
}

export async function generateMetadata(
  { params }: { params: Promise<{ slug: string }> },
): Promise<Metadata> {
  const { slug } = await params;
  const result = await load(slug);
  if (!result) return { title: 'Course not found' };
  const { seo } = result;
  return {
    title: seo.title,
    description: seo.description,
    keywords: seo.keywords,
    robots: seo.robots,
    alternates: seo.canonical ? { canonical: seo.canonical } : undefined,
    openGraph: {
      title: seo.og.title,
      description: seo.og.description,
      images: seo.og.image ? [seo.og.image] : undefined,
    },
  };
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-lg font-semibold">{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <dt>{label}</dt>
      <dd className="font-medium text-slate-800">{value}</dd>
    </div>
  );
}

export default async function CoursePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [result, settings, session] = await Promise.all([
    load(slug),
    apiSafe<SiteSettings>('/api/settings'),
    getSession(),
  ]);
  if (!result) notFound();

  const { course, seo } = result;
  const price = coursePrice(course, settings?.currency_position ?? 'left');

  // Only asked for when signed in, so anonymous visitors stay fully cached.
  const enrollStatus = session
    ? (await apiAuthSafe<{ status: 'valid' | 'expired' | false }>(
        `/api/enroll/status/${course.id}`))?.status ?? false
    : false;
  const wishlisted = session
    ? ((await apiAuthSafe<{ id: number }[]>('/api/wishlist')) ?? [])
        .some((c) => c.id === course.id)
    : false;

  return (
    <>
      {/* C-05: structured data ships server-rendered -- the point of SSR here. */}
      {seo.jsonLd != null && (
        <script type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(seo.jsonLd) }} />
      )}

      <section className="border-b border-slate-200 bg-slate-900 text-white">
        <div className="container-page grid gap-8 py-12 lg:grid-cols-[1fr_320px]">
          <div>
            <h1 className="text-3xl font-bold leading-tight md:text-4xl">{course.title}</h1>
            {course.short_description && (
              <p className="mt-3 max-w-2xl text-slate-300">{course.short_description}</p>
            )}
            <div className="mt-4 flex flex-wrap items-center gap-3 text-sm text-slate-300">
              {course.rating.count > 0 && (
                <span>{course.rating.average} / 5 ({course.rating.count} reviews)</span>
              )}
              <span>{course.total_enrollment} enrolled</span>
              <span>{course.total_lesson} lessons</span>
              {course.level && <span className="capitalize">{course.level}</span>}
            </div>
            {course.instructor && (
              <p className="mt-4 text-sm text-slate-300">
                Taught by{' '}
                <Link href={`/instructors/${course.instructor.id}`}
                  className="font-medium text-white underline">
                  {course.instructor.name}
                </Link>
              </p>
            )}
          </div>

          <aside className="card self-start bg-white p-5 text-slate-800">
            <div className="text-2xl font-bold text-brand-700">
              {price.was && <s className="mr-2 text-base font-normal text-slate-400">{price.was}</s>}
              {price.label}
            </div>
            <div className="mt-4">
              <CourseActions
                courseId={course.id}
                slug={String(course.slug ?? '')}
                isPaid={Boolean(course.is_paid)}
                isSignedIn={Boolean(session)}
                enrolled={enrollStatus}
                wishlisted={wishlisted}
              />
            </div>
            <dl className="mt-4 space-y-1 text-sm text-slate-600">
              <Row label="Lessons" value={String(course.total_lesson)} />
              <Row label="Language" value={course.language ?? '-'} />
              <Row label="Level" value={course.level ?? '-'} />
            </dl>
          </aside>
        </div>
      </section>

      <div className="container-page grid gap-10 py-10 lg:grid-cols-[1fr_320px]">
        <div className="space-y-10">
          {course.outcomes.length > 0 && (
            <Block title="What you will learn">
              <ul className="grid gap-2 sm:grid-cols-2">
                {course.outcomes.map((o, i) => (
                  <li key={i} className="text-sm text-slate-700">{o}</li>
                ))}
              </ul>
            </Block>
          )}

          <Block title="Curriculum">
            {course.curriculum.length === 0 ? (
              <p className="text-sm text-slate-500">Curriculum is being prepared.</p>
            ) : (
              <div className="divide-y divide-slate-200 rounded-lg border border-slate-200">
                {course.curriculum.map((s) => (
                  <details key={s.id} open>
                    <summary className="cursor-pointer px-4 py-3 text-sm font-medium">
                      {s.title}
                      <span className="ml-2 text-xs font-normal text-slate-500">
                        {s.lessons.length} {s.lessons.length === 1 ? 'lesson' : 'lessons'}
                      </span>
                    </summary>
                    <ul className="border-t border-slate-100 bg-slate-50">
                      {s.lessons.map((l) => (
                        <li key={l.id} className="flex justify-between px-4 py-2 text-sm text-slate-600">
                          <span>{l.title}</span>
                          <span className="text-xs">{l.is_free ? 'Preview' : l.duration ?? l.lesson_type}</span>
                        </li>
                      ))}
                    </ul>
                  </details>
                ))}
              </div>
            )}
          </Block>

          {course.requirements.length > 0 && (
            <Block title="Requirements">
              <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700">
                {course.requirements.map((r, i) => <li key={i}>{r}</li>)}
              </ul>
            </Block>
          )}

          {course.description && (
            <Block title="About this course">
              <div className="text-sm leading-relaxed text-slate-700"
                dangerouslySetInnerHTML={{ __html: course.description }} />
            </Block>
          )}
        </div>

        {course.instructor && (
          <aside className="card h-fit p-5">
            <h2 className="text-sm font-semibold">Instructor</h2>
            <Link href={`/instructors/${course.instructor.id}`}
              className="mt-2 block font-medium text-brand-700 hover:underline">
              {course.instructor.name}
            </Link>
            {course.instructor.about && (
              <p className="mt-2 text-sm text-slate-600">{course.instructor.about}</p>
            )}
          </aside>
        )}
      </div>
    </>
  );
}
