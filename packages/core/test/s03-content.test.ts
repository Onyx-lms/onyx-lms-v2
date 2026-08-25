import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SeoService } from '../src/catalog/seo.service.ts';
import { InstructorsService } from '../src/catalog/instructors.service.ts';
import { ContactService, NewsletterService } from '../src/content/contact.service.ts';
import { SettingsService } from '../src/settings/settings.service.ts';
import { parsePageQuery } from '../src/http/pagination.ts';
import { HttpError } from '../src/http/errors.ts';
import { seed } from './s03-fixtures.ts';

test('C-05 an entity SEO record beats the route record', async () => {
  const d = seed();
  const seo = new SeoService(d as never, new SettingsService(d as never));
  const meta = await seo.resolve({ route: 'courses', entity: { kind: 'course', id: 10 } });
  assert.equal(meta.title, 'React Basics SEO');
});

test('C-05 a route record is used when there is no entity record', async () => {
  const d = seed();
  const seo = new SeoService(d as never, new SettingsService(d as never));
  assert.equal((await seo.resolve({ route: 'courses' })).title, 'All Courses');
});

test('C-05 missing fields fall back to the global settings', async () => {
  const d = seed();
  const seo = new SeoService(d as never, new SettingsService(d as never));
  const meta = await seo.resolve({ route: 'unknown-route' });
  assert.equal(meta.title, 'Onyx EduTech');
  assert.equal(meta.description, 'Site wide description');
  assert.equal(meta.robots, 'index, follow');
});

test('C-05 an explicit fallback beats site settings but loses to a db record', async () => {
  const d = seed();
  const seo = new SeoService(d as never, new SettingsService(d as never));
  const meta = await seo.resolve({ route: 'nope', fallback: { title: 'Course Title' } });
  assert.equal(meta.title, 'Course Title');
  assert.equal(meta.og.title, 'Course Title');
});

test('C-09 instructor list carries course counts and ratings', async () => {
  const page = await new InstructorsService(seed() as never).list(parsePageQuery({}), '/i');
  assert.equal(page.total, 2);
  const grace = page.data.find((u) => u.name === 'Grace Hopper');
  assert.equal(grace.course_count, 2);
  assert.equal(grace.rating.average, 5);
  assert.deepEqual(grace.skills, ['php']);
});

test('C-09 instructor detail lists only their active courses', async () => {
  const detail = await new InstructorsService(seed() as never).detail(100);
  assert.equal(detail.courses.length, 2);
  assert.deepEqual(detail.educations, []);
});

test('C-09 a student id is not a valid instructor', async () => {
  await assert.rejects(() => new InstructorsService(seed() as never).detail(102),
    (e: HttpError) => e.status === 404);
});

test('C-08 contact submissions are stored unread', async () => {
  const d = seed();
  await new ContactService(d as never).submit({
    name: 'Ada', email: 'Ada@B.TEST', message: 'Hello there' });
  const row = d.tables.contacts[0];
  assert.equal(row.email, 'ada@b.test');
  assert.equal(row.has_read, 0);
  assert.equal(row.replied, 0);
});

test('C-08 subscribing twice does not duplicate the row', async () => {
  const d = seed();
  const svc = new NewsletterService(d as never);
  assert.equal(await svc.subscribe('a@b.test'), true);
  assert.equal(await svc.subscribe('A@B.test'), false);
  assert.equal(d.tables.newsletter_subscribers.length, 1);
});
