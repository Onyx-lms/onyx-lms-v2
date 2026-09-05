/**
 * What the platform withholds, and why it has to outrank everything.
 *
 * 0023 gave an institution a matrix and, correctly, made `admin` un-revokable
 * inside it: an administrator who can take away their own last capability has
 * locked the institution out with nobody left to undo it.
 *
 * That rule was then load-bearing in a place it was never meant to be. An
 * operator selling this product could open a customer's permission screen,
 * clear "Issue certificates" for every role, get a 200 back, and change
 * nothing -- `holdersOf` put `admin` straight back and the institution carried
 * on issuing. Confirmed against the live deployment: the save returned 200,
 * holders_now came back ["admin"], and the tenant administrator then issued a
 * credential anyway.
 *
 * So a denial is stored apart from the institution's own matrix and is checked
 * before any of it. The tests that matter are the ones proving nothing
 * underneath can reach past it -- not the role matrix, not the admin floor,
 * not a grant made about one person by name.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  can, holdersOf, normaliseDenials, isDenied,
  defaultDenials, needsPlatformGrant, GRANT_REQUIRED,
  type PermissionOverrides, type PersonalPermissions, type PlatformDenials,
} from '../src/onyx/permissions.ts';

const CERTS = 'careers.certificates' as const;

test('a denial beats the admin floor -- the whole point', () => {
  const denied: PlatformDenials = [CERTS];
  // Without it, the documented behaviour: admin always holds it.
  assert.equal(can('admin', CERTS), true);
  assert.deepEqual(holdersOf(CERTS), ['admin']);
  // With it, nobody does -- including admin.
  assert.equal(can('admin', CERTS, {}, {}, denied), false);
  assert.deepEqual(holdersOf(CERTS, {}, denied), []);
});

test('the institution cannot grant back what the platform withheld', () => {
  const denied: PlatformDenials = [CERTS];
  // The tenant matrix says placement and faculty may issue.
  const overrides: PermissionOverrides = { [CERTS]: ['admin', 'placement', 'faculty'] };
  for (const role of ['admin', 'placement', 'faculty', 'exams'] as const) {
    assert.equal(can(role, CERTS, overrides, {}, denied), false, role + ' must be refused');
  }
  assert.deepEqual(holdersOf(CERTS, overrides, denied), []);
});

test('a personal grant cannot reach past a denial either', () => {
  const denied: PlatformDenials = [CERTS];
  const personal: PersonalPermissions = { [CERTS]: true };
  assert.equal(can('placement', CERTS, {}, personal, denied), false);
  assert.equal(can('admin', CERTS, {}, personal, denied), false);
});

test('lifting the denial restores exactly what was there before', () => {
  const overrides: PermissionOverrides = { [CERTS]: ['admin', 'placement'] };
  const before = holdersOf(CERTS, overrides);
  assert.deepEqual(holdersOf(CERTS, overrides, [CERTS]), []);
  assert.deepEqual(holdersOf(CERTS, overrides, []), before);
  assert.equal(can('placement', CERTS, overrides, {}, []), true);
});

test('denying one capability does not touch any other', () => {
  const denied: PlatformDenials = [CERTS];
  assert.equal(can('admin', 'exams.publish', {}, {}, denied), true);
  assert.equal(can('admin', 'fees.invoice', {}, {}, denied), true);
  assert.equal(isDenied('exams.publish', denied), false);
});

test('normaliseDenials keeps only real capabilities, and de-duplicates', () => {
  assert.deepEqual(normaliseDenials([CERTS, CERTS, 'not.a.capability', 42, null]), [CERTS]);
  assert.deepEqual(normaliseDenials('careers.certificates'), []);   // not an array
  assert.deepEqual(normaliseDenials(undefined), []);
});

test('an institution with nothing withheld behaves exactly as before', () => {
  // The migration defaults every tenant to [], so this is the live path for
  // every institution until an operator says otherwise.
  for (const denied of [[], null, undefined] as const) {
    assert.equal(can('admin', CERTS, {}, {}, denied), true);
    assert.deepEqual(holdersOf(CERTS, {}, denied), ['admin']);
  }
});

/**
 * The half that answers "an administrator needs permission from the platform
 * before they get access", rather than "the platform can take it away".
 *
 * Same one stored list either way -- the only difference is where a new
 * institution starts. Seeded at creation, never applied retroactively, so an
 * institution already issuing credentials does not lose them because this list
 * grew after they signed up.
 */
test('a new institution starts without the grant-required capabilities', () => {
  const fresh = defaultDenials();
  assert.deepEqual(fresh, [...GRANT_REQUIRED]);
  assert.ok(fresh.includes(CERTS), 'issuing credentials is the platform\'s to grant');
  // Its administrator holds everything else, and not this.
  assert.equal(can('admin', CERTS, {}, {}, fresh), false);
  assert.equal(can('admin', 'exams.publish', {}, {}, fresh), true);
});

test('granting it is just removing it from the list', () => {
  const fresh = defaultDenials();
  assert.equal(can('admin', CERTS, {}, {}, fresh), false);
  const granted = fresh.filter((k) => k !== CERTS);
  assert.equal(can('admin', CERTS, {}, {}, granted), true);
  assert.deepEqual(holdersOf(CERTS, {}, granted), ['admin']);
});

test('needsPlatformGrant marks only the capabilities that require it', () => {
  assert.equal(needsPlatformGrant(CERTS), true);
  assert.equal(needsPlatformGrant('exams.publish'), false);
  assert.equal(needsPlatformGrant('fees.invoice'), false);
});

test('defaultDenials hands back a fresh array each time', () => {
  // A caller that mutates what it was given must not edit the catalogue.
  const a = defaultDenials();
  a.push('fees.invoice');
  assert.deepEqual(defaultDenials(), [...GRANT_REQUIRED]);
});
