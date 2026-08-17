import { apiAuthSafe } from '@/lib/session';
import type { Message, Thread } from '@/components/messenger';

/**
 * M-03 -- the data behind every inbox screen. Student, instructor and admin
 * all use the same endpoints; only the shell around them differs.
 */
export async function loadInbox(code: string | undefined) {
  const threads = (await apiAuthSafe<Thread[]>('/api/messages/threads')) ?? [];
  if (!code) return { threads, active: null as Thread | null, messages: [] as Message[] };

  const conversation = await apiAuthSafe<{
    thread: Thread; contact: Thread['contact']; messages: Message[];
  }>('/api/messages/threads/' + encodeURIComponent(code));
  if (!conversation) return { threads, active: null as Thread | null, messages: [] as Message[] };

  // The inbox row carries the unread count and contact the sidebar renders;
  // prefer it, and fall back to the conversation for a thread with no messages.
  const active = threads.find((t) => t.code === conversation.thread.code)
    ?? { ...conversation.thread, contact: conversation.contact, unread: 0, last_message: null };
  return { threads, active, messages: conversation.messages };
}
