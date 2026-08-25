'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/**
 * The two halves of a section, as tabs across the top of it.
 *
 * Examinations and Assessments each carry two things that are genuinely
 * different work: the SCHEDULE — what is happening, when, to whom, and how it
 * went — and the PAPERS, which is the bank a setter builds weeks earlier. They
 * were one page, so an operator scheduling a sitting had to scroll past a bank
 * composer to reach the list, and a setter building a bank scrolled past a
 * calendar to reach the composer.
 *
 * Tabs rather than two nav items, because they are one destination read two
 * ways: "Examinations" is where you go, and which half you want depends on what
 * you came to do. A sidebar with `Exam schedule` and `Exam papers` as siblings
 * of `Courses` would say they are separate places, and the crumb trail would
 * lose the fact that both belong to Examinations.
 *
 * The active tab is decided by the longest matching href, which is the same
 * rule the sidebar uses: `/examinations/papers` must light Papers and not
 * Schedule, and `/examinations/12` — a sitting's own page — must keep Schedule
 * lit, because that is the half it belongs to.
 */
export function SubTabs({ tabs }: {
  tabs: { href: string; label: string; count?: number }[];
}) {
  const pathname = usePathname();

  const active = tabs.reduce<string | null>((best, t) => {
    const matches = pathname === t.href || pathname.startsWith(t.href + '/');
    if (!matches) return best;
    return best === null || t.href.length > best.length ? t.href : best;
  }, null);

  return (
    <nav aria-label="Section" className="mb-4 border-b border-line">
      <ul className="-mb-px flex flex-wrap gap-1">
        {tabs.map((t) => {
          const on = t.href === active;
          return (
            <li key={t.href}>
              <Link
                href={t.href}
                aria-current={on ? 'page' : undefined}
                className={'inline-flex items-center gap-2 border-b-2 px-3.5 py-2.5 '
                  + 'text-[13.5px] font-semibold transition '
                  + (on
                    ? 'border-brand-600 text-brand-700'
                    : 'border-transparent text-muted hover:border-line hover:text-ink')}
              >
                {t.label}
                {t.count === undefined ? null : (
                  <span className={'rounded-full px-1.5 py-0.5 text-[11.5px] tabular-nums '
                    + (on ? 'bg-brand-50 text-brand-700' : 'bg-slate-100 text-muted')}>
                    {t.count}
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
