import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeDb } from './fake-db.ts';
import { TutorCatalogService } from '../src/tutor/tutor-catalog.service.ts';
import { TutorScheduleService, repeatSlots } from '../src/tutor/tutor-schedule.service.ts';
import { TutorBookingService, tuitionStarted, TUITION_OPENS_MINUTES }
  from '../src/tutor/tutor-booking.service.ts';
import { SettingsService } from '../src/settings/settings.service.ts';
import { HttpError } from '../src/http/errors.ts';

const NOW = 1_800_000_000_000;
const SEC = Math.floor(NOW / 1000);

function make() {
  const d = new FakeDb({
    settings: [{ id: 1, type: 'instructor_revenue', description: '60' }],
    users: [
      { id: 1, name: 'Admin' },
      { id: 2, name: 'Tutor Tam', email: 't@onyx.test' },
      { id: 3, name: 'Student Sid', email: 's@onyx.test' },
    ],
    tutor_categories: [{ id: 1, name: 'Languages', slug: 'languages', status: 1 },
                       { id: 2, name: 'Retired', slug: 'retired', status: 0 }],
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

test('TB-06 the join window is real, unlike tution_started()', () => {
  const base = { start_time: SEC + 5 * 60, end_time: SEC + 3600, joining_data: '{"room_code":"x"}' };

  assert.equal(tuitionStarted(base, NOW), true, 'starts in five minutes');
  // firstOrNew() returns a NEW model when nothing matches, so the original
  // expression was truthy for every input -- the window never applied.
  assert.equal(tuitionStarted({ ...base, joining_data: null }, NOW), false, 'nothing to join');
  assert.equal(tuitionStarted({ ...base, start_time: SEC + 3600 }, NOW), false, 'an hour away');
  assert.equal(tuitionStarted({ ...base, end_time: SEC - 1 }, NOW), false, 'already over');
  // The boundary: Laravel used a strict <, so exactly 15 minutes is still shut.
  assert.equal(tuitionStarted({ ...base, start_time: SEC + TUITION_OPENS_MINUTES * 60 }, NOW),
    false);
});

test('TB-05 bookings fall into live, upcoming and archive', () => {
  const tab = (start: number, end: number) =>
    TutorBookingService.tab({ start_time: start, end_time: end }, NOW);
  assert.equal(tab(SEC + 7200, SEC + 10800), 'upcoming');
  assert.equal(tab(SEC + 5 * 60, SEC + 3600), 'live');
  assert.equal(tab(SEC - 7200, SEC - 3600), 'archive');
});

test('TB-03 a repeated schedule expands to the chosen weekdays only', () => {
  // 2027-01-04 is a Monday.
  const slots = repeatSlots('2027-01-04T09:00:00.000Z', '2027-01-17T09:00:00.000Z',
    ['monday', 'wednesday']);
  assert.equal(slots.length, 4, 'two Mondays and two Wednesdays');
  for (const s of slots) {
    const d = new Date(s * 1000);
    assert.equal([1, 3].includes(d.getUTCDay()), true);
    assert.equal(d.getUTCHours(), 9, 'the time of day is kept');
  }
  assert.deepEqual(repeatSlots('2027-01-04T09:00:00Z', '2027-01-05T09:00:00Z', ['sunday']), []);
  assert.throws(() => repeatSlots('nonsense', '2027-01-05T09:00:00Z', ['monday']),
    (e: unknown) => (e as HttpError).status === 422);
});

test('TB-02 a tutor can only teach an active category and subject, once', async () => {
  const { catalog } = make();
  await assert.rejects(
    () => catalog.addCanTeach(2, { category_id: 2, subject_id: 1, price: 40 }),
    (e: HttpError) => e.status === 422, 'an inactive category is not offerable');

  const added = await catalog.addCanTeach(2, { category_id: 1, subject_id: 1, price: 40 });
  assert.equal(added!['price'], 40);
  // A second row for the same pair would make priceFor() ambiguous.
  await assert.rejects(
    () => catalog.addCanTeach(2, { category_id: 1, subject_id: 1, price: 50 }),
    (e: HttpError) => /already teach/.test(e.message));

  assert.equal(await catalog.priceFor(2, 1, 1), 40);
  assert.equal(await catalog.priceFor(3, 1, 1), null, 'someone who does not teach it');
});

test('TB-01 a taxonomy row in use cannot be deleted', async () => {
  const { catalog } = make();
  await catalog.addCanTeach(2, { category_id: 1, subject_id: 1, price: 40 });
  await assert.rejects(() => catalog.remove('tutor_categories', 1),
    (e: HttpError) => e.status === 422);
  await assert.rejects(() => catalog.remove('tutor_subjects', 1),
    (e: HttpError) => e.status === 422);

  const off = await catalog.toggleStatus('tutor_categories', 1);
  assert.equal(off.status, 0);
  assert.equal((await catalog.list('tutor_categories', true)).length, 0);
});
