/**
 * M-01 / M-04 -- direct messages.
 *
 * The Laravel source carries three generations of this feature at once:
 *
 *   1. `ChatController` + models `Chat` / `Message_thrade`, against tables
 *      (`chats`, `message_thrades`) that do not exist. `Message_thrade.php` is
 *      not in the repo either, so the file fatals on load.
 *   2. `frontend/Chatcontroller`, `count_unread_message_of_thread()` and
 *      `Admin\MessageController::searchThreads()`, written against an older
 *      column set (`message_thread_code`, `sender`, `receiver`, `read_status`).
 *   3. `student/MessageController` and the rest of `Admin\MessageController`,
 *      written against the columns that actually exist.
 *
 * Only (3) can run, so (3) is what this ports. See docs/ADR-004-messaging.md.
 *
 * A thread is one row per PAIR, and the pair is unordered: contact_one and
 * contact_two are whoever opened it first. Every lookup has to check both
 * orientations or a second thread appears for the same two people.
 */
import type { Db } from '../db/client.ts';
import { HttpError } from '../http/errors.ts';

const THREAD_COLUMNS = 'id, code, contact_one, contact_two, created_at, updated_at';
const MESSAGE_COLUMNS = 'id, thread_id, sender_id, receiver_id, message, read, created_at';

const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

/**
 * Thread codes appear in URLs, so they are drawn from a CSPRNG rather than
 * PHP's str_shuffle(). str_shuffle() can only ever produce characters that
 * appear once each -- 62 distinct characters shuffled and truncated -- so a
 * 20-character Laravel code has far less entropy than its length suggests, and
 * guessing one would expose a private conversation.
 */
export function newThreadCode(length = 20, random: (n: number) => Uint8Array = webRandom): string {
  const bytes = random(length);
  let out = '';
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return out;
}

function webRandom(n: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(n));
}

export interface ThreadRow {
  id: number; code: string; contact_one: number; contact_two: number;
  created_at: string | null; updated_at: string | null;
}

export class MessagingService {
  #db: Db;
  constructor(db: Db) { this.#db = db; }

  /** The other person in a thread, from the point of view of `userId`. */
  static counterpart(thread: ThreadRow, userId: number): number {
    return Number(thread.contact_one) === userId
      ? Number(thread.contact_two) : Number(thread.contact_one);
  }

  static isParticipant(thread: ThreadRow, userId: number): boolean {
    return Number(thread.contact_one) === userId || Number(thread.contact_two) === userId;
  }

  async threadById(id: number): Promise<ThreadRow> {
    const { data } = await this.#db.from('message_threads')
      .select(THREAD_COLUMNS).eq('id', id).maybeSingle();
    if (!data) throw new HttpError(404, 'Conversation not found.');
    return data as unknown as ThreadRow;
  }

  async threadByCode(code: string): Promise<ThreadRow> {
    const { data } = await this.#db.from('message_threads')
      .select(THREAD_COLUMNS).eq('code', code).maybeSingle();
    if (!data) throw new HttpError(404, 'Conversation not found.');
    return data as unknown as ThreadRow;
  }

  /**
   * The thread for a pair, in whichever orientation it was created. Returns
   * null rather than throwing so callers can decide whether to open one.
   */
  async findPair(a: number, b: number): Promise<ThreadRow | null> {
    const { data } = await this.#db.from('message_threads')
      .select(THREAD_COLUMNS)
      .or('and(contact_one.eq.' + a + ',contact_two.eq.' + b + '),'
        + 'and(contact_one.eq.' + b + ',contact_two.eq.' + a + ')')
      .maybeSingle();
    return (data as unknown as ThreadRow) ?? null;
  }

  /** M-01 -- open the conversation with someone, reusing it if it exists. */
  async openWith(userId: number, otherId: number): Promise<ThreadRow> {
    if (userId === otherId) {
      throw new HttpError(422, 'You cannot start a conversation with yourself.');
    }
    const { data: other } = await this.#db.from('users')
      .select('id').eq('id', otherId).maybeSingle();
    if (!other) throw new HttpError(404, 'That person does not exist.');

    const existing = await this.findPair(userId, otherId);
    if (existing) return existing;

    const now = new Date().toISOString();
    const { data, error } = await this.#db.from('message_threads').insert({
      code: newThreadCode(),
      contact_one: userId,
      contact_two: otherId,
      created_at: now, updated_at: now,
    }).select(THREAD_COLUMNS).maybeSingle();

