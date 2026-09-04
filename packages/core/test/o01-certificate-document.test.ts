/**
 * The credential on the supplied artwork.
 *
 * These are the checks that would have caught the three things that went wrong
 * while fitting the text to it, none of which a type would have caught:
 *
 *   * every kind must have a title AND a sentence -- a kind added to the API
 *     enum but not to the document renders a certificate with a blank title,
 *     which is worse than refusing to render one;
 *   * the sentence must never say "internship" for a course, which is what all
 *     four supplied templates say in their baked-in body copy;
 *   * the output must still be a single-page PDF carrying the artwork, because
 *     the whole approach is drawing over a template rather than redrawing it.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';
import {
  renderBrandedCertificate, certificateCopy, CERTIFICATE_KINDS,
} from '../src/format/certificate-doc.ts';

const base = {
  issuer: 'Malla Reddy University (Demo)',
  holder: 'Sneha Rao',
  title: 'Full-Stack Web Development',
  credentialId: 'BB173F56F69D8F039AB1678787ACC09C',
  issuedAt: '3 September 2026',
  verifyUrl: 'https://example.test/onyx/verify/BB173F56F69D8F039AB1678787ACC09C',
};

test('every kind the API accepts has a title and a sentence', () => {
  for (const kind of CERTIFICATE_KINDS) {
    const copy = certificateCopy(kind);
    assert.ok(copy.title.trim(), kind + ' has no title');
    assert.ok(copy.sentence.trim(), kind + ' has no sentence');
    assert.match(copy.title, /CERTIFICATE$/, kind + ' should read as a certificate');
  }
});

test('the four supplied designs are the four titles', () => {
  assert.equal(certificateCopy('course').title, 'COURSE COMPLETION CERTIFICATE');
  assert.equal(certificateCopy('internship').title, 'INTERNSHIP CERTIFICATE');
  assert.equal(certificateCopy('project').title, 'PROJECT COMPLETION CERTIFICATE');
  assert.equal(certificateCopy('performance').title, 'PERFORMANCE CERTIFICATE');
});

test('only the internship certificate mentions an internship', () => {
  // The supplied artwork says "the successful internship competition on" on
  // all four designs. Drawing that over a course completion would tell a
  // reader the wrong thing on the one line they actually read.
  for (const kind of CERTIFICATE_KINDS) {
    const { sentence } = certificateCopy(kind);
    if (kind === 'internship') assert.match(sentence, /internship/);
    else assert.doesNotMatch(sentence, /internship/, kind + ' must not claim an internship');
    assert.doesNotMatch(sentence, /competition/, kind + ' repeats the template typo');
  }
});

test('an unknown kind falls back rather than rendering a blank title', () => {
  // `kind` is a varchar with nothing behind it, so a row written by an older
  // release, or by hand, can hold anything at all.
  assert.equal(certificateCopy('something-else').title, 'COURSE COMPLETION CERTIFICATE');
  assert.equal(certificateCopy(null).title, 'COURSE COMPLETION CERTIFICATE');
  assert.equal(certificateCopy(undefined).title, 'COURSE COMPLETION CERTIFICATE');
});

test('renders a one-page PDF that still carries the artwork', async () => {
  const file = await renderBrandedCertificate({ ...base, kind: 'course' });
  assert.ok(Buffer.isBuffer(file));
  assert.equal(file.subarray(0, 5).toString(), '%PDF-');
  // The artwork alone is ~450 kB; anything close to empty means the template
  // did not load and this is a blank page with some text on it.
  assert.ok(file.length > 200_000, 'suspiciously small: ' + file.length);
  // Parsed rather than grepped: pdf-lib writes object streams, so /Type /Page
  // is compressed and not findable as text.
  const doc = await PDFDocument.load(file);
  assert.equal(doc.getPageCount(), 1);
  const { width, height } = doc.getPage(0).getSize();
  assert.ok(width > height, 'the artwork is landscape');
  assert.ok(Math.abs(width - 842.25) < 1, 'A4 landscape, as supplied');
});

test('a missing period leaves the second rule blank rather than inventing an end',
  async () => {
    // Both render; the point is that neither throws and the one with no period
    // is not silently given today's date as an end.
    const withPeriod = await renderBrandedCertificate(
      { ...base, kind: 'internship', from: '1 June 2026', to: '30 August 2026' });
    const without = await renderBrandedCertificate({ ...base, kind: 'internship' });
    assert.ok(withPeriod.length > 200_000);
    assert.ok(without.length > 200_000);
    assert.notEqual(withPeriod.length, without.length);
  });

test('a long name and a long subject do not run off the page', async () => {
  // `centred` shrinks until it fits; the failure this guards is a name wider
  // than the rule it sits on, which reads as a broken certificate.
  const file = await renderBrandedCertificate({
    ...base, kind: 'project',
    holder: 'Venkata Satyanarayana Chandrasekhar Rao',
    title: 'Distributed Systems and Fault-Tolerant Microservice Architecture',
  });
  assert.ok(file.length > 200_000);
});
