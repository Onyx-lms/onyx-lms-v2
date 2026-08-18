/**
 * Onyx O01 unit tests -- the decisions the E2E cannot reach cheaply.
 *
 * The E2E proves isolation against the real database. These cover the rules
 * that live in the service and the token: what happens at the edges, where a
 * mistake is silent rather than loud.
 *
 * Since docs/ADR-011-supabase-auth-migration.md, tokens are Supabase
 * Auth-issued and cryptographically verified against the project's real
 * JWKS -- nothing outside GoTrue can forge one that passes verifyOnyxToken(),
 * so that step is e2e-only coverage (see o08-authorization-matrix.e2e.ts).
 * What's left to unit-test here is the claim-SHAPE validation
 * (assertUsableOnyxClaims(), split out of requireOnyx() for exactly this
 * reason) and the tenancy service against a fake database and a fake
 * Supabase Auth client (fake-auth.ts) standing in for GoTrue.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeDb } from './fake-db.ts';
import { FakeAuth } from './fake-auth.ts';
import { TenancyService, ROLES } from '../src/onyx/tenancy.service.ts';
import { AuditService } from '../src/onyx/audit.service.ts';
import {
  extractOnyxToken, assertUsableOnyxClaims, assertSameTenant, type OnyxTokenClaims,
} from '../src/onyx/auth.ts';
import { HttpError } from '../src/http/errors.ts';

const req = (token?: string, cookie?: string) => ({
  headers: token ? { authorization: 'Bearer ' + token } : {},
  cookies: cookie ? { onyx_session: cookie } : undefined,
});

/** A claims object shaped like one the Custom Access Token Hook would stamp. */
const claims = (over: Partial<OnyxTokenClaims> = {}): OnyxTokenClaims => ({
  sub: 'user-1', user_id: 'user-1', tenant_id: 7, role: 'authenticated',
  tenant_role: 'admin', email: 'a@onyx.test', aud: 'authenticated',
  iat: 0, exp: 9_999_999_999, ...over,
});

// ---------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------

test('the cookie is read when there is no bearer header', () => {
  assert.equal(extractOnyxToken(req('tok')), 'tok');
  assert.equal(extractOnyxToken(req(undefined, 'tok')), 'tok');
  assert.equal(extractOnyxToken(req()), null);
});

test('claims carry the tenant and the role held inside them', () => {
  const c = assertUsableOnyxClaims(claims());
  assert.equal(c.tenant_id, 7);
  assert.equal(c.tenant_role, 'admin');
  assert.equal(c.user_id, 'user-1');
  // PostgREST SET ROLEs on this; anything else and every RLS policy misfires.
  assert.equal(c.role, 'authenticated');
});

test('claims with no usable tenant are refused rather than defaulted', () => {
  // Defaulting a missing tenant is how a request reads the wrong institution,
  // so each of these is a 401 and not "tenant 0" or "tenant undefined".
  for (const bad of [undefined, null, 0, -1, 1.5, '7']) {
    assert.throws(() => assertUsableOnyxClaims(claims({ tenant_id: bad as never })),
      (e: HttpError) => e.status === 401, 'tenant_id=' + JSON.stringify(bad) + ' was accepted');
  }
});

test('claims with a tenant but no role are refused', () => {
  assert.throws(() => assertUsableOnyxClaims(claims({ tenant_role: undefined as never })),
    (e: HttpError) => e.status === 401);
});

test('role guards allow exactly the roles named', () => {
  for (const role of ROLES) {
    const c = assertUsableOnyxClaims(claims({ tenant_role: role }));
    assert.equal(c.tenant_role, role);
    const others = ROLES.filter((r) => r !== role);
    assert.equal(others.includes(c.tenant_role), false, role + ' should not pass a guard for ' + others.join('/'));
  }
});

test('a tenant id from a request is checked against the token, not trusted', () => {
  const c = assertUsableOnyxClaims(claims());
  assert.doesNotThrow(() => assertSameTenant(c, 7));
  assert.throws(() => assertSameTenant(c, 8), (e: HttpError) => e.status === 403);
});

