import type { Metadata } from 'next';
import { money } from '@/lib/onyx-money';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { appOrigin } from '@/lib/app-origin';
import { getOnyxSession } from '@/lib/onyx-session';
import { Icon } from '@/components/onyx-ui';

interface PublicCourse {
  id: number; code: string; title: string; description: string | null; credits: number;
  access: 'batch' | 'open' | 'locked'; price_minor: number; currency: string;
  institution: { name: string; slug: string; registration_open: boolean };
  taught_by: string[];
  learners: number; lesson_count: number; total_minutes: number;
  modules: {
    id: number; title: string; summary: string | null;
    lessons: { title: string; type: string; minutes: number; preview: boolean }[];
  }[];
}

/*
 * Uncached, for the same reason the public profile is: a course whose price
 * changed, or which was closed this morning, must not keep advertising
 * yesterday's answer to somebody deciding whether to buy it.
 */
export const dynamic = 'force-dynamic';

async function load(id: string): Promise<PublicCourse | null> {
  if (!/^\d+$/.test(id)) return null;
  try {
    const res = await fetch(appOrigin() + '/api/onyx/c/' + id, { cache: 'no-store' });
    const body = await res.json().catch(() => ({ ok: false }));
    return body.ok ? (body.data as PublicCourse) : null;
  } catch {
    return null;
  }
}

export async function generateMetadata(
  { params }: { params: Promise<{ id: string }> },
): Promise<Metadata> {
  const { id } = await params;
  const course = await load(id);
  if (!course) return { title: 'Course' };
  const description = course.description
    ?? (course.lesson_count + ' lessons at ' + course.institution.name + '.');
  return {
    title: course.title,
    description,
    // The link is made to be sent, so it should unfurl into the course rather
    // than the site's default card.
    openGraph: { title: course.title + ' · ' + course.institution.name, description },
  };
}

const TYPE_ICON: Record<string, 'play' | 'book' | 'file' | 'external'> = {
  video: 'play', text: 'book', document: 'file', image: 'file', link: 'external',
};



/**
 * A course's own page, for people who do not have an account.
 *
 * Every published course has one. Somebody deciding whether to sign up -- or a
 * learner sent a link by a lecturer -- needs to see what the course is before
 * being asked to register for it, and until now the address answered only to
 * people who were already inside.
 *
 * What is public is the SYLLABUS: what the course covers, how many lessons,
 * how long, who teaches it, what it costs. What is not is the content itself.
 * That distinction is the whole page -- a prospectus has always listed the
 * chapters without printing the book.
 *
 * Nothing here needs a session, and the call to action changes with what the
 * visitor already has: sign in if they have an account, register if the
 * institution takes registrations, and if the course is sold, the price is on
 * the button rather than behind it.
 */
