import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { api, login, withDb, webPage, ADMIN, STUDENT, RUN } from './harness.ts';

let adminToken = '';
let studentToken = '';
let studentId = 0;
let categoryId = 0;
let categorySlug = '';
let bootcampId = 0;
let bootcampSlug = '';
let moduleId = 0;
let resourceId = 0;

before(async () => {
  adminToken = await login(ADMIN.email, ADMIN.password);
  studentToken = await login(STUDENT.email, STUDENT.password);
  studentId = await withDb(async (c) =>
    Number((await c.query('select id from users where email=$1', [STUDENT.email])).rows[0].id));

  const cats = await api<{ id: number; slug: string }[]>('/api/bootcamps/categories');
  categoryId = cats.data[0]!.id;
  categorySlug = cats.data[0]!.slug;
});

after(async () => {
  await withDb(async (c) => {
    const { rows } = await c.query('select id from bootcamps where title like $1',
      ['%E2E ' + RUN + '%']);
    for (const r of rows) {
      const mods = await c.query('select id from bootcamp_modules where bootcamp_id=$1', [r.id]);
      for (const m of mods.rows) {
        await c.query('delete from bootcamp_live_classes where module_id=$1', [m.id]);
        await c.query('delete from bootcamp_resources where module_id=$1', [m.id]);
      }
      await c.query('delete from bootcamp_modules where bootcamp_id=$1', [r.id]);
      await c.query('delete from bootcamp_purchases where bootcamp_id=$1', [r.id]);
    }
    await c.query('delete from bootcamps where title like $1', ['%E2E ' + RUN + '%']);
  });
});

test('BC-02 an admin creates a published workshop with an id-suffixed slug', async () => {
  const created = await api<{ id: number; slug: string; status: number; pending: number }>(
    '/api/manage/bootcamps', {
      token: adminToken,
      body: {
        title: 'Workshop E2E ' + RUN, category_id: categoryId,
        short_description: 'A test workshop', is_paid: 1, price: 100,
        discount_flag: 1, discounted_price: 25, outcomes: ['Ship something'],
      },
    });
  assert.equal(created.ok, true);
  bootcampId = created.data.id;
  bootcampSlug = created.data.slug;
  assert.equal(created.data.status, 1);
  assert.equal(created.data.pending, 0);
  assert.match(bootcampSlug, new RegExp('-' + bootcampId + '$'));
});

test('BC-06 the public price subtracts the discount, unlike a course', async () => {
  const res = await api<{
    bootcamp: { effective_price: number; price: number }; purchased: boolean; modules: unknown[];
  }>('/api/bootcamps/' + bootcampSlug);
  assert.equal(res.ok, true);
  // 100 - 25. Reading it the course way would charge 25.
  assert.equal(res.data.bootcamp.effective_price, 75);
  assert.equal(res.data.purchased, false);
});

test('BC-03/BC-04 modules and resources are authored by the owner only', async () => {
  const mod = await api<{ id: number; sort: number }>(
    '/api/manage/bootcamps/' + bootcampId + '/modules',
    { token: adminToken, body: { title: 'Week 1 E2E ' + RUN } });
  assert.equal(mod.ok, true);
  moduleId = mod.data.id;
  assert.equal(mod.data.sort, 1);

  const res = await api<{ id: number }>('/api/manage/bootcamp-modules/' + moduleId + '/resources', {
    token: adminToken,
    body: { title: 'slides.pdf', upload_type: 'resource', file: 'uploads/bootcamp/slides.pdf' },
  });
  assert.equal(res.ok, true);
  resourceId = res.data.id;

  const refused = await api('/api/manage/bootcamps/' + bootcampId + '/modules',
    { token: studentToken, body: { title: 'nope' } });
  assert.equal(refused.status, 403);
});

test('BC-04 resources are hidden from non-buyers and undownloadable by them', async () => {
  const anon = await api<{ modules: { resources: unknown[]; resource_count: number }[] }>(
    '/api/bootcamps/' + bootcampSlug);
  assert.deepEqual(anon.data.modules[0]!.resources, [], 'the file list is not public');
  assert.equal(anon.data.modules[0]!.resource_count, 1, 'but the count is, as a teaser');

  const download = await api('/api/bootcamp-resources/' + resourceId + '/download',
    { token: studentToken });
  assert.equal(download.status, 403, 'a non-buyer cannot fetch a signed link');

  const detail = await api('/api/my-bootcamps/' + bootcampSlug, { token: studentToken });
  assert.equal(detail.status, 403);
});

test('BC-06 a paid workshop cannot be taken for free', async () => {
  const free = await api('/api/bootcamps/' + bootcampId + '/enrol-free', {
    token: studentToken, method: 'POST',
  });
  assert.equal(free.status, 422);
  assert.match(free.message ?? '', /not free/);
});

