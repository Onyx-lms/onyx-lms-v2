/**
 * One place that knows how to reach Postgres.
 *
 * Supabase's direct host (db.<ref>.supabase.co) is IPv6-ONLY on projects
 * created after early 2024. On a network without working IPv6 it fails with
 * ENOTFOUND -- which looks like a dead database but is only a dead route. The
 * session pooler (aws-N-<region>.pooler.supabase.com) answers over IPv4 and
 * speaks the same protocol, so it is the fallback.
 *
 * Set SUPABASE_POOLER_URL in .env to skip the probing entirely.
 */
import fs from 'node:fs';
import pg from 'pg';

const ROOT = new URL('../../', import.meta.url).pathname.replace(/^[/]([A-Za-z]:)/, '$1');

/**
 * Configuration, from the .env file on a developer's machine and from the real
 * environment anywhere else.
 *
 * This used to read .env unconditionally, so every one of these tools threw
 * ENOENT on a CI runner or in a container -- where .env is deliberately absent
 * and the values arrive as environment variables instead. A workflow could pass
 * SUPABASE_DB_URL correctly and still watch the script die before it read it.
 *
 * The file wins where it exists, because that is the machine-local override a
 * developer expects; process.env fills in the rest.
 */
export function loadEnv() {
  let fromFile = {};
  try {
    fromFile = Object.fromEntries(fs.readFileSync(ROOT + '.env', 'utf8').split('\n')
      .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
      .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]));
  } catch {
    // No .env: not an error, just a machine configured the other way.
  }
  return { ...process.env, ...fromFile };
}

const clean = (url) => url.replace(/[?&]sslmode=[^&]*/, '');

/** Candidate connection settings, best first. */
function candidates(env) {
  const out = [];
  const direct = clean(env.SUPABASE_DB_URL ?? '');
  if (direct) out.push({ label: 'direct', config: { connectionString: direct } });
  if (env.SUPABASE_POOLER_URL) {
    out.push({ label: 'pooler (configured)', config: { connectionString: clean(env.SUPABASE_POOLER_URL) } });
  }

  // Derive the pooler from the direct URL: same password, user is
  // postgres.<project-ref>, host is the regional pooler.
  //
  // The region cannot be derived from the project ref, so it must be declared.
  // This used to default to 'ap-northeast-1'; when the project moved to
  // ap-south-1 that default would have quietly built Tokyo pooler hostnames for
  // a Mumbai database and reported them as unreachable, which reads as "the
  // database is down" rather than "you are knocking on the wrong door".
  // Saying nothing is better than guessing wrong.
  try {
    const u = new URL(direct);
    const ref = u.hostname.replace(/^db\./, '').replace(/\.supabase\.co$/, '');
    const region = env.SUPABASE_REGION;
    if (!region) {
      out.push({ label: 'pooler (skipped: set SUPABASE_REGION in .env to enable)', config: null });
    }
    for (const host of region ? ['aws-0-' + region + '.pooler.supabase.com',
                                 'aws-1-' + region + '.pooler.supabase.com'] : []) {
      out.push({
        label: 'pooler ' + host,
        config: {
          host, port: 5432, database: 'postgres',
          user: 'postgres.' + ref, password: decodeURIComponent(u.password),
        },
      });
    }
  } catch { /* no usable direct URL to derive from */ }
  return out;
}

/**
 * Connects, trying the direct host first and falling back to the pooler.
 * Returns a connected client; the caller ends it.
 */
export async function connect(env = loadEnv()) {
  const tried = [];
  for (const { label, config } of candidates(env)) {
    // A null config is a note about a candidate that could not be built at all
    // (an undeclared region), carried so the failure message says why.
    if (!config) { tried.push(label); continue; }
    const client = new pg.Client({
      ...config, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 10_000,
    });
    try {
      await client.connect();
      if (label !== 'direct') {
        console.log('[db] direct host unreachable, using ' + label);
      }
      return client;
    } catch (e) {
      tried.push(label + ': ' + e.message.split('\n')[0]);
      try { await client.end(); } catch { /* never connected */ }
    }
  }
  throw new Error('Could not reach the database. Tried:\n  ' + tried.join('\n  '));
}

/** Connect, run, always disconnect. */
export async function withDb(fn, env = loadEnv()) {
  const client = await connect(env);
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}
