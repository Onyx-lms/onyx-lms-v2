'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useState, useTransition } from 'react';
import type { Me, Role, Tenant } from '@/lib/onyx-session';
import { ROLE_LABELS, navFor, tabsFor, type OnyxNavGroup } from '@/lib/onyx-nav';
import { Icon } from '@/components/onyx-ui';
import { NotificationBell } from '@/components/onyx-inbox';
import { OnyxCreateProfileButton } from '@/components/onyx-create-profile-nav';

/**
 * F-07 -- the Onyx shell.
 *
 * Which institution you are in is the single most consequential thing on the
 * screen, so it is named in the sidebar rather than implied. When someone
 * belongs to more than one, switching is one control away and reloads
 * everything -- because everything below is scoped to the tenant in the token.
 *
 * The layout was rebuilt around a measured defect. The previous shell was a
 * single `lg:grid-cols-[240px_1fr]` with the sidebar first in the DOM, so
 * below `lg` the entire navigation simply stacked on top of the page: a
 * student on a phone scrolled past 13 links and 906px -- more than a full
 * 844px viewport -- before reaching one piece of their own work. Now the
 * sidebar is desktop-only, and a phone gets a sticky header plus a bottom tab
 * bar, so content starts immediately.
 */
export type { OnyxNavItem } from '@/lib/onyx-nav';

export function OnyxShell({ me, title, subtitle, children, action }: {
  me: Me;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  /** Optional primary action rendered beside the page title. */
  action?: React.ReactNode;
  /** Accepted for compatibility with callers that still pass it; the shell
   *  derives navigation from the role itself. */
  nav?: unknown;
}) {
  const groups = navFor(me.role);
  const tabs = tabsFor(me.role);
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="min-h-screen bg-canvas">
      <Header me={me} onMenu={() => setMenuOpen(true)} />

      {menuOpen ? (
        <MobileMenu me={me} groups={groups} onClose={() => setMenuOpen(false)} />
      ) : null}

      <div className="grid gap-7 px-4 pb-24 pt-5
                      lg:grid-cols-[216px_minmax(0,1fr)] lg:items-start lg:px-7 lg:pb-10 lg:pt-7">
        <aside className="hidden lg:sticky lg:top-[84px] lg:block">
          <TenantCard tenant={me.tenant} role={me.role}
            memberships={me.memberships} />
          {/* An institution admin creates a profile the same way a platform
              operator does -- same modal, same idea -- except there is no
              institution to choose: this account is always this institution. */}
          {me.role === 'admin' ? (
            <div className="mt-4"><OnyxCreateProfileButton /></div>
          ) : null}
          <nav className="mt-4" aria-label="Main">
            {groups.map((g, i) => (
              <NavGroup key={g.label ?? i} group={g} />
            ))}
          </nav>
          <div className="mt-4 rounded-2xl border border-line bg-white p-3">
            <div className="truncate text-xs text-muted" title={me.email}>{me.email}</div>
            <SignOutButton />
          </div>
        </aside>

        {/* A div, not a second `<main id="main">`. The root layout already
            owns the landmark and the skip link targets it, so this one nested
            inside it and duplicated the id on every authenticated page --
            which leaves `#main` ambiguous and the skip link landing on the
            outer element. The three pages that render no shell (denied,
            verify, transcript) already carry comments saying the root layout
            owns the landmark; these two shells were the only places not
            following that. */}
        <div className="min-w-0">
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="text-2xl font-extrabold tracking-tight sm:text-[28px]">{title}</h1>
              {subtitle ? <p className="mt-1 text-sm text-muted">{subtitle}</p> : null}
            </div>
            {action}
          </div>
          {children}
        </div>
      </div>

      <TabBar tabs={tabs} />
    </div>
  );
}

/* ------------------------------------------------------------------ header */

