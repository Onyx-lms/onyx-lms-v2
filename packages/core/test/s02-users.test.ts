import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeDb } from './fake-db.ts';
import { PermissionsService } from '../src/users/permissions.service.ts';
import { ProfileService } from '../src/users/profile.service.ts';
import { UsersService } from '../src/users/users.service.ts';
import { DeviceIpService } from '../src/users/device-ip.service.ts';
import { parsePageQuery } from '../src/http/pagination.ts';
import { hashPassword } from '../src/auth/password.ts';
import { HttpError } from '../src/http/errors.ts';

const seed = () => new FakeDb({
  users: [
    { id: 3, name: 'Root Admin', email: 'root@b.test', role: 'admin', status: 1 },
    { id: 9, name: 'Sub Admin', email: 'sub@b.test', role: 'admin', status: 1 },
    { id: 12, name: 'Sam Student', email: 'sam@b.test', role: 'student', status: 1 },
  ],
  permissions: [],
  device_ips: [],
});

test('A-08 the root admin is the LOWEST user id, not an arbitrary row', async () => {
  const svc = new PermissionsService(seed() as never);
  assert.equal(await svc.rootAdminId(), 3);
  assert.equal(await svc.isRootAdmin(3), true);
  assert.equal(await svc.isRootAdmin(9), false);
});

test('A-08 the root admin bypasses every permission check', async () => {
  const svc = new PermissionsService(seed() as never);
  assert.equal(await svc.can(3, 'admin.anything.at.all'), true);
});

test('A-08 a sub-admin is denied until the route is granted', async () => {
  const d = seed();
  const svc = new PermissionsService(d as never);
  assert.equal(await svc.can(9, 'admin.certificates.index'), false);
  await svc.toggle(9, 'admin.certificates.index');
  assert.equal(await svc.can(9, 'admin.certificates.index'), true);
});

test('A-08 toggling twice revokes, matching admin_permission_store', async () => {
  const d = seed();
  const svc = new PermissionsService(d as never);
  await svc.toggle(9, 'admin.courses');
  const after = await svc.toggle(9, 'admin.courses');
  assert.deepEqual(after, []);
  assert.equal(await svc.can(9, 'admin.courses'), false);
});

test('A-08 permissions persist as PHP-compatible JSON text', async () => {
  const d = seed();
  const svc = new PermissionsService(d as never);
  await svc.toggle(9, 'admin.dashboard');
  await svc.toggle(9, 'admin.courses');
  const stored = d.tables.permissions[0].permissions;
  assert.equal(typeof stored, 'string', 'stored as text, not jsonb');
  assert.equal(stored, '["admin.dashboard","admin.courses"]');
});

test('A-06 profile update writes only the provided fields', async () => {
  const d = seed();
  const svc = new ProfileService(d as never);
  await svc.update(12, { name: 'Samantha', phone: '555' });
  const row = d.tables.users.find((u: any) => u.id === 12);
  assert.equal(row.name, 'Samantha');
  assert.equal(row.phone, '555');
  assert.equal(row.email, 'sam@b.test', 'untouched fields survive');
});

test('A-06 skills round-trip through the JSON-as-text column', async () => {
  const d = seed();
  const svc = new ProfileService(d as never);
  await svc.update(12, { skills: ['php', 'node/js'] });
  const stored = d.tables.users.find((u: any) => u.id === 12).skills;
  // Note the escaped solidus -- this is what PHP writes.
  const BS = String.fromCharCode(92);
  assert.equal(stored, '["php","node' + BS + '/js"]');
  assert.deepEqual((await svc.get(12)).skills, ['php', 'node/js']);
});

test('A-06 changing a password requires the current one', async () => {
  const d = new FakeDb({
    users: [{ id: 1, email: 'a@b.test', role: 'student',
      password: await hashPassword('old-pass') }],
  });
  const svc = new ProfileService(d as never);
  await assert.rejects(() => svc.changePassword(1, 'wrong', 'new-pass'),
    (e: HttpError) => e.status === 422);
  await svc.changePassword(1, 'old-pass', 'new-pass');
  assert.notEqual(d.tables.users[0].password, await hashPassword('old-pass'));
});

test('A-07 instructor resume entries add, update and remove by index', async () => {
  const d = seed();
  const svc = new ProfileService(d as never);
  await svc.addEducation(9, { degree: 'BSc', institute: 'X', year: '2019' });
  await svc.addEducation(9, { degree: 'MSc', institute: 'Y', year: '2021' });
  assert.equal((await svc.educations(9)).length, 2);

  await svc.updateEducation(9, 0, { degree: 'BEng', institute: 'X', year: '2019' });
  assert.equal((await svc.educations(9))[0].degree, 'BEng');

  await svc.removeEducation(9, 0);
  const left = await svc.educations(9);
  assert.equal(left.length, 1);
  assert.equal(left[0].degree, 'MSc');
});

test('A-07 an out-of-range resume index is a 404, not a silent no-op', async () => {
  const svc = new ProfileService(seed() as never);
  await assert.rejects(() => svc.removeEducation(9, 5), (e: HttpError) => e.status === 404);
});

test('A-09 admin can create a user, and duplicate emails are rejected', async () => {
  const d = seed();
  const svc = new UsersService(d as never);
  const created = await svc.create({
    name: 'New Instructor', email: 'New@B.test', password: 'secret123', role: 'instructor' });
  assert.equal(created.role, 'instructor');
  assert.equal(created.email, 'new@b.test');
  await assert.rejects(() => svc.create({
    name: 'Dup', email: 'new@b.test', password: 'secret123', role: 'student' }),
    (e: HttpError) => e.status === 422);
});

test('A-09 listing filters by role and paginates like Laravel', async () => {
  const d = seed();
  const svc = new UsersService(d as never);
  const page = await svc.list({ role: 'admin' }, parsePageQuery({ per_page: '10' }), '/admin/users');
  assert.equal(page.total, 2);
  assert.equal(page.per_page, 10);
  assert.equal(page.current_page, 1);
});

test('A-09 search matches name or email', async () => {
  const d = seed();
  const svc = new UsersService(d as never);
  const page = await svc.list({ search: 'sam' }, parsePageQuery({}), '/admin/users');
  assert.equal(page.total, 1);
});

test('A-09 the root admin cannot be deleted', async () => {
  const d = seed();
  const svc = new UsersService(d as never);
  await assert.rejects(() => svc.remove(3, 3), (e: HttpError) => e.status === 403);
  await svc.remove(9, 3);
  assert.equal(d.tables.users.length, 2);
});

test('A-10 device ip is recorded once per session, not once per request', async () => {
  const d = seed();
  const svc = new DeviceIpService(d as never);
  await svc.record(12, '1.2.3.4', 'sess-a', 'Chrome');
  await svc.record(12, '1.2.3.4', 'sess-a', 'Chrome');
  assert.equal(d.tables.device_ips.length, 1);
  await svc.record(12, '1.2.3.4', 'sess-b', 'Chrome');
  assert.equal(d.tables.device_ips.length, 2);
});
