/**
 * Onyx O01 -- tenancy, roles and audit, end to end.
 *
 * This is the Onyx equivalent of the port's parity gate. The port's promise is
 * "the same schema"; Onyx's promise is "one institution can never see another",
 * and that promise is worth exactly as much as the test that tries to break it.
 *
 * So the shape here is deliberate: stand up TWO institutions with overlapping
 * people, then attack the boundary from every direction the API exposes --
 * reads, writes, role guards, token switching, and PostgREST directly.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { api, withDb, RUN, env, createTenant, onyxLogin } from './harness.ts';

const A = { name: 'Alpha University ' + RUN, slug: 'alpha-' + RUN };
const B = { name: 'Beta Institute ' + RUN, slug: 'beta-' + RUN };

const pw = 'OnyxTest#2026';
const mail = (who: string) => who + '.' + RUN + '@onyx.test';

/** Everything the tests below share, filled in by the first test. */
const world = {
  alpha: { id: 0, token: '', adminEmail: mail('alpha.admin') },
  beta: { id: 0, token: '', adminEmail: mail('beta.admin') },
  /** Belongs to BOTH institutions -- the case where a leak would be easiest. */
  shared: { email: mail('shared'), alphaToken: '', betaToken: '' },
  alphaStudentMembership: 0,
  betaStudentMembership: 0,
  studentToken: '',
};

test('two institutions can be created, each with its own administrator', async () => {
  for (const [key, t] of [['alpha', A], ['beta', B]] as const) {
    const res = await createTenant({
      name: t.name,
      slug: t.slug,
      admin: { name: t.name + ' Admin', email: world[key].adminEmail, password: pw },
    });
    assert.equal(res.ok, true, 'create ' + t.slug + ' failed: ' + res.message);
    world[key].id = Number(res.data.tenant.id);
    assert.ok(world[key].id > 0);
  }
  assert.notEqual(world.alpha.id, world.beta.id);

  world.alpha.token = await onyxLogin(world.alpha.adminEmail, pw);
  world.beta.token = await onyxLogin(world.beta.adminEmail, pw);
});

/**
 * Creating an institution is an operator action, not an open sign-up.
 *
 * This route used to accept anyone: reach the API, post a name, and you owned
 * a brand-new institution with yourself as its administrator. It now demands a
 * platform token, and "demands" has to mean something a test can break -- so
 * both of the obvious ways in are tried here, no token and a perfectly valid
 * tenant-admin token, and neither may create anything.
 */
test('creating an institution requires a platform token', async () => {
  const spec = (who: string) => ({
    name: 'Gatecrasher ' + RUN + ' ' + who,
    slug: 'gatecrash-' + who + '-' + RUN,
    admin: { name: 'Gatecrasher', email: mail('gatecrash.' + who), password: pw },
  });

  const anonymous = await api('/api/onyx/tenants', { body: spec('anon') });
  assert.equal(anonymous.status, 401, 'an unauthenticated caller created an institution');

  // A tenant admin is fully authenticated -- just not for this. A token that
  // opens one institution must not be able to mint another.
  const tenantAdmin = await api('/api/onyx/tenants', {
    token: world.alpha.token, body: spec('tenant-admin'),
  });
  assert.equal(tenantAdmin.status, 401,
    'a tenant admin token created an institution');

  // Neither attempt may have left anything behind.
  await withDb(async (c) => {
    const { rows } = await c.query(
      'SELECT slug FROM public."onyx_tenants" WHERE slug LIKE $1', ['gatecrash-%-' + RUN]);
    assert.equal(rows.length, 0, 'a refused create still landed: ' + JSON.stringify(rows));
  });
});

test('a slug can only belong to one institution', async () => {
  const res = await createTenant({
    name: A.name, slug: A.slug, admin: { name: 'x', email: mail('dupe'), password: pw },
  });
  assert.equal(res.ok, false);
  assert.equal(res.status, 422);
});

test('the token carries the tenant, and /me reports it', async () => {
  const claims = JSON.parse(
    Buffer.from(world.alpha.token.split('.')[1]!, 'base64url').toString());
  assert.equal(claims.tenant_id, world.alpha.id);
  assert.equal(claims.tenant_role, 'admin');
  // PostgREST needs this exact value to SET ROLE correctly (ADR-001).
  assert.equal(claims.role, 'authenticated');

  const me = await api('/api/onyx/me', { token: world.alpha.token });
  assert.equal(me.ok, true, me.message);
  assert.equal(Number(me.data.tenant.id), world.alpha.id);
  assert.equal(me.data.role, 'admin');
});

