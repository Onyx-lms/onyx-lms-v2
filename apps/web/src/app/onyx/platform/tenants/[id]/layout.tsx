import Link from 'next/link';
import { OnyxPlatformShell } from '@/components/onyx-platform-shell';
import { TenantSidebarNav, TenantHeader } from '@/components/onyx-platform-tenant-nav';
import { requirePlatformSession, platformApi } from '@/lib/onyx-platform-session';
import type { TenantDetail } from '@/lib/onyx-platform-tenant';
import { plural } from '@/lib/onyx-platform-tenant';
import { Icon, Pill } from '@/components/onyx-ui';

/**
 * Shared chrome for every `/onyx/platform/tenants/[id]/...` page: the
 * breadcrumb and section title up top, the institution strip under it, the tab
 * content in the middle, and -- in the shell's own left sidebar, via
 * `sidebarNav` -- the grouped nav that replaced one long scrolling page with
 * Overview/Students/Faculty/Courses/Assignments/Examinations/Assessments/
 * Grades/Fees as their own routes, navigated the same way every tenant-side
 * role already navigates (OnyxShell's NavGroup).
 *
 * Two things this file used to get wrong, both fixed here.
 *
 * **It never said which section you were on.** Every one of the thirteen
 * sections was headed with the institution's NAME, so the fee ledger, the
 * roster and the grade book all read "ABC Institution" and the name appeared
 * three times above the fold (h1, identity card, sidebar) while the one word
 * that would have told you where you were appeared nowhere. The section is now
 * the h1, with the path above it -- the shape Dialpad, Salesforce Setup and
 * Etsy's seller console all use.
 *
 * That heading is rendered by a CLIENT component (TenantHeader), not computed
 * here, and the reason is the sharp edge in this file: a layout is not
 * re-rendered when you navigate between its sibling pages. The first version
 * read the section from the `x-pathname` header, which was right on the first
 * paint and frozen after it -- click Students, then Faculty, then Fees, and
 * all three were still headed "Overview". Anything in a layout that depends on
 * WHICH child is showing has to be derived on the client.
 *
 * **Nothing destructive renders here any more.** Suspend and delete sat in the
 * top card first, then in a "Danger zone" below the content -- but this is a
 * LAYOUT, so either way they appeared under all thirteen sections. An operator
 * reading the fee ledger had "Delete institution" on the same screen for no
 * reason connected to what they came to do. Both now live once, on `settings/`.
 * Read state (the status dot, "nobody can sign in") stays up top where it
 * belongs -- it is information, not a lever.
 *
 * The tenant read is fetched here, once, for the header and the nav's
 * institution name -- each child page still reads its own section data
 * independently (a Next layout cannot hand a server-fetched value to a page
 * except through this file's own children prop, and every section already
 * degrades to its own "could not load" banner on a failed read, which a
 * shared fetch would not preserve).
 */

export default async function OnyxPlatformTenantLayout(
  { params, children }: { params: Promise<{ id: string }>; children: React.ReactNode },
) {
  const session = await requirePlatformSession();
  const { id } = await params;
  const tenant = await platformApi<TenantDetail>(
    '/api/onyx/platform/tenants/' + encodeURIComponent(id));
  const live = tenant.status === 1;
  const base = '/onyx/platform/tenants/' + tenant.id;

  return (
    <OnyxPlatformShell
      email={session.email}
      // The heading is a client component, not props computed here. See
      // TenantHeader: this file is a LAYOUT, and a layout does not re-render
      // when you move between its sibling pages, so a section title derived
      // here reads correctly once and then lies for the rest of the session.
      title={tenant.name}
      header={(
        <TenantHeader
          tenantId={tenant.id}
          tenantName={tenant.name}
          badge={live ? null : <Pill tone="late">Suspended</Pill>}
          subtitle={plural(tenant.member_count, 'member') + ' · '
            + plural(tenant.counts.courses, 'course')}
        />
      )}
      sidebarNav={<TenantSidebarNav tenantId={tenant.id} tenantName={tenant.name} />}
    >
      <div className="min-w-0 space-y-5">
        {/* The institution, in one line rather than the 180px card this used
            to be: the name is already in the breadcrumb above, so what is left
            is the handful of facts an operator checks before acting -- is it
            live, what is its address, what plan is it on -- and the way to
            change any of them. */}
        <div className={'flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border '
          + 'px-3.5 py-2.5 ' + (live
            ? 'border-line bg-white'
            : 'border-red-300 bg-red-50/60')}>
          <span className="flex min-w-0 items-center gap-2">
            <Icon name="building" className="h-4 w-4 shrink-0 text-brand-600" />
            <span className="truncate text-[13.5px] font-bold">{tenant.name}</span>
          </span>
          <span className="truncate font-mono text-[12px] text-muted">{tenant.slug}</span>
          {tenant.plan ? (
            <span className="text-[12.5px] text-muted">plan: {tenant.plan}</span>
          ) : null}
          <span className="text-[12.5px] text-muted">
            {live ? 'Everyone here can sign in.' : 'Nobody here can sign in — their data is untouched.'}
          </span>
          <span className="flex-1" />
          <Link href={base + '/settings'}
            className="inline-flex min-h-[32px] shrink-0 items-center gap-1.5 rounded-lg border
                       border-slate-300 px-2.5 text-[12.5px] font-semibold hover:border-brand-300
                       hover:text-brand-700">
            <Icon name="settings" className="h-3.5 w-3.5" />
            Settings
          </Link>
        </div>

        <div className="min-w-0">{children}</div>
      </div>
    </OnyxPlatformShell>
  );
}
