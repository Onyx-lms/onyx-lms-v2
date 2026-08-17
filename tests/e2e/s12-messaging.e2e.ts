import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { api, login, withDb, webPage, webLogin, env, ADMIN, STUDENT, RUN } from './harness.ts';

let adminToken = '';
let studentToken = '';
let outsiderToken = '';
let adminId = 0;
let studentId = 0;
let outsiderId = 0;
let threadId = 0;
let threadCode = '';

before(async () => {
  adminToken = await login(ADMIN.email, ADMIN.password);
  studentToken = await login(STUDENT.email, STUDENT.password);

  const ids = await withDb(async (c) => ({
    admin: Number((await c.query('select id from users where email=$1', [ADMIN.email])).rows[0].id),
    student: Number((await c.query('select id from users where email=$1', [STUDENT.email])).rows[0].id),
  }));
  adminId = ids.admin;
  studentId = ids.student;

  // A third account, in neither conversation, is what proves the boundary.
  const email = 'outsider+' + RUN + '@onyx.test';
  const created = await api<{ id: number }>('/api/admin/users', {
    token: adminToken,
    body: { name: 'Outsider', email, password: 'Secret#2026', role: 'student' },
  });
  outsiderId = created.data.id;
  const session = await api<{ token: string }>('/api/auth/login',
    { body: { email, password: 'Secret#2026' } });
  outsiderToken = session.data.token;
});

after(async () => {
  await withDb(async (c) => {
    await c.query('delete from messages where message like $1', ['%' + RUN + '%']);
    await c.query('delete from message_threads where contact_one=$1 or contact_two=$1',
      [outsiderId]);
    await c.query('delete from users where email like $1', ['outsider+' + RUN + '@%']);
    await c.query('delete from contacts where email like $1', ['%' + RUN + '@onyx.test']);
  });
});

test('M-01 a thread is created once and reused from either side', async () => {
  const opened = await api<{ id: number; code: string }>('/api/messages/threads',
    { token: studentToken, body: { user_id: adminId } });
  assert.equal(opened.ok, true);
  threadId = opened.data.id;
  threadCode = opened.data.code;
  assert.equal(threadCode.length, 20);

  const reversed = await api<{ id: number }>('/api/messages/threads',
    { token: adminToken, body: { user_id: studentId } });
  assert.equal(reversed.data.id, threadId, 'the pair is unordered');

  const self = await api('/api/messages/threads',
    { token: studentToken, body: { user_id: studentId } });
  assert.equal(self.status, 422);
});

test('M-01 sending derives the receiver and bumps the thread', async () => {
  const sent = await api<{ id: number; sender_id: number; receiver_id: number; read: number }>(
    '/api/messages',
    { token: studentToken, body: { thread_id: threadId, message: 'hello ' + RUN } });
  assert.equal(sent.data.sender_id, studentId);
  assert.equal(sent.data.receiver_id, adminId, 'never taken from the request');
  assert.equal(sent.data.read, 0);

  const inbox = await api<{ id: number; unread: number; last_message: { message: string } }[]>(
    '/api/messages/threads', { token: adminToken });
  const row = inbox.data.find((t) => t.id === threadId)!;
  assert.equal(row.unread, 1);
  assert.equal(row.last_message.message, 'hello ' + RUN);
});

test('M-01 an outsider can neither read nor post', async () => {
  const post = await api('/api/messages',
    { token: outsiderToken, body: { thread_id: threadId, message: 'intruding ' + RUN } });
  assert.equal(post.status, 403);

  // 404, not 403: whether a code exists is itself private.
  const read = await api('/api/messages/threads/' + threadCode, { token: outsiderToken });
  assert.equal(read.status, 404);

  const inbox = await api<unknown[]>('/api/messages/threads', { token: outsiderToken });
  assert.equal(inbox.data.length, 0);
});

