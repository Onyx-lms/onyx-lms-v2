import Link from 'next/link';
import type { CourseCard as Course } from '@/lib/api';
import { coursePrice } from '@/lib/format';

export function CourseCard({ course, currencyPosition }: {
  course: Course;
  currencyPosition: string | null;
}) {
  const price = coursePrice(course, currencyPosition);
  const isFree = price.label === 'Free';
  const initial = course.instructor_name?.trim().charAt(0).toUpperCase();

  return (
    <article className="card group flex flex-col transition duration-300 ease-out hover:-translate-y-1 hover:shadow-lift">
      {/* The "video holder" -- signals this is a video course, not just a static tile. */}
      <Link
        href={`/course/${course.slug}`}
        className="relative block aspect-video w-full overflow-hidden bg-gradient-to-br from-brand-700 to-brand-900"
      >
        {course.thumbnail ? (
          <img
            src={course.thumbnail}
            alt=""
            className="h-full w-full object-cover transition duration-500 ease-out group-hover:scale-105"
            loading="lazy"
          />
        ) : (
          <span aria-hidden className="absolute inset-0 bg-gradient-to-br from-brand-600 via-brand-700 to-brand-900" />
        )}

        {/* Scrim keeps the price badge and play glyph readable over any thumbnail. */}
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/60 via-black/0 to-black/10"
        />

        <span className="absolute left-3 top-3 chip border-transparent bg-white/95 font-semibold text-brand-700 shadow-card">
          {isFree ? (
            'Free'
          ) : (
            <>
              {price.label}
              {price.was && <s className="ml-1 font-normal text-muted">{price.was}</s>}
            </>
          )}
        </span>

        <span className="absolute inset-0 flex items-center justify-center">
          <span
            aria-hidden
            className="grid h-12 w-12 scale-95 place-items-center rounded-full bg-white/90 text-brand-700 opacity-90 shadow-card transition duration-300 ease-out group-hover:scale-105 group-hover:opacity-100 group-hover:shadow-lift"
          >
            <svg viewBox="0 0 24 24" width="18" height="18">
              <path d="M8 5.5v13l11-6.5z" fill="currentColor" />
            </svg>
          </span>
        </span>
      </Link>

      <div className="flex flex-1 flex-col gap-2 p-4">
        <div className="flex flex-wrap gap-1.5">
          {course.level && (
            <span className="chip border-brand-100 bg-brand-50 text-brand-700">{course.level}</span>
          )}
          {course.language && (
            <span className="chip border-slate-200 bg-slate-50 text-slate-600">{course.language}</span>
          )}
        </div>

        <h3 className="font-semibold leading-snug">
          <Link href={`/course/${course.slug}`} className="hover:text-brand-600">
            {course.title}
          </Link>
        </h3>

        {course.short_description && (
          <p className="line-clamp-2 text-sm text-muted">{course.short_description}</p>
        )}

        <div className="mt-auto flex items-center justify-between gap-2 pt-2">
          <span className="flex min-w-0 items-center gap-2 text-xs text-muted">
            {course.instructor_name && (
              <>
                <span aria-hidden className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-brand-50 text-[10px] font-semibold text-brand-700">
                  {initial}
                </span>
                <span className="truncate">{course.instructor_name}</span>
              </>
            )}
          </span>
          <Link
            href={`/course/${course.slug}`}
            className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-brand-600 opacity-0 transition duration-200 ease-out group-hover:opacity-100"
          >
            View course
            <svg viewBox="0 0 20 20" width="12" height="12" aria-hidden="true">
              <path d="M4 10h11m0 0-4-4m4 4-4 4" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </Link>
        </div>
      </div>
    </article>
  );
}
