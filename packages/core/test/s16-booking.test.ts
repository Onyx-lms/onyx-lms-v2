import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeDb } from './fake-db.ts';
import { TutorCatalogService } from '../src/tutor/tutor-catalog.service.ts';
import { TutorScheduleService } from '../src/tutor/tutor-schedule.service.ts';
import { TutorBookingService } from '../src/tutor/tutor-booking.service.ts';
import { SettingsService } from '../src/settings/settings.service.ts';
import { HttpError } from '../src/http/errors.ts';

const SOON = () => new Date(Date.now() + 60 * 60 * 1000).toISOString();

function make() {
  const d = new FakeDb({
    settings: [{ id: 1, type: 'instructor_revenue', description: '60' }],
    users: [
      { id: 2, name: 'Tutor Tam', email: 't@onyx.test' },
      { id: 3, name: 'Student Sid', email: 's@onyx.test' },
      { id: 4, name: 'Other', email: 'o@onyx.test' },
    ],
    tutor_categories: [{ id: 1, name: 'Languages', slug: 'languages', status: 1 }],
    tutor_subjects: [{ id: 1, name: 'French', slug: 'french', status: 1 }],
    tutor_can_teach: [], tutor_schedules: [], tutor_bookings: [], tutor_reviews: [],
  });
  const settings = new SettingsService(d as never);
  return {
    d,
    catalog: new TutorCatalogService(d as never),
    schedules: new TutorScheduleService(d as never),
    bookings: new TutorBookingService(d as never, settings),
  };
}

async function oneSlot(t: ReturnType<typeof make>, startIso = SOON()) {
  await t.catalog.addCanTeach(2, { category_id: 1, subject_id: 1, price: 100 });
  const [slot] = await t.schedules.create(2, {
    category_id: 1, subject_id: 1, duration: 60, tution_type: 1,
    start_time: startIso, price: 100,
  });
  return slot as Record<string, unknown>;
}

test('TB-03 a slot carries the price from the can-teach row', async () => {
  const t = make();
  const slot = await oneSlot(t);
  // Laravel left tutor_schedules.price null and read the can-teach row at
  // checkout, so a later price change silently repriced pending slots.
  assert.equal(slot['price'], 100);
  assert.equal(Number(slot['end_time']) - Number(slot['start_time']), 3600);
  assert.equal(slot['booking_id'], null);
});

test('TB-05 booking claims the slot so nobody else can take it', async () => {
  const t = make();
  const slot = await oneSlot(t);
  const id = slot['id'] as number;

  const booked = await t.bookings.book(id, 3,
    { invoice: '#1', paymentMethod: 'free' }) as Record<string, unknown>;
  assert.equal(booked['student_id'], 3);
  assert.equal(booked['tutor_id'], 2);
  assert.equal(booked['price'], 100);
  assert.equal(booked['joining_data'], null, 'the meeting is made on the first join');

  const claimed = t.d.tables['tutor_schedules']!.find((s) => s['id'] === id)!;
  assert.equal(claimed['booking_id'], booked['id']);

  await assert.rejects(() => t.bookings.book(id, 4, { invoice: '#2', paymentMethod: 'free' }),
    (e: HttpError) => /already been booked/.test(e.message));
});

test('TB-05 a tutor cannot book themselves, and a finished slot cannot be sold', async () => {
  const t = make();
  const slot = await oneSlot(t);
  await assert.rejects(
    () => t.bookings.book(slot['id'] as number, 2, { invoice: '#1', paymentMethod: 'free' }),
    (e: HttpError) => /your own session/.test(e.message));

  const t2 = make();
  await t2.catalog.addCanTeach(2, { category_id: 1, subject_id: 1, price: 100 });
  const [old] = await t2.schedules.create(2, {
    category_id: 1, subject_id: 1, duration: 60, tution_type: 1,
    start_time: new Date(Date.now() - 4 * 3600 * 1000).toISOString(), price: 100,
  });
  await assert.rejects(
    () => t2.bookings.book((old as Record<string, unknown>)['id'] as number, 3,
      { invoice: '#1', paymentMethod: 'free' }),
    (e: HttpError) => /already finished/.test(e.message));
});