function Header({ me, onMenu }: { me: Me; onMenu: () => void }) {
  const initials = (me.email ?? '?').slice(0, 2).toUpperCase();
  return (
    <header className="sticky top-0 z-40 flex h-[60px] items-center gap-3 border-b border-line
                       bg-white/90 px-4 backdrop-blur lg:px-7">
      <button type="button" onClick={onMenu} aria-label="Open navigation"
        className="grid h-11 w-11 place-items-center rounded-2xl border border-line
                   text-muted hover:bg-brand-50 hover:text-brand-700 lg:hidden">
        <Icon name="menu" />
      </button>

      <Link href="/onyx/dashboard" aria-label="Onyx LMS, home"
        className="flex min-h-[44px] items-center gap-2.5">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/onyx-mark.png" alt="" className="h-7 w-auto" />
        <span className="hidden text-[15px] font-bold tracking-tight sm:inline">Onyx LMS</span>
      </Link>

      <span className="flex-1" />

      <span className="hidden truncate text-xs text-muted sm:block lg:hidden"
        title={me.tenant.name}>
        {me.tenant.name}
      </span>

      {/* Beside the avatar, which is where every product this audience already
          uses puts it. The count is what makes it worth having. */}
      <NotificationBell />
      <span className="grid h-[38px] w-[38px] shrink-0 place-items-center rounded-full
                       bg-gradient-to-br from-brand-500 to-brand-700 text-[13px]
                       font-bold text-white" aria-hidden="true">
        {initials}
      </span>
    </header>
  );
}

/* -------------------------------------------------------------- navigation */

