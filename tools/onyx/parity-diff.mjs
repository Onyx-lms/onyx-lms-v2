/**
 * Proves the Next-hosted API answers identically to the Fastify one.
 *
 * The v2 migration replaces a Fastify server with a router shim inside Next
 * (docs/ADR-012). 574 handlers move without being edited, so the risk is not
 * that a handler is wrong -- it is that the *plumbing* around it differs in some
 * small way on some subset of routes: a path parameter matched by the wrong
 * pattern, a query string dropped, an empty body arriving as '' instead of
 * undefined, a status coming back 500 where it should be 401.
 *
 * None of that is visible to a typechecker, and most of it is invisible to a
 * smoke test of five endpoints. What catches it is running the same request
 * against both servers and diffing the answers -- which is possible only because
 * apps/api is deliberately kept alive through the migration as the oracle.
 *
 * That is not hypothetical: this harness's first run is what surfaced
 * `GET /api/onyx/me` answering 500-with-a-401-body, because @onyx/core was
 * bundled twice and `err instanceof HttpError` was false across the copies.
 *
 *   node tools/onyx/parity-diff.mjs
 *   node tools/onyx/parity-diff.mjs --shim http://localhost:5175 --oracle http://localhost:4000
 *   node tools/onyx/parity-diff.mjs --authed        # also probe with real tokens
 *
 * Exits non-zero on any mismatch, so it can gate a commit.
 */
const arg = (name, fallback) => {
  const i = process.argv.indexOf('--' + name);
  return i === -1 ? fallback : process.argv[i + 1];
};
const SHIM = arg('shim', 'http://localhost:5175');
const ORACLE = arg('oracle', 'http://localhost:4000');
const AUTHED = process.argv.includes('--authed');

/**
 * Probes chosen for what they exercise, not for coverage.
 *
 * Public reads first (no auth to get wrong), then the shapes most likely to
 * break in a hand-written matcher: the eight genuinely ambiguous
 * static-vs-parameter pairs, a query string, a deep multi-parameter path, a
 * 404, and an unauthenticated call to each product's guard.
 */
const PROBES = [
  // --- plumbing basics -----------------------------------------------------
  { m: 'GET', p: '/health', note: 'the one route not under /api' },
  { m: 'GET', p: '/api/settings' },
  { m: 'GET', p: '/api/settings/theme' },
  { m: 'GET', p: '/api/languages' },

  // --- query strings must survive -----------------------------------------
  { m: 'GET', p: '/api/courses' },
  { m: 'GET', p: '/api/courses?per_page=2' },
  { m: 'GET', p: '/api/courses?per_page=2&page=1' },
  { m: 'GET', p: '/api/blogs?per_page=1' },

  // --- the eight ambiguous pairs: a static segment must beat a parameter ---
  { m: 'GET', p: '/api/blogs/categories', note: 'must not hit /api/blogs/:slug' },
  { m: 'GET', p: '/api/blogs/popular', note: 'must not hit /api/blogs/:slug' },
  { m: 'GET', p: '/api/bootcamps/categories', note: 'must not hit /api/bootcamps/:slug' },
  { m: 'GET', p: '/api/courses/facets', note: 'must not hit /api/courses/:slug' },
  { m: 'GET', p: '/api/courses/compare', note: 'must not hit /api/courses/:slug' },
  { m: 'GET', p: '/api/onyx/interviews/mine', note: 'must not hit /api/onyx/interviews/:id' },
  { m: 'GET', p: '/api/onyx/workspaces/all', note: 'must not hit /api/onyx/workspaces/:id' },
  { m: 'GET', p: '/api/onyx/tickets/breaches', note: 'must not hit /api/onyx/tickets/:id' },

  // --- the parameter side of those same pairs still resolves ---------------
  { m: 'GET', p: '/api/blogs/definitely-not-a-real-slug', note: 'parameter route, expect 404' },
  { m: 'GET', p: '/api/courses/definitely-not-a-real-slug' },

  // --- guards: both products, unauthenticated ------------------------------
  { m: 'GET', p: '/api/onyx/me', note: 'onyx guard -> 401, NOT 500' },
  { m: 'GET', p: '/api/onyx/courses', note: 'onyx guard' },
  { m: 'GET', p: '/api/account/profile', note: 'port guard' },
  { m: 'GET', p: '/api/onyx/platform/tenants', note: 'platform guard' },

  // --- not found -----------------------------------------------------------
  { m: 'GET', p: '/api/nonsense' },
  { m: 'GET', p: '/api/onyx/nonsense' },
  { m: 'GET', p: '/api/onyx/courses/99999999', note: 'valid shape, absent row' },

  // --- bodyless POST: the empty body must arrive as undefined, not '' ------
  { m: 'POST', p: '/api/onyx/auth/login', body: {}, note: 'validation error, not a crash' },
  { m: 'POST', p: '/api/auth/login', body: {}, note: 'validation error, not a crash' },
];

