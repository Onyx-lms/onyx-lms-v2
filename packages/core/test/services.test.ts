import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeDb } from './fake-db.ts';
import { SettingsService } from '../src/settings/settings.service.ts';
import { I18nService } from '../src/i18n/i18n.service.ts';
import { StorageService } from '../src/storage/storage.service.ts';

// Fixtures mirror the real rows in the Laravel database.
const fixtures = () => new FakeDb({
  settings: [
    { id: 1, type: 'system_title', description: 'EZiL Certify' },
    { id: 2, type: 'language', description: 'english' },
    { id: 3, type: 'theme', description: 'classic' },
    { id: 4, type: 'currency_position', description: 'left' },
    { id: 5, type: 'smtp_pass', description: 'super-secret' },
    { id: 6, type: 'student_email_verification', description: '0' },
  ],
  languages: [
    { id: 1, name: 'English', direction: 'ltr' },
    { id: 2, name: 'Arabic', direction: 'rtl' },
  ],
  language_phrases: [
    { id: 1, language_id: 1, phrase: 'Dashboard', translated: 'Dashboard' },
    { id: 2, language_id: 2, phrase: 'Dashboard', translated: 'لوحة القيادة' },
    { id: 3, language_id: 1, phrase: 'Hello ____ and ____', translated: 'Hello ____ and ____' },
  ],
});

test('P-01 settings.get returns the stored value', async () => {
  const s = new SettingsService(fixtures() as never);
  assert.equal(await s.get('system_title'), 'EZiL Certify');
});

test('P-01 a missing key returns null (PHP returned false)', async () => {
  const s = new SettingsService(fixtures() as never);
  assert.equal(await s.get('does_not_exist'), null);
});

test('P-01 second read is served from cache, not the database', async () => {
  const db = fixtures();
  const s = new SettingsService(db as never);
  await s.get('system_title');
  db.tables['settings'] = []; // if it hits the db again this returns null
  assert.equal(await s.get('system_title'), 'EZiL Certify');
});

test('P-01 writing a setting invalidates the cached value', async () => {
  const s = new SettingsService(fixtures() as never);
  await s.get('system_title');
  await s.set('system_title', 'Onyx LMS');
  assert.equal(await s.get('system_title'), 'Onyx LMS');
});

test('P-02 theme falls back to default when the configured theme has no views', async () => {
  // Live DB says theme=classic but only the default view tree exists.
  const s = new SettingsService(fixtures() as never);
  assert.equal(await s.theme(), 'default');
});

test('P-07 secrets are excluded from the public settings payload', async () => {
  const s = new SettingsService(fixtures() as never);
  const pub = await s.publicSettings();
  assert.equal(pub['system_title'], 'EZiL Certify');
  assert.ok(!('smtp_pass' in pub), 'smtp_pass must never reach the browser');
});

test('P-03 get_phrase returns the translation for the active language', async () => {
  const i18n = new I18nService(fixtures() as never);
  assert.equal(await i18n.phrase('Dashboard', 'english'), 'Dashboard');
  assert.equal(await i18n.phrase('Dashboard', 'Arabic'), 'لوحة القيادة');
});

test('P-03 language name match is case-insensitive like the SQL LIKE', async () => {
  const i18n = new I18nService(fixtures() as never);
  assert.equal(await i18n.phrase('Dashboard', 'ARABIC'), 'لوحة القيادة');
});

test('P-03 an unknown language returns the key untouched', async () => {
  const i18n = new I18nService(fixtures() as never);
  assert.equal(await i18n.phrase('Dashboard', 'klingon'), 'Dashboard');
});

test('P-03 placeholders are replaced one occurrence at a time, in order', async () => {
  const i18n = new I18nService(fixtures() as never);
  assert.equal(await i18n.phrase('Hello ____ and ____', 'english', ['Ada', 'Grace']),
    'Hello Ada and Grace');
});

test('P-03 a missing phrase is auto-registered against English', async () => {
  const db = fixtures();
  const i18n = new I18nService(db as never, { autoRegisterMissing: true });
  assert.equal(await i18n.phrase('Brand New Key', 'english'), 'Brand New Key');
  const added = db.tables['language_phrases']!.some((r) => r['phrase'] === 'Brand New Key');
  assert.ok(added, 'unknown key should be recorded for translators');
});

test('P-03 auto-registration can be turned off', async () => {
  const db = fixtures();
  const i18n = new I18nService(db as never, { autoRegisterMissing: false });
  await i18n.phrase('Another Key', 'english');
  const added = db.tables['language_phrases']!.some((r) => r['phrase'] === 'Another Key');
  assert.ok(!added);
});

test('P-03 rtl direction is reported for Arabic', async () => {
  const i18n = new I18nService(fixtures() as never);
  assert.equal(await i18n.direction('Arabic'), 'rtl');
  assert.equal(await i18n.direction('English'), 'ltr');
});

test('P-04 legacy Laravel paths normalise without rewriting the database', () => {
  // H-02 requires stored paths to keep resolving with zero row updates.
  assert.equal(StorageService.toKey('uploads/thumbnails/a.png'), 'thumbnails/a.png');
  assert.equal(StorageService.toKey('/public/uploads/thumbnails/a.png'), 'thumbnails/a.png');
  assert.equal(StorageService.toKey('thumbnails/a.png'), 'thumbnails/a.png');
  assert.equal(StorageService.toKey('https://old.example.com/uploads/x/y.jpg'), 'x/y.jpg');
  const BS = String.fromCharCode(92);
  assert.equal(StorageService.toKey('uploads' + BS + 'windows' + BS + 'path.png'), 'windows/path.png');
});

test('P-04 publicUrl uses the configured base and never mutates the stored path', () => {
  const svc = new StorageService({} as never, { publicBase: 'https://cdn.test/uploads' });
  assert.equal(svc.publicUrl('uploads/thumbnails/a.png'),
    'https://cdn.test/uploads/thumbnails/a.png');
  assert.equal(svc.publicUrl(null), null);
  assert.equal(svc.publicUrl(''), null);
});
