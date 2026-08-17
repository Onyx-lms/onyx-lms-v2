import type { Metadata } from 'next';
import { requireSession } from '@/lib/session';
import { DashboardShell } from '@/components/dashboard-shell';
import { STUDENT_NAV, INSTRUCTOR_NAV, ADMIN_NAV } from '@/lib/nav';
import { Messenger } from '@/components/messenger';
import { loadInbox } from '@/lib/messages';

export const metadata: Metadata = { title: 'Messages' };
// Conversations must never be served from a cache shared between users.
export const dynamic = 'force-dynamic';

const navFor = (role: string) =>
  role === 'admin' ? ADMIN_NAV : role === 'instructor' ? INSTRUCTOR_NAV : STUDENT_NAV;

export default async function MessagesPage(
  { searchParams }: { searchParams: Promise<Record<string, string | undefined>> },
) {
  const session = await requireSession();
  const params = await searchParams;
  const { threads, active, messages } = await loadInbox(params['inbox']);

  return (
    <DashboardShell role={session.app_role} email={session.email}
      nav={navFor(session.app_role)} title="Messages">
      <Messenger threads={threads} active={active} messages={messages}
        viewerId={session.user_id} basePath="/messages" />
    </DashboardShell>
  );
}
