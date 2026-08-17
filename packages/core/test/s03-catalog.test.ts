import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeDb } from './fake-db.ts';
import { CategoriesService } from '../src/catalog/categories.service.ts';
import { CoursesService, perPageForLayout } from '../src/catalog/courses.service.ts';
import { parsePageQuery } from '../src/http/pagination.ts';
import { HttpError } from '../src/http/errors.ts';
import { seed } from './s03-fixtures.ts';

const svc = (d: FakeDb) => {
  const cats = new CategoriesService(d as never);
  return { cats, courses: new CoursesService(d as never, cats) };
};

test('C-02 builds a two-level tree with rolled-up course counts', async () => {
  const { cats } = svc(seed());
  const tree = await cats.tree();
  assert.equal(tree.length, 2);
  const dev = tree.find((c) => c.slug === 'development');
  assert.equal(dev.children.length, 2);
  assert.equal(dev.course_count, 2);
  assert.equal(tree.find((c) => c.slug === 'design').course_count, 1);
});

test('C-02 draft courses are never counted', async () => {
  const { cats } = svc(seed());
  assert.equal((await cats.courseCounts()).get(2), 1);
});

test('C-02 top categories are ordered by course count', async () => {
  const { cats } = svc(seed());
  assert.equal((await cats.top(2))[0].slug, 'development');
});

test('C-03 a parent category includes its children', async () => {
  const { cats } = svc(seed());
  assert.deepEqual((await cats.filterIdsForSlug('development')).sort(), [1, 2, 3]);
});

test('C-03 a child category matches only itself', async () => {
  const { cats } = svc(seed());
  assert.deepEqual(await cats.filterIdsForSlug('web'), [2]);
});

test('C-03 only active courses are listed', async () => {
  const { courses } = svc(seed());
  assert.equal((await courses.list({}, parsePageQuery({}), '/c')).total, 3);
});

test('C-03 filtering by a parent category returns the children courses', async () => {
  const { courses } = svc(seed());
  assert.equal((await courses.list({ categorySlug: 'development' }, parsePageQuery({}), '/c')).total, 2);
});

test('C-03 an unknown category slug returns nothing, not everything', async () => {
  const { courses } = svc(seed());
  assert.equal((await courses.list({ categorySlug: 'nope' }, parsePageQuery({}), '/c')).total, 0);
});

test('C-03 price filters map to is_paid and discount_flag', async () => {
  const { courses } = svc(seed());
  const q = parsePageQuery({});
  assert.equal((await courses.list({ price: 'free' }, q, '/c')).total, 1);
  assert.equal((await courses.list({ price: 'paid' }, q, '/c')).total, 2);
  assert.equal((await courses.list({ price: 'discount' }, q, '/c')).total, 1);
});

test('C-03 level and language filters are exact matches', async () => {
  const { courses } = svc(seed());
  const q = parsePageQuery({});
  assert.equal((await courses.list({ level: 'beginner' }, q, '/c')).total, 2);
  assert.equal((await courses.list({ language: 'spanish' }, q, '/c')).total, 1);
});

test('C-03 search spans the six Laravel columns', async () => {
  const { courses } = svc(seed());
  const q = parsePageQuery({});
  assert.equal((await courses.list({ search: 'react' }, q, '/c')).total, 1);
  assert.equal((await courses.list({ search: 'design systems' }, q, '/c')).total, 1);
  assert.equal((await courses.list({ search: 'deep dive' }, q, '/c')).total, 1);
});

test('C-03 layout drives page size the way Laravel did', () => {
  assert.equal(perPageForLayout('grid'), 9);
  assert.equal(perPageForLayout('list'), 5);
});

test('C-03 cards carry the instructor without an N+1', async () => {
  const { courses } = svc(seed());
  const page = await courses.list({}, parsePageQuery({}), '/c');
  assert.equal(page.data[0].instructor_name, 'Ada Lovelace');
});

test('C-03 facets list the distinct levels and languages', async () => {
  const { courses } = svc(seed());
  const f = await courses.facets();
  assert.deepEqual(f.levels, ['advanced', 'beginner']);
  assert.deepEqual(f.languages, ['english', 'spanish']);
});

test('C-04 course detail assembles curriculum, counts and ratings', async () => {
  const { courses } = svc(seed());
  const detail = await courses.detailBySlug('react-basics');
  assert.equal(detail.curriculum.length, 1);
  assert.equal(detail.curriculum[0].lessons.length, 2);
  assert.equal(detail.total_lesson, 2);
  assert.equal(detail.total_enrollment, 1);
  assert.equal(detail.rating.average, 4.5);
  assert.equal(detail.rating.breakdown['5'], 1);
  assert.equal(detail.instructor.name, 'Grace Hopper');
});

test('C-04 JSON-as-text course columns are decoded', async () => {
  const { courses } = svc(seed());
  const detail = await courses.detailBySlug('react-basics');
  assert.deepEqual(detail.requirements, ['A laptop']);
  assert.deepEqual(detail.outcomes, ['Build apps']);
  assert.deepEqual(detail.faqs, []);
});

test('C-04 a draft course is not reachable by slug', async () => {
  const { courses } = svc(seed());
  await assert.rejects(() => courses.detailBySlug('draft-course'),
    (e: HttpError) => e.status === 404);
});
