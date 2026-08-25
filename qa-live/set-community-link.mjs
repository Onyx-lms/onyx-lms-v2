/**
 * Sets the WhatsApp community link the Jobs page offers.
 *
 * Through the product's own settings route rather than an UPDATE, so the change
 * carries an audit record and goes through the same validation an administrator
 * typing it into Settings would meet -- which is the point of having that route.
 *
 * ABC Institution only by default. The link is one WhatsApp group invite, and
 * pointing several institutions at a single group puts their students in one
 * chat together; that is a decision for whoever runs the group, not a default.
 *
 * Two ways in, because not every institution has an administrator in the
 * credentials sheet. With one, this signs in as them and uses the institution's
 * own settings route; without one it acts as the platform console, which
 * reaches the same validation through `updateTenant`. Either way it is a real
 * request through a real route, audited, and never an UPDATE.
 *
 *   node qa-live/set-community-link.mjs                       # show what is set
 *   node qa-live/set-community-link.mjs --apply               # set it for ABC
 *   node qa-live/set-community-link.mjs --apply --slug=<slug> # somewhere else
 */
import fs from 'node:fs';

const BASE = process.env.QA_BASE ?? 'https://onyx-lms-v2.vercel.app';
const APPLY = process.argv.includes('--apply');
const slugArg = process.argv.find((a) => a.startsWith('--slug='));
const SLUG = slugArg ? slugArg.slice('--slug='.length) : 'abc-institution';

const URL_TO_SET = 'https://chat.whatsapp.com/EQalpEfMMeTIxGio8RsNrz?s=cl&p=i&mlu=4';
const LABEL = 'Join our WhatsApp community';

const cred = fs.readFileSync('onyx-v2-credentials.csv', 'utf8')
  .trim().split(/\r?\n/).slice(1).map((r) => r.split(','));
const admin = cred.find((r) => r[1] === SLUG && r[2] === 'admin');

async function call(path, { method = 'GET', token, body } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const p = await res.json().catch(() => ({}));
  return { status: res.status, data: p?.data, message: p?.message };
}

const token = admin ? (await call('/api/onyx/auth/login', {
  method: 'POST', body: { email: admin[4], password: admin[5] },
})).data?.token : null;

const platformToken = token ? null : (await call('/api/onyx/platform/login', {
  method: 'POST',
  body: { email: 'superadmin@onyx.platform', password: 'Platform#2026!' },
})).data?.token;

if (!token && !platformToken) {
  console.error('Could not sign in as either the institution or the console.');
  process.exit(2);
}

/** The institution, read the way whichever caller we are can read it. */
let tenantId = null;
async function readBack() {
  if (token) return (await call('/api/onyx/me', { token })).data?.tenant ?? {};
  return (await call('/api/onyx/platform/tenants/' + tenantId,
    { token: platformToken })).data ?? {};
}

if (!token) {
  const tenants = (await call('/api/onyx/platform/tenants', { token: platformToken })).data ?? [];
  const found = tenants.find((t) => String(t.slug) === SLUG);
  if (!found) {
    console.error('No institution with the address "' + SLUG + '".');
    process.exit(2);
  }
  tenantId = found.id;
}

console.log('acting as: ' + (token ? 'an administrator of ' + SLUG : 'the platform console'));
const before = await readBack();
console.log(SLUG + ' before: ' + (before.community_url || '(no link)'));

if (!APPLY) {
  console.log('\nWould set: ' + URL_TO_SET);
  console.log('Nothing was changed. Pass --apply.');
  process.exit(0);
}

const saved = token
  ? await call('/api/onyx/tenant/community', {
    method: 'PUT', token,
    body: { community_url: URL_TO_SET, community_label: LABEL },
  })
  : await call('/api/onyx/platform/tenants/' + tenantId, {
    method: 'PATCH', token: platformToken,
    body: { community_url: URL_TO_SET, community_label: LABEL },
  });
console.log('save: ' + saved.status + ' ' + (saved.message ?? ''));

// Read it back rather than trusting the write's own echo: the button renders
// from the institution's stored row, so that is the thing that has to be right.
const after = await readBack();
console.log(SLUG + ' after:  ' + (after.community_url || '(no link)'));
console.log('label:        ' + (after.community_label || '(none)'));
if (after.community_url !== URL_TO_SET) {
  console.error('\nThe stored link is not the one that was sent.');
  process.exit(3);
}
console.log('\nThe Jobs page will now offer this link.');