test('a token with no tenant claim is refused outright', async () => {
  // Forged with the real secret but no tenant_id: it verifies, and must still
  // be rejected. Defaulting a missing tenant is how a request reads the wrong
  // institution, so "no tenant" is 401 rather than "no tenant yet".
  const jwt = (await import('jsonwebtoken')).default;
  const now = Math.floor(Date.now() / 1000);
  const token = jwt.sign(
    { sub: '1', user_id: 1, role: 'authenticated', aud: 'authenticated',
      email: 'nobody@onyx.test', iat: now, exp: now + 600 },
    env.SUPABASE_JWT_SECRET!, { algorithm: 'HS256' });

  const res = await api('/api/onyx/me', { token });
  assert.equal(res.status, 401, 'a tenant-less token was accepted');
});

test('each institution builds its own roster', async () => {
  const add = async (token: string, who: string, role: string, email?: string) => {
    const res = await api<{ membership: { id: number } }>('/api/onyx/members', {
      token, body: { name: who, email: email ?? mail(who), role, password: pw },
    });
    assert.equal(res.ok, true, 'invite ' + who + ' failed: ' + res.message);
    return Number(res.data.membership.id);
  };

  world.alphaStudentMembership = await add(world.alpha.token, 'alpha.student', 'student');
  await add(world.alpha.token, 'alpha.faculty', 'faculty');
  world.betaStudentMembership = await add(world.beta.token, 'beta.student', 'student');

  // The same person, in both institutions, with a different role in each. This
  // is what roles-on-membership buys, and what a leak would expose fastest.
  await add(world.alpha.token, 'shared', 'faculty', world.shared.email);
  await add(world.beta.token, 'shared', 'student', world.shared.email);

  world.studentToken = await onyxLogin(mail('alpha.student'), pw);
});

test('an administrator sees their own roster and nobody else', async () => {
  const alpha = await api<any[]>('/api/onyx/members', { token: world.alpha.token });
  const beta = await api<any[]>('/api/onyx/members', { token: world.beta.token });
  assert.equal(alpha.ok, true, alpha.message);
  assert.equal(beta.ok, true, beta.message);

  const emails = (r: typeof alpha) => r.data.map((m) => m.user?.email);
  // admin + student + faculty + shared
  assert.equal(alpha.data.length, 4, 'alpha roster: ' + JSON.stringify(emails(alpha)));
  // admin + student + shared
  assert.equal(beta.data.length, 3, 'beta roster: ' + JSON.stringify(emails(beta)));

  assert.ok(!emails(alpha).includes(mail('beta.student')), 'alpha can see a beta student');
  assert.ok(!emails(beta).includes(mail('alpha.student')), 'beta can see an alpha student');
  assert.ok(!emails(beta).includes(mail('alpha.faculty')), 'beta can see alpha faculty');

  // Every row belongs to the caller's tenant, without exception.
  for (const m of alpha.data) assert.equal(Number(m.tenant_id), world.alpha.id);
  for (const m of beta.data) assert.equal(Number(m.tenant_id), world.beta.id);
});

test('the shared person is faculty in one institution and a student in the other', async () => {
  world.shared.alphaToken = await onyxLogin(world.shared.email, pw, world.alpha.id);
  world.shared.betaToken = await onyxLogin(world.shared.email, pw, world.beta.id);

  const inAlpha = await api('/api/onyx/me', { token: world.shared.alphaToken });
  const inBeta = await api('/api/onyx/me', { token: world.shared.betaToken });
  assert.equal(inAlpha.data.role, 'faculty');
  assert.equal(inBeta.data.role, 'student');
  assert.equal(inAlpha.data.user_id, inBeta.data.user_id, 'one identity, two memberships');

  // Faculty may read a roster; a student may not. Same person, same password.
  assert.equal((await api('/api/onyx/members', { token: world.shared.alphaToken })).status, 200);
  assert.equal((await api('/api/onyx/members', { token: world.shared.betaToken })).status, 403);
});

