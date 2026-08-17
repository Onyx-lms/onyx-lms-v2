import { test } from 'node:test';
import assert from 'node:assert/strict';
import { phpJsonEncode, phpJsonDecode, isPhpJsonStable } from '../src/json/php-json.ts';

// F-05 acceptance: PHP-written JSON read by Node and rewritten must produce
// byte-identical text.
//
// Expected values are assembled from BS at runtime rather than written as
// escape sequences, so what is asserted is unambiguously the byte PHP emits.
const BS = String.fromCharCode(92);

test('escapes forward slashes the way PHP json_encode does', () => {
  const value = { url: 'https://a.test/x/y' };
  const expected = '{"url":"https:' + BS + '/' + BS + '/a.test' + BS + '/x' + BS + '/y"}';
  assert.equal(phpJsonEncode(value), expected);
  // Plain JSON.stringify would NOT match -- guard against someone simplifying.
  assert.notEqual(JSON.stringify(value), phpJsonEncode(value));
});

test('escapes non-ASCII as a unicode escape like PHP', () => {
  assert.equal(phpJsonEncode({ t: 'café' }), '{"t":"caf' + BS + 'u00e9"}');
  assert.equal(phpJsonEncode(['日本']), '["' + BS + 'u65e5' + BS + 'u672c"]');
});

test('emits surrogate pairs per UTF-16 code unit', () => {
  const grinning = String.fromCodePoint(0x1f600);
  assert.equal(phpJsonEncode(grinning), '"' + BS + 'ud83d' + BS + 'ude00"');
});

test('round-trips real drip_content_settings byte-identically', () => {
  const fromPhp = '{"lesson_completion_role":"percentage","minimum_percentage":80}';
  assert.equal(phpJsonEncode(phpJsonDecode(fromPhp, null)), fromPhp);
  assert.ok(isPhpJsonStable(fromPhp));
});

test('round-trips a watched_counter tick array byte-identically', () => {
  const fromPhp = '["0","5","10","15"]';
  assert.equal(phpJsonEncode(phpJsonDecode(fromPhp, null)), fromPhp);
});

test('round-trips a permissions allow-list byte-identically', () => {
  const fromPhp = '["admin.dashboard","admin.courses","admin.certificates.index"]';
  assert.equal(phpJsonEncode(phpJsonDecode(fromPhp, null)), fromPhp);
});

test('round-trips a url-bearing value byte-identically', () => {
  // live_classes.additional_info stores Zoom start_url -- the escaped-solidus
  // case that plain JSON.stringify silently breaks.
  const fromPhp = '{"start_url":"https:' + BS + '/' + BS + '/zoom.us' + BS + '/s' + BS + '/123"}';
  assert.equal(phpJsonEncode(phpJsonDecode(fromPhp, null)), fromPhp);
  assert.ok(isPhpJsonStable(fromPhp));
});

test('decode is total -- malformed legacy values fall back, never throw', () => {
  assert.deepEqual(phpJsonDecode('not json', []), []);
  assert.deepEqual(phpJsonDecode('', []), []);
  assert.deepEqual(phpJsonDecode(null, []), []);
  assert.deepEqual(phpJsonDecode('null', []), []);
});
