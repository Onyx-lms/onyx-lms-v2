'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/**
 * The platform-wide links -- Institutions and Platform admins. Split out
 * from OnyxPlatformShell (a server component) for the one reason a client
 * component earns its keep here: enough destinations that which one you're
 * on should be visibly marked, the same as every other nav in this product
 * (OnyxShell's NavGroup, TenantSidebarNav).
 *
 * Audit log is deliberately not listed here -- the page and its API still
 * work, reachable directly at /onyx/platform/audit; it is just not a navbar
 * destination.
 */
const LINKS = [
  { href: '/onyx/platform', label: 'Institutions' },
  { href: '/onyx/platform/admins', label: 'Platform admins' },
  { href: '/onyx/platform/oauth-clients', label: 'OAuth clients' },
];

export function PlatformNavLinks() {
  const pathname = usePathname();
  return (
    <nav className="mt-4" aria-label="Platform">
      {LINKS.map((l) => {
        // Exact match only: /onyx/platform itself must not read as active
        // while looking at /onyx/platform/tenants/42 (a prefix match would
        // light up "Institutions" for every tenant page too).
        const active = pathname === l.href;
        return (
          <Link key={l.href} href={l.href} aria-current={active ? 'page' : undefined}
            className={'flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-sm '
              + (active
                ? 'bg-brand-600 font-semibold text-white'
                : 'font-medium text-slate-700 hover:bg-brand-50 hover:text-brand-700')}>
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