test('switching institutions works only between the ones you belong to', async () => {
  // Switching needs the caller's own refresh token, not just their access
  // token (see tenancy.service.ts's switchTenant()) -- onyxLogin() only
  // hands back the access token, so this signs in directly for the one
  // that also needs the pair.
  const signedIn = await api<{ token: string; refresh_token: string }>(
    '/api/onyx/auth/login', { body: { email: world.shared.email, password: pw, tenant_id: world.alpha.id } });
  assert.equal(signedIn.ok, true, signedIn.message);

  const switched = await api<{ token: string }>('/api/onyx/auth/switch', {
    token: signedIn.data.token,
    body: { tenant_id: world.beta.id, refresh_token: signedIn.data.refresh_token },
  });
  assert.equal(switched.ok, true, switched.message);
  assert.equal(switched.data.role, 'student');

  const claims = JSON.parse(
    Buffer.from(switched.data.token.split('.')[1]!, 'base64url').toString());
  assert.equal(claims.tenant_id, world.beta.id);
  assert.equal(claims.tenant_role, 'student', 'switching kept the old tenant role');

  // Alpha's admin belongs to Alpha only, so Beta is not a place they can go --
  // even though Beta plainly exists and its id is easy to guess.
  const adminSignedIn = await api<{ token: string; refresh_token: string }>(
    '/api/onyx/auth/login', { body: { email: world.alpha.adminEmail, password: pw, tenant_id: world.alpha.id } });
  const denied = await api('/api/onyx/auth/switch', {
    token: adminSignedIn.data.token,
    body: { tenant_id: world.beta.id, refresh_token: adminSignedIn.data.refresh_token },
  });
  assert.equal(denied.status, 403, 'an admin switched into an institution they do not belong to');
});

test('a membership id from another institution is not addressable', async () => {
  // Alpha's admin holds a valid admin token and a real membership id. The only
  // thing standing between them and Beta's roster is the tenant scope.
  const id = world.betaStudentMembership;

  const promoted = await api('/api/onyx/members/' + id, {
    token: world.alpha.token, method: 'PATCH', body: { role: 'admin' },
  });
  assert.equal(promoted.status, 404, 'cross-tenant role change was allowed');

  const removed = await api('/api/onyx/members/' + id, {
    token: world.alpha.token, method: 'DELETE',
  });
  assert.equal(removed.status, 404, 'cross-tenant removal was allowed');

  // ...and it is genuinely still there, not merely reported as absent.
  const beta = await api<any[]>('/api/onyx/members', { token: world.beta.token });
  assert.ok(beta.data.some((m) => Number(m.id) === id), 'beta lost a member to alpha');
});

test('role guards hold: a student cannot read or change the roster', async () => {
  assert.equal((await api('/api/onyx/members', { token: world.studentToken })).status, 403);
  assert.equal((await api('/api/onyx/members', {
    token: world.studentToken, body: { name: 'x', email: mail('sneak'), role: 'admin', password: pw },
  })).status, 403);
  assert.equal((await api('/api/onyx/members/' + world.alphaStudentMembership, {
    token: world.studentToken, method: 'DELETE',
  })).status, 403);
  assert.equal((await api('/api/onyx/audit', { token: world.studentToken })).status, 403);
});

test('an institution cannot be left without an administrator', async () => {
  const roster = await api<any[]>('/api/onyx/members', { token: world.beta.token });
  const admin = roster.data.find((m) => m.role === 'admin')!;

  const demoted = await api('/api/onyx/members/' + admin.id, {
    token: world.beta.token, method: 'PATCH', body: { role: 'student' },
  });
  assert.equal(demoted.status, 422, 'the only administrator demoted themselves');

  const removed = await api('/api/onyx/members/' + admin.id, {
    token: world.beta.token, method: 'DELETE',
  });
  assert.equal(removed.status, 422, 'the only administrator removed themselves');

  // With a second admin in place the first is free to go.
  const promoted = await api('/api/onyx/members/' + world.betaStudentMembership, {
    token: world.beta.token, method: 'PATCH', body: { role: 'admin' },
  });
  assert.equal(promoted.ok, true, promoted.message);
  const now = await api('/api/onyx/members/' + admin.id, {
    token: world.beta.token, method: 'PATCH', body: { role: 'faculty' },
  });
  assert.equal(now.ok, true, 'demotion still blocked with a second admin: ' + now.message);
});

