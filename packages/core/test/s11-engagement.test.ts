import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeDb } from './fake-db.ts';
import { BlogEngagementService } from '../src/blog/engagement.service.ts';
import { HttpError } from '../src/http/errors.ts';

const users = [{ id: 1, name: 'Root', photo: null, role: 'admin' },
               { id: 2, name: 'Ada', photo: null, role: 'student' },
               { id: 3, name: 'Sam', photo: null, role: 'student' }];

const engagementDb = () => new FakeDb({
  users: [...users],
  blogs: [{ id: 7, title: 'Live post', status: 1 }, { id: 8, title: 'Pending', status: 0 }],
  blog_comments: [], blog_likes: [],
});

test('R-06 comments nest exactly one level deep', async () => {
  const d = engagementDb();
  const svc = new BlogEngagementService(d as never);

  const top = await svc.comment(7, 2, 'Great post') as { id: number };
  const reply = await svc.comment(7, 3, 'Agreed', top.id) as { id: number };

  // A reply to a reply would produce a tree the views cannot render.
  await assert.rejects(() => svc.comment(7, 2, 'nested deeper', reply.id),
    (e: HttpError) => e.status === 422);

  const thread = await svc.comments(7);
  assert.equal(thread.length, 1, 'only roots are top level');
  assert.equal(thread[0]!.replies.length, 1);
  assert.equal(thread[0]!.user?.name, 'Ada');
});

test('R-06 you cannot comment on a post that is not published', async () => {
  const svc = new BlogEngagementService(engagementDb() as never);
  await assert.rejects(() => svc.comment(8, 2, 'sneaking in'),
    (e: HttpError) => e.status === 404);
  await assert.rejects(() => svc.comment(999, 2, 'no such post'),
    (e: HttpError) => e.status === 404);
});

test('R-06 an unapproved comment is visible only to its author', async () => {
  const d = engagementDb();
  const svc = new BlogEngagementService(d as never);
  const c = await svc.comment(7, 2, 'held for review') as { id: number };
  d.tables['blog_comments']![0]!['check'] = 0;

  assert.equal((await svc.comments(7)).length, 0, 'hidden from everyone else');
  assert.equal((await svc.comments(7, 3)).length, 0);
  const own = await svc.comments(7, 2);
  assert.equal(own.length, 1, 'the author still sees their own');
  assert.equal(own[0]!.id, c.id);
});

test('R-06 only the author edits, author or admin deletes', async () => {
  const d = engagementDb();
  const svc = new BlogEngagementService(d as never);
  const c = await svc.comment(7, 2, 'mine') as { id: number };

  await assert.rejects(() => svc.updateComment(c.id, 3, 'hijacked'),
    (e: HttpError) => e.status === 403);
  await assert.rejects(() => svc.removeComment(c.id, 3, false),
    (e: HttpError) => e.status === 403);

  await svc.updateComment(c.id, 2, 'edited');
  assert.equal(d.tables['blog_comments']![0]!['comment'], 'edited');
  await svc.removeComment(c.id, 999, true);
  assert.equal(d.tables['blog_comments']!.length, 0, 'an admin may remove anything');
});

test('R-06 deleting a comment takes its replies', async () => {
  const d = engagementDb();
  const svc = new BlogEngagementService(d as never);
  const top = await svc.comment(7, 2, 'root') as { id: number };
  await svc.comment(7, 3, 'reply', top.id);

  await svc.removeComment(top.id, 2, false);
  assert.equal(d.tables['blog_comments']!.length, 0, 'no orphaned replies');
});

test('R-06 a like is one per person and toggles off', async () => {
  const d = engagementDb();
  const svc = new BlogEngagementService(d as never);

  assert.equal(await svc.toggleLike(7, 2), true);
  assert.deepEqual(await svc.likeState(7, 2), { count: 1, liked: true });
  assert.deepEqual(await svc.likeState(7, 3), { count: 1, liked: false });

  assert.equal(await svc.toggleLike(7, 2), false, 'liking again removes it');
  assert.deepEqual(await svc.likeState(7, 2), { count: 0, liked: false });

  await svc.toggleLike(7, 2);
  await svc.toggleLike(7, 3);
  assert.equal(d.tables['blog_likes']!.length, 2, 'two people, two rows');
  assert.deepEqual(await svc.likeState(7), { count: 2, liked: false });
});

test('R-06 comment counts skip unapproved rows', async () => {
  const d = engagementDb();
  const svc = new BlogEngagementService(d as never);
  await svc.comment(7, 2, 'one');
  await svc.comment(7, 3, 'two');
  d.tables['blog_comments']![1]!['check'] = 0;

  const counts = await svc.commentCounts([7, 8]);
  assert.equal(counts.get(7), 1);
  assert.equal(counts.get(8), undefined);
  assert.equal((await svc.commentCounts([])).size, 0);
});