test('M-04 opening the conversation marks the other side read', async () => {
  const before = await api<{ count: number }>('/api/messages/unread', { token: adminToken });
  assert.equal(before.data.count >= 1, true);

  await api('/api/messages/threads/' + threadCode, { token: adminToken });

  const after = await api<{ count: number }>('/api/messages/unread', { token: adminToken });
  assert.equal(after.data.count, 0);
  // The sender's own copy is untouched.
  const sender = await api<{ count: number }>('/api/messages/unread', { token: studentToken });
  assert.equal(sender.data.count, 0, 'nobody has sent to the student yet');
});

test('M-02 the realtime token is scoped: RLS lets it read only your own rows', async () => {
  const grant = await api<{
    token: string; supabase_url: string; supabase_anon_key: string;
  }>('/api/messages/realtime-token', { token: studentToken, method: 'POST' });
  assert.equal(grant.ok, true);

  // It authenticates the socket but must never authenticate the API.
  const replay = await api('/api/me', { token: grant.data.token });
  assert.equal(replay.status, 401, 'a scoped token cannot be replayed against the API');

  const { createClient } = await import('@supabase/supabase-js');
  const as = (token: string) => createClient(grant.data.supabase_url, grant.data.supabase_anon_key, {
    auth: { persistSession: false },
    global: { headers: { Authorization: 'Bearer ' + token } },
  });

  const mine = await as(grant.data.token).from('messages').select('id, message');
  assert.equal(mine.data!.length >= 1, true, 'a participant reads their own conversation');

  const anon = createClient(grant.data.supabase_url, grant.data.supabase_anon_key,
    { auth: { persistSession: false } });
  assert.equal(((await anon.from('messages').select('id')).data ?? []).length, 0,
    'anonymous reads nothing');

  const other = await api<{ token: string }>('/api/messages/realtime-token',
    { token: outsiderToken, method: 'POST' });
  const theirs = await as(other.data.token).from('messages').select('id');
  assert.equal((theirs.data ?? []).length, 0, 'an outsider reads nothing');

  // Writes stay service-role only, even for a participant.
  const write = await as(grant.data.token).from('messages')
    .insert({ thread_id: threadId, sender_id: studentId, receiver_id: adminId, message: 'x', read: 0 });
  assert.ok(write.error, 'direct inserts are blocked by RLS');
});

