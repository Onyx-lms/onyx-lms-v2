import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeDb } from './fake-db.ts';
import { CompareService, sumDurations, MAX_COMPARE } from '../src/catalog/compare.service.ts';
import { phpJsonEncode } from '../src/json/php-json.ts';

const db = () => new FakeDb({
  courses: [
    { id: 1, slug: 'node', title: 'Node', status: 'active', user_id: 9, category_id: 3,
      outcomes: phpJsonEncode(['Build APIs']), requirements: phpJsonEncode(['A laptop']),
      is_paid: 1, price: 50, expiry_period: null },
    { id: 2, slug: 'react', title: 'React', status: 'active', user_id: 9, category_id: 3,
      outcomes: phpJsonEncode(['Build UIs']), requirements: null,
      is_paid: 0, price: null, expiry_period: 30 },
    { id: 3, slug: 'draft', title: 'Draft', status: 'draft', user_id: 9, category_id: 3,
      outcomes: null, requirements: null },
    { id: 4, slug: 'sql', title: 'SQL', status: 'active', user_id: 9, category_id: 3 },
  ],
  users: [{ id: 9, name: 'Ada' }],
  categories: [{ id: 3, title: 'Development' }],
  lessons: [
    { id: 1, course_id: 1, duration: '00:10:00' },
    { id: 2, course_id: 1, duration: '01:05:30' },
    { id: 3, course_id: 2, duration: '00:20:00' },
  ],
  enrollments: [{ id: 1, course_id: 1 }, { id: 2, course_id: 1 }, { id: 3, course_id: 2 }],
  reviews: [
    { id: 1, course_id: 1, rating: 5 }, { id: 2, course_id: 1, rating: 4 },
  ],
});

test('E-07 comparison keeps the order asked for and decodes the JSON columns', async () => {
  const svc = new CompareService(db() as never);
  const rows = await svc.bySlugs(['react', 'node']);

  assert.deepEqual(rows.map((r) => r['slug']), ['react', 'node'], 'the requested order');
  const node = rows.find((r) => r['slug'] === 'node')!;
  assert.deepEqual(node['outcomes'], ['Build APIs']);
  assert.deepEqual(node['requirements'], ['A laptop']);
  // A null JSON column must come back as an empty list, not null.
  assert.deepEqual(rows.find((r) => r['slug'] === 'react')!['requirements'], []);
});

test('E-07 the matrix totals lessons, length, enrolments and rating', async () => {
  const svc = new CompareService(db() as never);
  const [node] = await svc.bySlugs(['node']);

  assert.equal(node!['total_lesson'], 2);
  assert.equal(node!['total_enrollment'], 2);
  assert.deepEqual(node!['rating'], { average: 4.5, count: 2 });
  assert.equal((node!['total_duration'] as { label: string }).label, '1h 15m');
  assert.equal((node!['instructor'] as { name: string }).name, 'Ada');
  assert.equal((node!['category'] as { title: string }).title, 'Development');
});

test('E-07 unpublished and unknown slugs are dropped, not fatal', async () => {
  const svc = new CompareService(db() as never);
  // One bad slug in a shared link should not blank the comparison.
  const rows = await svc.bySlugs(['node', 'draft', 'no-such-course']);
  assert.deepEqual(rows.map((r) => r['slug']), ['node']);

  assert.deepEqual(await svc.bySlugs([]), []);
  assert.deepEqual(await svc.bySlugs(['   ']), []);
  assert.deepEqual(await svc.bySlugs(['draft']), [], 'a draft course is not comparable');
});

test('E-07 duplicates collapse and the list is capped', async () => {
  const svc = new CompareService(db() as never);
  assert.equal((await svc.bySlugs(['node', 'node', 'react'])).length, 2, 'deduplicated');

  const many = await svc.bySlugs(['node', 'react', 'sql', 'draft']);
  assert.equal(many.length <= MAX_COMPARE, true, 'never more than ' + MAX_COMPARE);
});

test('E-07 suggestions exclude what is already being compared', async () => {
  const svc = new CompareService(db() as never);
  const hits = await svc.suggestions(['node', 'react'], undefined);
  const slugs = hits.map((h) => h.slug);

  assert.equal(slugs.includes('node'), false);
  assert.equal(slugs.includes('react'), false);
  assert.equal(slugs.includes('sql'), true);
  assert.equal(slugs.includes('draft'), false, 'only published courses are offered');

  const searched = await svc.suggestions([], 'sql');
  assert.deepEqual(searched.map((h) => h.slug), ['sql']);
});

test('E-07 durations add up, and rubbish values do not poison the total', () => {
  assert.equal(sumDurations(['00:10:00', '00:05:30']).label, '15m');
  assert.equal(sumDurations(['01:00:00', '00:30:00']).label, '1h 30m');
  assert.equal(sumDurations([]).seconds, 0);
  // Lessons legitimately have no duration, and the column is free text.
  assert.equal(sumDurations([null, '', 'abc', '00:10:00']).label, '10m');
  // "MM:SS" is padded rather than read as hours.
  assert.equal(sumDurations(['10:00']).seconds, 600);
});
