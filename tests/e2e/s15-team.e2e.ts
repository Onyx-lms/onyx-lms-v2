import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { api, login, withDb, webPage, ADMIN, STUDENT, RUN } from './harness.ts';

let adminToken = '';
let leaderToken = '';
let leaderTwoToken = '';
let leaderId = 0;
let leaderTwoId = 0;
let memberId = 0;
let courseId = 0;
let packageId = 0;
let packageSlug = '';

before(async () => {
  adminToken = await login(ADMIN.email, ADMIN.password);
  leaderToken = await login(STUDENT.email, STUDENT.password);
  leaderId = await withDb(async (c) =>
    Number((await c.query('select id from users where email=$1', [STUDENT.email])).rows[0].id));

  const make = async (name: string, tag: string) => {
    const email = tag + '+' + RUN + '@onyx.test';
    const created = await api<{ id: number }>('/api/admin/users', {
      token: adminToken,
      body: { name, email, password: 'Secret#2026', role: 'student' },
    });
    const session = await api<{ token: string }>('/api/auth/login',
      { body: { email, password: 'Secret#2026' } });
    return { id: created.data.id, token: session.data.token };
  };
  const two = await make('Leader Two', 'leader2');
  leaderTwoId = two.id;
  leaderTwoToken = two.token;
  memberId = (await make('Seat One', 'seat1')).id;

  const course = await api<{ id: number }>('/api/authoring/courses',
    { token: adminToken, body: { title: 'Classroom course ' + RUN, is_paid: 0 } });
  courseId = course.data.id;
  await api('/api/authoring/courses/' + courseId + '/status',
    { token: adminToken, body: { status: 'active' } });
});

after(async () => {
  await withDb(async (c) => {
    const { rows } = await c.query('select id from team_training_packages where title like $1',
      ['%E2E ' + RUN + '%']);
    for (const r of rows) {
      await c.query('delete from team_package_members where team_package_id=$1', [r.id]);
      await c.query('delete from team_package_purchases where package_id=$1', [r.id]);
    }
    await c.query('delete from team_training_packages where title like $1', ['%E2E ' + RUN + '%']);
    await c.query('delete from enrollments where course_id=$1', [courseId]);
    await c.query('delete from courses where id=$1', [courseId]);
    await c.query('delete from users where email like $1', ['%+' + RUN + '@onyx.test']);
  });
});

test('TP-01 a paid package with no price is refused', async () => {
  // Laravel wrote required_if:is_paid,1 but the field is pricing_type, so the
  // rule never fired and a paid package saved with no price at all.
  const bad = await api('/api/manage/team-packages', {
    token: adminToken,
    body: {
      title: 'No price E2E ' + RUN, course_id: courseId, course_privacy: 'public',
      allocation: 2, pricing_type: 1, expiry_type: 'lifetime',
    },
  });
  assert.equal(bad.status, 422);
  assert.match(bad.message ?? '', /needs a price/);
});

test('TP-01 a free package is created and listed publicly', async () => {
  const created = await api<{ id: number; slug: string; allocation: number }>(
    '/api/manage/team-packages', {
      token: adminToken,
      body: {
        title: 'Classroom E2E ' + RUN, course_id: courseId, course_privacy: 'public',
        allocation: 2, pricing_type: 0, expiry_type: 'lifetime',
        features: ['Two seats', 'Lifetime access'],
      },
    });
  assert.equal(created.ok, true);
  packageId = created.data.id;
  packageSlug = created.data.slug;
  assert.equal(created.data.allocation, 2);

  const listed = await api<{ data: { id: number }[] }>('/api/team-packages?search=' + RUN);
  assert.equal(listed.data.data.some((p) => p.id === packageId), true);
});

test('TP-05 a private package is never listed publicly', async () => {
  const priv = await api<{ id: number; slug: string }>('/api/manage/team-packages', {
    token: adminToken,
    body: {
      title: 'Private E2E ' + RUN, course_id: courseId, course_privacy: 'private',
      allocation: 1, pricing_type: 0, expiry_type: 'lifetime',
    },
  });
  const listed = await api<{ data: { id: number }[] }>('/api/team-packages?search=' + RUN);
  assert.equal(listed.data.data.some((p) => p.id === priv.data.id), false);
  // But it is still reachable by its own link, which is what private means.
  assert.equal((await api('/api/team-packages/' + priv.data.slug)).ok, true);
});