function NavGroup({ group }: { group: OnyxNavGroup }) {
  const pathname = usePathname();
  // A handful of items (Students/Faculty) are the same page with a
  // different query string, so the plain pathname match every other item
  // uses would light both up together. Only those need the query compared.
  const searchParams = useSearchParams();
  const currentFull = pathname + (searchParams.toString() ? '?' + searchParams.toString() : '');
  return (
    <div className="mb-4">
      {group.label ? (
        <div className="mb-1.5 px-2.5 text-[10.5px] font-bold uppercase tracking-[.09em]
                        text-muted">
          {group.label}
        </div>
      ) : null}
      {group.items.map((item) => {
        const active = item.href.includes('?')
          ? currentFull === item.href
          : pathname === item.href || pathname.startsWith(item.href + '/');
        return (
          <Link
            key={item.href + item.label}
            href={item.href}
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
  );
}

/** The phone menu. A sheet, so it covers rather than displaces the content. */
function MobileMenu({ me, groups, onClose }: {
  me: Me; groups: OnyxNavGroup[]; onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 lg:hidden">
      <button type="button" aria-label="Close navigation" onClick={onClose}
        className="absolute inset-0 bg-ink/40" />
      <div className="absolute inset-y-0 left-0 flex w-[86%] max-w-[320px] flex-col
                      overflow-y-auto bg-white p-4 shadow-lift">
        <div className="mb-3 flex items-center justify-between">
          <span className="text-[15px] font-bold">Menu</span>
          <button type="button" onClick={onClose} aria-label="Close navigation"
            className="grid h-11 w-11 place-items-center rounded-2xl border border-line text-muted">
            ✕
          </button>
        </div>
        <TenantCard tenant={me.tenant} role={me.role} memberships={me.memberships} />
        {me.role === 'admin' ? (
          <div className="mt-4"><OnyxCreateProfileButton /></div>
        ) : null}
        <nav className="mt-4 flex-1" aria-label="All sections" onClick={onClose}>
          {groups.map((g, i) => <NavGroup key={g.label ?? i} group={g} />)}
        </nav>
        <div className="rounded-2xl border border-line p-3">
          <div className="truncate text-xs text-muted" title={me.email}>{me.email}</div>
          <SignOutButton />
        </div>
      </div>
    </div>
  );
}

/** Five destinations, thumb-reachable. The full menu stays in the header. */
function TabBar({ tabs }: { tabs: ReturnType<typeof tabsFor> }) {
  const pathname = usePathname();
  if (tabs.length < 2) return null;
  return (
    // w-screen/max-w-full rather than relying on inset-x-0 alone: a fixed
    // element sizes against the initial containing block, so if any page ever
    // scrolls sideways the bar silently grows with it instead of staying the
    // width of the screen. Pinning the width makes the bar independent of
    // whatever a page below it does.
    <nav aria-label="Quick navigation"
      className="fixed bottom-0 left-0 z-40 grid w-screen max-w-full border-t border-line
                 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden"
      style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}>
      {tabs.map((t) => {
        const active = pathname === t.href || pathname.startsWith(t.href + '/');
        return (
          <Link key={t.href + t.label} href={t.href}
            aria-current={active ? 'page' : undefined}
            className={'flex h-16 flex-col items-center justify-center gap-1 text-[10.5px] '
              + 'font-semibold ' + (active ? 'text-brand-600' : 'text-muted')}>
            <Icon name={t.icon} className="h-[22px] w-[22px]" />
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}

/* ---------------------------------------------------------------- tenant */

function TenantCard({ tenant, role, memberships }: {
  tenant: Tenant; role: Role; memberships: { tenant: Tenant; role: Role }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const others = memberships.filter((m) => m.tenant.id !== tenant.id);

  const switchTo = (id: number) => {
    setError(null);
    start(async () => {
      const res = await fetch('/api/web/onyx/switch', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenant_id: id }),
      });
      const body = await res.json().catch(() => ({}));
      if (!body.ok) { setError(body.message ?? 'Could not switch.'); return; }
      setOpen(false);
      // A hard refresh, not a client transition: every server component below
      // was rendered against the old tenant.
      router.refresh();
      router.push('/onyx/dashboard');
    });
  };

  return (
    // A stable hook for tests. The suite previously located this card by its
    // Tailwind classes (`div.rounded-xl.border-slate-200.p-4`), which meant
    // restyling the shell broke six passing tests that had found no real
    // defect -- a test coupled to a class name tests the stylesheet, not the
    // product.
    <div data-testid="tenant-card" className="rounded-2xl border border-line bg-white p-3.5">
      <div className="text-[10.5px] font-bold uppercase tracking-[.09em] text-muted">
        Institution
      </div>
      <div className="mt-0.5 truncate text-sm font-bold" title={tenant.name}>{tenant.name}</div>
      <div className="text-xs text-muted">{ROLE_LABELS[role]}</div>

      {others.length > 0 ? (
        <>
          <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open}
            className="mt-2.5 w-full rounded-2xl border border-line px-3 py-2 text-xs
                       font-medium text-slate-700 hover:bg-brand-50">
            Switch institution
          </button>
          {open ? (
            <ul className="mt-2 space-y-1">
              {others.map((m) => (
                <li key={m.tenant.id}>
                  <button type="button" disabled={pending} onClick={() => switchTo(m.tenant.id)}
                    className="w-full rounded-xl px-2 py-2 text-left text-xs text-slate-700
                               hover:bg-slate-100 disabled:opacity-50">
                    <span className="block truncate font-medium">{m.tenant.name}</span>
                    <span className="text-muted">{ROLE_LABELS[m.role]}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          {error ? <p role="alert" className="mt-2 text-xs text-red-700">{error}</p> : null}
        </>
      ) : null}
    </div>
  );
}

function SignOutButton() {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      type="button" disabled={pending}
      onClick={() => start(async () => {
        await fetch('/api/web/onyx/login', { method: 'DELETE' });
        router.push('/onyx/login');
        router.refresh();
      })}
      className="mt-2 min-h-[38px] w-full rounded-2xl border border-line px-3 py-1.5 text-xs
                 font-medium text-slate-700 hover:bg-brand-50 disabled:opacity-50"
    >
      {pending ? 'Signing out…' : 'Sign out'}
    </button>
  );
}
