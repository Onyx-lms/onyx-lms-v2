import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeDb } from './fake-db.ts';
import { CampaignService } from '../src/admin/campaign.service.ts';
import { SettingsService } from '../src/settings/settings.service.ts';
import { HttpError } from '../src/http/errors.ts';
import type { MailMessage } from '../src/mail/mail.service.ts';

/** Mail that records what it was asked to send, and can fail chosen addresses. */
function fakeMail(failFor: string[] = []) {
  const sent: MailMessage[] = [];
  return {
    sent,
    service: {
      send: async (m: MailMessage) => {
        sent.push(m);
        return failFor.includes(m.to) ? { sent: false, error: 'refused' } : { sent: true };
      },
    },
  };
}

function make(opts: { failFor?: string[]; settings?: Record<string, unknown>[] } = {}) {
  const d = new FakeDb({
    settings: opts.settings ?? [],
    users: [
      { id: 1, name: 'Root', email: 'root@onyx.test', role: 'admin', status: 1 },
      { id: 2, name: 'Sid', email: 'sid@onyx.test', role: 'student', status: 1 },
      { id: 3, name: 'Tam', email: 'tam@onyx.test', role: 'instructor', status: 1 },
    ],
    newsletters: [], newsletter_subscribers: [], builder_pages: [], applications: [],
  });
  const settings = new SettingsService(d as never);
  const mail = fakeMail(opts.failFor);
  return { d, mail, svc: new CampaignService(d as never, settings, mail.service as never) };
}

test('SET-07 a campaign sends to the subscriber list, in batches', async () => {
  const t = make();
  t.d.tables['newsletter_subscribers']!.push(
    { id: 1, email: 'a@onyx.test' }, { id: 2, email: 'b@onyx.test' },
    { id: 3, email: 'A@ONYX.TEST' });
  const c = await t.svc.createCampaign('Autumn update', '<p>News</p>') as Record<string, unknown>;

  const result = await t.svc.send(c['id'] as number, { batchSize: 2 });
  // The duplicate differs only by case, so it must not be mailed twice.
  assert.deepEqual({ recipients: result.recipients, sent: result.sent, failed: result.failed },
    { recipients: 2, sent: 2, failed: 0 });
  assert.equal(t.mail.sent[0]!.subject, 'Autumn update');
  assert.equal(t.mail.sent[0]!.html, '<p>News</p>');
});

test('SET-07 registered users can be included, and are merged with subscribers', async () => {
  const t = make();
  t.d.tables['newsletter_subscribers']!.push({ id: 1, email: 'sid@onyx.test' });
  const c = await t.svc.createCampaign('All hands', 'body') as Record<string, unknown>;

  const result = await t.svc.send(c['id'] as number, { includeUsers: true });
  // sid is both a subscriber and a user; three addresses in total, not four.
  assert.equal(result.recipients, 3);
  assert.equal(result.sent, 3);
});

test('SET-07 one bad address does not abandon the run', async () => {
  const t = make({ failFor: ['b@onyx.test'] });
  t.d.tables['newsletter_subscribers']!.push(
    { id: 1, email: 'a@onyx.test' }, { id: 2, email: 'b@onyx.test' },
    { id: 3, email: 'c@onyx.test' });
  const c = await t.svc.createCampaign('Update', 'body') as Record<string, unknown>;

  const result = await t.svc.send(c['id'] as number, { batchSize: 1 });
  // The original looped and stopped at the first failure.
  assert.equal(result.sent, 2);
  assert.equal(result.failed, 1);
  assert.deepEqual(result.failed_addresses, ['b@onyx.test']);
});

test('SET-07 sending to nobody is refused, and a missing campaign is a 404', async () => {
  const t = make();
  const c = await t.svc.createCampaign('Nobody', 'body') as Record<string, unknown>;
  await assert.rejects(() => t.svc.send(c['id'] as number),
    (e: HttpError) => e.status === 422 && /nobody/.test(e.message));
  await assert.rejects(() => t.svc.send(999), (e: HttpError) => e.status === 404);
});

test('SET-08 a permanent page cannot be deleted', async () => {
  const t = make();
  const made = await t.svc.savePage({ identifier: 'home', name: 'Home', html: '<h1>Hi</h1>' });
  assert.equal(made.identifier, 'home');

  await t.svc.removePage(made.id);
  assert.equal(t.d.tables['builder_pages']!.length, 0);

  // A permanent page is part of the shipped theme, not user content.
  t.d.tables['builder_pages']!.push({
    id: 99, identifier: 'shipped', name: 'Shipped', html: '', is_permanent: 1, status: 1 });
  await assert.rejects(() => t.svc.removePage(99), (e: HttpError) => e.status === 422);
});

test('SET-08 saving with an id updates rather than duplicating', async () => {
  const t = make();
  const made = await t.svc.savePage({ identifier: 'about', name: 'About', html: 'v1' });
  const again = await t.svc.savePage({
    id: made.id, identifier: 'about', name: 'About us', html: 'v2' });
  assert.equal(again.id, made.id);
  assert.equal(again.name, 'About us');
  assert.equal(t.d.tables['builder_pages']!.length, 1);
});

test('SET-09 applications can be switched off entirely', async () => {
  const off = make({ settings: [{ id: 1, type: 'instructor_application', description: '0' }] });
  assert.equal(await off.svc.applicationsOpen(), false);
  await assert.rejects(
    () => off.svc.apply(2, { phone: '1', description: 'd', document: 'f.pdf' }),
    (e: HttpError) => e.status === 403);

  const on = make();
  assert.equal(await on.svc.applicationsOpen(), true, 'absent means open');
});

test('SET-09 you cannot apply twice while pending, or if you already teach', async () => {
  const t = make();
  await t.svc.apply(2, { phone: '0700', description: 'I teach Node', document: 'a.pdf' });
  await assert.rejects(
    () => t.svc.apply(2, { phone: '0700', description: 'again', document: 'b.pdf' }),
    (e: HttpError) => /in process/.test(e.message));

  // An instructor has nothing to apply for.
  await assert.rejects(
    () => t.svc.apply(3, { phone: '0700', description: 'x', document: 'c.pdf' }),
    (e: HttpError) => /already publish/.test(e.message));
  await assert.rejects(
    () => t.svc.apply(404, { phone: '1', description: 'x', document: 'd.pdf' }),
    (e: HttpError) => e.status === 404);
});

test('SET-09 approving promotes the applicant, once', async () => {
  const t = make();
  const made = await t.svc.apply(2, {
    phone: '0700', description: 'I teach Node', document: 'a.pdf' }) as Record<string, unknown>;
  const id = made['id'] as number;

  const result = await t.svc.approve(id);
  assert.deepEqual(result, { id, user_id: 2, role: 'instructor' });
  assert.equal(t.d.tables['users']!.find((u) => u['id'] === 2)!['role'], 'instructor');

  await assert.rejects(() => t.svc.approve(id),
    (e: HttpError) => /already approved/.test(e.message));
  await assert.rejects(() => t.svc.approve(999), (e: HttpError) => e.status === 404);
});

test('SET-09 a rejected applicant may apply again', async () => {
  const t = make();
  const first = await t.svc.apply(2, {
    phone: '0700', description: 'try one', document: 'a.pdf' }) as Record<string, unknown>;
  await t.svc.removeApplication(first['id'] as number);

  // Laravel refused any second application forever, even after a rejection.
  const second = await t.svc.apply(2, {
    phone: '0700', description: 'try two', document: 'b.pdf' });
  assert.ok(second);
  assert.equal((await t.svc.applications()).length, 1);
});
