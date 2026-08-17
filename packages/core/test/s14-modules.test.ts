import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeDb } from './fake-db.ts';
import { BootcampModuleService, unix, classStarted } from '../src/bootcamp/module.service.ts';
import { BootcampPurchaseService } from '../src/bootcamp/purchase.service.ts';
import { SettingsService } from '../src/settings/settings.service.ts';
import { HttpError } from '../src/http/errors.ts';

const HOUR = 3600;
const NOW = 1_800_000_000_000; // fixed clock, in ms

function make(instructorShare = '40') {
  const d = new FakeDb({
    settings: [{ id: 1, type: 'instructor_revenue', description: instructorShare }],
    users: [{ id: 2, name: 'Ada' }, { id: 3, name: 'Sam' }],
    bootcamps: [
      { id: 5, user_id: 3, title: 'Workshop', slug: 'workshop', status: 1,
        is_paid: 1, price: 100, discount_flag: 1, discounted_price: 25 },
      { id: 6, user_id: 3, title: 'Free one', slug: 'free-one', status: 1,
        is_paid: 0, price: null, discount_flag: 0, discounted_price: null },
      { id: 7, user_id: 3, title: 'Hidden', slug: 'hidden', status: 0, is_paid: 0 },
    ],
    bootcamp_modules: [], bootcamp_live_classes: [], bootcamp_resources: [],
    bootcamp_purchases: [],
  });
  const settings = new SettingsService(d as never);
  return {
    d,
    modules: new BootcampModuleService(d as never),
    purchases: new BootcampPurchaseService(d as never, settings),
  };
}

test('BC-03 publish and expiry dates are unix integers, not timestamps', () => {
  // bootcamp_modules stores integers; live_classes stores a datetime. Both are
  // kept as they are, so the conversion has to live in one place.
  assert.equal(unix('2027-01-01T00:00:00.000Z'), 1798761600);
  assert.equal(unix(1798761600), 1798761600);
  assert.equal(unix(null), null);
  assert.equal(unix(''), null);
  assert.equal(unix('not a date'), null);
});

test('BC-03 a module is closed before it publishes and after it expires', () => {
  const { modules } = make();
  const now = NOW;
  const seconds = Math.floor(now / 1000);
  const open = (publish: number | null, expiry: number | null) =>
    modules.isOpen({ publish_date: publish, expiry_date: expiry, restriction: null }, now);

  assert.equal(open(null, null), true, 'no dates means always open');
  assert.equal(open(seconds - HOUR, null), true);
  assert.equal(open(seconds + HOUR, null), false, 'not published yet');
  assert.equal(open(null, seconds + HOUR), true);
  assert.equal(open(null, seconds - HOUR), false, 'expired');
});

test('BC-03 modules append in order and can be reordered', async () => {
  const { d, modules } = make();
  const a = await modules.create(5, { title: 'Week 1' }) as { id: number; sort: number };
  const b = await modules.create(5, { title: 'Week 2' }) as { id: number; sort: number };
  assert.equal(a.sort, 1);
  assert.equal(b.sort, 2);

  await modules.sort(5, [b.id, a.id]);
  const rows = d.tables['bootcamp_modules']!;
  assert.equal(rows.find((r) => r['id'] === b.id)!['sort'], 1);
  assert.equal(rows.find((r) => r['id'] === a.id)!['sort'], 2);

  // A module from another workshop must not be renumbered by this call.
  const other = await modules.create(6, { title: 'Elsewhere' }) as { id: number };
  await modules.sort(5, [other.id]);
  assert.equal(d.tables['bootcamp_modules']!.find((r) => r['id'] === other.id)!['sort'], 1);
});

