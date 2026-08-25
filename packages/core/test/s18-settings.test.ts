import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeDb } from './fake-db.ts';
import { SettingsAdminService, SETTING_GROUPS, SECRET_KEYS }
  from '../src/admin/settings-admin.service.ts';
import { PlatformAdminService, KEPT } from '../src/admin/platform-admin.service.ts';
import { SettingsService } from '../src/settings/settings.service.ts';
import { phpJsonEncode, phpJsonDecode } from '../src/json/php-json.ts';
import { HttpError } from '../src/http/errors.ts';

function make() {
  const d = new FakeDb({
    settings: [
      { id: 1, type: 'system_title', description: 'Onyx EduTech' },
      { id: 2, type: 'smtp_pass', description: 'real-secret' },
      { id: 3, type: 'language', description: 'English' },
    ],
    payment_gateways: [
      { id: 1, identifier: 'stripe', title: 'Stripe', status: 0, test_mode: 1, is_addon: 0,
        keys: phpJsonEncode({ publishable_key: 'pk_live_1', secret_key: 'sk_live_1' }) },
    ],
    languages: [
      { id: 1, name: 'English', direction: 'ltr' },
      { id: 2, name: 'Arabic', direction: 'rtl' },
    ],
    language_phrases: [
      { id: 1, language_id: 1, phrase: 'Home', translated: 'Home' },
      { id: 2, language_id: 1, phrase: 'Courses', translated: 'Courses' },
      { id: 3, language_id: 2, phrase: 'Home', translated: 'ar-home' },
    ],
  });
  const settings = new SettingsService(d as never);
  return { d, settings, admin: new SettingsAdminService(d as never, settings),
           platform: new PlatformAdminService(d as never) };
}

test('SET-01 a secret is never read back, only reported as set', async () => {
  const { admin } = make();
  const group = await admin.group('system');
  assert.equal(group['system_title'], 'Onyx EduTech');
  // The Laravel screens rendered smtp_pass straight into the form's value.
  assert.equal('smtp_pass' in group, false);
  assert.equal(group['smtp_pass_set'], true);
});

test('SET-01 an unknown key is refused rather than quietly stored', async () => {
  const { admin, d } = make();
  await assert.rejects(() => admin.saveGroup('system', { not_a_setting: 'x' }),
    (e: HttpError) => e.status === 422 && /not_a_setting/.test(e.message));
  // A typo in a form field name used to create a setting nobody ever reads.
  assert.equal(d.tables['settings']!.some((s) => s['type'] === 'not_a_setting'), false);
});

test('SET-01 a key from another screen is refused', async () => {
  const { admin } = make();
  // zoom_client_id belongs to the API screen, not the system one.
  await assert.rejects(() => admin.saveGroup('system', { zoom_client_id: 'x' }),
    (e: HttpError) => e.status === 422);
  await admin.saveGroup('api', { zoom_client_id: 'ok' });
});

test('SET-05 a blank secret leaves the stored one alone', async () => {
  const { admin, settings } = make();
  await admin.saveGroup('api', { smtp_pass: '' });
  settings.invalidate();
  assert.equal(await settings.get('smtp_pass'), 'real-secret', 'an untouched field is blank');

  await admin.saveGroup('api', { smtp_pass: 'rotated' });
  settings.invalidate();
  assert.equal(await settings.get('smtp_pass'), 'rotated');
});

test('SET-01 every declared key belongs to exactly one screen', () => {
  const seen = new Map<string, string>();
  for (const [group, keys] of Object.entries(SETTING_GROUPS)) {
    for (const key of keys) {
      const other = seen.get(key);
      assert.equal(other, undefined,
        key + ' is on both ' + other + ' and ' + group + '; saving one would fight the other');
      seen.set(key, group);
    }
  }
  // And no readable key is also a declared secret.
  for (const key of seen.keys()) assert.equal(SECRET_KEYS.has(key), false, key);
});