    // A unique index on the pair would be a schema change, so a race can still
    // insert twice; fall back to whichever row won rather than failing.
    if (error) {
      const raced = await this.findPair(userId, otherId);
      if (raced) return raced;
      throw new HttpError(500, 'Could not start the conversation: ' + error.message);
    }
    return data as unknown as ThreadRow;
  }
  /**
   * M-03 -- the inbox: every thread the user takes part in, newest activity
   * first, with the other person and the unread count attached.
   */
  async inbox(userId: number, search?: string) {
    const { data } = await this.#db.from('message_threads')
      .select(THREAD_COLUMNS)
      .or('contact_one.eq.' + userId + ',contact_two.eq.' + userId)
      .order('updated_at', { ascending: false });
    let threads = (data ?? []) as unknown as ThreadRow[];
    if (!threads.length) return [];

    const otherIds = [...new Set(threads.map((t) => MessagingService.counterpart(t, userId)))];
    const { data: users } = await this.#db.from('users')
      .select('id, name, email, photo, role').in('id', otherIds);
    const byId = new Map((users ?? []).map((u) => [u.id, u]));

    if (search) {
      // Filtering on the contact's name or email, which is what the UI offers.
      const needle = search.trim().toLowerCase();
      threads = threads.filter((t) => {
        const u = byId.get(MessagingService.counterpart(t, userId)) as
          { name?: string | null; email?: string | null } | undefined;
        return (u?.name ?? '').toLowerCase().includes(needle)
          || (u?.email ?? '').toLowerCase().includes(needle);
      });
    }

    const [unread, latest] = await Promise.all([
      this.unreadByThread(userId),
      this.latestByThread(threads.map((t) => t.id)),
    ]);

    return threads.map((t) => ({
      ...t,
      contact: byId.get(MessagingService.counterpart(t, userId)) ?? null,
      unread: unread.get(t.id) ?? 0,
      last_message: latest.get(t.id) ?? null,
    }));
  }

  /**
   * M-01 -- ports count_unread_message_of_thread(). The original counted
   * messages in a thread that the current user did not send and had not read;
   * it queried columns that no longer exist, so it throws in the source. Same
   * rule, real columns, and one query for every thread instead of one each.
   */
  async unreadByThread(userId: number): Promise<Map<number, number>> {
    const { data } = await this.#db.from('messages')
      .select('thread_id').eq('receiver_id', userId).eq('read', 0);
    const out = new Map<number, number>();
    for (const r of data ?? []) {
      const id = Number(r.thread_id);
      out.set(id, (out.get(id) ?? 0) + 1);
    }
    return out;
  }

  async unreadTotal(userId: number): Promise<number> {
    const { count } = await this.#db.from('messages')
      .select('id', { count: 'exact', head: true })
      .eq('receiver_id', userId).eq('read', 0);
    return count ?? 0;
  }

  async latestByThread(threadIds: number[]): Promise<Map<number, unknown>> {
    const out = new Map<number, unknown>();
    if (!threadIds.length) return out;
    const { data } = await this.#db.from('messages')
      .select(MESSAGE_COLUMNS).in('thread_id', threadIds)
      .order('id', { ascending: false });
    // Ordered newest first, so the first row seen per thread is the latest.
    for (const m of data ?? []) {
      const id = Number(m.thread_id);
      if (!out.has(id)) out.set(id, m);
    }
    return out;
  }

  /** M-03 -- one conversation. Reading it marks the other side's messages read. */
  async conversation(code: string, userId: number) {
    const thread = await this.threadByCode(code);
    // Not a participant is a 404, not a 403: whether a code exists at all is
    // itself information about someone else's conversation.
    if (!MessagingService.isParticipant(thread, userId)) {
      throw new HttpError(404, 'Conversation not found.');
    }

    await this.markRead(thread.id, userId);
    const { data } = await this.#db.from('messages')
      .select(MESSAGE_COLUMNS).eq('thread_id', thread.id).order('id');

    const otherId = MessagingService.counterpart(thread, userId);
    const { data: contact } = await this.#db.from('users')
      .select('id, name, email, photo, role').eq('id', otherId).maybeSingle();

    return { thread, contact: contact ?? null, messages: data ?? [] };
  }

  /** M-01 -- send. Only the two participants may post into a thread. */
  async send(threadId: number, senderId: number, text: string) {
    const thread = await this.threadById(threadId);
    // The original took thread_id straight from the request and never checked,
    // so any signed-in account could post into any conversation.
    if (!MessagingService.isParticipant(thread, senderId)) {
      throw new HttpError(403, 'This action is unauthorized.');
    }
    const body = text.trim();
    if (!body) throw new HttpError(422, 'Write a message first.');

    const now = new Date().toISOString();
    const { data, error } = await this.#db.from('messages').insert({
      thread_id: thread.id,
      sender_id: senderId,
      receiver_id: MessagingService.counterpart(thread, senderId),
      message: body,
      read: 0,
      created_at: now, updated_at: now,
    }).select(MESSAGE_COLUMNS).maybeSingle();
    if (error) throw new HttpError(500, 'Could not send the message: ' + error.message);

    // The inbox sorts on this, so the thread has to move to the top.
    await this.#db.from('message_threads').update({ updated_at: now }).eq('id', thread.id);
    return data;
  }

  /** M-04 -- read receipts. Only the recipient's own copy is ever flipped. */
  async markRead(threadId: number, userId: number): Promise<void> {
    await this.#db.from('messages')
      .update({ read: 1, updated_at: new Date().toISOString() })
      .eq('thread_id', threadId).eq('receiver_id', userId).eq('read', 0);
  }

  /** M-04 -- delete your own message. */
  async remove(messageId: number, userId: number, isAdmin: boolean): Promise<void> {
    const { data } = await this.#db.from('messages')
      .select('id, sender_id').eq('id', messageId).maybeSingle();
    if (!data) throw new HttpError(404, 'Message not found.');
    if (!isAdmin && Number(data.sender_id) !== userId) {
      throw new HttpError(403, 'This action is unauthorized.');
    }
    await this.#db.from('messages').delete().eq('id', messageId);
  }

  /** M-04 -- find someone to message, by name or email. */
  async searchContacts(userId: number, term: string, limit = 20) {
    const needle = term.trim();
    if (!needle) return [];
    const like = '%' + needle + '%';
    const { data } = await this.#db.from('users')
      .select('id, name, email, photo, role')
      .or('name.ilike.' + like + ',email.ilike.' + like)
      .limit(limit + 1);
    // Never offer the user themselves as someone to message.
    return (data ?? []).filter((u) => u.id !== userId).slice(0, limit);
  }
}