/** Authed probes, run only with --authed: these read real rows. */
const AUTHED_PROBES = [
  { m: 'GET', p: '/api/onyx/me', as: 'admin' },
  { m: 'GET', p: '/api/onyx/members', as: 'admin' },
  { m: 'GET', p: '/api/onyx/courses', as: 'admin' },
  { m: 'GET', p: '/api/onyx/my/courses', as: 'student' },
  { m: 'GET', p: '/api/onyx/my/learning-overview', as: 'student' },
  { m: 'GET', p: '/api/onyx/my/teaching-overview', as: 'faculty' },
  { m: 'GET', p: '/api/onyx/progress', as: 'student' },
  { m: 'GET', p: '/api/onyx/exams', as: 'exams' },
  { m: 'GET', p: '/api/onyx/platform/tenants', as: 'platform' },
];

const ACCOUNTS = {
  admin: ['admin@demo.onyx', 'Demo#2026!', '/api/onyx/auth/login'],
  faculty: ['faculty@demo.onyx', 'Demo#2026!', '/api/onyx/auth/login'],
  student: ['student@demo.onyx', 'Demo#2026!', '/api/onyx/auth/login'],
  exams: ['exams@demo.onyx', 'Demo#2026!', '/api/onyx/auth/login'],
  platform: ['superadmin@onyx.platform', 'Platform#2026!', '/api/onyx/platform/login'],
};

async function hit(base, probe, token) {
  const headers = {};
  if (probe.body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = 'Bearer ' + token;
  try {
    const res = await fetch(base + probe.p, {
      method: probe.m,
      headers,
      body: probe.body === undefined ? undefined : JSON.stringify(probe.body),
    });
    return { status: res.status, text: await res.text() };
  } catch (e) {
    return { status: 0, text: 'FETCH FAILED: ' + e.message };
  }
}

/**
 * Fields that differ between two processes by construction, not by defect.
 * Blanked rather than ignored, so a *structural* change still shows up.
 */
function normalise(text) {
  let t = text;
  try {
    const j = JSON.parse(text);
    if (j?.data?.ts) j.data.ts = '<ts>';
    if (j?.data?.uptime_seconds !== undefined) j.data.uptime_seconds = '<n>';
    if (Array.isArray(j?.data?.checks)) j.data.checks = j.data.checks.map((c) => ({ ...c, ms: '<ms>' }));
    t = JSON.stringify(j);
  } catch { /* not JSON -- compare verbatim */ }
  // A signed URL or a token carries a fresh signature per call.
  return t.replace(/(token|access_token|url|signature)":"[^"]*"/g, '$1":"<varies>"');
}

async function tokensFor(base, roles) {
  const out = {};
  for (const role of roles) {
    const [email, password, path] = ACCOUNTS[role];
    const res = await fetch(base + path, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const j = await res.json().catch(() => ({}));
    if (!j?.ok) throw new Error('could not sign in as ' + role + ' on ' + base + ': '
      + (j?.message ?? res.status));
    out[role] = j.data.token;
  }
  return out;
}

console.log('shim   ' + SHIM);
console.log('oracle ' + ORACLE + '\n');

let probes = PROBES.map((p) => ({ ...p }));
if (AUTHED) {
  const roles = [...new Set(AUTHED_PROBES.map((p) => p.as))];
  // Tokens are minted per server: they are the same identities, but each token is
  // freshly signed, and a token from one process must be accepted by the other.
  const [shimTokens, oracleTokens] = await Promise.all([
    tokensFor(SHIM, roles), tokensFor(ORACLE, roles),
  ]);
  probes = probes.concat(AUTHED_PROBES.map((p) => ({
    ...p, shimToken: shimTokens[p.as], oracleToken: oracleTokens[p.as],
  })));
}

let same = 0;
const bad = [];

for (const probe of probes) {
  const [a, b] = await Promise.all([
    hit(SHIM, probe, probe.shimToken),
    hit(ORACLE, probe, probe.oracleToken),
  ]);
  const statusMatch = a.status === b.status;
  const bodyMatch = normalise(a.text) === normalise(b.text);
  const label = probe.m + ' ' + probe.p + (probe.as ? '  [' + probe.as + ']' : '');

  if (statusMatch && bodyMatch) {
    same += 1;
    console.log('  ok   ' + String(a.status).padEnd(4) + label);
  } else {
    bad.push({ probe, a, b, statusMatch, bodyMatch });
    console.log('  DIFF ' + label);
    if (!statusMatch) console.log('        status  shim=' + a.status + '  oracle=' + b.status);
    if (!bodyMatch) {
      console.log('        shim    ' + normalise(a.text).slice(0, 200));
      console.log('        oracle  ' + normalise(b.text).slice(0, 200));
    }
    if (probe.note) console.log('        note: ' + probe.note);
  }
}

console.log('\n' + same + '/' + probes.length + ' identical');
if (bad.length) {
  console.log(bad.length + ' MISMATCH(ES) -- the shim does not yet reproduce the Fastify server');
  process.exit(1);
}
console.log('parity: PASS');
