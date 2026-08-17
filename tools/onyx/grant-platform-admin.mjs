/**
 * Grants platform admin -- from the machine, not the API.
 *
 * Every other grant goes through POST /api/onyx/platform/admins, which
 * requires an existing platform admin's token. The very first one is the
 * exception: onyx_platform_admins starts empty, so nobody can hold that
 * token yet. This writes the row directly with the same service-role
 * connection the rest of tools/onyx and tools/db use -- a step deliberately
 * left as "run this on the machine that already has the credentials" rather
 * than a self-service HTTP route, because an unauthenticated way to grant
 * platform admin is a way to grant platform admin to anyone who finds it.
 *
 * Usage
 *   node tools/onyx/grant-platform-admin.mjs <email> [--name "Name"] [--password "..."]
 *
 * If the account does not exist yet, --name and --password create it.
 * If it does, both are ignored -- the existing identity is used as is.
 *
 * CREATING THE ACCOUNT GOES THROUGH GOTRUE, NOT AN INSERT.
 *
 * This used to hash a password itself and INSERT it into onyx_users.password.
 * That column no longer exists: migration 0014 dropped it when Supabase Auth
 * took over credentials (docs/ADR-011-supabase-auth-migration.md), so the tool
 * failed with `column "password" of relation "onyx_users" does not exist` on
 * any database migrated past 0014. It kept "working" on the original project
 * only because that project's platform admin was created before the cutover
 * and carried across by provision-auth-users.mjs -- so the breakage was
 * invisible until v2 stood up a fresh project and had no first admin at all.
 *
 * onyx_users is now a profile table keyed 1:1 with auth.users, so the order
 * matters: GoTrue creates the identity and assigns the uuid, and that uuid
 * becomes onyx_users.id. Doing it the other way round would mint a profile id
 * that no auth user has, and the account could never sign in.
 */
import { createClient } from '@supabase/supabase-js';
import { connect, loadEnv } from '../db/connect.mjs';

const args = process.argv.slice(2);
const email = args[0];
if (!email || email.startsWith('--')) {
  console.log('usage: node tools/onyx/grant-platform-admin.mjs <email> [--name "Name"] [--password "..."]');
  process.exit(1);
}
const flag = (name) => {
  const i = args.indexOf('--' + name);
  return i === -1 ? null : args[i + 1];
};
const name = flag('name');
const password = flag('password');

const env = loadEnv();
if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required to create an account.');
}
const auth = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } });

/**
 * The auth.users row for this email, creating it if absent.
 *
 * `email_confirm: true` because no SMTP is configured on this project -- a
 * confirmation mail would never arrive and the account would be permanently
 * unable to sign in. Tolerates the identity already existing (a partial
 * earlier run) by looking it up rather than failing, so this stays re-runnable.
 */
async function authUserFor(normalised, displayName, plainPassword) {
  const { data: created, error } = await auth.auth.admin.createUser({
    email: normalised,
    password: plainPassword,
    email_confirm: true,
    user_metadata: { name: displayName },
  });
  if (!error) return created.user.id;

  if (!/already|exists|registered/i.test(error.message)) throw error;
  // Already in GoTrue -- find it. listUsers is paged; this is a seeding tool
  // against a small directory, so walking it is fine.
  for (let page = 1; page <= 20; page += 1) {
    const { data } = await auth.auth.admin.listUsers({ page, perPage: 200 });
    const hit = (data?.users ?? []).find((u) => (u.email ?? '').toLowerCase() === normalised);
    if (hit) return hit.id;
    if (!data?.users?.length) break;
  }
  throw new Error('GoTrue says ' + normalised + ' exists but it could not be found.');
}

const client = await connect();
try {
  const normalised = email.trim().toLowerCase();
  const { rows: [existing] } = await client.query(
    'SELECT id, name FROM public."onyx_users" WHERE email = $1', [normalised]);

  let userId;
  if (existing) {
    userId = existing.id;
    console.log('using existing account: ' + normalised + ' (id ' + userId + ')');
  } else {
    if (!name || !password) {
      throw new Error('That account does not exist yet -- pass --name and --password to create it.');
    }
    // GoTrue first: it owns the identity and assigns the uuid the profile is keyed by.
    userId = await authUserFor(normalised, name, password);
    await client.query(
      `INSERT INTO public."onyx_users" ("id", "email", "name", "status", "email_verified_at")
       VALUES ($1, $2, $3, 1, now())
       ON CONFLICT ("id") DO UPDATE SET "name" = EXCLUDED."name"`,
      [userId, normalised, name]);
    console.log('created account: ' + normalised + ' (id ' + userId + ')');
  }

  const { rows: [already] } = await client.query(
    'SELECT id FROM public."onyx_platform_admins" WHERE user_id = $1', [userId]);
  if (already) {
    console.log(normalised + ' is already a platform admin.');
  } else {
    await client.query(
      'INSERT INTO public."onyx_platform_admins" ("user_id") VALUES ($1)', [userId]);
    console.log('granted platform admin to ' + normalised);
  }
  console.log('\nSign in at /onyx/platform/login with this email and password.');
} finally {
  await client.end();
}
