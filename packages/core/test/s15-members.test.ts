import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeDb } from './fake-db.ts';
import { TeamPackageService } from '../src/team/team-package.service.ts';
import { TeamMemberService } from '../src/team/team-member.service.ts';
import { SettingsService } from '../src/settings/settings.service.ts';
import { HttpError } from '../src/http/errors.ts';

function make() {
  const d = new FakeDb({
    settings: [{ id: 1, type: 'instructor_revenue', description: '40' }],
    users: [
      { id: 1, name: 'Owner', email: 'owner@onyx.test' },
      { id: 2, name: 'Leader One', email: 'leader1@onyx.test' },
      { id: 3, name: 'Leader Two', email: 'leader2@onyx.test' },
      { id: 4, name: 'Member A', email: 'a@onyx.test' },
      { id: 5, name: 'Member B', email: 'b@onyx.test' },
    ],
    courses: [{ id: 9, title: 'Node', slug: 'node', category_id: 1 }],
    team_training_packages: [],
    team_package_members: [],
    team_package_purchases: [],
    enrollments: [],
  });
  const settings = new SettingsService(d as never);
  return {
    d,
    packages: new TeamPackageService(d as never),
    members: new TeamMemberService(d as never, settings),
  };
}

async function seats(t: ReturnType<typeof make>, allocation = 2) {
  const pkg = await t.packages.create(1, {
    title: 'Classroom', course_id: 9, course_privacy: 'public',
    allocation, pricing_type: 0, expiry_type: 'lifetime',
  }) as Record<string, unknown>;
  return pkg['id'] as number;
}

const buy = (t: ReturnType<typeof make>, id: number, userId: number, invoice: string) =>
  t.members.record({ packageId: id, userId, invoice, price: 0, paymentMethod: 'free' });

test('TP-04 seats belong to the leader, not to the package', async () => {
  const t = make();
  const id = await seats(t, 2);
  await buy(t, id, 2, '#1');
  await buy(t, id, 3, '#2');

  await t.members.addMember(id, 2, 4);
  await t.members.addMember(id, 2, 5);
  assert.equal(await t.members.reservedSeats(id, 2), 2);
  await assert.rejects(() => t.members.addMember(id, 2, 1),
    (e: HttpError) => /Not enough space/.test(e.message));

  // reserved_team_members() counted every member of the package with no leader
  // filter, so leader two would have been locked out of seats they paid for.
  assert.equal(await t.members.reservedSeats(id, 3), 0);
  await t.members.addMember(id, 3, 4);
  assert.equal(await t.members.reservedSeats(id, 3), 1);
});

test('TP-04 adding a member requires having bought the package', async () => {
  const t = make();
  const id = await seats(t);
  await assert.rejects(() => t.members.addMember(id, 2, 4),
    (e: HttpError) => e.status === 403);

  await buy(t, id, 2, '#1');
  await t.members.addMember(id, 2, 4);

  await assert.rejects(() => t.members.addMember(id, 2, 4),
    (e: HttpError) => /already exists/.test(e.message));
  await assert.rejects(() => t.members.addMember(id, 2, 2),
    (e: HttpError) => /cannot add yourself/.test(e.message));
  await assert.rejects(() => t.members.addMember(id, 2, 999),
    (e: HttpError) => e.status === 404);
});

test('TP-04 adding a member grants the course', async () => {
  const t = make();
  const id = await seats(t);
  await buy(t, id, 2, '#1');
  await t.members.addMember(id, 2, 4);

  const enrolment = t.d.tables['enrollments']!.find((e) => e['user_id'] === 4)!;
  assert.ok(enrolment, 'the member is enrolled on the package course');
  assert.equal(enrolment['course_id'], 9);
  assert.equal(enrolment['enrollment_type'], 'team_package');
  assert.equal(enrolment['expiry_date'], null, 'a lifetime package never expires');
});

test('TP-04 removing a member must not destroy an enrolment they bought', async () => {
  const t = make();
  const id = await seats(t);
  await buy(t, id, 2, '#1');

  // Member A already paid for this course themselves.
  t.d.tables['enrollments']!.push({
    id: 99, course_id: 9, user_id: 4, enrollment_type: 'paid', expiry_date: null,
  });
  await t.members.addMember(id, 2, 4);
  await t.members.removeMember(id, 2, 4);

  // Laravel deleted ANY enrolment on the course here, wiping out access the
  // member had bought for themselves.
  const left = t.d.tables['enrollments']!.filter((e) => e['user_id'] === 4);
  assert.equal(left.length, 1, 'their own enrolment survives');
  assert.equal(left[0]!['enrollment_type'], 'paid');
  assert.equal(await t.members.reservedSeats(id, 2), 0, 'the seat is freed');
});

