import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeDb } from './fake-db.ts';
import { MailService } from '../src/mail/mail.service.ts';
import { verifyEmailTemplate, resetPasswordTemplate } from '../src/mail/templates.ts';
import { detectFileType } from '../src/media/media.service.ts';
import { SettingsService } from '../src/settings/settings.service.ts';

const settingsWith = (rows: Record<string, string>) => new SettingsService(
  new FakeDb({
    settings: Object.entries(rows).map(([type, description], i) => ({ id: i + 1, type, description })),
  }) as never);

test('P-06 mail is skipped, not thrown, when SMTP is unconfigured', async () => {
  const mail = new MailService(settingsWith({ protocol: 'mail' }));
  const result = await mail.send({ to: 'a@b.test', subject: 'x', html: '<p>x</p>' });
  assert.equal(result.sent, false);
  assert.equal(result.skipped, 'not-configured');
});

test('P-06 an unreachable SMTP host fails soft rather than throwing', async () => {
  const mail = new MailService(settingsWith({
    protocol: 'smtp', smtp_host: '127.0.0.1', smtp_port: '1', smtp_from_email: 'a@b.test',
  }));
  const result = await mail.send({ to: 'x@y.test', subject: 'x', html: '<p>x</p>' });
  // A dead mail server must not roll back a completed registration.
  assert.equal(result.sent, false);
  assert.ok(result.error, 'the failure is reported, not swallowed silently');
});

test('P-06 verification email carries the action url in both button and text', () => {
  const tpl = verifyEmailTemplate({ siteTitle: 'EZiL Certify', actionUrl: 'https://x.test/v?token=abc' });
  assert.match(tpl.subject, /Verify/i);
  assert.ok(tpl.html.includes('https://x.test/v?token=abc'));
  assert.ok(tpl.html.includes('EZiL Certify'));
});

test('P-06 templates escape site titles rather than injecting markup', () => {
  const tpl = resetPasswordTemplate({
    siteTitle: '<script>alert(1)</script>', actionUrl: 'https://x.test/r',
  });
  assert.ok(!tpl.html.includes('<script>'), 'title must be escaped');
  assert.ok(tpl.html.includes('&lt;script&gt;'));
});

test('P-05 file type detection covers image, video, document and other', () => {
  assert.equal(detectFileType('thumb.PNG'), 'image');
  assert.equal(detectFileType('lesson.mp4'), 'video');
  assert.equal(detectFileType('notes.pdf'), 'document');
  assert.equal(detectFileType('archive.bin'), 'other');
  assert.equal(detectFileType('noextension'), 'other');
});
