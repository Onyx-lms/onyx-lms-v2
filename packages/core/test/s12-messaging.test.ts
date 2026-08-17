import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeDb } from './fake-db.ts';
import { MessagingService, newThreadCode } from '../src/messaging/messaging.service.ts';
import { issueAccessToken, issueRealtimeToken, verifyAccessToken } from '../src/auth/jwt.ts';
import { requireAuth } from '../src/auth/guards.ts';
import { HttpError } from '../src/http/errors.ts';

const users = [
  { id: 1, name: 'Root', email: 'root@onyx.test', photo: null, role: 'admin' },
  { id: 2, name: 'Ada', email: 'ada@onyx.test', photo: null, role: 'student' },
  { id: 3, name: 'Sam', email: 'sam@onyx.test', photo: null, role: 'instructor' },
];

const db = () => new FakeDb({ users: [...users], message_threads: [], messages: [] });

test('M-01 a thread is per pair and is reused from either side', async () => {
  const d = db();
  const svc = new MessagingService(d as never);

  const opened = await svc.openWith(2, 3);
  const again = await svc.openWith(2, 3);
  const reversed = await svc.openWith(3, 2);

  assert.equal(again.id, opened.id);
  assert.equal(reversed.id, opened.id, 'the pair is unordered');
  assert.equal(d.tables['message_threads']!.length, 1, 'no duplicate thread');
});

test('M-01 you cannot open a thread with yourself or with a stranger', async () => {
  const svc = new MessagingService(db() as never);
  await assert.rejects(() => svc.openWith(2, 2), (e: HttpError) => e.status === 422);
  await assert.rejects(() => svc.openWith(2, 999), (e: HttpError) => e.status === 404);
});

test('M-01 only a participant may send, and the receiver is derived', async () => {
  const d = db();
  const svc = new MessagingService(d as never);
  const thread = await svc.openWith(2, 3);

  // The original took thread_id from the request and never checked.
  await assert.rejects(() => svc.send(thread.id, 1, 'intruding'),
    (e: HttpError) => e.status === 403);

  const sent = await svc.send(thread.id, 2, '  hello  ') as Record<string, unknown>;
  assert.equal(sent['sender_id'], 2);
  assert.equal(sent['receiver_id'], 3, 'never taken from the request');
  assert.equal(sent['message'], 'hello', 'trimmed');
  assert.equal(sent['read'], 0);

  await assert.rejects(() => svc.send(thread.id, 2, '   '),
    (e: HttpError) => e.status === 422, 'an empty message is refused');
});

test('M-01 unread counts only count what you received and have not read', async () => {
  const d = db();
  const svc = new MessagingService(d as never);
  const thread = await svc.openWith(2, 3);
  await svc.send(thread.id, 2, 'one');
  await svc.send(thread.id, 2, 'two');
  await svc.send(thread.id, 3, 'reply');

  assert.equal(await svc.unreadTotal(3), 2, 'Sam received two');
  assert.equal(await svc.unreadTotal(2), 1, 'Ada received one');
  const byThread = await svc.unreadByThread(3);
  assert.equal(byThread.get(thread.id), 2);

  // Your own sent messages are never unread for you.
  await svc.markRead(thread.id, 3);
  assert.equal(await svc.unreadTotal(3), 0);
  assert.equal(await svc.unreadTotal(2), 1, 'marking read is per recipient');
});

test('M-03 the inbox carries the other person, the unread count and the last line', async () => {
  const d = db();
  const svc = new MessagingService(d as never);
  const withSam = await svc.openWith(2, 3);
  await svc.send(withSam.id, 3, 'first');
  await svc.send(withSam.id, 3, 'latest');

  const inbox = await svc.inbox(2);
  assert.equal(inbox.length, 1);
  assert.equal((inbox[0]!.contact as { name: string }).name, 'Sam', 'the other person');
  assert.equal(inbox[0]!.unread, 2);
  assert.equal((inbox[0]!.last_message as { message: string }).message, 'latest');
});

test('M-03 the inbox is every thread you are in, from either column', async () => {
  const d = db();
  const svc = new MessagingService(d as never);
  await svc.openWith(2, 3);   // Ada is contact_one
  await svc.openWith(1, 2);   // Ada is contact_two

  // Laravel ANDed the two columns, so this list was always empty.
  assert.equal((await svc.inbox(2)).length, 2);
  assert.equal((await svc.inbox(1)).length, 1);
});

test('M-03 opening a conversation marks the other side read, and outsiders get 404', async () => {
  const d = db();
  const svc = new MessagingService(d as never);
  const thread = await svc.openWith(2, 3);
  await svc.send(thread.id, 2, 'hello');

  await assert.rejects(() => svc.conversation(thread.code, 1),
    (e: HttpError) => e.status === 404,
    'a non-participant must not learn that the code exists');

  const view = await svc.conversation(thread.code, 3);
  assert.equal(view.messages.length, 1);
  assert.equal((view.contact as { name: string }).name, 'Ada');
  assert.equal(await svc.unreadTotal(3), 0, 'reading marks it read');
});

test('M-04 you may delete your own message, an admin may delete any', async () => {
  const d = db();
  const svc = new MessagingService(d as never);
  const thread = await svc.openWith(2, 3);
  const mine = await svc.send(thread.id, 2, 'mine') as { id: number };

  await assert.rejects(() => svc.remove(mine.id, 3, false), (e: HttpError) => e.status === 403);
  await svc.remove(mine.id, 999, true);
  assert.equal(d.tables['messages']!.length, 0);
  await assert.rejects(() => svc.remove(mine.id, 2, false), (e: HttpError) => e.status === 404);
});

test('M-04 contact search never offers you yourself, and a blank term matches nobody', async () => {
  const svc = new MessagingService(db() as never);
  assert.equal((await svc.searchContacts(2, '  ')).length, 0);

  const hits = await svc.searchContacts(2, 'a');
  assert.equal(hits.some((u) => u.id === 2), false, 'self is filtered out');
  assert.equal(hits.length > 0, true);
});

test('M-02 thread codes are long and drawn from a CSPRNG', () => {
  const a = newThreadCode();
  assert.equal(a.length, 20);
  assert.match(a, /^[0-9A-Za-z]+$/);
  assert.notEqual(newThreadCode(), newThreadCode());

  // PHP's str_shuffle could never repeat a character; a real random source can,
  // which is the whole point -- 62^20 instead of a permutation of 62.
  const many = Array.from({ length: 200 }, () => newThreadCode(8));
  assert.equal(many.some((c) => new Set(c).size < c.length), true);
});

test('M-02 a realtime token is refused by the API', () => {
  const secret = 'test-secret-value';
  const input = { userId: 2, email: 'ada@onyx.test', appRole: 'student' as const, secret };

  const session = issueAccessToken(input);
  const realtime = issueRealtimeToken(input);

  // Both are valid signatures Postgres will accept for RLS...
  assert.equal(verifyAccessToken(realtime.token, secret)?.user_id, 2);
  assert.equal(verifyAccessToken(realtime.token, secret)?.role, 'authenticated');
  assert.equal(verifyAccessToken(realtime.token, secret)?.scope, 'realtime');

  // ...but only the session token authenticates a request.
  const asReq = (t: string) => ({ headers: { authorization: 'Bearer ' + t } });
  assert.equal(requireAuth(asReq(session.token), secret).user_id, 2);
  assert.throws(() => requireAuth(asReq(realtime.token), secret));

  assert.equal(realtime.expiresAt - session.expiresAt < 0, true, 'and it is shorter lived');
});