test('TP-04 a team-granted enrolment is withdrawn on removal', async () => {
  const t = make();
  const id = await seats(t);
  await buy(t, id, 2, '#1');
  await t.members.addMember(id, 2, 5);
  assert.equal(t.d.tables['enrollments']!.length, 1);

  await t.members.removeMember(id, 2, 5);
  assert.equal(t.d.tables['enrollments']!.length, 0, 'the granted access goes with the seat');
  await assert.rejects(() => t.members.removeMember(id, 2, 5),
    (e: HttpError) => e.status === 404);
});

test('TP-04 an existing enrolment is extended, never shortened', async () => {
  const t = make();
  const soon = Date.parse('2027-01-01T00:00:00Z');
  const later = Date.parse('2028-01-01T00:00:00Z');

  const pkg = await t.packages.create(1, {
    title: 'Long classroom', course_id: 9, course_privacy: 'public',
    allocation: 2, pricing_type: 0, expiry_type: 'limited',
    start_date: '2026-01-01T00:00:00Z', expiry_date: '2028-01-01T00:00:00Z',
  }) as Record<string, unknown>;
  const id = pkg['id'] as number;
  await buy(t, id, 2, '#1');

  // A shorter enrolment already exists; the package should push it out.
  t.d.tables['enrollments']!.push({
    id: 99, course_id: 9, user_id: 4, enrollment_type: 'paid',
    expiry_date: new Date(soon).toISOString(),
  });
  await t.members.addMember(id, 2, 4);
  const row = t.d.tables['enrollments']!.find((e) => e['user_id'] === 4)!;
  assert.equal(new Date(String(row['expiry_date'])).getTime(), later);

  // A longer existing enrolment must not be cut back.
  t.d.tables['enrollments']!.push({
    id: 100, course_id: 9, user_id: 5, enrollment_type: 'paid',
    expiry_date: new Date(Date.parse('2030-01-01T00:00:00Z')).toISOString(),
  });
  await t.members.addMember(id, 2, 5);
  const other = t.d.tables['enrollments']!.find((e) => e['user_id'] === 5)!;
  assert.equal(String(other['expiry_date']).startsWith('2030'), true);
});

test('TP-03 a purchase splits revenue and an invoice stays private', async () => {
  const t = make();
  const id = await seats(t);
  await t.packages.update(id, {
    title: 'Classroom', course_id: 9, course_privacy: 'public',
    allocation: 2, pricing_type: 1, price: 500, expiry_type: 'lifetime',
  });

  const row = await t.members.record({
    packageId: id, userId: 2, invoice: '#inv', price: 500, tax: 0, paymentMethod: 'offline',
  }) as Record<string, unknown>;
  assert.equal(row['instructor_revenue'], 200, '40% of 500');
  assert.equal(row['admin_revenue'], 300);
  assert.equal(Number(row['instructor_revenue']) + Number(row['admin_revenue']), 500);

  await assert.rejects(() => t.members.byInvoice('#inv', 3, false),
    (e: HttpError) => e.status === 404, 'someone else cannot read it');
  assert.ok(await t.members.byInvoice('#inv', 2, false));
  assert.ok(await t.members.byInvoice('#inv', 999, true), 'an admin may');
});

test('TP-03 you cannot buy your own package, or buy it twice', async () => {
  const t = make();
  const id = await seats(t);
  await assert.rejects(() => buy(t, id, 1, '#x'),
    (e: HttpError) => /own this item/.test(e.message));

  await buy(t, id, 2, '#1');
  await assert.rejects(() => buy(t, id, 2, '#2'),
    (e: HttpError) => /already purchased/.test(e.message));
});

test('TP-04 candidate search flags who is already in the classroom', async () => {
  const t = make();
  const id = await seats(t);
  await buy(t, id, 2, '#1');
  await t.members.addMember(id, 2, 4);

  const hits = await t.members.searchCandidates(id, 2, 'onyx.test');
  assert.equal(hits.some((u) => u.id === 2), false, 'a leader is not their own member');
  assert.equal(hits.find((u) => u.id === 4)!.already_member, true);
  assert.equal(hits.find((u) => u.id === 5)!.already_member, false);
  assert.equal((await t.members.searchCandidates(id, 2, '   ')).length, 0);
});
