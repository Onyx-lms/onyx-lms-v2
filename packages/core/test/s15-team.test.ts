import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeDb } from './fake-db.ts';
import { TeamPackageService } from '../src/team/team-package.service.ts';
import { TeamMemberService } from '../src/team/team-member.service.ts';
import { SettingsService } from '../src/settings/settings.service.ts';
import { HttpError } from '../src/http/errors.ts';
import { parsePageQuery } from '../src/http/pagination.ts';

const PAGE = parsePageQuery({});
const LIFETIME = { expiry_type: 'lifetime' as const };

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

const basePackage = {
  title: 'Classroom', course_id: 9, course_privacy: 'public' as const,
  allocation: 2, pricing_type: 0 as const, ...LIFETIME,
};

test('TP-01 a paid package without a price is refused', async () => {
  const { packages } = make();
  // Laravel wrote required_if:is_paid,1 but the field is pricing_type, so the
  // rule never fired and a paid package could be saved with no price at all.
  await assert.rejects(
    () => packages.create(1, { ...basePackage, pricing_type: 1 }),
    (e: HttpError) => e.status === 422 && /needs a price/.test(e.message));

  const ok = await packages.create(1, { ...basePackage, pricing_type: 1, price: 250 });
  assert.equal((ok as Record<string, unknown>)['price'], 250);
});

test('TP-02 a limited package needs a real date range', async () => {
  const { packages } = make();
  await assert.rejects(
    () => packages.create(1, { ...basePackage, expiry_type: 'limited' }),
    (e: HttpError) => e.status === 422 && /start and an end/.test(e.message));

  await assert.rejects(
    () => packages.create(1, {
      ...basePackage, expiry_type: 'limited',
      start_date: '2027-06-01T00:00:00Z', expiry_date: '2027-01-01T00:00:00Z',
    }), (e: HttpError) => /end after it starts/.test(e.message));

  const made = await packages.create(1, {
    ...basePackage, expiry_type: 'limited',
    start_date: '2027-01-01T00:00:00Z', expiry_date: '2027-06-01T00:00:00Z',
  }) as Record<string, unknown>;
  // The columns are unix integers, unlike live_classes which uses a datetime.
  assert.equal(made['start_date'], 1798761600);
  assert.equal(typeof made['expiry_date'], 'number');
});

test('TP-02 switching back to lifetime clears the stale dates', async () => {
  const { packages } = make();
  const made = await packages.create(1, {
    ...basePackage, expiry_type: 'limited',
    start_date: '2027-01-01T00:00:00Z', expiry_date: '2027-06-01T00:00:00Z',
  }) as Record<string, unknown>;

  const updated = await packages.update(made['id'] as number,
    { ...basePackage, expiry_type: 'lifetime' }) as Record<string, unknown>;
  // Keeping them would silently expire a package that is meant to be lifetime.
  assert.equal(updated['start_date'], null);
  assert.equal(updated['expiry_date'], null);
});

test('TP-01 a package with no seats is refused', async () => {
  const { packages } = make();
  // Laravel validated min:0, which creates a classroom nobody can be added to.
  await assert.rejects(() => packages.create(1, { ...basePackage, allocation: 0 }),
    (e: HttpError) => e.status === 422 && /at least one seat/.test(e.message));
});

test('TP-05 private packages never appear in the public list', async () => {
  const { packages } = make();
  await packages.create(1, basePackage);
  await packages.create(1, { ...basePackage, title: 'Private one', course_privacy: 'private' });

  const listed = await packages.published({}, PAGE, '/x');
  assert.equal(listed.total, 1);
  assert.equal((listed.data[0] as Record<string, unknown>)['course_privacy'], 'public');
});

test('TP-01 a sold package cannot be deleted', async () => {
  const { d, packages, members } = make();
  const pkg = await packages.create(1, basePackage) as Record<string, unknown>;
  const id = pkg['id'] as number;
  await members.record({ packageId: id, userId: 2, invoice: '#a', price: 0, paymentMethod: 'free' });

  // Deleting it would strand the members' course access.
  await assert.rejects(() => packages.remove(id), (e: HttpError) => e.status === 422);
  d.tables['team_package_purchases'] = [];
  await packages.remove(id);
  assert.equal(d.tables['team_training_packages']!.length, 0);
});
