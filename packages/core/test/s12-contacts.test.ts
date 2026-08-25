import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeDb } from './fake-db.ts';
import { ContactService } from '../src/content/contact.service.ts';
import { SettingsService } from '../src/settings/settings.service.ts';
import { HttpError } from '../src/http/errors.ts';
import type { MailMessage, MailResult } from '../src/mail/mail.service.ts';

/** A mail service that records what it was asked to send. */
function fakeMail(result: MailResult = { sent: true, messageId: 'x' }) {
  const sent: MailMessage[] = [];
  return {
    sent,
    service: { send: async (m: MailMessage) => { sent.push(m); return result; } },
  };
}

function make(mailResult?: MailResult) {
  const d = new FakeDb({
    contacts: [], settings: [{ id: 1, type: 'system_title', description: 'Onyx EduTech' }],
  });
  const mail = fakeMail(mailResult);
  const svc = new ContactService(
    d as never, mail.service as never, new SettingsService(d as never));
  return { d, svc, mail };
}

test('M-06 opening the inbox marks everything read', async () => {
  const { d, svc } = make();
  await svc.submit({ name: 'Ada', email: 'ada@onyx.test', message: 'Do you offer refunds?' });
  assert.equal(d.tables['contacts']![0]!['has_read'], 0);

  const list = await svc.list();
  assert.equal(list.length, 1);
  // Laravel filtered on has_read = null, but rows are written with 0, so the
  // original update matched nothing and the badge never cleared.
  assert.equal(d.tables['contacts']![0]!['has_read'], 1);
});

test('M-06 search covers every field the admin screen offers', async () => {
  const { svc } = make();
  await svc.submit({ name: 'Ada', email: 'ada@onyx.test', phone: '0700900',
    address: 'Leeds', message: 'About the Node course' });
  await svc.submit({ name: 'Sam', email: 'sam@onyx.test', message: 'Invoice question' });

  assert.equal((await svc.list('Leeds')).length, 1, 'address');
  assert.equal((await svc.list('0700900')).length, 1, 'phone');
  assert.equal((await svc.list('Node course')).length, 1, 'message body');
  assert.equal((await svc.list('sam@')).length, 1, 'email');
  assert.equal((await svc.list()).length, 2, 'no search returns everything');
});

test('M-06 a reply is emailed and only then flips the replied flag', async () => {
  const { d, svc, mail } = make();
  await svc.submit({ name: 'Ada', email: 'ada@onyx.test', message: 'Refunds?' });
  const id = d.tables['contacts']![0]!['id'] as number;

  const after = await svc.reply(id, 'Yes, within 14 days.') as Record<string, unknown>;
  assert.equal(mail.sent.length, 1);
  assert.equal(mail.sent[0]!.to, 'ada@onyx.test');
  assert.equal(mail.sent[0]!.text, 'Yes, within 14 days.');
  assert.match(mail.sent[0]!.subject, /Onyx EduTech/, 'the site title names the reply');
  assert.equal(after['replied'], 1);
});

test('M-06 an admin may override the subject', async () => {
  const { d, svc, mail } = make();
  await svc.submit({ name: 'Ada', email: 'ada@onyx.test', message: 'Refunds?' });
  const id = d.tables['contacts']![0]!['id'] as number;

  await svc.reply(id, 'Yes.', '  Your refund request  ');
  assert.equal(mail.sent[0]!.subject, 'Your refund request');
});

test('M-06 a failed send leaves the enquiry unanswered', async () => {
  const { d, svc } = make({ sent: false, error: 'smtp refused' });
  await svc.submit({ name: 'Ada', email: 'ada@onyx.test', message: 'Refunds?' });
  const id = d.tables['contacts']![0]!['id'] as number;

  // Laravel flipped `replied` regardless, so a bounced reply looked answered.
  await assert.rejects(() => svc.reply(id, 'Yes.'), (e: HttpError) => e.status === 502);
  assert.equal(d.tables['contacts']![0]!['replied'], 0);
});

test('M-06 replying to or deleting a missing enquiry is a 404', async () => {
  const { svc } = make();
  await assert.rejects(() => svc.reply(999, 'hi'), (e: HttpError) => e.status === 404);
  await assert.rejects(() => svc.remove(999), (e: HttpError) => e.status === 404);
});

test('M-06 deleting removes the row', async () => {
  const { d, svc } = make();
  await svc.submit({ name: 'Ada', email: 'ada@onyx.test', message: 'Refunds?' });
  const id = d.tables['contacts']![0]!['id'] as number;
  await svc.remove(id);
  assert.equal(d.tables['contacts']!.length, 0);
});
