'use client';

import { usePathname } from 'next/navigation';

/**
 * The storefront's header and footer, and the rule that Onyx never wears them.
 *
 * Onyx is a separate product on this deployment (ADR-006): an institutional
 * platform must not carry another product's branding. The root layout enforced
 * that by reading `x-pathname` and returning a different tree under `/onyx` --
 * which is right exactly once, because a ROOT LAYOUT is not re-rendered on a
 * client-side navigation. Somebody who clicked "Sign in" on the marketing page
 * landed on the Onyx sign-in screen with the shop's header still above it,
 * cart and all; loading the same URL directly was clean, so it only ever
 * showed for people who arrived the way people actually arrive.
 *
 * `usePathname()` re-evaluates on every navigation, soft or hard, which is the
 * only thing that holds in both directions -- into Onyx and back out again.
 *
 * The chrome arrives as SLOTS rather than being imported here: SiteHeader
 * reaches for the session, which needs `next/headers`, so it has to stay a
 * server component. The layout renders it and this decides whether it belongs
 * on the page.
 */
export function StorefrontChrome({ header, footer, children }: {
  header: React.ReactNode;
  footer: React.ReactNode;
  children: React.ReactNode;
}) {
  const onyx = usePathname().startsWith('/onyx');

  return (
    <>
      {onyx ? null : header}
      {/* WCAG 2.4.1: tabIndex={-1} is load-bearing -- <main> is not natively
          focusable, so without it the skip link only scrolls, focus stays on
          the link, and a screen reader never announces the jump. -1 keeps it
          out of the normal Tab order; it is only ever focused by that link. */}
      <main id="main" tabIndex={-1} className="flex-1">{children}</main>
      {onyx ? null : footer}
    </>
  );
}
