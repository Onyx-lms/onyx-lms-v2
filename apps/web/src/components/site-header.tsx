import Link from 'next/link';
import type { CategoryNode, SiteSettings } from '@/lib/api';
import { getSession, homeForRole } from '@/lib/session';
import { OnyxMark } from '@/components/onyx-brand';

export async function SiteHeader({ settings, categories }: {
  settings: SiteSettings | null;
  categories: CategoryNode[];
}) {
  const session = await getSession();

  return (
    <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/90 backdrop-blur">
      <div className="container-page flex h-16 items-center gap-6">
        {/* The mark was missing here entirely: the storefront header showed the
            title as text while every page under /onyx wore the actual logo, so
            the two halves of the same deployment did not look related.
            `OnyxMark` renders it with alt="" on purpose -- the name is right
            beside it in text, and a described image would make a screen reader
            announce the brand twice. */}
        <Link href="/" className="flex min-h-[44px] items-center gap-2.5">
          <OnyxMark className="h-8 w-auto shrink-0" />
          <span className="text-lg font-semibold tracking-tight text-brand-700">
            {settings?.system_title ?? 'Onyx LMS'}
          </span>
        </Link>

        <nav className="hidden items-center gap-5 text-sm md:flex">
          {/* Workshops, Tutors, Teams and Blog are deliberately absent from the
              nav. The routes still exist and still answer -- /bootcamps,
              /tutors, /team-packages and /blogs are reachable by link and by
              search engine, and nothing that deep-links into them breaks. They
              are simply no longer advertised on the way in, so the front door
              offers courses and the people who teach them rather than six
              destinations of uneven weight. */}
          <Link href="/courses" className="hover:text-brand-600">Courses</Link>
          <Link href="/instructors" className="hover:text-brand-600">Instructors</Link>
          <Link href="/knowledge-base" className="hover:text-brand-600">Help</Link>
          <Link href="/about-us" className="hover:text-brand-600">About</Link>
          <Link href="/contact-us" className="hover:text-brand-600">Contact</Link>
        </nav>

        <form action="/courses" className="ml-auto hidden flex-1 max-w-xs md:block">
          <input
            type="search"
            name="search"
            placeholder="Search courses"
            aria-label="Search courses"
            className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm outline-none focus:border-brand-500"
          />
        </form>

        {session ? (
          <Link href={homeForRole(session.app_role)} className="btn-primary ml-auto md:ml-0">
            Dashboard
          </Link>
        ) : (
          // Straight to Onyx rather than through /login's redirect: the
          // destination shows on hover, and it is one navigation fewer.
          // A learner arriving cold needs the other door too, and it was not on
          // any page of the storefront.
          <span className="ml-auto flex items-center gap-2 md:ml-0">
            <Link href="/onyx/signup"
              className="hidden min-h-[40px] items-center rounded-lg px-3 text-sm font-semibold
                         text-brand-700 hover:underline sm:inline-flex">
              Create account
            </Link>
            <Link href="/onyx/login" className="btn-primary">Sign in</Link>
          </span>
        )}
      </div>

      {categories.length > 0 && (
        <div className="border-t border-slate-100 bg-slate-50">
          <div className="container-page flex gap-4 overflow-x-auto py-2 text-sm">
            {categories.slice(0, 8).map((c) => (
              <Link
                key={c.id}
                href={`/courses?category=${c.slug}`}
                className="whitespace-nowrap text-slate-600 hover:text-brand-600"
              >
                {c.title}
                {/* `muted`, not slate-400: the count sits on the tinted strip
                    and axe flagged it as a serious contrast failure on every
                    page that renders this header, not just this one. */}
                <span className="ml-1 text-xs text-muted">({c.course_count})</span>
              </Link>
            ))}
          </div>
        </div>
      )}
    </header>
  );
}