// ---------------------------------------------------------------------------
// Tenancy
// ---------------------------------------------------------------------------

const PW = 'Secret#2026';

async function make() {
  const auth = new FakeAuth();
  const alphaAdmin = auth.seed('admin@alpha.test', PW);
  const shared = auth.seed('shared@both.test', PW);
  const suspended = auth.seed('suspended@alpha.test', PW);
  const nobody = auth.seed('nobody@nowhere.test', PW);
  const ghost = auth.seed('ghost@closed.test', PW);

  const db = new FakeDb({
    onyx_tenants: [
      { id: 1, name: 'Alpha University', slug: 'alpha', status: 1, plan: null },
      { id: 2, name: 'Beta Institute', slug: 'beta', status: 1, plan: null },
      { id: 3, name: 'Closed College', slug: 'closed', status: 0, plan: null },
    ],
    onyx_users: [
      { id: alphaAdmin, email: 'admin@alpha.test', name: 'Alpha Admin', status: 1 },
      { id: shared, email: 'shared@both.test', name: 'Shared', status: 1 },
      { id: suspended, email: 'suspended@alpha.test', name: 'Suspended', status: 0 },
      { id: nobody, email: 'nobody@nowhere.test', name: 'Nobody', status: 1 },
      { id: ghost, email: 'ghost@closed.test', name: 'Ghost', status: 1 },
    ],
    onyx_memberships: [
      { id: 100, tenant_id: 1, user_id: alphaAdmin, role: 'admin', status: 1 },
      { id: 101, tenant_id: 1, user_id: shared, role: 'faculty', status: 1 },
      { id: 102, tenant_id: 2, user_id: shared, role: 'student', status: 1 },
      { id: 103, tenant_id: 1, user_id: suspended, role: 'student', status: 1 },
      { id: 104, tenant_id: 2, user_id: alphaAdmin, role: 'admin', status: 1 },
      { id: 105, tenant_id: 2, user_id: nobody, role: 'student', status: 1 },
      { id: 106, tenant_id: 3, user_id: ghost, role: 'admin', status: 1 },
    ],
    onyx_audit_logs: [],
    onyx_enrollments: [],
  });
  const svc = new TenancyService(db as never, auth as never, auth as never);
  return { db, auth, svc, ids: { alphaAdmin, shared, suspended, nobody, ghost } };
}

test('an institution and its first administrator are created together', async () => {
  const { db, svc } = await make();
  const { tenant, admin } = await svc.createTenant({
    name: 'Gamma Polytechnic',
    admin: { name: 'G Admin', email: 'g@gamma.test', password: 'Secret#2026' },
  });
  assert.equal(tenant!.slug, 'gamma-polytechnic');
  // An institution with no admin cannot be fixed from inside it.
  const m = db.tables.onyx_memberships!.find((r) => r.user_id === admin.id)!;
  assert.equal(m.tenant_id, tenant!.id);
  assert.equal(m.role, 'admin');
});

test('a name that yields no usable address is rejected before anything is written', async () => {
  const { db, svc } = await make();
  const before = db.tables.onyx_tenants!.length;
  await assert.rejects(svc.createTenant({
    name: '!!!', admin: { name: 'x', email: 'x@x.test', password: 'Secret#2026' },
  }), (e: HttpError) => e.status === 422);
  assert.equal(db.tables.onyx_tenants!.length, before, 'a tenant was written anyway');
});

test('a slug belongs to one institution', async () => {
  const { svc } = await make();
  await assert.rejects(svc.createTenant({
    name: 'Alpha University', slug: 'alpha',
    admin: { name: 'x', email: 'x@x.test', password: 'Secret#2026' },
  }), (e: HttpError) => e.status === 422);

  // And when two signups race past that check, the unique constraint answers
  // with the same 422 rather than a 500 -- the race is caught before
  // upsertUser() ever runs, so no auth double is needed here.
  const racing = new TenancyService({
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }),
      insert: () => ({ select: () => ({ maybeSingle: async () =>
        ({ data: null, error: { code: '23505', message: 'duplicate key' } }) }) }),
    }),
  } as never);
  await assert.rejects(racing.createTenant({
    name: 'Delta School',
    admin: { name: 'x', email: 'x@x.test', password: 'Secret#2026' },
  }), (e: HttpError) => e.status === 422);
});