test('M-02 a message reaches the recipient over Realtime without a refresh', async () => {
  const grant = await api<{
    token: string; supabase_url: string; supabase_anon_key: string;
  }>('/api/messages/realtime-token', { token: adminToken, method: 'POST' });

  const { createClient } = await import('@supabase/supabase-js');
  const client = createClient(grant.data.supabase_url, grant.data.supabase_anon_key,
    { auth: { persistSession: false } });
  // Awaited. `setAuth` is async, and the join below carries whatever token is
  // set when it goes out; without the await the channel can join as `anon`,
  // which delivers nothing and says nothing. That was a real defect in the
  // inbox, and this test only found it because it ran slowly enough once.
  await client.realtime.setAuth(grant.data.token);

  /*
   * Two things have to be true before writing, and neither is the join ack.
   *
   * SUBSCRIBED means the channel joined, not that the listener is live:
   * Realtime records each postgres_changes listener in `realtime.subscription`
   * a measurable moment later -- ~460ms on an idle project. A change committed
   * before that row exists is routed to nobody and is gone, so this waits for
   * the row rather than for the ack.
   *
   * The listener also has to have joined as the user. If it joined as `anon`,
   * the policy on `messages` (sender or receiver is the caller) matches
   * nothing and every change is silently withheld -- which is exactly what
   * the whole-suite failure turned out to be. The claims are asserted below,
   * so a regression of that names itself instead of looking like a flake.
   */
  const listener = async () => withDb(async (c) => (await c.query(
    // Realtime stores the filter as `{"(thread_id,eq,42,f)"}`. Matched on the
    // whole clause, not the bare number: 42 is a substring of 424.
    `select claims->>'user_id' uid, claims_role::text role
     from realtime.subscription
     where entity = 'public.messages'::regclass and filters::text like $1`,
    ['%(thread_id,eq,' + threadId + ',%'])).rows[0] ?? null);

  const trace: string[] = [];
  const sentBodies: string[] = [];
  let resend: NodeJS.Timeout | undefined;
  let overall: NodeJS.Timeout | undefined;
  let joinedAs: { uid: string | null; role: string } | null = null;

  const delivered = new Promise<string>((resolve, reject) => {
    let settled = false;
    const done = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(resend);
      clearTimeout(overall);
      fn();
    };

    const sendOne = async () => {
      const body = 'realtime ' + RUN + ' #' + (sentBodies.length + 1);
      sentBodies.push(body);
      const sent = await api('/api/messages',
        { token: studentToken, body: { thread_id: threadId, message: body } });
      trace.push('sent' + sentBodies.length + '=' + sent.ok);
      if (!sent.ok) {
        done(() => reject(new Error('the message could not be sent: ' + sent.message)));
        return;
      }
      // Insurance against a genuinely dropped change, not the mechanism: with
      // the token awaited and the listener registered, the first one arrives.
      //
      // Guarded, because the message usually lands *during* the await above:
      // `done()` clears the timer that exists at that moment, and arming a new
      // one afterwards starts a chain that outlives the test -- it kept
      // writing messages every 8s, held the file open for two minutes and
      // took the next file down with it.
      if (settled) return;
      resend = setTimeout(() => { void sendOne(); }, 8_000);
    };

    overall = setTimeout(() => {
      done(async () => {
        const rows = await withDb(async (c) => (await c.query(
          `select thread_id from messages where message like $1`,
          ['%' + RUN + ' #%'])).rows);
        reject(new Error(
          'no realtime event in 40s after ' + sentBodies.length + ' messages ['
          + trace.join(' ') + ']. Subscribed to thread ' + threadId
          + ' as ' + JSON.stringify(joinedAs) + '; the database holds '
          + rows.length + ' of them on thread(s) '
          + [...new Set(rows.map((r) => String(r.thread_id)))].join(', ')));
      });
    }, 40_000);

    const channel = client
      .channel('e2e:thread:' + threadId)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'messages',
        filter: 'thread_id=eq.' + threadId,
      }, (payload) => {
        done(() => resolve(String((payload.new as { message: string }).message)));
      })
      .subscribe(async (status) => {
        trace.push(status);
        if (trace.filter((st) => st === 'CHANNEL_ERROR').length >= 2) {
          done(() => reject(new Error('the realtime channel kept failing: ' + trace.join(' '))));
          return;
        }
        // Once per join: a rejoin must not start a second chain of resends.
        if (status !== 'SUBSCRIBED' || sentBodies.length > 0) return;
        for (let i = 0; i < 100 && !joinedAs; i += 1) {
          joinedAs = await listener();
          if (!joinedAs) await new Promise((r) => setTimeout(r, 100));
        }
        trace.push('registered');
        await sendOne();
      });
    void channel;
  });

  try {
    const message = await delivered;
    assert.ok(sentBodies.includes(message),
      'something arrived that this test did not write: ' + message);
    assert.equal(joinedAs?.role, 'authenticated',
      'the listener joined as ' + joinedAs?.role + ', which reads nothing under RLS');
    assert.equal(String(joinedAs?.uid), String(adminId),
      'the listener joined as the wrong user, so RLS would hide the conversation');
    if (sentBodies.length > 1) {
      // Visible, but not a verdict: the broker dropped a change and recovered.
      console.log('    realtime delivered on attempt ' + sentBodies.length);
    }
  } finally {
    clearTimeout(resend);
    clearTimeout(overall);
    // In a finally, not after the assertion: `delivered` rejecting (a real
    // regression, or just a slow socket on the run) skipped straight past the
    // disconnect below, leaving the handle open. node --test then never exits
    // -- not a failure this test reports, but a hang the *next* file pays for,
    // silently, with nothing in the log to say why. Removing the channel is
    // not enough on its own; the underlying socket has to be disconnected too.
    await client.removeAllChannels();
    client.realtime.disconnect();
  }
});

