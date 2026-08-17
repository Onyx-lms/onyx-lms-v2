import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { api, login, withDb, webPage, ADMIN, STUDENT, RUN } from './harness.ts';

let adminToken = '';
let studentToken = '';
let studentId = 0;
let topicId = 0;
let articleId = 0;
let testimonialId = 0;

before(async () => {
  adminToken = await login(ADMIN.email, ADMIN.password);
  studentToken = await login(STUDENT.email, STUDENT.password);
  studentId = await withDb(async (c) =>
    Number((await c.query('select id from users where email=$1', [STUDENT.email])).rows[0].id));
});

after(async () => {
  await withDb(async (c) => {
    await c.query('delete from knowledge_bases where title like $1', ['%E2E ' + RUN + '%']);
    await c.query('delete from knowledge_base_topicks where topic_name like $1',
      ['%E2E ' + RUN + '%']);
    await c.query('delete from user_reviews where review like $1', ['%E2E ' + RUN + '%']);
  });
});

test('R-08 only an admin may create topics and articles', async () => {
  const refused = await api('/api/admin/knowledge-base/topics',
    { token: studentToken, body: { title: 'Nope ' + RUN } });
  assert.equal(refused.status, 403);

  const topic = await api<{ id: number }>('/api/admin/knowledge-base/topics',
    { token: adminToken, body: { title: 'Support E2E ' + RUN } });
  assert.equal(topic.ok, true);
  topicId = topic.data.id;

  const article = await api<{ id: number }>('/api/admin/knowledge-base/articles', {
    token: adminToken,
    body: {
      knowledge_base_id: topicId,
      topic_name: 'Refunds E2E ' + RUN,
      description: 'Refunds are processed within fourteen days.',
    },
  });
  assert.equal(article.ok, true);
  articleId = article.data.id;
});

test('R-08 an article cannot hang off a topic that does not exist', async () => {
  const orphan = await api('/api/admin/knowledge-base/articles', {
    token: adminToken,
    body: { knowledge_base_id: 999999, topic_name: 'Orphan ' + RUN, description: 'x' },
  });
  assert.equal(orphan.status, 404);
});

test('R-08 browsing and search are public', async () => {
  const topics = await api<{ id: number; article_count: number }[]>('/api/knowledge-base');
  const mine = topics.data.find((t) => t.id === topicId)!;
  assert.equal(mine.article_count, 1);

  const detail = await api<{ articles: { id: number }[] }>(
    '/api/knowledge-base/topics/' + topicId);
  assert.equal(detail.data.articles.some((a) => a.id === articleId), true);

  const article = await api<{ topic: { id: number }; siblings: unknown[] }>(
    '/api/knowledge-base/articles/' + articleId);
  assert.equal(article.data.topic.id, topicId);

  // Search reaches into the body, not just the title.
  const hits = await api<{ id: number }[]>('/api/knowledge-base/search?q=fourteen%20days');
  assert.equal(hits.data.some((h) => h.id === articleId), true);

  const empty = await api<unknown[]>('/api/knowledge-base/search?q=');
  assert.equal(empty.data.length, 0, 'a blank search is not "everything"');
});

test('R-08 a missing topic or article is a 404', async () => {
  assert.equal((await api('/api/knowledge-base/topics/999999')).status, 404);
  assert.equal((await api('/api/knowledge-base/articles/999999')).status, 404);
});

test('R-08 the knowledge base renders server-side', async () => {
  // Both the page and its data fetches are cached for 60s, and the topic list
  // is fetched from a constant URL -- so a brand-new topic legitimately may not
  // appear yet. The search fetch carries a run-unique URL, so it is always a
  // fresh render, and that is what proves the HTML is built on the server.
  const index = await webPage('/knowledge-base?q=' + encodeURIComponent('Refunds E2E ' + RUN));
  assert.equal(index.status, 200);
  assert.match(index.html, new RegExp('Refunds E2E ' + RUN), 'search hits render server-side');
  assert.match(index.html, /Topics/, 'the topic section renders');

  const article = await webPage('/knowledge-base/articles/' + articleId);
  assert.equal(article.status, 200);
  assert.match(article.html, /fourteen days/);
});

test('R-03 testimonials are admin-only to write and public to read', async () => {
  const refused = await api('/api/admin/testimonials',
    { token: studentToken, body: { user_id: studentId, rating: 5, review: 'sneaky ' + RUN } });
  assert.equal(refused.status, 403);

  const ghost = await api('/api/admin/testimonials',
    { token: adminToken, body: { user_id: 999999, rating: 5, review: 'ghost ' + RUN } });
  assert.equal(ghost.status, 422, 'the quoted person must exist');

  const created = await api<{ id: number; rating: number; user: { id: number } }>(
    '/api/admin/testimonials',
    { token: adminToken, body: { user_id: studentId, rating: 5, review: 'Loved it E2E ' + RUN } });
  assert.equal(created.ok, true);
  testimonialId = created.data.id;
  assert.equal(created.data.rating, 5, 'read back as a number despite the varchar column');
  assert.equal(created.data.user.id, studentId);

  const publicList = await api<{ id: number }[]>('/api/testimonials');
  assert.equal(publicList.data.some((t) => t.id === testimonialId), true);
});

test('R-03 a testimonial can be edited and removed', async () => {
  const updated = await api<{ rating: number; review: string }>(
    '/api/admin/testimonials/' + testimonialId,
    { token: adminToken, method: 'PATCH', body: { rating: 4 } });
  assert.equal(updated.data.rating, 4);
  assert.match(updated.data.review, /Loved it E2E/, 'untouched fields survive');

  const refused = await api('/api/admin/testimonials/' + testimonialId,
    { token: studentToken, method: 'DELETE' });
  assert.equal(refused.status, 403);

  const removed = await api('/api/admin/testimonials/' + testimonialId,
    { token: adminToken, method: 'DELETE' });
  assert.equal(removed.ok, true);
  assert.equal((await api('/api/admin/testimonials/' + testimonialId,
    { token: adminToken, method: 'DELETE' })).status, 404);
});

test('R-08 deleting a topic deletes its articles', async () => {
  await api('/api/admin/knowledge-base/topics/' + topicId,
    { token: adminToken, method: 'DELETE' });
  const left = await withDb(async (c) => Number((await c.query(
    'select count(*)::int n from knowledge_base_topicks where knowledge_base_id=$1',
    [topicId])).rows[0].n));
  assert.equal(left, 0);
  assert.equal((await api('/api/knowledge-base/topics/' + topicId)).status, 404);
});