test('inviting an existing address attaches the person, it does not clone them', async () => {
  const { db, svc, ids } = await make();
  const before = db.tables.onyx_users!.length;
  const { user } = await svc.invite(3, {
    name: 'Different Name', email: 'ADMIN@Alpha.test', role: 'faculty',
  });
  // Same identity, matched case-insensitively -- a second row here is how one
  // person ends up locked out of half their institutions.
  assert.equal(user.id, ids.alphaAdmin);
  assert.equal(db.tables.onyx_users!.length, before);
});

test('one person, one role per institution', async () => {
  const { svc, ids } = await make();
  await assert.rejects(svc.addMember(1, ids.alphaAdmin, 'student'), (e: HttpError) => e.status === 422);
});

test('a role has to be a role', async () => {
  const { svc, ids } = await make();
  await assert.rejects(svc.addMember(1, ids.nobody, 'superuser' as never),
    (e: HttpError) => e.status === 422);
  await assert.rejects(svc.changeRole(1, 101, 'owner' as never),
    (e: HttpError) => e.status === 422);
});

test('the switcher lists every live institution a person belongs to', async () => {
  const { svc, ids } = await make();
  const shared = await svc.membershipsFor(ids.shared);
  assert.deepEqual(shared.map((m) => m.tenant.slug).sort(), ['alpha', 'beta']);
  // Roles are per membership: the same person, two different things.
  assert.deepEqual(shared.map((m) => m.role).sort(), ['faculty', 'student']);
});

test('a membership of a suspended institution is not a way in', async () => {
  const { svc, ids } = await make();
  assert.deepEqual(await svc.membershipsFor(ids.ghost), []);
  await assert.rejects(svc.signIn('ghost@closed.test', PW),
    (e: HttpError) => e.status === 403);
});

test('a member of one institution is not addressable from another', async () => {
  const { svc } = await make();
  // Membership 102 is real and belongs to Beta. Alpha's admin holds a valid
  // token; the tenant scope is the only thing in the way.
  await assert.rejects(svc.changeRole(1, 102, 'admin'), (e: HttpError) => e.status === 404);
  await assert.rejects(svc.removeMember(1, 102), (e: HttpError) => e.status === 404);
  // 404 rather than 403: whether that id exists is not Alpha's business.
});

test('the last administrator cannot demote or remove themselves', async () => {
  const { svc } = await make();
  await assert.rejects(svc.changeRole(1, 100, 'student'), (e: HttpError) => e.status === 422);
  await assert.rejects(svc.removeMember(1, 100), (e: HttpError) => e.status === 422);

  // With a second admin appointed, the first is free to go.
  await svc.changeRole(1, 101, 'admin');
  assert.deepEqual(await svc.changeRole(1, 100, 'faculty'), { id: 100, from: 'admin', to: 'faculty' });
});

test('a roster is one institution and is searchable within it', async () => {
  const { svc } = await make();
  const alpha = await svc.members(1);
  assert.deepEqual(alpha.map((m) => m.id).sort(), [100, 101, 103]);
  for (const m of alpha) assert.equal(m.tenant_id, 1);

  assert.deepEqual((await svc.members(1, { role: 'admin' })).map((m) => m.id), [100]);
  // Search covers name and address, case-insensitively.
  assert.deepEqual((await svc.members(1, { search: 'SHARED@both' })).map((m) => m.id), [101]);
  assert.deepEqual((await svc.members(1, { search: 'alpha admin' })).map((m) => m.id), [100]);
  assert.deepEqual(await svc.members(1, { search: 'nobody' }), []);
});

