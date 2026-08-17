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
 */
import { hashPassword } from '../../packages/core/src/auth/password.ts';
import { connect } from '../db/connect.mjs';

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
    const hashed = await hashPassword(password);
    const { rows: [created] } = await client.query(
      `INSERT INTO public."onyx_users" ("email", "name", "password", "status")
       VALUES ($1, $2, $3, 1) RETURNING "id"`,
      [normalised, name, hashed]);
    userId = created.id;
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
