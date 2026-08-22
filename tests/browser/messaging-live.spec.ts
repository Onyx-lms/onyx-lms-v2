/**
 * A message arrives in the open inbox, in a real browser, with no refresh.
 *
 * The e2e suite proves Realtime delivers to a subscriber it builds itself.
 * That is not the same claim as "the product's inbox receives", and the
 * difference was hiding a defect: `Messenger` called `client.realtime.setAuth`
 * without awaiting it, and `setAuth` is async. When the join went out first --
 * which is what happens on a cold socket, i.e. the first time anyone opens
 * their inbox -- it carried the anon key. Realtime then recorded the listener
 * with no user_id, the RLS policy on `messages` (sender or receiver is the
 * caller) matched nothing, and every change was withheld in silence: no
 * error, no failed subscribe, just an inbox that never updated until the
 * reader pressed refresh.
 *
 * Nothing but a browser catches that, so this drives one.
 */
import { test, expect } from '@playwright/test';
import { api, login, withDb, RUN, ADMIN, STUDENT } from '../e2e/harness.ts';

test.describe.configure({ mode: 'serial' });

test('a message sent by the other person appears without a reload', async ({ page }) => {
  test.setTimeout(120_000);

  /*
   * This one needs fixtures, and nothing in the repository creates them.
   *
   * It signs in as `mailtest@onyx.test` on the STOREFRONT -- the ported
   * Laravel `users` table, not `onyx_users` -- and messages them as
   * `root@onyx.test`. Both are seeded by the e2e runner's own setup, so the
   * spec works under `npm run e2e` and cannot work against a deployment that
   * has never had that run against it.
   *
   * Skipped, with the reason, rather than left to fail. It used to time out
   * for thirty seconds on a sign-in that was never going to succeed, which
   * reads in a report as a broken inbox -- a product failure, and a fairly
   * alarming one -- when what is actually missing is a row. A suite that shows
   * red for a reason nobody can act on is a suite people stop reading.
   */
  const seeded = await withDb(async (c) => Number((await c.query(
    'select count(*)::int n from users where email in ($1, $2)',
    [STUDENT.email, ADMIN.email])).rows[0].n));
  test.skip(seeded < 2,
    'the storefront accounts this needs are not in this database -- run `npm run e2e` first');

  // Sign in as the learner through the real form, exactly as a reader would.
  await page.goto('/login/store');
  await page.getByLabel(/email/i).first().fill(STUDENT.email);
  await page.getByLabel(/password/i).first().fill(STUDENT.password);
  await page.getByRole('button', { name: /sign in|log ?in/i }).first().click();
  await page.waitForURL((u) => !u.pathname.endsWith('/login/store'), { timeout: 30_000 });

  // The conversation has to exist before it can be opened.
  const adminToken = await login(ADMIN.email, ADMIN.password);
  const studentId = await withDb(async (c) => Number((await c.query(
    'select id from users where email=$1', [STUDENT.email])).rows[0].id));
  const thread = await api<{ id: number; code: string }>('/api/messages/threads',
    { token: adminToken, body: { user_id: studentId } });
  expect(thread.ok, thread.message).toBe(true);

  await page.goto('/messages?inbox=' + thread.data.code);
  await expect(page.getByRole('heading', { name: /messages/i }).first()).toBeVisible();

  // Long enough that the socket is listening AND the catch-up fetch that runs
  // on SUBSCRIBED has already been and gone. That matters: without the wait,
  // a message could arrive by way of that fetch and the test would pass with
  // the socket joined as anon and delivering nothing -- which is the very
  // fault this exists to catch. After this point the only thing that can put
  // the message on screen is the channel.
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(12_000);

  const body = 'live from the other side ' + RUN;
  const sent = await api('/api/messages',
    { token: adminToken, body: { thread_id: thread.data.id, message: body } });
  expect(sent.ok, sent.message).toBe(true);

  // No reload anywhere in this test: if it appears, it came down the socket.
  await expect(page.getByText(body)).toBeVisible({ timeout: 45_000 });
});

test.afterAll(async () => {
  await withDb(async (c) => {
    await c.query('delete from messages where message like $1', ['%' + RUN + '%']);
  });
});
