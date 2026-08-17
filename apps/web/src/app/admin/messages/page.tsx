import type { Metadata } from 'next';
import { requireRole } from '@/lib/session';
import { DashboardShell } from '@/components/dashboard-shell';
import { ADMIN_NAV } from '@/lib/nav';
import { Messenger } from '@/components/messenger';
import { loadInbox } from '@/lib/messages';

export const metadata: Metadata = { title: 'Messages' };
export const dynamic = 'force-dynamic';

/**
 * M-05 -- admin messaging.
 *
 * The same screen as /messages: an admin opens a thread with anyone through
 * the contact search. It is a separate route only so it sits inside the admin
 * navigation. Unlike Admin\MessageController::store(), the sender is always the
 * signed-in admin -- see ADR-004.
 */
export default async function AdminMessagesPage(
  { searchParams }: { searchParams: Promise<Record<string, string | undefined>> },
) {
  const session = await requireRole('admin');
  const params = await searchParams;
  const { threads, active, messages } = await loadInbox(params['inbox']);

  return (
    <DashboardShell role={session.app_role} email={session.email}
      nav={ADMIN_NAV} title="Messages">
      <Messenger threads={threads} active={active} messages={messages}
        viewerId={session.user_id} basePath="/admin/messages" />
    </DashboardShell>
  );
}
