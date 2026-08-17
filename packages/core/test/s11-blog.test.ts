import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeDb } from './fake-db.ts';
import { BlogService } from '../src/blog/blog.service.ts';
import { BlogEngagementService } from '../src/blog/engagement.service.ts';
import { SettingsService } from '../src/settings/settings.service.ts';
import { HttpError } from '../src/http/errors.ts';
import { parsePageQuery } from '../src/http/pagination.ts';

const PAGE = parsePageQuery({});

function make(overrides: Record<string, unknown[]> = {}) {
  const d = new FakeDb({
    settings: [],
    users: [{ id: 1, name: 'Root', photo: null }, { id: 2, name: 'Ada', photo: null }],
    blog_categories: [
      { id: 1, title: 'Guides', subtitle: null, slug: 'guides' },
      { id: 2, title: 'News', subtitle: null, slug: 'news' },
    ],
    blogs: [],
    blog_comments: [],
    blog_likes: [],
    ...overrides,
  });
  const settings = new SettingsService(d as never);
  return { d, blog: new BlogService(d as never, settings), settings };
}

test('R-07 the blog is on unless a setting turns it off', async () => {
  const { blog, d, settings } = make();
  assert.equal(await blog.isEnabled(), true, 'absent means on');

  d.tables['settings'] = [{ id: 1, type: 'blog_visibility_on_the_home_page', description: '0' }];
  settings.invalidate();
  assert.equal(await blog.isEnabled(), false);
  await assert.rejects(() => blog.assertEnabled(), (e: HttpError) => e.status === 404);
});

test('R-07 instructor access is a separate switch from module visibility', async () => {
  const { blog, d, settings } = make();
  assert.equal(await blog.instructorsAllowed(), true);

  d.tables['settings'] = [{ id: 1, type: 'instructors_blog_permission', description: '0' }];
  settings.invalidate();
  assert.equal(await blog.instructorsAllowed(), false);
  // Turning instructors off must not take the public blog down with it.
  assert.equal(await blog.isEnabled(), true);
  await assert.rejects(() => blog.assertInstructorsAllowed(),
    (e: HttpError) => e.status === 403);
});

test('R-04 admin posts publish, instructor posts wait for approval', async () => {
  const { blog } = make();
  const byAdmin = await blog.create(1, { title: 'Release notes' }, true);
  const byInstructor = await blog.create(2, { title: 'My first post' }, false);

  assert.equal(byAdmin.status, 1);
  assert.equal(byInstructor.status, 0);
  // The id is appended so two identical titles cannot collide.
  assert.equal(byAdmin.slug, 'release-notes-' + byAdmin.id);

  const pending = await blog.pending(PAGE, '/api/admin/blogs/pending');
  assert.deepEqual(pending.data.map((r) => (r as { id: number }).id), [byInstructor.id]);
});

test('R-05 only published posts are public, popular ones first', async () => {
  const { blog } = make();
  await blog.create(1, { title: 'Draft one' }, false);
  await blog.create(1, { title: 'Plain post', category_id: 1 }, true);
  const featured = await blog.create(1, { title: 'Featured', category_id: 1, is_popular: 1 }, true);

  const page = await blog.published({}, PAGE, '/api/blogs');
  const ids = page.data.map((r) => (r as { id: number }).id);
  assert.equal(page.total, 2, 'the pending post is not public');
  assert.equal(ids[0], featured.id, 'is_popular sorts first');

  const decorated = page.data[0] as { category: { slug: string } | null };
  assert.equal(decorated.category?.slug, 'guides');
});

test('R-05 an unknown category slug returns nothing, not everything', async () => {
  const { blog } = make();
  await blog.create(1, { title: 'Visible', category_id: 1 }, true);

  const good = await blog.published({ categorySlug: 'guides' }, PAGE, '/api/blogs');
  assert.equal(good.total, 1);

  const bad = await blog.published({ categorySlug: 'does-not-exist' }, PAGE, '/api/blogs');
  assert.equal(bad.total, 0);
});

test('R-05 bySlug refuses a pending post', async () => {
  const { blog } = make();
  const post = await blog.create(2, { title: 'Waiting' }, false);
  await assert.rejects(() => blog.bySlug(String(post.slug)),
    (e: HttpError) => e.status === 404);

  await blog.setStatus(post.id, 1);
  const live = await blog.bySlug(String(post.slug)) as { id: number };
  assert.equal(live.id, post.id);
});

test('R-04 an instructor only sees and deletes their own posts', async () => {
  const { blog } = make();
  const mine = await blog.create(2, { title: 'Mine' }, false);
  await blog.create(1, { title: 'Someone else' }, true);

  const list = await blog.listFor({ userId: 2 }, PAGE, '/api/manage/blogs');
  assert.deepEqual(list.data.map((r) => (r as { id: number }).id), [mine.id]);

  await assert.rejects(() => blog.remove(mine.id + 1, 2),
    (e: HttpError) => e.status === 404, 'another author is invisible, not forbidden');
});

test('R-04 deleting a post takes its comments and likes with it', async () => {
  const { blog, d } = make();
  const post = await blog.create(1, { title: 'Doomed' }, true);
  const engagement = new BlogEngagementService(d as never);
  await engagement.comment(post.id, 2, 'nice');
  await engagement.toggleLike(post.id, 2);
  assert.equal(d.tables['blog_comments']!.length, 1);
  assert.equal(d.tables['blog_likes']!.length, 1);

  await blog.remove(post.id);
  assert.equal(d.tables['blog_comments']!.length, 0, 'no orphaned comments');
  assert.equal(d.tables['blog_likes']!.length, 0, 'no orphaned likes');
});

test('R-04 category counts only count published posts', async () => {
  const { blog } = make();
  await blog.create(1, { title: 'Live', category_id: 1 }, true);
  await blog.create(2, { title: 'Pending', category_id: 1 }, false);
  await blog.create(1, { title: 'Other', category_id: 2 }, true);

  const counts = await blog.postCountsByCategory();
  assert.equal(counts.get(1), 1);
  assert.equal(counts.get(2), 1);
});
