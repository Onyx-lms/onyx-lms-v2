/**
 * Permission for a person, not only for a role.
 *
 * The role matrix answers "what may faculty do". The question institutions
 * actually ask is always narrower -- the lecturer who also runs the timetable,
 * the one exams officer trusted with fee structures -- and answering it through
 * the matrix means promoting everybody who shares their role. That is how a
 * permission system quietly becomes "everyone is an administrator".
 *
 * This is authorization, so the tests that matter are the refusals. Three
 * invariants have to survive, and each of them is the sort of thing that would
 * be invisible until somebody exploited it:
 *
 *   * **A personal grant cannot exceed the capability.** Several capabilities
 *     carry an empty `holders` list, which in this product means no
 *     institution may ever delegate them. Naming a person is not a way round
 *     that -- checked on write AND on read, so a row written before a
 *     capability was locked down cannot outlive the decision.
 *
 *   * **A revocation always works** -- except against an administrator, who
 *     cannot be locked out of their own institution.
 *
 *   * **The order is person, then role, then default.** Anything else and the
 *     two systems disagree about the same person.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  can, holdersOf, normalisePersonal, CAPABILITIES,
  type PermissionOverrides, type PersonalPermissions,
} from '../src/onyx/permissions.ts';

/**
 * A capability an institution MAY delegate to faculty.
 *
 * `holders` and `defaults` are different lists and conflating them is easy:
 * "faculty may be given this" is not "faculty has this". Both fixtures exist
 * so a test says which one it means.
 */
const DELEGABLE = CAPABILITIES.find((c) => c.holders.includes('faculty'))!;
/** One faculty hold out of the box, for the revocation cases. */
const HELD = CAPABILITIES.find((c) => c.defaults.includes('faculty'))!;
/** One it may never delegate to anybody -- `holders` is empty on purpose. */
const SEALED = CAPABILITIES.find((c) => c.holders.length === 0)!;

test('the catalogue still has both kinds, or these tests prove nothing', () => {
  // A guard on the fixtures themselves: if somebody gave every capability a
  // holders list, `SEALED` would be undefined and half of this file would
  // silently stop testing anything.
  assert.ok(DELEGABLE, 'no capability is delegable to faculty');
  assert.ok(HELD, 'no capability is held by faculty by default');
  assert.ok(SEALED, 'no capability is sealed -- the empty-holders case is gone');
});

// --------------------------------------------------------------- the grants

test('a person can be given something their role does not carry', async () => {
  const overrides: PermissionOverrides = { [DELEGABLE.key]: ['admin'] };
  // Their role has just been stripped of it...
  assert.equal(can('faculty', DELEGABLE.key, overrides), false);
  // ...but this one person keeps it.
  assert.equal(can('faculty', DELEGABLE.key, overrides, { [DELEGABLE.key]: true }), true);
});

test('a person can be refused something their role does carry', () => {
  // The other half, and just as real: a lecturer who should no longer publish
  // results, without changing what "faculty" means for the other forty.
  assert.ok(holdersOf(HELD.key).includes('faculty'), 'fixture: faculty holds it by default');
  assert.equal(can('faculty', HELD.key, null, { [HELD.key]: false }), false);
});

test('nothing personal is the same as nothing at all', () => {
  // "Follow their role" is the absence of a decision, not a third stored
  // value -- otherwise a row saying "granted, same as the role" would keep the
  // grant after the matrix took it away from the role.
  const withRole = can('faculty', DELEGABLE.key, null);
  assert.equal(can('faculty', DELEGABLE.key, null, {}), withRole);
  assert.equal(can('faculty', DELEGABLE.key, null, null), withRole);
  assert.equal(can('faculty', DELEGABLE.key, null, undefined), withRole);
});

// -------------------------------------------------------------- the refusals

