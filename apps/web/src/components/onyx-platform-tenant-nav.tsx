'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Icon, type IconName } from '@/components/onyx-ui';

/**
 * The nav for one open institution -- Overview, Students, Faculty, Courses...
 * a grouped left sidebar, the same shape OnyxShell already uses for every
 * tenant-side role (onyx-nav.ts's NAV, rendered by OnyxShell's NavGroup).
 * This used to be a horizontal tab strip under the identity card, which read
 * as a second, different navigation idiom bolted onto a product that
 * otherwise always navigates from the left. Consistency meant becoming the
 * same kind of nav, not a nicer version of the different one.
 *
 * The identity card stays in the main content area, in layout.tsx -- who this
 * institution is and whether it can sign in, the same distinction OnyxShell
 * draws between its TenantCard (who/where) and its NavGroup (navigation).
 * What CHANGES the institution -- rename, suspend, delete -- is not in that
 * card and not in this nav twice: it is one destination, Settings, at the
 * bottom.
 */
interface TenantNavItem { seg: string; label: string; icon: IconName }
interface TenantNavGroup { label?: string; items: TenantNavItem[] }

const GROUPS: TenantNavGroup[] = [
  { items: [{ seg: '', label: 'Overview', icon: 'home' }] },
  { label: 'People', items: [
    { seg: 'students', label: 'Students', icon: 'users' },
    { seg: 'faculty', label: 'Faculty', icon: 'user' },
    { seg: 'staff', label: 'Other roles', icon: 'shield' },
  ] },
  // Assignments has no nav entry here on purpose -- it isn't a top-level
  // destination on the tenant side either (there is no student/faculty
  // "Assignments" nav item; onyx-nav.ts has none). An assignment is
  // course-scoped, created and read from inside a course, the same way
  // courses/[id]/page.tsx does it for faculty and students. Listing it here
  // as a sibling of Assessments and Examinations implied a second,
  // coequal testing system that does not exist in the product -- the
  // platform's own assignments page is still reachable, linked from
  // Courses below, where the real feature actually lives.
  { label: 'Academics', items: [
    { seg: 'courses', label: 'Courses', icon: 'book' },
    { seg: 'timetable', label: 'Timetable', icon: 'calendar' },
    { seg: 'examinations', label: 'Examinations', icon: 'award' },
    { seg: 'assessments', label: 'Assessments', icon: 'target' },
  ] },
  { label: 'Governance', items: [
    { seg: 'permissions', label: 'Permissions', icon: 'shield' },
  ] },
  { label: 'Records', items: [
    { seg: 'grades', label: 'Grades', icon: 'trophy' },
    { seg: 'fees', label: 'Fees', icon: 'wallet' },
  ] },
  // Last, on its own, and the only route from which this institution can be
  // renamed, suspended or deleted -- see settings/page.tsx. Being a
  // destination rather than a control on every screen is what keeps the other
  // nine sections free of a red button.
  { items: [{ seg: 'settings', label: 'Settings', icon: 'settings' }] },
];

export function TenantSidebarNav({ tenantId, tenantName }: { tenantId: number; tenantName: string }) {
  const pathname = usePathname();
  const base = '/onyx/platform/tenants/' + tenantId;

  return (
    <div className="mt-4 border-t border-line pt-4">
      <div className="mb-1.5 px-2.5 text-[10.5px] font-bold uppercase tracking-[.09em] text-muted">
        This institution
      </div>
      <div className="mb-2 truncate px-2.5 text-[13px] font-bold" title={tenantName}>
        {tenantName}
      </div>
      <nav aria-label="Institution sections">
        {GROUPS.map((g, i) => (
          <div key={g.label ?? i} className="mb-3.5">
            {g.label ? (
              <div className="mb-1 px-2.5 text-[10px] font-bold uppercase tracking-[.08em] text-faint">
                {g.label}
              </div>
            ) : null}
            {g.items.map((item) => {
              const href = item.seg ? base + '/' + item.seg : base;
              const active = pathname === href;
              return (
                <Link
                  key={item.seg}
                  href={href}
                  aria-current={active ? 'page' : undefined}
                  className={'flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-sm '
                    + (active
                      ? 'bg-brand-600 font-semibold text-white'
                      : 'font-medium text-slate-700 hover:bg-brand-50 hover:text-brand-700')}
                >
                  <Icon name={item.icon} className={'h-[19px] w-[19px] ' + (active ? '' : 'opacity-85')} />
                  {item.label}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>
    </div>
  );
}
