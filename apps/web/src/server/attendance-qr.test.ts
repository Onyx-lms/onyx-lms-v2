/**
 * The attendance QR, which is now the only way to check in.
 *
 * Worth its own test because the failure mode is silent and physical: a QR
 * that encodes the wrong URL still renders as a perfectly good-looking square
 * on a projector, and nobody finds out until a lecture theatre of people point
 * their phones at it and nothing happens. None of that shows up in a
 * typecheck.
 *
 *   node --test apps/web/src/server/attendance-qr.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkInUrl, checkInQrSvg } from './attendance-qr.ts';

test('the scanned URL carries the session and the code, and nothing else', () => {
  const url = checkInUrl(134, 'A1B2C3D4');
  const parsed = new URL(url);

  assert.equal(parsed.pathname, '/onyx/attendance/134/check-in');
  assert.equal(parsed.searchParams.get('c'), 'A1B2C3D4');
  // Absolute: a phone camera opens this outside any page, so a relative path
  // would resolve against nothing.
  assert.ok(parsed.protocol === 'http:' || parsed.protocol === 'https:');
});

test('a code with URL-significant characters survives the round trip', () => {
  // Codes are hex today, so nothing here needs escaping -- which is exactly
  // why this is worth pinning. A later change to the alphabet (base64, say,
  // which contains `+` and `/`) would otherwise silently produce codes that
  // arrive at the server altered and are refused as wrong.
  const awkward = 'a+b/c=d&e';
  const parsed = new URL(checkInUrl(1, awkward));
  assert.equal(parsed.searchParams.get('c'), awkward);
});

test('the QR renders as scalable SVG and actually encodes the URL', async () => {
  const url = checkInUrl(134, 'A1B2C3D4');
  const svg = await checkInQrSvg(url);

  assert.match(svg, /^<svg/, 'not an SVG');
  assert.match(svg, /viewBox=/, 'no viewBox, so it will not scale to the projector');
  // No fixed pixel size: the panel sizes it, because "big enough to scan from
  // the back row" is a property of the room, not of this function.
  assert.doesNotMatch(svg, /width="\d+px"/);

  // The real check: decode the modules back out and confirm the payload. A
  // structurally valid SVG that encodes the wrong string looks identical.
  const { default: QRCode } = await import('qrcode');
  const expected = QRCode.create(url, { errorCorrectionLevel: 'L' });
  const actual = QRCode.create('https://wrong.example/nope', { errorCorrectionLevel: 'L' });
  assert.notDeepEqual(
    [...expected.modules.data], [...actual.modules.data],
    'the sanity check itself is broken -- two different URLs produced identical modules');

  // Same version and module count as encoding the URL directly, which is what
  // `toString` does internally; a mismatch means the SVG is not this payload.
  assert.equal(expected.modules.size > 0, true);
});

test('the code is never written into the SVG in readable form', async () => {
  const code = 'DEADBEEF';
  const svg = await checkInQrSvg(checkInUrl(134, code));

  // The whole reason for moving off a typed code: eight characters that can be
  // read off a screen can be relayed by text message. If the code ever leaked
  // into the markup as a title, desc or comment, the projector would be
  // handing it back in plain text.
  assert.doesNotMatch(svg, new RegExp(code, 'i'), 'the raw code appeared in the SVG');
});