test('TB-05 revenue splits on the platform setting and adds back to the price', async () => {
  const t = make();
  const slot = await oneSlot(t);
  const booked = await t.bookings.book(slot['id'] as number, 3,
    { invoice: '#inv', paymentMethod: 'free' }) as Record<string, unknown>;

  assert.equal(booked['instructor_revenue'], 60, '60% of 100');
  assert.equal(booked['admin_revenue'], 40);
  assert.equal(Number(booked['instructor_revenue']) + Number(booked['admin_revenue']), 100);
});

test('TB-05 an invoice is visible to both parties and nobody else', async () => {
  const t = make();
  const slot = await oneSlot(t);
  await t.bookings.book(slot['id'] as number, 3, { invoice: '#inv', paymentMethod: 'free' });

  assert.ok(await t.bookings.byInvoice('#inv', 3, false), 'the student');
  assert.ok(await t.bookings.byInvoice('#inv', 2, false), 'the tutor');
  assert.ok(await t.bookings.byInvoice('#inv', 999, true), 'an admin');
  await assert.rejects(() => t.bookings.byInvoice('#inv', 4, false),
    (e: HttpError) => e.status === 404, 'a stranger gets a 404, not a 403');
});

test('TB-05 a listed booking never carries the joining payload', async () => {
  const t = make();
  const slot = await oneSlot(t);
  const booked = await t.bookings.book(slot['id'] as number, 3,
    { invoice: '#inv', paymentMethod: 'free' }) as Record<string, unknown>;
  await t.bookings.setJoiningData(booked['id'] as number, { room_code: 'secret-room' });

  const mine = await t.bookings.forStudent(3);
  assert.equal(mine.length, 1);
  assert.equal('joining_data' in mine[0]!, false, 'it can carry a host link');
  assert.equal(mine[0]!['has_joining_data'], true);
});

test('TB-07 a review needs a finished session, and there is one per tutor', async () => {
  const t = make();
  const slot = await oneSlot(t);
  const booked = await t.bookings.book(slot['id'] as number, 3,
    { invoice: '#inv', paymentMethod: 'free' }) as Record<string, unknown>;

  // The session has not happened yet. The original allowed a review anyway.
  await assert.rejects(() => t.bookings.review(2, 3, 5, 'Great'),
    (e: HttpError) => e.status === 422);

  const row = t.d.tables['tutor_bookings']!.find((b) => b['id'] === booked['id'])!;
  row['end_time'] = Math.floor(Date.now() / 1000) - 60;

  assert.deepEqual(await t.bookings.review(2, 3, 5, ' Great tutor '), { updated: false });
  const first = await t.bookings.reviewsFor(2);
  assert.equal(first.total, 1, 'ports total_review_by_tutor_id()');
  assert.equal(first.average, 5);
  assert.equal(first.reviews[0]!.review, 'Great tutor');

  // A second review from the same student edits the first, never stacks.
  assert.deepEqual(await t.bookings.review(2, 3, 3, 'Changed my mind'), { updated: true });
  const second = await t.bookings.reviewsFor(2);
  assert.equal(second.total, 1);
  assert.equal(second.average, 3);
});

test('TB-04 only open, future slots are offered', async () => {
  const t = make();
  const slot = await oneSlot(t);
  const id = slot['id'] as number;

  assert.equal((await t.schedules.forTutor(2, { onlyOpen: true })).length, 1);
  await t.bookings.book(id, 3, { invoice: '#1', paymentMethod: 'free' });
  // The original listed booked slots as available.
  assert.equal((await t.schedules.forTutor(2, { onlyOpen: true })).length, 0);
  assert.equal((await t.schedules.forTutor(2)).length, 1, 'the tutor still sees it');

  await assert.rejects(() => t.schedules.remove(id, 2),
    (e: HttpError) => /has been booked/.test(e.message));
  await assert.rejects(() => t.schedules.remove(id, 4),
    (e: HttpError) => e.status === 403, 'and only its owner may remove it');
});
