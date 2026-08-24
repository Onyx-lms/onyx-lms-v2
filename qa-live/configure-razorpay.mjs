/**
 * Switches Razorpay on for the real institutions.
 *
 * The mock-or-real decision is made on the server from whether an institution
 * has a gateway configured -- never by the client, because a client that could
 * choose would be a client that could choose to pay nothing. Until this runs,
 * every institution here has none, so every Buy button opens the mock dialog
 * and says so.
 *
 * Keys come from the git-ignored file and are never printed. Run again to
 * rotate them: `saveGateway` merges, so this overwrites the two it sets and
 * leaves anything else (a webhook secret, say) alone.
 *
 *   node qa-live/configure-razorpay.mjs            # list what is configured
 *   node qa-live/configure-razorpay.mjs --apply    # configure them
 */
import fs from 'node:fs';

const BASE = process.env.QA_BASE ?? 'https://onyx-lms-v2.vercel.app';
const APPLY = process.argv.includes('--apply');

const [, keyLine] = fs.readFileSync('rzp (1).csv', 'utf8').trim().split(/\r?\n/);
const [KEY_ID, KEY_SECRET] = keyLine.split(',').map((s) => s.trim());

/** The administrators, one per institution, from the credentials sheet. */
const rows = fs.readFileSync('onyx-v2-credentials.csv', 'utf8')
  .trim().split(/\r?\n/).slice(1).map((r) => r.split(','));
const seen = new Set();
const admins = rows
  .filter((r) => r[2] === 'admin' && r[1])
  .map((r) => ({ slug: r[1], email: r[4], password: r[5] }))
  .filter((a) => !seen.has(a.slug) && seen.add(a.slug));

async function call(path, { method = 'GET', token, body } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

console.log((APPLY ? 'Configuring' : 'Reading') + ' ' + admins.length
  + ' institutions at ' + BASE + '\n');

for (const admin of admins) {
  const token = (await call('/api/onyx/auth/login',
    { method: 'POST', body: { email: admin.email, password: admin.password } }))
    .body?.data?.token;
  if (!token) {
    console.log('skip       ' + admin.slug.padEnd(20) + ' could not sign in as ' + admin.email);
    continue;
  }

  if (APPLY) {
    const saved = await call('/api/onyx/admin/gateways', {
      method: 'PUT', token,
      body: {
        identifier: 'razorpay', title: 'Razorpay', currency: 'INR',
        test_mode: true, status: true,
        keys: { razorpay_key: KEY_ID, razorpay_secret: KEY_SECRET },
      },
    });
    console.log((saved.status === 200 ? 'configured ' : 'FAILED     ')
      + admin.slug.padEnd(20) + (saved.body?.message ?? saved.status));
  }

  const now = await call('/api/onyx/admin/gateways', { token });
  const list = (now.body?.data ?? [])
    .map((g) => g.identifier + (g.status ? '' : ' (off)')
      + ' [' + (g.configured_keys ?? []).join(', ') + ']');
  console.log('           ' + admin.slug.padEnd(20)
    + (list.length ? list.join(' · ') : 'no gateway — Buy opens the mock dialog'));
}

console.log('\nKey id ' + KEY_ID.slice(0, 14) + '… (test mode). '
  + 'No secret is printed, here or in the API’s own reads.');
if (!APPLY) console.log('Nothing was changed. Pass --apply to configure.');
