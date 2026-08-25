/**
 * Turn the departure rule on for the demo institution's papers.
 *
 * Every paper written before migration 0040 has `breach_limit` at zero -- the
 * old behaviour, where leaving the examination is recorded and nothing more.
 * That is the right default for a live institution mid-term and the wrong one
 * for a demo somebody is about to test the rule on, so this arms them.
 *
 * Tenant 798 only, and it refuses to write anywhere else.
 *
 *   node qa-live/arm-demo-breach-rule.mjs [limit]
 */
const BASE = process.env.QA_BASE ?? 'https://onyx-lms-v2.vercel.app';
const DEMO_SLUG = 'malla-reddy-demo';
const LIMIT = Number(process.argv[2] ?? 3);

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

const pt = (await call('/api/onyx/platform/login', {
  method: 'POST',
  body: { email: 'superadmin@onyx.platform', password: 'Platform#2026!' },
})).data?.token;

const tenants = (await call('/api/onyx/platform/tenants', { token: pt })).data ?? [];
const demo = tenants.find((t) => t.slug === DEMO_SLUG);
if (!demo) { console.log('The demo institution is not there.'); process.exit(1); }
const TID = Number(demo.id);
if (tenants.some((t) => t.slug !== DEMO_SLUG && Number(t.id) === TID)) {
  console.log('REFUSING: that id belongs to another institution.');
  process.exit(1);
}
const base = '/api/onyx/platform/tenants/' + TID;

const papers = (await call(base + '/academics?limit=200', { token: pt })).data?.assessments ?? [];
console.log('Arming ' + papers.length + ' papers at ' + demo.name + ' (tenant ' + TID + ')');
console.log('  limit ' + LIMIT + (LIMIT ? ' — warn ' + (LIMIT - 1) + ', then hand in' : ' — off'));

for (const paper of papers) {
  const said = await call(base + '/assessments/' + paper.id, {
    method: 'PATCH', token: pt, body: { breach_limit: LIMIT },
  });
  console.log('  ' + (said.status === 200 ? 'ok   ' : 'FAIL ') + paper.title);
}

const after = (await call(base + '/academics?limit=200', { token: pt })).data?.assessments ?? [];
console.log('\nRead back:');
for (const paper of after) {
  const one = (await call(base + '/assessments/' + paper.id, { token: pt })).data?.assessment;
  console.log('  ' + String(one?.breach_limit).padStart(2) + '  ' + paper.title);
}