test('the audit log records what happened, scoped to the institution', async () => {
  const alpha = await api<any[]>('/api/onyx/audit', { token: world.alpha.token });
  assert.equal(alpha.ok, true, alpha.message);

  const actions = alpha.data.map((r) => r.action);
  assert.ok(actions.includes('tenant.created'), 'no tenant.created entry');
  assert.ok(actions.includes('membership.created'), 'no membership.created entry');
  for (const row of alpha.data) assert.equal(Number(row.tenant_id), world.alpha.id);

  // Beta's role changes are Beta's business.
  const beta = await api<any[]>('/api/onyx/audit', { token: world.beta.token });
  assert.ok(beta.data.some((r) => r.action === 'membership.role_changed'),
    'beta role change was not recorded');
  assert.ok(!alpha.data.some((r) => r.action === 'membership.role_changed'),
    'alpha can read beta audit entries');

  // A role change records both sides, or it is not an audit trail.
  const change = beta.data.find((r) => r.action === 'membership.role_changed')!;
  assert.ok(change.before?.role && change.after?.role, 'role change kept no before/after');
  assert.ok(change.actor, 'audit entry has no actor');
});

/**
 * The API is not the boundary -- the database is. These go straight to
 * PostgREST with a tenant's own token, the way Realtime and any future
 * browser-side read would, and check the RLS policies rather than the guards.
 */
test('RLS confines a tenant token at the database, not just at the API', async () => {
  // The harness reads .env itself; the client reads process.env, and node --test
  // is not started with --env-file.
  for (const k of ['SUPABASE_URL', 'SUPABASE_ANON_KEY']) process.env[k] ??= env[k];
  const { onyxTenantClient } = await import('@onyx/core');
  const alpha = onyxTenantClient(world.alpha.token);

  const { data: tenants } = await alpha.from('onyx_tenants').select('id, slug');
  assert.equal(tenants?.length, 1, 'a tenant token saw ' + (tenants?.length ?? 0) + ' institutions');
  assert.equal(tenants![0]!.slug, A.slug);

  const { data: memberships } = await alpha.from('onyx_memberships').select('id, tenant_id');
  assert.ok(memberships!.length > 0, 'RLS hid the caller\'s own memberships');
  for (const m of memberships!) assert.equal(Number(m.tenant_id), world.alpha.id);

  // The identity table is shared, so this is the join that matters most: Beta's
  // people must be invisible even though the rows sit in the same table.
  const { data: users } = await alpha.from('onyx_users').select('id, email');
  const emails = users!.map((u) => u.email);
  assert.ok(emails.includes(mail('alpha.student')), 'RLS hid the caller\'s own students');
  assert.ok(!emails.includes(mail('beta.student')), 'a tenant token read another tenant\'s people');
  assert.ok(!emails.includes(world.beta.adminEmail), 'a tenant token read another tenant\'s admin');

  // Nobody reads the audit log directly: it has RLS and no select policy, so
  // the admin-only API route is the only way in.
  const { data: logs } = await alpha.from('onyx_audit_logs').select('id');
  assert.equal(logs?.length ?? 0, 0, 'audit logs are readable through PostgREST');

  // And a tenant token cannot write anything at all -- service role only.
  const { error } = await alpha.from('onyx_memberships')
    .insert({ tenant_id: world.alpha.id, user_id: 1, role: 'admin', status: 1 });
  assert.ok(error, 'a tenant token wrote to onyx_memberships');
});

test('every Onyx table is tenant-scoped, and cleanup leaves nothing behind', async () => {
  await withDb(async (c) => {
    // The guard from migration 0001, checked here too so a table added in a
    // later sprint fails the gate rather than the next isolation incident.
    const { rows: missing } = await c.query('SELECT * FROM onyx.assert_tenant_scoped()');
    assert.equal(missing.length, 0,
      'Onyx tables with no tenant_id: ' + missing.map((r) => r.missing).join(', '));

    // Cascades take memberships and audit rows with them.
    await c.query('DELETE FROM public."onyx_tenants" WHERE slug = ANY($1)', [[A.slug, B.slug]]);
    await c.query('DELETE FROM public."onyx_users" WHERE email LIKE $1', ['%.' + RUN + '@onyx.test']);

    const { rows: [left] } = await c.query(
      'SELECT count(*)::int c FROM public."onyx_memberships" m ' +
      'LEFT JOIN public."onyx_tenants" t ON t.id = m.tenant_id WHERE t.id IS NULL');
    assert.equal(left.c, 0, 'memberships outlived their institution');
  });
});
