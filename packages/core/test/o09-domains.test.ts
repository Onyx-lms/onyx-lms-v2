/**
 * Onyx O09 unit tests -- Live Classes domains.
 *
 * Two claims matter here and neither is obvious from reading the code.
 *
 * The first is the curriculum link. It is the only value in this table that
 * ends up in an `href`, and an href is where `javascript:` lives. React does
 * not sanitise one and neither does Next, so the check is the service's and the
 * tests are the proof it is there.
 *
 * The second is that a patch leaves absent fields alone. That is the difference
 * between renaming a domain and silently wiping its price, and it is the kind
 * of bug that looks like data loss rather than like a bug.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeDb } from './fake-db.ts';
import {
  DomainsService, normaliseCurriculumUrl, isExternalHttpUrl,
} from '../src/onyx/domains.service.ts';
import { HttpError } from '../src/http/errors.ts';

const T = 1;      // the tenant everything below belongs to
const OTHER = 2;  // a second institution, present to be excluded

const storage = {
  signedUrl: async (path: string) => 'https://signed.example/' + path,
  upload: async (key: string) => key,
  signedUpload: async (key: string) => ({
    path: key, token: 'tok', signedUrl: 'https://signed.example/put/' + key,
  }),
  publicUrl: (path: string) => 'https://cdn.example/' + path,
  remove: async () => undefined,
};

function seed() {
  return new FakeDb({
    onyx_domains: [
      { id: 1, tenant_id: T, title: 'Data Science', summary: 'Stats and models.',
        curriculum_url: 'https://onyxedutech.com/ds', image_path: 'onyx/1/domains/9-ds.png',
        certificate: 'Certificate in Data Science', duration_label: '12 weeks',
        price_minor: 500000, currency: 'INR', sort: 0, status: 1,
        created_by: 'u1', created_at: 'now', updated_at: 'now' },
      { id: 2, tenant_id: T, title: 'Hidden one', summary: '', curriculum_url: '',
        image_path: null, certificate: '', duration_label: '', price_minor: 0,
        currency: 'INR', sort: 1, status: 0,
        created_by: 'u1', created_at: 'now', updated_at: 'now' },
      { id: 3, tenant_id: OTHER, title: 'Somebody else’s', summary: '',
        curriculum_url: '', image_path: null, certificate: '', duration_label: '',
        price_minor: 0, currency: 'INR', sort: 0, status: 1,
        created_by: 'u9', created_at: 'now', updated_at: 'now' },
    ],
  });
}

// ---------------------------------------------------------------- the link

test('a curriculum link without a scheme is given one rather than refused', () => {
  // People type this. Refusing it teaches them nothing.
  assert.equal(normaliseCurriculumUrl('onyxedutech.com/curriculum'),
    'https://onyxedutech.com/curriculum');
});

test('http and https both survive', () => {
  assert.equal(normaliseCurriculumUrl('https://onyxedutech.com/ds'), 'https://onyxedutech.com/ds');
  assert.equal(normaliseCurriculumUrl('http://onyxedutech.com/ds'), 'http://onyxedutech.com/ds');
});

test('an empty link stays empty rather than becoming a bare scheme', () => {
  assert.equal(normaliseCurriculumUrl(''), '');
  assert.equal(normaliseCurriculumUrl(null), '');
  assert.equal(normaliseCurriculumUrl('   '), '');
});

test('a javascript: link is refused, and the refusal names the scheme', () => {
  // The whole reason this function exists.
  assert.throws(() => normaliseCurriculumUrl('javascript:alert(1)'), (e: unknown) => {
    assert.ok(e instanceof HttpError);
    assert.equal(e.status, 422);
    assert.match(e.message, /javascript/);
    return true;
  });
});

test('other non-web schemes are refused too', () => {
  for (const bad of ['ftp://files.example/x', 'data:text/html,<script>', 'file:///etc/passwd']) {
    assert.throws(() => normaliseCurriculumUrl(bad), HttpError, bad + ' should be refused');
  }
});

test('the read-side guard agrees with the write-side one', () => {
  // Belt and braces: a row written before the check existed must not render.
  assert.equal(isExternalHttpUrl('https://onyxedutech.com'), true);
  assert.equal(isExternalHttpUrl('http://onyxedutech.com'), true);
  assert.equal(isExternalHttpUrl('javascript:alert(1)'), false);
  assert.equal(isExternalHttpUrl(''), false);
  assert.equal(isExternalHttpUrl(null), false);
});

// ------------------------------------------------------------- the service

test('a list is one institution only, and hides what is hidden', async () => {
  const svc = new DomainsService(seed() as never, storage);

  const visible = await svc.list(T);
  assert.deepEqual(visible.map((d) => d.title), ['Data Science']);

  const all = await svc.list(T, { includeHidden: true });
  assert.deepEqual(all.map((d) => d.title), ['Data Science', 'Hidden one']);

  // The other institution's domain never appears, asked for either way.
  assert.equal(all.some((d) => d.tenant_id === OTHER), false);
});

test('reading another institution.s domain is a 404, not a 403', async () => {
  // Ids are sequential, so a 403 would confirm the row exists.
  const svc = new DomainsService(seed() as never, storage);
  await assert.rejects(() => svc.domain(T, 3), (e: unknown) => {
    assert.ok(e instanceof HttpError);
    assert.equal(e.status, 404);
    return true;
  });
});

test('a stored image key is resolved to a URL, and a missing one stays null', async () => {
  const svc = new DomainsService(seed() as never, storage);
  const withImage = await svc.domain(T, 1);
  assert.equal(withImage.image_url, 'https://cdn.example/onyx/1/domains/9-ds.png');

  const without = await svc.domain(T, 2);
  assert.equal(without.image_url, null);
});

test('a patch leaves every field it does not mention alone', async () => {
  // The claim: renaming a domain cannot wipe its price, its link or its image.
  const svc = new DomainsService(seed() as never, storage);
  const after = await svc.update(T, 1, { title: 'Applied Data Science' });

  assert.equal(after.title, 'Applied Data Science');
  assert.equal(after.price_minor, 500000);
  assert.equal(after.curriculum_url, 'https://onyxedutech.com/ds');
  assert.equal(after.certificate, 'Certificate in Data Science');
  assert.equal(after.duration_label, '12 weeks');
  assert.equal(after.image_path, 'onyx/1/domains/9-ds.png');
});

test('a patch normalises the link it is given', async () => {
  const svc = new DomainsService(seed() as never, storage);
  const after = await svc.update(T, 1, { curriculum_url: 'onyxedutech.com/new' });
  assert.equal(after.curriculum_url, 'https://onyxedutech.com/new');
});

test('a patch cannot smuggle a javascript link past the check', async () => {
  const svc = new DomainsService(seed() as never, storage);
  await assert.rejects(() => svc.update(T, 1, { curriculum_url: 'javascript:alert(1)' }),
    HttpError);
});

test('creating stores the tenant, the author and a normalised link', async () => {
  const db = seed();
  const svc = new DomainsService(db as never, storage);
  const made = await svc.create(T, 'u7', {
    title: '  Cloud Engineering  ', curriculum_url: 'onyxedutech.com/cloud', price_minor: 250000,
  });

  assert.equal(made.title, 'Cloud Engineering');   // trimmed
  assert.equal(made.tenant_id, T);
  assert.equal(made.created_by, 'u7');
  assert.equal(made.curriculum_url, 'https://onyxedutech.com/cloud');
  assert.equal(made.currency, 'INR');
  assert.equal(made.status, 1);
});

test('a domain with no name is refused', async () => {
  const svc = new DomainsService(seed() as never, storage);
  await assert.rejects(() => svc.create(T, 'u7', { title: '   ' }), (e: unknown) => {
    assert.ok(e instanceof HttpError);
    assert.equal(e.status, 422);
    return true;
  });
});

test('deleting removes the row and its thumbnail', async () => {
  const db = seed();
  const removed: string[] = [];
  const svc = new DomainsService(db as never, {
    ...storage, remove: async (p: string) => { removed.push(p); },
  });

  await svc.remove(T, 1);
  assert.deepEqual(removed, ['onyx/1/domains/9-ds.png']);
  await assert.rejects(() => svc.domain(T, 1), HttpError);
});

test('a bucket that refuses still lets the row go', async () => {
  // An orphaned image costs kilobytes; a domain that will not delete costs a
  // support ticket.
  const db = seed();
  const svc = new DomainsService(db as never, {
    ...storage, remove: async () => { throw new Error('bucket unreachable'); },
  });

  await svc.remove(T, 1);
  await assert.rejects(() => svc.domain(T, 1), HttpError);
});

test('an upload ticket is keyed to the caller.s own institution', async () => {
  const svc = new DomainsService(seed() as never, storage);
  const ticket = await svc.signUpload(T, 'my photo.png');

  assert.match(ticket.path, /^onyx\/1\/domains\/\d+-my-photo\.png$/);
});

test('an upload filename cannot climb out of the institution.s folder', async () => {
  const svc = new DomainsService(seed() as never, storage);
  const ticket = await svc.signUpload(T, '../../other-tenant/evil.png');

  assert.ok(ticket.path.startsWith('onyx/1/domains/'), ticket.path);
  assert.equal(ticket.path.includes('..'), false);
});