test('sign-in tells an attacker nothing about which addresses exist', async () => {
  const { svc } = await make();
  const wrongPassword = await svc.signIn('admin@alpha.test', 'wrong').catch((e) => e);
  const noSuchPerson = await svc.signIn('ghost@nowhere.test', 'wrong').catch((e) => e);
  assert.equal(wrongPassword.status, 401);
  assert.equal(noSuchPerson.status, 401);
  assert.equal(wrongPassword.message, noSuchPerson.message);
});

test('sign-in picks the named institution, and refuses one you do not belong to', async () => {
  const { svc } = await make();
  const beta = await svc.signIn('shared@both.test', PW, 2);
  assert.equal(beta.membership.role, 'student');
  const alpha = await svc.signIn('shared@both.test', PW, 1);
  assert.equal(alpha.membership.role, 'faculty');

  await assert.rejects(svc.signIn('shared@both.test', PW, 3),
    (e: HttpError) => e.status === 403);
});

test('signing in points the session at the chosen tenant', async () => {
  const { svc, auth } = await make();
  const result = await svc.signIn('shared@both.test', PW, 2);
  assert.equal(result.session.access_token.includes(result.user.id), true);
  // setActiveTenant() ran before the session was minted, so a refresh sees it.
  const refreshed = await auth.auth.refreshSession({ refresh_token: result.session.refresh_token });
  assert.equal(refreshed.error, null);
});

test('a suspended account cannot sign in even with the right password', async () => {
  const { svc } = await make();
  await assert.rejects(svc.signIn('suspended@alpha.test', PW),
    (e: HttpError) => e.status === 403);
});

test('an account belonging to no institution is told so, not let in', async () => {
  const { db, svc, ids } = await make();
  db.tables.onyx_memberships = db.tables.onyx_memberships!.filter((m) => m.user_id !== ids.nobody);
  await assert.rejects(svc.signIn('nobody@nowhere.test', PW),
    (e: HttpError) => e.status === 403);
});

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

test('an audit entry records the actor, the tenant and both sides of the change', async () => {
  const { db } = await make();
  const audit = new AuditService(db as never);
  await audit.record({ tenant_id: 1, user_id: 'user-10' }, {
    action: 'membership.role_changed', entityType: 'membership', entityId: 101,
    before: { role: 'faculty' }, after: { role: 'admin' }, ip: '203.0.113.9',
  });
  const [row] = db.tables.onyx_audit_logs as Record<string, unknown>[];
  assert.equal(row!.tenant_id, 1);
  assert.equal(row!.actor_id, 'user-10');
  assert.deepEqual(row!.before, { role: 'faculty' });
  assert.deepEqual(row!.after, { role: 'admin' });
  assert.equal(row!.ip, '203.0.113.9');
});

test('a system action has no actor rather than a fabricated one', async () => {
  const { db } = await make();
  await new AuditService(db as never).recordSystem(1, {
    action: 'tenant.created', entityType: 'tenant', entityId: 1,
  });
  // actor_id is a foreign key to a real person; a placeholder id would fail it
  // and the entry would be lost.
  assert.equal((db.tables.onyx_audit_logs as Record<string, unknown>[])[0]!.actor_id, null);
});

test('a failed audit write is reported, never thrown', async () => {
  // The row describes work that already happened. Throwing here would undo it.
  const broken = {
    from: () => ({ insert: async () => ({ error: { message: 'disk on fire' } }) }),
  };
  const seen: string[] = [];
  const audit = new AuditService(broken as never, (m) => seen.push(m));
  await audit.record({ tenant_id: 1, user_id: 'user-10' },
    { action: 'certificate.revoked', entityType: 'certificate', entityId: 5 });
  assert.equal(seen.length, 1);
  assert.match(seen[0]!, /certificate\.revoked/);
  assert.match(seen[0]!, /disk on fire/);
});