test('M-04 you may delete your own message; nobody else may', async () => {
  const sent = await api<{ id: number }>('/api/messages',
    { token: studentToken, body: { thread_id: threadId, message: 'to delete ' + RUN } });

  const refused = await api('/api/messages/' + sent.data.id,
    { token: outsiderToken, method: 'DELETE' });
  assert.equal(refused.status, 403);

  const allowed = await api('/api/messages/' + sent.data.id,
    { token: studentToken, method: 'DELETE' });
  assert.equal(allowed.ok, true);
});

test('M-04 contact search finds people and never offers you yourself', async () => {
  const hits = await api<{ id: number }[]>('/api/messages/contacts?search=' + encodeURIComponent(STUDENT.email));
  const found = await api<{ id: number }[]>('/api/messages/contacts?search='
    + encodeURIComponent(STUDENT.email), { token: adminToken });
  assert.equal(hits.status, 401, 'contact search needs a session');
  assert.equal(found.data.some((u) => u.id === studentId), true);

  const self = await api<{ id: number }[]>('/api/messages/contacts?search='
    + encodeURIComponent(ADMIN.email), { token: adminToken });
  assert.equal(self.data.some((u) => u.id === adminId), false);
});

test('M-03 the inbox renders server-side for a signed-in user', async () => {
  const cookie = await webLogin(ADMIN.email, ADMIN.password);
  const page = await webPage('/messages?inbox=' + threadCode, cookie);
  assert.equal(page.status, 200);
  assert.match(page.html, /realtime /, 'the conversation is in the HTML');

  const anon = await webPage('/messages');
  assert.equal(anon.status, 307, 'signed-out visitors are redirected');
});

test('M-06 the contact inbox lists, marks read and deletes', async () => {
  const email = 'enquiry+' + RUN + '@onyx.test';
  const submitted = await api('/api/contact', {
    body: { name: 'Enquirer', email, phone: '0700900', address: 'Leeds',
      message: 'Question about pricing ' + RUN },
  });
  assert.equal(submitted.ok, true);

  const forbidden = await api('/api/admin/contacts', { token: studentToken });
  assert.equal(forbidden.status, 403);

  const list = await api<{ id: number; has_read: number; replied: number; email: string }[]>(
    '/api/admin/contacts?search=' + encodeURIComponent(RUN), { token: adminToken });
  const row = list.data.find((c) => c.email === email)!;
  assert.ok(row, 'the enquiry is in the admin list');
  assert.equal(row.has_read, 1, 'opening the inbox marks it read');
  assert.equal(row.replied, 0);

  const removed = await api('/api/admin/contacts/' + row.id,
    { token: adminToken, method: 'DELETE' });
  assert.equal(removed.ok, true);
  assert.equal((await api('/api/admin/contacts/' + row.id,
    { token: adminToken, method: 'DELETE' })).status, 404);
});

test('M-06 a reply that cannot be delivered leaves the enquiry unanswered', async () => {
  const email = 'undeliverable+' + RUN + '@onyx.test';
  await api('/api/contact',
    { body: { name: 'Enquirer', email, message: 'Pricing please ' + RUN } });
  const list = await api<{ id: number; email: string; replied: number }[]>(
    '/api/admin/contacts?search=' + encodeURIComponent(RUN), { token: adminToken });
  const row = list.data.find((c) => c.email === email)!;

  const reply = await api('/api/admin/contacts/' + row.id + '/reply',
    { token: adminToken, body: { message: 'Here are our prices.' } });

  // Whether SMTP is reachable in this environment decides which branch runs;
  // both are correct, and the flag must agree with what actually happened.
  const after = await api<{ id: number; replied: number }[]>(
    '/api/admin/contacts?search=' + encodeURIComponent(RUN), { token: adminToken });
  const now = after.data.find((c) => c.id === row.id)!;

  if (reply.ok) {
    assert.equal(now.replied, 1, 'a delivered reply marks it answered');
  } else {
    assert.equal(reply.status, 502);
    // Laravel flipped `replied` regardless, so a bounced reply looked answered.
    assert.equal(now.replied, 0, 'a failed send must not mark it answered');
  }

  await api('/api/admin/contacts/' + row.id, { token: adminToken, method: 'DELETE' });
});