test('TP-03 two different buyers can both claim the same package', async () => {
  const first = await api('/api/team-packages/' + packageId + '/claim-free',
    { token: leaderToken, method: 'POST' });
  assert.equal(first.ok, true);

  const second = await api('/api/team-packages/' + packageId + '/claim-free',
    { token: leaderTwoToken, method: 'POST' });
  assert.equal(second.ok, true);

  const again = await api('/api/team-packages/' + packageId + '/claim-free',
    { token: leaderToken, method: 'POST' });
  assert.equal(again.status, 422, 'but not twice each');
});

test('TP-04 seats are per leader, not shared across buyers', async () => {
  const before = await api<{ seats_used: number; seats_total: number }>(
    '/api/my-team-packages/' + packageId + '/members', { token: leaderToken });
  assert.deepEqual(
    { used: before.data.seats_used, total: before.data.seats_total }, { used: 0, total: 2 });

  await api('/api/my-team-packages/' + packageId + '/members',
    { token: leaderToken, body: { member_id: memberId } });

  const mine = await api<{ seats_used: number; members: { member_id: number }[] }>(
    '/api/my-team-packages/' + packageId + '/members', { token: leaderToken });
  assert.equal(mine.data.seats_used, 1);
  assert.equal(mine.data.members.some((m) => m.member_id === memberId), true);

  // reserved_team_members() had no leader filter, so leader two would have
  // inherited leader one's used seat.
  const theirs = await api<{ seats_used: number; members: unknown[] }>(
    '/api/my-team-packages/' + packageId + '/members', { token: leaderTwoToken });
  assert.equal(theirs.data.seats_used, 0, 'a second buyer starts with a full allocation');
  assert.equal(theirs.data.members.length, 0);
});

test('TP-04 adding a member enrols them on the course', async () => {
  const enrolment = await withDb(async (c) => (await c.query(
    'select enrollment_type from enrollments where course_id=$1 and user_id=$2',
    [courseId, memberId])).rows[0]);
  assert.ok(enrolment, 'the member is enrolled');
  assert.equal(enrolment.enrollment_type, 'team_package');
});

test('TP-04 the seat cap is enforced, and only buyers may manage seats', async () => {
  const extra = await api<{ id: number }>('/api/admin/users', {
    token: adminToken,
    body: { name: 'Seat Two', email: 'seat2+' + RUN + '@onyx.test',
      password: 'Secret#2026', role: 'student' },
  });
  const third = await api<{ id: number }>('/api/admin/users', {
    token: adminToken,
    body: { name: 'Seat Three', email: 'seat3+' + RUN + '@onyx.test',
      password: 'Secret#2026', role: 'student' },
  });

  await api('/api/my-team-packages/' + packageId + '/members',
    { token: leaderToken, body: { member_id: extra.data.id } });

  const full = await api('/api/my-team-packages/' + packageId + '/members',
    { token: leaderToken, body: { member_id: third.data.id } });
  assert.equal(full.status, 422);
  assert.match(full.message ?? '', /Not enough space/);

  // Someone who never bought the package cannot see or fill its seats.
  const outsider = await api('/api/my-team-packages/' + packageId + '/members',
    { token: adminToken });
  assert.equal(outsider.status, 403);
});

test('TP-04 removing a member frees the seat and withdraws the granted access', async () => {
  const removed = await api('/api/my-team-packages/' + packageId + '/members/' + memberId,
    { token: leaderToken, method: 'DELETE' });
  assert.equal(removed.ok, true);

  const left = await withDb(async (c) => Number((await c.query(
    'select count(*)::int n from enrollments where course_id=$1 and user_id=$2',
    [courseId, memberId])).rows[0].n));
  assert.equal(left, 0, 'the access granted by the package goes with the seat');

  const seats = await api<{ seats_used: number }>(
    '/api/my-team-packages/' + packageId + '/members', { token: leaderToken });
  assert.equal(seats.data.seats_used, 1);

  assert.equal((await api('/api/my-team-packages/' + packageId + '/members/' + memberId,
    { token: leaderToken, method: 'DELETE' })).status, 404);
});

test('TP-05 the package pages render server-side', async () => {
  const list = await webPage('/team-packages?search=' + RUN);
  assert.equal(list.status, 200);
  assert.match(list.html, /Classroom E2E /);

  const detail = await webPage('/team-package/' + packageSlug);
  assert.equal(detail.status, 200);
  assert.match(detail.html, /Lifetime access/, 'the feature list is in the HTML');

  const gated = await webPage('/my-team-packages');
  assert.equal(gated.status, 307, 'signed-out visitors are redirected');
});

test('TP-01 a sold package cannot be deleted', async () => {
  const refused = await api('/api/manage/team-packages/' + packageId,
    { token: adminToken, method: 'DELETE' });
  // Deleting it would strand the members' course access.
  assert.equal(refused.status, 422);
});