test('the audit log reads one institution, newest first', async () => {
  const { db, ids } = await make();
  const audit = new AuditService(db as never);
  await audit.record({ tenant_id: 1, user_id: ids.alphaAdmin },
    { action: 'membership.created', entityType: 'membership', entityId: 101 });
  await audit.record({ tenant_id: 2, user_id: ids.alphaAdmin },
    { action: 'membership.removed', entityType: 'membership', entityId: 102 });
  await audit.record({ tenant_id: 1, user_id: ids.alphaAdmin },
    { action: 'certificate.issued', entityType: 'certificate', entityId: 9 });

  const alpha = await audit.list(1);
  assert.deepEqual(alpha.map((r) => r.action), ['certificate.issued', 'membership.created']);
  for (const r of alpha) assert.equal(r.tenant_id, 1);
  assert.equal(alpha[0]!.actor?.email, 'admin@alpha.test');

  assert.deepEqual((await audit.list(1, { action: 'certificate.issued' })).map((r) => r.entity_id), [9]);
  assert.deepEqual(await audit.list(1, { entityType: 'nothing' }), []);
});

test('a caller cannot ask the audit log for more than it will give', async () => {
  const { db } = await make();
  const audit = new AuditService(db as never);
  for (let i = 0; i < 600; i += 1) {
    (db.tables.onyx_audit_logs as Record<string, unknown>[]).push({
      id: i + 1, tenant_id: 1, actor_id: null, action: 'fee.updated',
      entity_type: 'fee', entity_id: i,
    });
  }
  assert.equal((await audit.list(1, { limit: 10_000 })).length, 500);
});

// ---------------------------------------------------------------------------
// CMP-01 -- roll numbers
// ---------------------------------------------------------------------------

test('an institution sets its own number for somebody, and it must be unique there', async () => {
  const { svc } = await make();
  const a = await svc.invite(1, {
    name: 'Aditya Pillai', email: 'aditya@x.test', role: 'student', roll_number: 'CS-2024-014' });
  assert.equal(a.membership.roll_number, 'CS-2024-014');

  // Everybody gets one -- a staff ID is the same idea, and the registry works
  // from it just as the examinations office does.
  const staff = await svc.invite(1, {
    name: 'Dr. Arun Menon', email: 'arun@x.test', role: 'faculty', roll_number: 'STAFF-07' });
  assert.equal(staff.membership.roll_number, 'STAFF-07');

  // Case-insensitively unique: CS-2024-014 and cs-2024-014 are the same person
  // to everybody except a database.
  await assert.rejects(
    svc.invite(1, { name: 'Someone Else', email: 'else@x.test',
      role: 'student', roll_number: 'cs-2024-014' }),
    (e: HttpError) => e.status === 409 && /Aditya Pillai/.test(e.message));
});

test('a roll number belongs to the institution, not to the account', async () => {
  const { svc } = await make();
  const first = await svc.invite(1, {
    name: 'Visiting Lecturer', email: 'visitor@x.test', role: 'faculty', roll_number: 'VL-1' });

  // The same person at a second institution, under that institution's own
  // number. Putting the roll on the user row would force one identity across
  // institutions that do not share one.
  const second = await svc.addMember(2, first.user.id, 'faculty', 'VL-1');
  assert.equal(second.roll_number, 'VL-1');
  assert.notEqual(second.tenant_id, first.membership.tenant_id);

  // The same account, listed at both, each under that institution's number.
  const here = (await svc.members(1)).find((m) => String(m.user_id) === first.user.id);
  const there = (await svc.members(2)).find((m) => String(m.user_id) === first.user.id);
  assert.equal(here!.roll_number, 'VL-1');
  assert.equal(there!.roll_number, 'VL-1');
  assert.notEqual(here!.id, there!.id);
});

test('an administrator can correct or clear a roll number', async () => {
  const { svc } = await make();
  const m = await svc.invite(1, {
    name: 'Meera Nair', email: 'meera@x.test', role: 'student', roll_number: 'CS-2024-020' });
  const id = Number(m.membership.id);

  const fixed = await svc.updateMember(1, id, { roll_number: 'CS-2024-021' });
  assert.equal(fixed.membershipChange!.after.roll_number, 'CS-2024-021');

  // Blank clears it. An administrator who typed one onto the wrong person, or
  // an institution that stops using them, needs a way back.
  const cleared = await svc.updateMember(1, id, { roll_number: '  ' });
  assert.equal(cleared.membershipChange!.after.roll_number, null);

  // ...and a member can exist without one at all.
  const none = await svc.invite(1, {
    name: 'No Number', email: 'none@x.test', role: 'student' });
  assert.equal(none.membership.roll_number, null);
});