test('BC-05 class_started needs joining data, no force-stop and the right window', () => {
  const seconds = Math.floor(NOW / 1000);
  const base = { start_time: seconds + 5 * 60, end_time: seconds + HOUR,
                 joining_data: '{"room_code":"abc"}', force_stop: 0 };

  assert.equal(classStarted(base, NOW), true, 'starts in five minutes');
  assert.equal(classStarted({ ...base, force_stop: 1 }, NOW), false, 'stopped by the host');
  assert.equal(classStarted({ ...base, joining_data: null }, NOW), false, 'nothing to join');
  assert.equal(classStarted({ ...base, start_time: seconds + 60 * 60 }, NOW), false,
    'more than fifteen minutes away');
  assert.equal(classStarted({ ...base, end_time: seconds - 60 }, NOW), false, 'already over');
  // Exactly the 15-minute boundary: Laravel used a strict <, so this is closed.
  assert.equal(classStarted({ ...base, start_time: seconds + 15 * 60 }, NOW), false);
});

test('BC-06 free enrolment refuses paid, owned and repeat purchases', async () => {
  const { purchases } = make();
  await assert.rejects(() => purchases.enrolFree(5, 2, '#a'),
    (e: HttpError) => e.status === 422 && /not free/.test(e.message));
  await assert.rejects(() => purchases.enrolFree(6, 3, '#a'),
    (e: HttpError) => e.status === 422 && /own this item/.test(e.message));
  await assert.rejects(() => purchases.enrolFree(7, 2, '#a'),
    (e: HttpError) => e.status === 404, 'an unpublished workshop is not purchasable');

  const first = await purchases.enrolFree(6, 2, '#invoice1') as Record<string, unknown>;
  assert.equal(first['price'], 0);
  assert.equal(first['instructor_revenue'], 0);
  assert.equal(await purchases.hasPurchased(6, 2), true);

  await assert.rejects(() => purchases.enrolFree(6, 2, '#invoice2'),
    (e: HttpError) => /already purchased/.test(e.message));
});

test('BC-06 a paid purchase splits revenue on the platform setting', async () => {
  const { purchases } = make('40');
  const row = await purchases.record({
    bootcampId: 5, userId: 2, invoice: '#inv', price: 75, tax: 5, paymentMethod: 'offline',
  }) as Record<string, unknown>;

  assert.equal(row['price'], 75);
  assert.equal(row['instructor_revenue'], 30, '40% of 75');
  assert.equal(row['admin_revenue'], 45);
  assert.equal(Number(row['instructor_revenue']) + Number(row['admin_revenue']), 75,
    'the split always adds back to the price');

  const totals = await purchases.revenueFor(3);
  assert.deepEqual(totals, { sales: 1, gross: 75, instructor: 30, admin: 45 });
});

test('BC-06 an invoice is private to its buyer', async () => {
  const { purchases } = make();
  await purchases.enrolFree(6, 2, '#mine');

  const own = await purchases.byInvoice('#mine', 2, false) as Record<string, unknown>;
  assert.equal((own['bootcamp'] as { slug: string }).slug, 'free-one');

  // Someone else's invoice is a 404, not a 403: its existence is private.
  await assert.rejects(() => purchases.byInvoice('#mine', 3, false),
    (e: HttpError) => e.status === 404);
  const asAdmin = await purchases.byInvoice('#mine', 999, true);
  assert.ok(asAdmin, 'an admin may read any invoice');
});

test('BC-06 invoices are unique and use the Laravel shape', async () => {
  const { purchases } = make();
  const a = purchases.newInvoice();
  assert.equal(a.length, 20, "Laravel used Str::random(20)");
  assert.match(a, /^[A-Za-z0-9]+$/);
  assert.notEqual(a, purchases.newInvoice());
});

test('BC-06 an owned workshop cannot be bought again', async () => {
  const { purchases } = make();
  await purchases.record({
    bootcampId: 5, userId: 2, invoice: '#first', price: 75, paymentMethod: 'offline',
  });
  // Laravel checked is_purchased_bootcamp() before building the payment, so a
  // second attempt is refused up front rather than at approval time.
  assert.equal(await purchases.hasPurchased(5, 2), true);
  await assert.rejects(() => purchases.record({
    bootcampId: 5, userId: 2, invoice: '#second', price: 75, paymentMethod: 'offline',
  }), (e: HttpError) => e.status === 422 && /already purchased/.test(e.message));
});