test('BC-06 the paid path goes through offline review and splits revenue', async () => {
  const request = await api<{ id: number; payable_amount: number }>(
    '/api/bootcamps/' + bootcampId + '/purchase', { token: studentToken, method: 'POST', body: {} });
  assert.equal(request.ok, true);
  // The amount is computed server-side from the workshop, not sent by the client.
  assert.equal(Number(request.data.payable_amount) >= 75, true);

  const approved = await api<{ status: string; invoice: string | null }>(
    '/api/admin/offline-payments/' + request.data.id + '/accept',
    { token: adminToken, method: 'POST' });
  assert.equal(approved.ok, true);

  const purchase = await withDb(async (c) => (await c.query(
    'select price, admin_revenue, instructor_revenue, payment_method from bootcamp_purchases '
    + 'where bootcamp_id=$1 and user_id=$2', [bootcampId, studentId])).rows[0]);
  assert.ok(purchase, 'accepting the request records the purchase');
  assert.equal(purchase.payment_method, 'offline');
  assert.equal(
    Math.round((Number(purchase.admin_revenue) + Number(purchase.instructor_revenue)) * 100) / 100,
    Number(purchase.price), 'the split adds back to the price');
});

test('BC-04/BC-07 a buyer sees the programme and can fetch a signed link', async () => {
  const mine = await api<{ modules: { resources: { id: number }[] }[] }>(
    '/api/my-bootcamps/' + bootcampSlug, { token: studentToken });
  assert.equal(mine.ok, true);
  assert.equal(mine.data.modules[0]!.resources.some((r) => r.id === resourceId), true);

  const list = await api<{ bootcamp: { slug: string } | null }[]>('/api/my-bootcamps',
    { token: studentToken });
  assert.equal(list.data.some((p) => p.bootcamp?.slug === bootcampSlug), true);

  // The object is not really in the bucket, so this is a clean 404 rather than
  // {url: null} -- what matters is that the buyer got past the access check.
  const download = await api('/api/bootcamp-resources/' + resourceId + '/download',
    { token: studentToken });
  assert.equal([200, 404].includes(download.status ?? 0), true);
  assert.notEqual(download.status, 403, 'a buyer is no longer refused');
});

test('BC-06 buying twice is refused', async () => {
  const again = await api('/api/bootcamps/' + bootcampId + '/purchase',
    { token: studentToken, method: 'POST', body: {} });
  assert.equal(again.status, 422);
});

test('BC-02 an instructor workshop waits for approval', async () => {
  const email = 'workshopper+' + RUN + '@onyx.test';
  await api('/api/admin/users', {
    token: adminToken,
    body: { name: 'Workshopper', email, password: 'Secret#2026', role: 'instructor' },
  });
  const author = await api<{ token: string }>('/api/auth/login',
    { body: { email, password: 'Secret#2026' } });

  const made = await api<{ id: number; slug: string; status: number; pending: number }>(
    '/api/manage/bootcamps',
    { token: author.data.token, body: { title: 'Pending E2E ' + RUN } });
  assert.equal(made.data.status, 0);
  assert.equal(made.data.pending, 1);

  const hidden = await api('/api/bootcamps/' + made.data.slug);
  assert.equal(hidden.status, 404, 'not public until approved');

  const queue = await api<{ data: { id: number }[] }>('/api/admin/bootcamps/pending',
    { token: adminToken });
  assert.equal(queue.data.data.some((b) => b.id === made.data.id), true);

  await api('/api/admin/bootcamps/' + made.data.id + '/status',
    { token: adminToken, body: { status: 1 } });
  assert.equal((await api('/api/bootcamps/' + made.data.slug)).ok, true);

  await withDb(async (c) => {
    await c.query('delete from users where email=$1', [email]);
  });
});

test('BC-02 duplicate deep-copies the programme, unpublished', async () => {
  const copy = await api<{ id: number; status: number }>(
    '/api/manage/bootcamps/' + bootcampId + '/duplicate', { token: adminToken, method: 'POST' });
  assert.equal(copy.ok, true);
  assert.equal(copy.data.status, 0);

  const detail = await api<{ modules: { resources: unknown[] }[] }>(
    '/api/manage/bootcamps/' + copy.data.id, { token: adminToken });
  // Laravel copied only the workshop row, leaving the clone with no programme.
  assert.equal(detail.data.modules.length, 1);
  assert.equal(detail.data.modules[0]!.resources.length, 1);

  await api('/api/manage/bootcamps/' + copy.data.id, { token: adminToken, method: 'DELETE' });
});

test('BC-07 the workshop pages render server-side', async () => {
  const list = await webPage('/bootcamps?search=' + RUN);
  assert.equal(list.status, 200);
  assert.match(list.html, /Workshop E2E /);

  const detail = await webPage('/bootcamp/' + bootcampSlug);
  assert.equal(detail.status, 200);
  assert.match(detail.html, /Week 1 E2E /, 'the programme is in the HTML');

  const gated = await webPage('/my-bootcamps');
  assert.equal(gated.status, 307, 'signed-out visitors are redirected');
});

test('BC-02 deleting removes the workshop and everything under it', async () => {
  await api('/api/manage/bootcamps/' + bootcampId, { token: adminToken, method: 'DELETE' });
  const left = await withDb(async (c) => ({
    modules: Number((await c.query(
      'select count(*)::int n from bootcamp_modules where bootcamp_id=$1', [bootcampId])).rows[0].n),
    resources: Number((await c.query(
      'select count(*)::int n from bootcamp_resources where module_id=$1', [moduleId])).rows[0].n),
  }));
  assert.deepEqual(left, { modules: 0, resources: 0 });
});