test('a roster can be searched by roll number', async () => {
  const { svc } = await make();
  await svc.invite(1, {
    name: 'Karthik Subramanian', email: 'k@x.test', role: 'student', roll_number: 'CS-2024-031' });
  await svc.invite(1, { name: 'Other Person', email: 'o@x.test', role: 'student' });

  // Staff have the number in front of them, off a register or a script -- and
  // a search that does not match it is a convincing way to conclude somebody
  // is not enrolled.
  const found = await svc.members(1, { search: 'cs-2024-031' });
  assert.equal(found.length, 1);
  assert.equal(found[0]!.user?.name, 'Karthik Subramanian');
});

// ---------------------------------------------------------------------------
// CMP-05 -- who is in a lecturer's directory
// ---------------------------------------------------------------------------

test('a lecturer sees the students they teach, and no other learner', async () => {
  const { db, svc } = await make();
  // Two students; only one is on the course this lecturer teaches.
  const mine = await svc.invite(1, { name: 'Mine', email: 'mine@x.test', role: 'student' });
  const theirs = await svc.invite(1, { name: 'Theirs', email: 'theirs@x.test', role: 'student' });
  (db.tables.onyx_enrollments as Record<string, unknown>[]).push(
    { id: 1, tenant_id: 1, course_id: 7, user_id: mine.user.id, status: 1 },
    { id: 2, tenant_id: 1, course_id: 8, user_id: theirs.user.id, status: 1 });

  const seen = await svc.members(1, { onlyStudentsOn: [7] });
  const emails = seen.filter((m) => m.role === 'student').map((m) => m.user?.email);
  assert.deepEqual(emails, ['mine@x.test']);
  assert.ok(!emails.includes('theirs@x.test'),
    'a lecturer was shown a learner they do not teach');
});

test('colleagues keep their names but lose their contact details', async () => {
  const { db, svc } = await make();
  const student = await svc.invite(1, { name: 'Mine', email: 'mine@x.test', role: 'student' });
  (db.tables.onyx_enrollments as Record<string, unknown>[]).push(
    { id: 1, tenant_id: 1, course_id: 7, user_id: student.user.id, status: 1 });

  const seen = await svc.members(1, { onlyStudentsOn: [7] });
  const colleague = seen.find((m) => m.role === 'admin');
  // Redacted, not removed: a timetable naming who teaches the next session,
  // or a picker for a second lecturer on a course, are not directory lookups
  // -- dropping staff would turn those screens back into raw ids.
  assert.ok(colleague, 'staff disappeared entirely');
  assert.ok(colleague!.user?.name, 'a colleague lost their name');
  assert.equal(colleague!.user?.email, '', 'a colleague’s email was still readable');
});

test('a lecturer teaching nothing sees no learners at all', async () => {
  const { db, svc } = await make();
  const student = await svc.invite(1, { name: 'Mine', email: 'mine@x.test', role: 'student' });
  (db.tables.onyx_enrollments as Record<string, unknown>[]).push(
    { id: 1, tenant_id: 1, course_id: 7, user_id: student.user.id, status: 1 });

  // No courses means no students -- emphatically not "see everybody", which is
  // the way an empty filter list usually fails.
  const seen = await svc.members(1, { onlyStudentsOn: [] });
  assert.equal(seen.filter((m) => m.role === 'student').length, 0);
});

test('an administrator still gets the whole roster', async () => {
  const { svc } = await make();
  await svc.invite(1, { name: 'A', email: 'a@x.test', role: 'student' });
  await svc.invite(1, { name: 'B', email: 'b@x.test', role: 'student' });
  const all = await svc.members(1);
  const emails = all.filter((m) => m.role === 'student').map((m) => m.user?.email);
  assert.ok(emails.includes('a@x.test') && emails.includes('b@x.test'));
});