test('SET-03 gateway credentials are masked on read and preserved on write', async () => {
  const { platform, d } = make();
  const [before] = await platform.gateways();
  assert.equal((before!.keys as Record<string, unknown>)['publishable_key'], 'pk_live_1');
  // Anything that looks like a secret is reduced to a marker.
  assert.equal((before!.keys as Record<string, unknown>)['secret_key'], KEPT);

  await platform.saveGateway(1, {
    status: 1, keys: { publishable_key: 'pk_live_2', secret_key: KEPT },
  });
  const stored = phpJsonDecode<Record<string, string>>(
    d.tables['payment_gateways']![0]!['keys'] as string, {});
  assert.equal(stored['publishable_key'], 'pk_live_2');
  assert.equal(stored['secret_key'], 'sk_live_1', 'the untouched secret survives');
  assert.equal(d.tables['payment_gateways']![0]!['status'], 1);
});

test('SET-03 a genuinely blank credential does clear it', async () => {
  const { platform, d } = make();
  await platform.saveGateway(1, { keys: { secret_key: '' } });
  const stored = phpJsonDecode<Record<string, string>>(
    d.tables['payment_gateways']![0]!['keys'] as string, {});
  assert.equal(stored['secret_key'], '');
});

test('SET-06 a new language starts with the full phrase list', async () => {
  const { platform, d } = make();
  const added = await platform.addLanguage('  Spanish  ', 'ltr') as Record<string, unknown>;
  assert.equal(added['name'], 'Spanish', 'trimmed');
  // Two distinct phrases exist across the fixture; both are seeded, once each.
  assert.equal(added['phrase_count'], 2);
  assert.equal(d.tables['language_phrases']!.filter(
    (p) => p['language_id'] === added['id']).length, 2);

  await assert.rejects(() => platform.addLanguage('Spanish', 'ltr'),
    (e: HttpError) => /already exists/.test(e.message));
});

test('SET-06 the site language cannot be deleted out from under itself', async () => {
  const { platform, d } = make();
  await assert.rejects(() => platform.removeLanguage(1, 'English'),
    (e: HttpError) => e.status === 422);

  // The seeded row is 'English' but settings.language is 'english'. An exact
  // match let the delete through and took the language and its phrases with it.
  await assert.rejects(() => platform.removeLanguage(1, 'english'),
    (e: HttpError) => e.status === 422, 'the comparison must ignore case');
  await assert.rejects(() => platform.removeLanguage(1, '  ENGLISH  '),
    (e: HttpError) => e.status === 422, 'and surrounding space');

  await platform.removeLanguage(2, 'English');
  assert.equal(d.tables['languages']!.some((l) => l['id'] === 2), false);
  assert.equal(d.tables['language_phrases']!.some((p) => p['language_id'] === 2), false,
    'its phrases go with it');
});

test('SET-06 a phrase from another language cannot be rewritten', async () => {
  const { platform, d } = make();
  // Phrase 3 belongs to Arabic; saving it under English must be ignored.
  await platform.savePhrases(1, { 3: 'hijacked', 1: 'Start' });
  assert.equal(d.tables['language_phrases']!.find((p) => p['id'] === 3)!['translated'],
    'ar-home');
  assert.equal(d.tables['language_phrases']!.find((p) => p['id'] === 1)!['translated'], 'Start');
});

test('SET-06 export and import round-trip a language', async () => {
  const { platform } = make();
  const dump = await platform.exportLanguage(1);
  assert.deepEqual(dump.phrases, { Home: 'Home', Courses: 'Courses' });

  const result = await platform.importLanguage(1, { Home: 'Start', Pricing: 'Pricing' });
  assert.deepEqual(result, { updated: 1, added: 1 });
  const again = await platform.exportLanguage(1);
  assert.deepEqual(again.phrases, { Home: 'Start', Courses: 'Courses', Pricing: 'Pricing' });

  await assert.rejects(() => platform.exportLanguage(404), (e: HttpError) => e.status === 404);
});
