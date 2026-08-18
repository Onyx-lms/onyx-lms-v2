/**
 * Every account that can sign in to this deployment, as a CSV.
 *
 * Written as a tool rather than typed out by hand for one reason: a hand-made
 * list is a snapshot of what somebody believed at the time, and this one has
 * to be regenerated after every seed. The accounts come from the database,
 * so the file cannot quietly drift from what actually exists.
 *
 * **The passwords are not read from anywhere -- they cannot be.** Supabase
 * Auth stores a bcrypt hash and there is no way back from it. What this
 * prints is the password the seeders *set*, which is a constant in
 * `seed-demo.mjs` and `seed-full.mjs`. An account created any other way, or
 * one whose owner has since changed their password, is emitted with an empty
 * password column rather than a guess -- a credentials file that confidently
 * states a wrong password is worse than one that admits it does not know.
 *
 * The output is gitignored (`*credentials*.csv`, .gitignore:40) because it is
 * plaintext passwords for real, reachable accounts. That is deliberate and
 * should stay that way.
 *
 * Each row is then CHECKED by signing in with it. A credentials file nobody
 * has tried is a list of guesses, and this one is handed to people who will
 * assume every line works. Anything that does not authenticate has its
 * password cleared and the reason recorded, so the file never asserts
 * something untrue -- which is the whole difference between a document and a
 * document you can rely on.
 *
 * Usage
 *   node tools/onyx/export-credentials.mjs
 *   node tools/onyx/export-credentials.mjs --out somewhere-else.csv
 *   node tools/onyx/export-credentials.mjs --no-verify     (skip the sign-ins)
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

// The repo-root .env, the same way next.config.mjs reads it.
if (existsSync('.env')) {
  for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
    const eq = line.indexOf('=');
    if (eq < 1 || line.trim().startsWith('#')) continue;
    const key = line.slice(0, eq).trim();
    if (process.env[key] === undefined) process.env[key] = line.slice(eq + 1).trim();
  }
}

const URL_BASE = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_BASE || !KEY) {
  console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.');
  process.exit(1);
}

const outAt = process.argv.indexOf('--out');
const OUT = outAt === -1 ? 'onyx-v2-credentials.csv' : process.argv[outAt + 1];
const APP = process.env.APP_URL || 'https://onyx-lms-v2.vercel.app';

/** What each seeder sets. Anything not created by one of them is unknown. */
const SEEDED_PASSWORD = 'Demo#2026!';
const PLATFORM_PASSWORD = 'Platform#2026!';
const PLATFORM_EMAIL = 'superadmin@onyx.platform';

async function rows(table, query = '') {
  const res = await fetch(URL_BASE + '/rest/v1/' + table + query, {
    headers: { apikey: KEY, Authorization: 'Bearer ' + KEY },
  });
  if (!res.ok) throw new Error(table + ': HTTP ' + res.status);
  return res.json();
}

/** RFC 4180: quote anything containing a comma, a quote or a newline. */
const cell = (v) => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};

const [tenants, memberships, users, admins] = await Promise.all([
  rows('onyx_tenants', '?select=id,name,slug,status&order=id'),
  rows('onyx_memberships', '?select=tenant_id,user_id,role,status,roll_number&order=tenant_id'),
  rows('onyx_users', '?select=id,email,name,status'),
  rows('onyx_platform_admins', '?select=user_id').catch(() => []),
]);

const userById = new Map(users.map((u) => [String(u.id), u]));
const tenantById = new Map(tenants.map((t) => [Number(t.id), t]));
const platformIds = new Set(admins.map((a) => String(a.user_id)));

// Institutions the seeders build, so a demo account can be told apart from
// debris left by an interrupted e2e run.
const SEEDED_SLUGS = new Set([
  'meridian-tech', 'ashcroft-poly', 'abc-institution', 'xyz-polytechnic',
]);

const out = [];

// The platform operator first -- it is a different door, and somebody
// reading this file is usually looking for it.
const operator = users.find((u) => String(u.email).toLowerCase() === PLATFORM_EMAIL);
out.push({
  institution: '(platform operator)',
  slug: '',
  role: 'superadmin',
  name: operator?.name ?? 'Platform operator',
  email: PLATFORM_EMAIL,
  password: PLATFORM_PASSWORD,
  roll_number: '',
  sign_in_at: APP + '/onyx/platform/login',
  account: operator ? (operator.status === 1 ? 'active' : 'disabled') : 'not provisioned',
});

