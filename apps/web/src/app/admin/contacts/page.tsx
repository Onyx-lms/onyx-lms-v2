import type { Metadata } from 'next';
import { requireRole, apiAuthSafe } from '@/lib/session';
import { DashboardShell } from '@/components/dashboard-shell';
import { ADMIN_NAV } from '@/lib/nav';
import { ContactInbox, type Enquiry } from '@/components/contact-inbox';

export const metadata: Metadata = { title: 'Contact enquiries' };
export const dynamic = 'force-dynamic';

/** M-06 -- the contact form inbox. Opening it marks everything read. */
export default async function AdminContacts(
  { searchParams }: { searchParams: Promise<Record<string, string | undefined>> },
) {
  const session = await requireRole('admin');
  const params = await searchParams;
  const search = params['search'] ?? '';
  const enquiries = (await apiAuthSafe<Enquiry[]>(
    '/api/admin/contacts' + (search ? '?search=' + encodeURIComponent(search) : ''))) ?? [];

  return (
    <DashboardShell role={session.app_role} email={session.email}
      nav={ADMIN_NAV} title="Contact enquiries">
      <form action="/admin/contacts" className="flex gap-2">
        <input name="search" defaultValue={search} placeholder="Search name, email, phone or text"
          className="w-full max-w-md rounded-md border border-slate-300 px-3 py-2 text-sm" />
        <button className="btn-primary" type="submit">Search</button>
      </form>

      {enquiries.length === 0 ? (
        <p className="mt-6 rounded-lg border border-dashed border-slate-300 p-10 text-center text-sm text-slate-500">
          {search ? 'Nothing matches that search.' : 'No enquiries yet.'}
        </p>
      ) : (
        <ul className="mt-6 space-y-3">
          {enquiries.map((e) => (
            <li key={e.id} className="card grid gap-4 p-4 sm:grid-cols-[1fr_220px]">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{e.name ?? 'Anonymous'}</span>
                  <span className="text-sm text-slate-500">{e.email}</span>
                  {e.replied ? (
                    <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700">
                      Replied
                    </span>
                  ) : (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700">
                      Awaiting reply
                    </span>
                  )}
                </div>
                <p className="mt-2 whitespace-pre-line text-sm text-slate-700">{e.message}</p>
                <p className="mt-2 text-xs text-slate-500">
                  {[e.phone, e.address].filter(Boolean).join(' - ')}
                  {e.created_at ? ' - ' + new Date(e.created_at).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' }) : ''}
                </p>
              </div>
              <ContactInbox enquiry={e} />
            </li>
          ))}
        </ul>
      )}
    </DashboardShell>
  );
}
