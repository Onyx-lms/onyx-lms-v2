import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { api, login, withDb, webPage, ADMIN, STUDENT, RUN } from './harness.ts';

let adminToken = '';
let studentToken = '';
let categoryId = 0;
let categorySlug = '';
let blogId = 0;
let blogSlug = '';

before(async () => {
  adminToken = await login(ADMIN.email, ADMIN.password);
  studentToken = await login(STUDENT.email, STUDENT.password);

  const categories = await api<{ id: number; slug: string }[]>('/api/blogs/categories');
  categoryId = categories.data[0]!.id;
  categorySlug = categories.data[0]!.slug;
});

after(async () => {
  // Leave the database as we found it, so a re-run starts clean.
  await withDb(async (c) => {
    await c.query('delete from blogs where title like $1', ['%E2E ' + RUN + '%']);
  });
});

test('R-04 an admin post publishes immediately and gets an id-suffixed slug', async () => {
  const created = await api<{ id: number; slug: string; status: number }>('/api/manage/blogs', {
    token: adminToken,
    body: {
      title: 'Blog E2E ' + RUN,
      description: '<p>Body copy.</p>',
      keywords: 'e2e,blog',
      category_id: categoryId,
      is_popular: 1,
    },
  });
  assert.equal(created.ok, true);
  blogId = created.data.id;
  blogSlug = created.data.slug;
  assert.equal(created.data.status, 1);
  assert.match(blogSlug, new RegExp('-' + blogId + '$'), 'the row id makes the slug unique');
});

test('R-05 the post is public without a token, with SEO metadata', async () => {
  const res = await api<{
    post: { title: string }; seo: { title: string }; likes: { count: number; liked: boolean };
  }>('/api/blogs/' + blogSlug);
  assert.equal(res.ok, true);
  assert.equal(res.data.post.title, 'Blog E2E ' + RUN);
  assert.equal(res.data.seo.title, 'Blog E2E ' + RUN, 'falls back to the post title');
  assert.deepEqual(res.data.likes, { count: 0, liked: false });
});

test('R-05 the category filter narrows, and an unknown slug returns nothing', async () => {
  const inCategory = await api<{ data: { id: number }[] }>('/api/blogs?category=' + categorySlug);
  assert.equal(inCategory.data.data.some((p) => p.id === blogId), true);

  const unknown = await api<{ total: number }>('/api/blogs?category=no-such-category-' + RUN);
  assert.equal(unknown.data.total, 0);
});

test('R-04 a student cannot author, and cannot reach the admin queue', async () => {
  const authoring = await api('/api/manage/blogs',
    { token: studentToken, body: { title: 'Nope ' + RUN } });
  assert.equal(authoring.status, 403);

  const queue = await api('/api/admin/blogs/pending', { token: studentToken });
  assert.equal(queue.status, 403);
});

test('R-06 comments thread one level and reject deeper nesting', async () => {
  const top = await api<{ id: number }>('/api/blogs/' + blogId + '/comments',
    { token: studentToken, body: { comment: 'First comment ' + RUN } });
  assert.equal(top.ok, true);

  const reply = await api<{ id: number; parent_id: number }>('/api/blogs/' + blogId + '/comments',
    { token: adminToken, body: { comment: 'Thanks!', parent_id: top.data.id } });
  assert.equal(reply.data.parent_id, top.data.id);

  const deeper = await api('/api/blogs/' + blogId + '/comments',
    { token: studentToken, body: { comment: 'too deep', parent_id: reply.data.id } });
  assert.equal(deeper.status, 422);

  const page = await api<{ comments: { id: number; replies: unknown[] }[] }>(
    '/api/blogs/' + blogSlug);
  const thread = page.data.comments.find((c) => c.id === top.data.id)!;
  assert.equal(thread.replies.length, 1);
});

test('R-06 a like is one per person and toggles off', async () => {
  const first = await api<{ count: number; liked: boolean }>('/api/blogs/' + blogId + '/like',
    { token: studentToken, method: 'POST' });
  assert.deepEqual(first.data, { count: 1, liked: true });

  const second = await api<{ count: number; liked: boolean }>('/api/blogs/' + blogId + '/like',
    { token: studentToken, method: 'POST' });
  assert.deepEqual(second.data, { count: 0, liked: false }, 'nobody can stack likes');

  await api('/api/blogs/' + blogId + '/like', { token: studentToken, method: 'POST' });
  await api('/api/blogs/' + blogId + '/like', { token: adminToken, method: 'POST' });
  const anon = await api<{ likes: { count: number; liked: boolean } }>('/api/blogs/' + blogSlug);
  assert.deepEqual(anon.data.likes, { count: 2, liked: false });
});

test('R-06 only the author or an admin may delete a comment', async () => {
  const mine = await api<{ id: number }>('/api/blogs/' + blogId + '/comments',
    { token: adminToken, body: { comment: 'admin comment ' + RUN } });
  const refused = await api('/api/blog-comments/' + mine.data.id,
    { token: studentToken, method: 'DELETE' });
  assert.equal(refused.status, 403);

  const allowed = await api('/api/blog-comments/' + mine.data.id,
    { token: adminToken, method: 'DELETE' });
  assert.equal(allowed.ok, true);
});

test('R-05 the blog pages render server-side', async () => {
  // A run-unique search term sidesteps the ISR cache on the bare /blogs URL.
  const list = await webPage('/blogs?search=' + RUN);
  assert.equal(list.status, 200);
  assert.match(list.html, /Blog E2E /, 'the post is in the HTML, not fetched later');

  const detail = await webPage('/blog/' + blogSlug);
  assert.equal(detail.status, 200);
  assert.match(detail.html, /Body copy\./);
  assert.match(detail.html, /Sign in/, 'anonymous readers are invited to sign in');
});

test('R-07 an instructor post waits for approval', async () => {
  const email = 'blogwriter+' + RUN + '@onyx.test';
  await api('/api/admin/users', {
    token: adminToken,
    body: { name: 'Blog Writer', email, password: 'Secret#2026', role: 'instructor' },
  });
  const writer = await api<{ token: string }>('/api/auth/login',
    { body: { email, password: 'Secret#2026' } });

  const post = await api<{ id: number; slug: string; status: number }>('/api/manage/blogs', {
    token: writer.data.token,
    body: { title: 'Instructor E2E ' + RUN, description: 'Pending copy.' },
  });
  assert.equal(post.data.status, 0, 'instructor posts are never auto-published');

  const queue = await api<{ data: { id: number }[] }>('/api/admin/blogs/pending',
    { token: adminToken });
  assert.equal(queue.data.data.some((p) => p.id === post.data.id), true);

  // Not public until an admin approves it.
  const hidden = await api('/api/blogs/' + post.data.slug);
  assert.equal(hidden.status, 404);

  const approved = await api('/api/admin/blogs/' + post.data.id + '/status',
    { token: adminToken, body: { status: 1 } });
  assert.equal(approved.ok, true);

  const now = await api('/api/blogs/' + post.data.slug);
  assert.equal(now.ok, true);
});

test('R-04 deleting a post removes its comments and likes', async () => {
  await api('/api/manage/blogs/' + blogId, { token: adminToken, method: 'DELETE' });
  const remaining = await withDb(async (c) => ({
    comments: Number((await c.query(
      'select count(*)::int n from blog_comments where blog_id=$1', [blogId])).rows[0].n),
    likes: Number((await c.query(
      'select count(*)::int n from blog_likes where blog_id=$1', [blogId])).rows[0].n),
  }));
  assert.deepEqual(remaining, { comments: 0, likes: 0 });
});
