import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeDb } from './fake-db.ts';
import { KnowledgeBaseService } from '../src/blog/knowledge-base.service.ts';
import { TestimonialService } from '../src/community/testimonial.service.ts';
import { HttpError } from '../src/http/errors.ts';

const kbDb = () => new FakeDb({
  knowledge_bases: [], knowledge_base_topicks: [],
});

test('R-08 topics carry their article counts', async () => {
  const svc = new KnowledgeBaseService(kbDb() as never);
  const started = await svc.createTopic('Getting started') as { id: number };
  const billing = await svc.createTopic('Billing') as { id: number };
  await svc.createArticle(started.id, 'How to enrol', 'Click enrol.');
  await svc.createArticle(started.id, 'Reset a password', 'Use the link.');

  const topics = await svc.topics();
  const byId = new Map(topics.map((t) => [t.id, t.article_count]));
  assert.equal(byId.get(started.id), 2);
  assert.equal(byId.get(billing.id), 0, 'an empty topic still lists, with zero');
});

test('R-08 an article knows its topic and its siblings', async () => {
  const svc = new KnowledgeBaseService(kbDb() as never);
  const topic = await svc.createTopic('Getting started') as { id: number };
  const first = await svc.createArticle(topic.id, 'How to enrol', 'Click enrol.') as { id: number };
  await svc.createArticle(topic.id, 'Reset a password', 'Use the link.');

  const article = await svc.article(first.id);
  assert.equal(article.topic?.title, 'Getting started');
  assert.equal(article.siblings.length, 2, 'siblings include the article itself');
  assert.equal(article.description, 'Click enrol.');
});

test('R-08 an article cannot hang off a topic that does not exist', async () => {
  const svc = new KnowledgeBaseService(kbDb() as never);
  await assert.rejects(() => svc.createArticle(404, 'Orphan', 'body'),
    (e: HttpError) => e.status === 404);
});

test('R-08 deleting a topic deletes its articles', async () => {
  const d = kbDb();
  const svc = new KnowledgeBaseService(d as never);
  const topic = await svc.createTopic('Doomed') as { id: number };
  await svc.createArticle(topic.id, 'Article', 'body');

  await svc.removeTopic(topic.id);
  assert.equal(d.tables['knowledge_bases']!.length, 0);
  assert.equal(d.tables['knowledge_base_topicks']!.length, 0, 'no orphaned articles');
});

test('R-08 search matches titles and bodies, and an empty term matches nothing', async () => {
  const svc = new KnowledgeBaseService(kbDb() as never);
  const topic = await svc.createTopic('Help') as { id: number };
  await svc.createArticle(topic.id, 'Refund policy', 'Ask within 14 days.');
  await svc.createArticle(topic.id, 'Certificates', 'Download from your profile.');

  assert.equal((await svc.search('refund')).length, 1, 'matches the title');
  assert.equal((await svc.search('profile')).length, 1, 'matches the body');
  assert.equal((await svc.search('   ')).length, 0, 'a blank search is not "everything"');
  assert.equal((await svc.search('nothing here')).length, 0);
});

test('R-08 missing topics and articles are 404, not empty pages', async () => {
  const svc = new KnowledgeBaseService(kbDb() as never);
  await assert.rejects(() => svc.topic(1), (e: HttpError) => e.status === 404);
  await assert.rejects(() => svc.article(1), (e: HttpError) => e.status === 404);
});

test('R-03 a testimonial is stored against a real user and read back as a number', async () => {
  const d = new FakeDb({
    users: [{ id: 2, name: 'Ada', photo: null, role: 'student' }],
    user_reviews: [],
  });
  const svc = new TestimonialService(d as never);

  await assert.rejects(() => svc.create({ user_id: 999, rating: 5, review: 'ghost' }),
    (e: HttpError) => e.status === 422);

  const created = await svc.create({ user_id: 2, rating: 5, review: '  Great platform.  ' });
  // rating is a varchar column, as with instructor_reviews.
  assert.equal(d.tables['user_reviews']![0]!['rating'], '5');
  assert.equal(created!['rating'], 5, 'reads back as a number');
  assert.equal(created!['review'], 'Great platform.', 'trimmed');
  assert.equal((created!['user'] as { name: string }).name, 'Ada');
});

test('R-03 the home page list is newest first and capped', async () => {
  const d = new FakeDb({
    users: [{ id: 2, name: 'Ada', photo: null, role: 'student' }],
    user_reviews: [],
  });
  const svc = new TestimonialService(d as never);
  for (let i = 1; i <= 8; i++) {
    await svc.create({ user_id: 2, rating: 5, review: 'review ' + i });
  }

  const shown = await svc.published(6);
  assert.equal(shown.length, 6);
  assert.equal(shown[0]!['review'], 'review 8', 'newest first');
  assert.equal((await svc.all()).length, 8, 'the admin screen sees them all');
});

test('R-03 update and delete work, and a missing one is 404', async () => {
  const d = new FakeDb({
    users: [{ id: 2, name: 'Ada', photo: null, role: 'student' }],
    user_reviews: [],
  });
  const svc = new TestimonialService(d as never);
  const t = await svc.create({ user_id: 2, rating: 3, review: 'ok' });
  const id = t!['id'] as number;

  const updated = await svc.update(id, { rating: 5 });
  assert.equal(updated!['rating'], 5);
  assert.equal(updated!['review'], 'ok', 'untouched fields stay');

  await svc.remove(id);
  await assert.rejects(() => svc.find(id), (e: HttpError) => e.status === 404);
  await assert.rejects(() => svc.remove(id), (e: HttpError) => e.status === 404);
});