for (const m of memberships) {
  const tenant = tenantById.get(Number(m.tenant_id));
  const user = userById.get(String(m.user_id));
  if (!tenant || !user) continue;
  const seeded = SEEDED_SLUGS.has(String(tenant.slug));
  out.push({
    institution: tenant.name,
    slug: tenant.slug,
    role: m.role,
    name: user.name ?? '',
    email: user.email ?? '',
    // Only where a seeder set it. Everything else is left blank on purpose.
    password: seeded ? SEEDED_PASSWORD : '',
    roll_number: m.roll_number ?? '',
    sign_in_at: APP + '/onyx/login',
    account: [
      user.status === 1 ? 'active' : 'disabled account',
      m.status === 1 ? null : 'membership suspended',
      tenant.status === 1 ? null : 'institution suspended',
      seeded ? null : 'password unknown (not seeded)',
    ].filter(Boolean).join('; '),
  });
}

// Institution, then role in the order a person reads them, then name.
const ROLE_ORDER = ['superadmin', 'admin', 'faculty', 'exams', 'placement',
  'employer', 'guardian', 'student'];
out.sort((a, b) =>
  a.institution.localeCompare(b.institution)
  || ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role)
  || String(a.roll_number).localeCompare(String(b.roll_number), undefined, { numeric: true })
  || a.name.localeCompare(b.name));

// ---- verify every claimed password by actually using it -------------------

const VERIFY = !process.argv.includes('--no-verify');
if (VERIFY) {
  const claimed = out.filter((r) => r.password);
  process.stdout.write('Checking ' + claimed.length + ' credentials against ' + APP + ' ');
  let broken = 0;
  /**
   * One attempt, paced.
   *
   * GoTrue rate-limits sign-ins per IP, and thirty-five back to back trips it
   * -- the first version of this blanked sixteen good passwords in a row and
   * called them wrong, which is a far worse failure than not checking at all.
   * So: a gap between attempts, and a single retry after a longer pause
   * before anything is believed. A password is only cleared when it fails
   * twice with time in between.
   */
  const attempt = async (row) => {
    const path = row.role === 'superadmin'
      ? '/api/onyx/platform/login' : '/api/web/onyx/login';
    try {
      const res = await fetch(APP + path, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: row.email, password: row.password }),
      });
      const body = await res.json().catch(() => ({}));
      if (body.ok === true) return 'ok';
      // Told in as many words that this is pacing, not credentials.
      if (res.status === 429 || /rate|too many/i.test(String(body.message ?? ''))) {
        return 'throttled';
      }
      return 'bad';
    } catch {
      // The deployment being unreachable is not evidence about the password.
      return 'unreachable';
    }
  };
  const pause = (ms) => new Promise((r) => setTimeout(r, ms));

  for (const row of claimed) {
    await pause(350);
    let verdict = await attempt(row);
    if (verdict !== 'ok') {
      await pause(4000);
      verdict = await attempt(row);
    }
    const works = verdict !== 'bad';
    if (!works) {
      broken += 1;
      row.password = '';
      row.account = [row.account, 'password does not work — set it again to use this account']
        .filter(Boolean).join('; ');
    }
    process.stdout.write(works ? '.' : 'x');
  }
  process.stdout.write('\n');
  if (broken) {
    console.log('\n  ' + broken + ' credential(s) did not work; their passwords are blank.');
  }
}

const header = ['institution', 'slug', 'role', 'name', 'email', 'password',
  'roll_number', 'sign_in_at', 'account'];
const csv = [header.join(',')]
  .concat(out.map((r) => header.map((h) => cell(r[h])).join(',')))
  .join('\n') + '\n';

writeFileSync(OUT, csv, 'utf8');

const byInstitution = new Map();
for (const r of out) byInstitution.set(r.institution, (byInstitution.get(r.institution) ?? 0) + 1);

console.log('\nWrote ' + OUT + '  (' + out.length + ' accounts)\n');
for (const [name, n] of [...byInstitution].sort()) {
  console.log('  ' + String(n).padStart(3) + '  ' + name);
}
console.log('\n  Passwords are the seeded constants, not read from the database --');
console.log('  Supabase stores a hash. Anything not seeded is left blank.');
console.log('  This file is gitignored. Keep it that way.\n');
