'use client';

import Link from 'next/link';
import { useState } from 'react';
import { OnyxMark } from '@/components/onyx-brand';
import { PlatformSignOut, CreateProfileForm, CreateTenantForm } from '@/components/onyx-platform-forms';
import { PlatformNavLinks } from '@/components/onyx-platform-nav-links';
import { Icon } from '@/components/onyx-ui';

/**
 * The platform console's own shell -- not OnyxShell.
 *
 * OnyxShell's whole header is a tenant switcher: an institution's name, its
 * role labels, a list of other institutions the signed-in person belongs to.
 * None of that exists for a platform admin, who is not a member of any
 * institution by virtue of holding this session. Reusing OnyxShell here would
 * mean either passing it a fake tenant or teaching it a "no tenant" mode --
 * both bend a component whose whole point is "you are always inside exactly one
 * institution" to describe someone who, on this page, is not.
 *
 * What it does share is the chrome. Until now this was a bare grid with a
 * left-aligned link list, and it read as an internal tool bolted to the side of
 * the product -- which is roughly the opposite of the impression you want from
 * the screen that can suspend a paying customer. Same header, same sidebar
 * card, same type scale; the one deliberate difference is the band naming this
 * as the platform, because an operator who forgets which console they are in is
 * one click from acting on the wrong institution.
 *
 * Mobile carried the same defect OnyxShell's own docstring describes and had
 * already fixed on the tenant side: the sidebar had no `hidden lg:block`, so
 * below `lg` the grid collapsed to one column and dumped the entire sidebar
 * -- operator card, both create buttons, platform nav, and (inside an
 * institution) ten more section links -- above the page on every load. A
 * platform admin opening an institution on a phone scrolled past all of that
 * before reaching the institution's name, let alone its content. Same fix as
 * OnyxShell: sidebar is desktop-only, a hamburger opens the same content as a
 * sheet on top of the page instead of pushing it down.
 */
export function OnyxPlatformShell({ email, title, subtitle, children, action, sidebarNav }: {
  email: string;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  /** The primary action for this screen, beside the title. */
  action?: React.ReactNode;
  /**
   * Institution-scoped navigation, rendered below the platform-wide links
   * rather than instead of them -- Institutions and Platform admins stay one
   * click away the same way OnyxShell's own sidebar never hides the way back
   * out. Passed by the tenant layout when a tenant is open; absent everywhere
   * else. See onyx-platform-tenant-nav.tsx for what fills this in.
   */
  sidebarNav?: React.ReactNode;
}) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="min-h-screen bg-canvas">
      <header className="sticky top-0 z-40 flex h-[60px] items-center gap-3 border-b border-line
                         bg-white/90 px-4 backdrop-blur lg:px-7">
        <button type="button" onClick={() => setMenuOpen(true)} aria-label="Open navigation"
          className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl border border-line
                     text-muted hover:bg-brand-50 hover:text-brand-700 lg:hidden">
          <Icon name="menu" />
        </button>

        <Link href="/onyx/platform" aria-label="Onyx platform console, home"
          className="flex min-h-[44px] items-center gap-2.5">
          <OnyxMark className="h-7 w-auto" />
          <span className="hidden text-[15px] font-bold tracking-tight sm:inline">Onyx</span>
        </Link>
        {/* Said out loud, in the one place it cannot be missed. Every other
            screen in this product acts on one institution; this one acts on
            all of them. */}
        <span className="rounded-full bg-ink px-2.5 py-1 text-[11px] font-bold uppercase
                         tracking-[.08em] text-white">
          Platform
        </span>
        <span className="flex-1" />
        <span className="hidden truncate text-xs text-muted sm:block" title={email}>{email}</span>
      </header>

      {menuOpen ? (
        <PlatformMobileMenu email={email} sidebarNav={sidebarNav} onClose={() => setMenuOpen(false)} />
      ) : null}

      <div className="grid gap-7 px-4 pb-10 pt-5 lg:grid-cols-[216px_minmax(0,1fr)]
                      lg:items-start lg:px-7 lg:pt-7">
        <aside className="hidden lg:sticky lg:top-[84px] lg:block">
          <div className="rounded-2xl border border-line bg-white p-3.5">
            <div className="text-[10.5px] font-bold uppercase tracking-[.09em] text-muted">
              Operator
            </div>
            <div className="mt-0.5 truncate text-sm font-bold" title={email}>{email}</div>
            <div className="text-xs text-muted">Every institution</div>
          </div>

          {/* The two creation actions live in the navbar itself, not a
              page header -- so they are reachable from every screen,
              including from inside an institution, not just the
              Institutions list. Each opens as its own modal. */}
          <div className="mt-4 space-y-2">
            <CreateProfileForm />
            <CreateTenantForm />
          </div>

          <PlatformNavLinks />

          {sidebarNav}

          <div className="mt-4 rounded-2xl border border-line bg-white p-3">
            <PlatformSignOut />
          </div>
        </aside>

        <main id="main" tabIndex={-1} className="min-w-0">
          <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="text-2xl font-extrabold tracking-tight sm:text-[28px]">{title}</h1>
              {subtitle ? <p className="mt-1 text-sm text-muted">{subtitle}</p> : null}
            </div>
            {action}
          </div>
          {children}
        </main>
      </div>
    </div>
  );
}

/**
 * The phone menu. A sheet, so it covers rather than displaces the content --
 * same idea as OnyxShell's own MobileMenu.
 *
 * Only the plain navigation links (PlatformNavLinks, sidebarNav) auto-close
 * the sheet on click. CreateProfileForm and CreateTenantForm each open their
 * own modal from a click on the SAME button that would trigger auto-close --
 * closing this sheet mid-click would unmount that button's instance (and the
 * `open` state driving its modal) before the modal ever painted. Left outside
 * that wrapper, exactly like OnyxShell leaves its TenantCard's multi-step
 * switcher outside its own auto-close nav.
 */
function PlatformMobileMenu({ email, sidebarNav, onClose }: {
  email: string; sidebarNav?: React.ReactNode; onClose: () => void;
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

        <div className="rounded-2xl border border-line bg-white p-3.5">
          <div className="text-[10.5px] font-bold uppercase tracking-[.09em] text-muted">
            Operator
          </div>
          <div className="mt-0.5 truncate text-sm font-bold" title={email}>{email}</div>
          <div className="text-xs text-muted">Every institution</div>
        </div>

        <div className="mt-4 space-y-2">
          <CreateProfileForm />
          <CreateTenantForm />
        </div>

        <div className="flex-1" onClick={onClose}>
          <PlatformNavLinks />
          {sidebarNav}
        </div>

        <div className="rounded-2xl border border-line p-3">
          <PlatformSignOut />
        </div>
      </div>
    </div>
  );
}

