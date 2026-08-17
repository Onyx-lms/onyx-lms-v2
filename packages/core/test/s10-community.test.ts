import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeDb } from './fake-db.ts';
import { ForumService } from '../src/community/forum.service.ts';
import { ReviewService, InstructorReviewService } from '../src/community/review.service.ts';
import { newIdentifier, DEFAULT_TEMPLATE } from '../src/certificates/certificate.service.ts';
import { verificationUrl } from '../src/certificates/qr.ts';
import { HttpError } from '../src/http/errors.ts';

const db = () => new FakeDb({
  forums: [], users: [{ id: 12, name: 'Sam' }, { id: 13, name: 'Ada' }],
  reviews: [], like_dislike_reviews: [], instructor_reviews: [],
  enrollments: [{ id: 1, course_id: 5, user_id: 12 }],
});

test('CERT-04 identifiers are 12 alphanumeric characters', () => {
  const id = newIdentifier();
  assert.equal(id.length, 12);
  assert.match(id, /^[A-Za-z0-9]+$/);
  assert.notEqual(newIdentifier(), newIdentifier());
});

test('CERT-03 the verification URL carries only the identifier', () => {
  const url = verificationUrl('https://learn.test/', 'ABC123xyz789');
  assert.equal(url, 'https://learn.test/verify/certificate/ABC123xyz789');
  assert.equal(url.includes('@'), false, 'no email is ever in the link');
});

test('CERT-05 the default template positions every field', () => {
  for (const key of ['name_top', 'course_top', 'date_top', 'qr_top', 'qr_size']) {
    assert.equal(typeof (DEFAULT_TEMPLATE as Record<string, unknown>)[key], 'number');
  }
});

test('FOR-01 a question is a root post and a reply hangs off it', async () => {
  const d = db();
  const forum = new ForumService(d as never);
  const q = await forum.ask(5, 12, 'How do I start?', 'Stuck on lesson one.');
  assert.equal(q.parent_id, 0);
  assert.equal(q.likes, null, 'a new post has no votes, stored as null');

  const reply = await forum.reply(q.id, 13, 'Start with the setup video.');
  assert.equal(reply.parent_id, q.id);

  const thread = await forum.thread(q.id);
  assert.equal(thread.replies.length, 1);
});

test('FOR-02 replying to a reply is refused', async () => {
  const forum = new ForumService(db() as never);
  const q = await forum.ask(5, 12, 'Q', 'body');
  const reply = await forum.reply(q.id, 13, 'answer');
  await assert.rejects(() => forum.reply(reply.id, 12, 'nested'),
    (e: HttpError) => e.status === 404);
});

test('FOR-03 a like is one per user, stored as an id array', async () => {
  const d = db();
  const forum = new ForumService(d as never);
  const q = await forum.ask(5, 12, 'Q', 'body');

  const first = await forum.react(q.id, 13, 'like');
  assert.equal(first.likes, 1);
  assert.equal(first.liked, true);

  // Clicking again from the same account clears the vote, it does not add one.
  assert.equal((await forum.react(q.id, 13, 'like')).likes, 0);

  await forum.react(q.id, 13, 'like');
  await forum.react(q.id, 12, 'like');
  assert.equal((d.tables.forums[0] as Record<string, unknown>).likes, '[13,12]',
    'user ids, not a counter');
});

test('FOR-03 liking clears a dislike from the same user', async () => {
  const d = db();
  const forum = new ForumService(d as never);
  const q = await forum.ask(5, 12, 'Q', 'body');
  await forum.react(q.id, 13, 'dislike');
  const after = await forum.react(q.id, 13, 'like');
  assert.equal(after.likes, 1);
  assert.equal(after.dislikes, 0);
  assert.equal((d.tables.forums[0] as Record<string, unknown>).dislikes, null,
    'an empty array stores as null');
});

test('FOR-02 only the author may edit; an admin may delete anything', async () => {
  const d = db();
  const forum = new ForumService(d as never);
  const q = await forum.ask(5, 12, 'Q', 'body');
  await assert.rejects(() => forum.update(q.id, 13, { description: 'hijack' }),
    (e: HttpError) => e.status === 403);
  await forum.update(q.id, 12, { description: 'edited' });

  await forum.reply(q.id, 13, 'reply');
  await forum.remove(q.id, 999, true);
  assert.equal(d.tables.forums.length, 0, 'deleting a question takes its replies');
});

test('R-01 only an enrolled student may review a course', async () => {
  const reviews = new ReviewService(db() as never);
  await assert.rejects(() => reviews.submit(5, 13, 5, 'great'),
    (e: HttpError) => e.status === 403);
  assert.equal((await reviews.submit(5, 12, 5, 'great')).rating, 5);
});

test('R-01 a second review updates the first rather than adding one', async () => {
  const d = db();
  const reviews = new ReviewService(d as never);
  await reviews.submit(5, 12, 5, 'great');
  await reviews.submit(5, 12, 3, 'on reflection');
  assert.equal(d.tables.reviews.length, 1);
  assert.equal((d.tables.reviews[0] as Record<string, unknown>).rating, 3);
});

test('R-01 a rating outside one to five is refused', async () => {
  const reviews = new ReviewService(db() as never);
  await assert.rejects(() => reviews.submit(5, 12, 0, 'x'), (e: HttpError) => e.status === 422);
  await assert.rejects(() => reviews.submit(5, 12, 6, 'x'), (e: HttpError) => e.status === 422);
});

test('R-01 ratings summarise into an average and a breakdown', async () => {
  const d = db();
  d.tables.enrollments.push({ id: 2, course_id: 5, user_id: 13 });
  const reviews = new ReviewService(d as never);
  await reviews.submit(5, 12, 5, 'great');
  await reviews.submit(5, 13, 4, 'good');
  const out = await reviews.forCourse(5);
  assert.equal(out.summary.average, 4.5);
  assert.equal(out.summary.count, 2);
  assert.equal(out.summary.breakdown['5'], 1);
});

test('R-01 helpful votes are one per user and toggle off', async () => {
  const d = db();
  const reviews = new ReviewService(d as never);
  const review = await reviews.submit(5, 12, 5, 'great');
  assert.deepEqual(await reviews.react(review.id, 13, 'like'), { likes: 1, dislikes: 0 });
  assert.deepEqual(await reviews.react(review.id, 13, 'like'), { likes: 0, dislikes: 0 });
  assert.deepEqual(await reviews.react(review.id, 13, 'dislike'), { likes: 0, dislikes: 1 });
});

test('R-02 an instructor rating stores as text, and self-review is refused', async () => {
  const d = db();
  const svc = new InstructorReviewService(d as never);
  await assert.rejects(() => svc.submit(12, 12, 5, 'me'), (e: HttpError) => e.status === 422);

  await svc.submit(12, 13, 4, 'helpful');
  // instructor_reviews.rating is varchar; reviews.rating is integer.
  assert.equal(typeof (d.tables.instructor_reviews[0] as Record<string, unknown>).rating, 'string');
  assert.equal((await svc.forInstructor(12)).summary.average, 4);
});
