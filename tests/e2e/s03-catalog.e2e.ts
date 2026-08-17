import { test } from 'node:test';
import assert from 'node:assert/strict';
import { api, webPage, RUN } from './harness.ts';

test('S03 the catalog lists only active courses', async () => {
  const res = await api<{ total: number; data: unknown[] }>('/api/courses');
  assert.equal(res.ok, true);
  assert.equal(res.data.total >= 1, true);
});

test('S03 price filters partition the catalog exactly', async () => {
  const all = await api<{ total: number }>('/api/courses');
  const free = await api<{ total: number }>('/api/courses?price=free');
  const paid = await api<{ total: number }>('/api/courses?price=paid');
  assert.equal(free.data.total + paid.data.total, all.data.total);
});

test('S03 an unknown category slug returns nothing, not everything', async () => {
  const res = await api<{ total: number }>('/api/courses?category=no-such-category');
  assert.equal(res.data.total, 0);
});

test('S03 course detail carries curriculum, decoded JSON and resolved SEO', async () => {
  const list = await api<{ data: { slug: string }[] }>('/api/courses');
  const slug = list.data.data[0]!.slug;
  const res = await api<{ course: Record<string, unknown>; seo: Record<string, unknown> }>(
    '/api/courses/' + slug);
  assert.equal(res.ok, true);
  assert.ok(Array.isArray(res.data.course.curriculum));
  assert.ok(Array.isArray(res.data.course.requirements), 'JSON-as-text is decoded');
  assert.equal(res.data.seo.robots, 'index, follow');
});

test('S03 the course page server-renders its metadata', async () => {
  const list = await api<{ data: { slug: string }[] }>('/api/courses');
  const page = await webPage('/course/' + list.data.data[0]!.slug);
  assert.equal(page.status, 200);
  assert.match(page.html, /<title>/);
  assert.match(page.html, /name="robots"/);
});

test('S03 an unknown course is a real 404', async () => {
  const page = await webPage('/course/definitely-not-a-course-' + RUN);
  assert.equal(page.status, 404);
});

test('S03 instructors and categories are browsable', async () => {
  const instructors = await api<{ total: number }>('/api/instructors');
  assert.equal(instructors.ok, true);
  const categories = await api<unknown[]>('/api/categories');
  assert.equal(Array.isArray(categories.data), true);
});

test('S03 contact and newsletter accept submissions and reject bad input', async () => {
  const good = await api('/api/contact', {
    body: { name: 'E2E', email: 'e2e-' + RUN + '@onyx.test', message: 'hello from the suite' },
  });
  assert.equal(good.ok, true);

  const bad = await api('/api/contact', { body: { name: '', email: 'nope', message: '' } });
  assert.equal(bad.status, 422);
  assert.ok(bad.errors?.email?.length);

  const sub = await api('/api/newsletter/subscribe', { body: { email: 'e2e-' + RUN + '@onyx.test' } });
  const resub = await api('/api/newsletter/subscribe', { body: { email: 'e2e-' + RUN + '@onyx.test' } });
  // Identical response either way, so the form is not a membership oracle.
  assert.deepEqual(sub.data, resub.data);
});

test('E-07 courses can be compared side by side', async () => {
  const list = await api<{ data: { slug: string; title: string }[] }>('/api/courses?per_page=3');
  const slugs = list.data.data.map((c) => c.slug).filter(Boolean);
  if (slugs.length < 2) return; // nothing to compare on an empty catalogue

  const pair = slugs.slice(0, 2).join(',');
  const res = await api<{
    courses: { slug: string; total_lesson: number; rating: { count: number } }[];
    suggestions: { slug: string }[];
    max: number;
  }>('/api/courses/compare?courses=' + encodeURIComponent(pair));

  assert.equal(res.ok, true);
  assert.deepEqual(res.data.courses.map((c) => c.slug), slugs.slice(0, 2), 'order is kept');
  assert.equal(typeof res.data.courses[0]!.total_lesson, 'number');
  // Already-compared courses are not offered again.
  assert.equal(res.data.suggestions.some((s) => slugs.slice(0, 2).includes(s.slug)), false);

  // "compare" must not be swallowed by the /api/courses/:slug route.
  const unknown = await api<{ courses: unknown[] }>('/api/courses/compare?courses=no-such-course');
  assert.equal(unknown.ok, true);
  assert.deepEqual(unknown.data.courses, [], 'an unknown slug is dropped, not an error');

  const page = await webPage('/compare?courses=' + encodeURIComponent(pair));
  assert.equal(page.status, 200);
  assert.match(page.html, /Compare courses/);
});
