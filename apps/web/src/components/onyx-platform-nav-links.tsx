'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Icon, type IconName } from '@/components/onyx-ui';

/**
 * The platform-wide navigation.
 *
 * Three flat links with no icons and no grouping, which was fine at three and
 * says nothing about what this console IS. Every operator console worth
 * copying groups its sidebar by the kind of thing being administered --
 * Google Workspace (Directory / Devices / Apps / Billing), Docusign (Signing
 * and sending / Integrations / Agreement actions), Unity Cloud (Projects /
 * Products / Administration) -- because the grouping is what tells somebody
 * arriving what the console can do before they have clicked anything.
 *
 * Two groups here, because there are honestly two kinds of thing: the
 * customers, and the keys to the platform itself.
 *
 * Audit log sits under Platform rather than being unlisted. On the tenant side
 * it was removed from the menu because an administrator is SENT there; here it
 * is the opposite -- reviewing what operators did to customers' institutions is
 * a thing an operator does deliberately, and it is one of the few screens in
 * this product that exists to be browsed.
 */
interface NavLink { href: string; label: string; icon: IconName; exact?: boolean }
interface NavGroup { label: string; items: NavLink[] }

const GROUPS: NavGroup[] = [
  {
    label: 'Customers',
    items: [
      // Exact, so it does not light up while an institution is open -- the
      // institution's own nav is showing underneath by then.
      { href: '/onyx/platform', label: 'Institutions', icon: 'building', exact: true },
    ],
  },
  {
    label: 'Platform',
    items: [
      { href: '/onyx/platform/admins', label: 'Operators', icon: 'shield' },
      { href: '/onyx/platform/oauth-clients', label: 'OAuth clients', icon: 'code' },
      { href: '/onyx/platform/audit', label: 'Audit log', icon: 'flag' },
    ],
  },
];

export function PlatformNavLinks() {
  const pathname = usePathname();

  return (
    <nav className="mt-4" aria-label="Platform">
      {GROUPS.map((group) => (
        <div key={group.label} className="mb-3.5">
          <div className="mb-1 px-2.5 text-[10px] font-bold uppercase tracking-[.08em] text-muted">
            {group.label}
          </div>
          {group.items.map((l) => {
            const active = l.exact
              ? pathname === l.href
              : pathname === l.href || pathname.startsWith(l.href + '/');
            return (
              <Link key={l.href} href={l.href} aria-current={active ? 'page' : undefined}
                className={'flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-sm '
                  + (active
                    ? 'bg-brand-600 font-semibold text-white'
                    : 'font-medium text-slate-700 hover:bg-brand-50 hover:text-brand-700')}>
                <Icon name={l.icon} className={'h-[18px] w-[18px] ' + (active ? '' : 'opacity-85')} />
                {l.label}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