test('a personal grant cannot reach past what the capability allows', () => {
  /*
   * The one that matters most.
   *
   * `fees.structures` and its kind are declared with an empty holders list --
   * no institution may ever delegate them below an administrator. If naming a
   * person got round that, the whole "never delegable" declaration would be
   * decoration.
   *
   * Refused on READ as well as on write, so a row stored before a capability
   * was sealed cannot outlive the decision to seal it.
   */
  assert.equal(can('faculty', SEALED.key, null, { [SEALED.key]: true }), false);
  assert.equal(can('exams', SEALED.key, null, { [SEALED.key]: true }), false);
  assert.equal(can('student', SEALED.key, null, { [SEALED.key]: true }), false);

  // And dropped before it can be stored.
  assert.deepEqual(normalisePersonal({ [SEALED.key]: true }, 'faculty'), {});
});

test('a grant to a role the capability never names is dropped', () => {
  // A student cannot be given the marking queue by name any more than by
  // matrix. `holders` is the list of roles this may EVER go to.
  const notForStudents = CAPABILITIES.find((c) =>
    c.holders.length > 0 && !c.holders.includes('student'))!;
  assert.ok(notForStudents, 'fixture: a capability students may never hold');
  assert.equal(can('student', notForStudents.key, null, { [notForStudents.key]: true }), false);
  assert.deepEqual(normalisePersonal({ [notForStudents.key]: true }, 'student'), {});
});

test('a revocation is honoured even where a grant would not be', () => {
  // Taking something away is always allowed. An institution narrowing what one
  // person may do should never be blocked by the same list that stops it
  // widening -- the list exists to cap reach, not to protect capabilities.
  assert.deepEqual(normalisePersonal({ [SEALED.key]: false }, 'faculty'),
    { [SEALED.key]: false });
  assert.equal(can('faculty', SEALED.key, null, { [SEALED.key]: false }), false);
});

test('an administrator cannot be locked out of their own institution', () => {
  /*
   * The same reasoning `holdersOf` uses when it puts `admin` back into any
   * stored override: a configuration that removes the last person who could
   * change it is not a configuration, it is a lockout with no way back that
   * does not involve us.
   */
  for (const cap of CAPABILITIES.slice(0, 12)) {
    assert.equal(can('admin', cap.key, null, { [cap.key]: false }), true,
      'an admin was locked out of ' + cap.key);
  }
});

test('rubbish in the stored object is ignored rather than trusted', () => {
  // The column is jsonb and this is a permission check. Anything not in the
  // catalogue, and anything that is not a boolean, is not a decision.
  const cleaned = normalisePersonal({
    [DELEGABLE.key]: true,
    'not.a.capability': true,
    'courses.create': 'yes' as unknown as boolean,
    '__proto__': true,
  }, 'faculty');
  assert.deepEqual(Object.keys(cleaned), [DELEGABLE.key]);

  // And an unknown key in a stored blob changes no answer.
  const odd = { 'not.a.capability': true } as unknown as PersonalPermissions;
  assert.equal(can('faculty', DELEGABLE.key, null, odd), can('faculty', DELEGABLE.key, null));
});

test('a person with no role holds nothing, whatever is stored about them', () => {
  assert.equal(can(null, DELEGABLE.key, null, { [DELEGABLE.key]: true }), false);
  assert.equal(can(undefined, DELEGABLE.key, null, { [DELEGABLE.key]: true }), false);
});

// ----------------------------------------------------------------- the order

test('the person beats the role, and the role beats the default', () => {
  const key = HELD.key;

  // Default: faculty holds it.
  assert.equal(can('faculty', key, null), true);
  // Institution takes it off faculty: the role now decides.
  assert.equal(can('faculty', key, { [key]: ['admin'] }), false);
  // This person is given it back by name: the person now decides.
  assert.equal(can('faculty', key, { [key]: ['admin'] }, { [key]: true }), true);
  // And taken away by name again, over a matrix that grants it.
  assert.equal(can('faculty', key, { [key]: ['admin', 'faculty'] }, { [key]: false }), false);
});
