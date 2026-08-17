import Link from 'next/link';
import { LogoutButton } from './logout-button';
import type { AppRole } from '@/lib/session';

export interface NavItem { href: string; label: string }

/** C-01: the authenticated shell for student, instructor and admin. */
export function DashboardShell({ role, email, nav, title, children }: {
  role: AppRole;
  email: string;
  nav: NavItem[];
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="container-page grid gap-8 py-8 lg:grid-cols-[220px_1fr]">
      <aside>
        <div className="rounded-xl border border-slate-200 p-4">
          <div className="text-xs uppercase tracking-wide text-slate-500">{role}</div>
          <div className="mt-1 truncate text-sm font-medium" title={email}>{email}</div>
        </div>
        <nav className="mt-4 space-y-1">
          {nav.map((item) => (
            <Link key={item.href} href={item.href}
              className="block rounded-lg px-3 py-2 text-sm text-slate-700 hover:bg-slate-100">
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="mt-4"><LogoutButton /></div>
      </aside>

      <section>
        <h1 className="text-2xl font-semibold">{title}</h1>
        <div className="mt-6">{children}</div>
      </section>
    </div>
  );
}