export default async function PublicCoursePage(
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const course = await load(id);
  if (!course) notFound();

  const session = await getOnyxSession();
  const inside = '/onyx/courses/' + course.id;
  const withNext = (path: string) => path + '?next=' + encodeURIComponent(inside);

  const priced = course.access === 'locked';
  const joinable = course.access !== 'batch';

  return (
    <div className="min-h-screen bg-canvas">
      <div className="mx-auto w-full max-w-4xl px-4 py-10 sm:py-14">
        <p className="text-[12.5px] font-semibold uppercase tracking-[.1em] text-muted">
          {course.institution.name}
        </p>
        <h1 className="mt-2 text-[30px] font-extrabold leading-tight tracking-tight sm:text-[36px]">
          {course.title}
        </h1>

        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[13px] text-muted">
          <span className="font-mono font-bold">{course.code}</span>
          {course.credits ? <span>{course.credits} credits</span> : null}
          <span>{course.lesson_count} lesson{course.lesson_count === 1 ? '' : 's'}</span>
          {course.total_minutes ? <span>{Math.round(course.total_minutes / 60)} hours</span> : null}
          {course.learners ? (
            <span>{course.learners} enrolled</span>
          ) : null}
        </div>

        {course.description ? (
          <p className="mt-5 max-w-[62ch] text-[16px] leading-relaxed text-slate-700">
            {course.description}
          </p>
        ) : null}

        {course.taught_by.length ? (
          <p className="mt-4 flex items-center gap-2 text-[13.5px] text-muted">
            <Icon name="user" className="h-4 w-4" />
            Taught by {course.taught_by.join(', ')}
          </p>
        ) : null}

        {/* The decision, stated once and early. */}
        <div className="mt-7 flex flex-wrap items-center gap-3 rounded-2xl border border-line
                        bg-white p-4 shadow-card">
          <div className="min-w-0 flex-1">
            <div className="text-[22px] font-extrabold leading-none tabular-nums">
              {priced ? money(course.price_minor, course.currency) : 'Free'}
            </div>
            <p className="mt-1.5 text-[13px] leading-relaxed text-muted">
              {session
                ? 'You are signed in — open it from your courses.'
                : priced
                  ? 'Buy it once and it stays on your list.'
                  : joinable
                    ? 'Start it as soon as you have an account.'
                    : 'Enrolment for this course is handled by the institution.'}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {session ? (
              <Link href={inside}
                className="inline-flex min-h-[46px] items-center rounded-xl bg-brand-600 px-5
                           text-[15px] font-bold text-white hover:bg-brand-700">
                Open the course
              </Link>
            ) : (
              <>
                {/* Registration is only offered where it would actually work --
                    an institution that has not opened it would send somebody to
                    a form that refuses their address. */}
                {course.institution.registration_open && joinable ? (
                  <Link href={withNext('/onyx/signup')}
                    className="inline-flex min-h-[46px] items-center rounded-xl bg-brand-600 px-5
                               text-[15px] font-bold text-white hover:bg-brand-700">
                    {priced ? 'Sign up to buy' : 'Sign up to start'}
                  </Link>
                ) : null}
                <Link href={withNext('/onyx/login')}
                  className="inline-flex min-h-[46px] items-center rounded-xl border border-line
                             bg-white px-5 text-[15px] font-bold hover:border-brand-300
                             hover:text-brand-700">
                  Sign in
                </Link>
              </>
            )}
          </div>
        </div>

        {course.modules.length ? (
          <section className="mt-10">
            <h2 className="text-[11.5px] font-bold uppercase tracking-[.085em] text-muted">
              What is inside
            </h2>
            <div className="mt-3 space-y-3">
              {course.modules.map((m) => (
                <div key={m.id} className="overflow-hidden rounded-2xl border border-line bg-white">
                  <div className="border-b border-line bg-slate-50 px-4 py-3">
                    <div className="text-[14.5px] font-bold">{m.title}</div>
                    {m.summary ? (
                      <p className="mt-0.5 text-[12.5px] text-muted">{m.summary}</p>
                    ) : null}
                  </div>
                  <ul className="divide-y divide-line">
                    {m.lessons.map((l) => (
                      <li key={l.title}
                        className="flex items-center gap-3 px-4 py-2.5 text-[13.5px]">
                        <Icon name={TYPE_ICON[l.type] ?? 'book'}
                          className="h-4 w-4 shrink-0 text-muted" />
                        <span className="min-w-0 flex-1 truncate">{l.title}</span>
                        {l.preview ? (
                          <span className="rounded-full bg-brand-50 px-2 py-0.5 text-[11.5px]
                                           font-bold text-brand-700">Preview</span>
                        ) : (
                          <Icon name="lock" className="h-3.5 w-3.5 shrink-0 text-faint" />
                        )}
                        {l.minutes ? (
                          <span className="w-12 shrink-0 text-right tabular-nums text-muted">
                            {l.minutes}m
                          </span>
                        ) : null}
                      </li>
                    ))}
                    {m.lessons.length === 0 ? (
                      <li className="px-4 py-2.5 text-[13px] text-muted">
                        Lessons for this unit are still being written.
                      </li>
                    ) : null}
                  </ul>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {/* Said plainly, because it is what the page is: a syllabus, not the
            course. */}
        <footer className="mt-12 border-t border-line pt-5 text-[12.5px] leading-relaxed text-muted">
          This page lists what the course covers. The lessons themselves, the register and the
          marks belong to {course.institution.name} and open once you are enrolled.
        </footer>
      </div>
    </div>
  );
}
