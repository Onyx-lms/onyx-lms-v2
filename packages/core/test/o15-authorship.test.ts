/**
 * Onyx O15 -- who made this.
 *
 * The rule with the sharpest edge is the one with no column behind it: a
 * creator with NO membership at the institution is the platform operator. It
 * is right because of how the console writes -- an operator holds an
 * onyx_users row and belongs to nobody -- and it is the kind of rule that
 * quietly inverts if somebody later gives operators a membership "for
 * tidiness". These tests are what would catch that.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeDb } from './fake-db.ts';
import { authorsOf, withAuthors, AUTHOR_ROLE_LABELS } from '../src/onyx/authorship.ts';

const T = 1;
const OTHER = 2;

function world() {
  return new FakeDb({
    onyx_users: [
      { id: 'u-fac', name: 'Anjali Rao', email: 'anjali@mr.test' },
      { id: 'u-adm', name: 'Priya Nair', email: 'priya@mr.test' },
      { id: 'u-ops', name: 'Platform Operator', email: 'superadmin@onyx.platform' },
      { id: 'u-gone', name: 'Departed Lecturer', email: 'gone@mr.test' },
      { id: 'u-elsewhere', name: 'Someone Else', email: 'else@other.test' },
    ],
    onyx_memberships: [
      { id: 1, tenant_id: T, user_id: 'u-fac', role: 'faculty', status: 1 },
      { id: 2, tenant_id: T, user_id: 'u-adm', role: 'admin', status: 1 },
      // Left the institution: on the roll, not a member.
      { id: 3, tenant_id: T, user_id: 'u-gone', role: 'faculty', status: 0 },
      // Belongs to a DIFFERENT institution, which must not colour their
      // standing here.
      { id: 4, tenant_id: OTHER, user_id: 'u-elsewhere', role: 'admin', status: 1 },
    ],
  });
}

test('a creator is named with their standing at this institution', async () => {
  const found = await authorsOf(world() as never, T, ['u-fac', 'u-adm']);
  assert.equal(found.get('u-fac')?.name, 'Anjali Rao');
  assert.equal(found.get('u-fac')?.role, 'faculty');
  assert.equal(found.get('u-adm')?.role, 'admin');
});

test('a creator with no membership here is the platform operator', async () => {
  /*
   * The whole rule, and it needs no column: the console writes as an
   * onyx_users row that belongs to no institution, so "no membership" IS
   * "acting from outside". If operators are ever given memberships, this
   * fails -- which is the point of writing it down.
   */
  const found = await authorsOf(world() as never, T, ['u-ops']);
  assert.equal(found.get('u-ops')?.role, 'superadmin');
  assert.equal(AUTHOR_ROLE_LABELS[found.get('u-ops')!.role], 'Platform');
});

test('a membership at another institution does not name them here', async () => {
  // Administrator of institution 2, and nothing at institution 1. Reading the
  // membership without scoping it to the tenant would call them an
  // administrator on a record they touched as an outsider.
  const found = await authorsOf(world() as never, T, ['u-elsewhere']);
  assert.equal(found.get('u-elsewhere')?.role, 'superadmin');
  const there = await authorsOf(world() as never, OTHER, ['u-elsewhere']);
  assert.equal(there.get('u-elsewhere')?.role, 'admin');
});

test('a withdrawn membership does not name them either', async () => {
  // Status 0 is "left". They wrote the paper and they are no longer faculty,
  // so the byline says the institution no longer vouches for them -- which is
  // true, and better than saying they still teach here.
  const found = await authorsOf(world() as never, T, ['u-gone']);
  assert.equal(found.get('u-gone')?.role, 'superadmin');
  assert.equal(found.get('u-gone')?.name, 'Departed Lecturer');
});

test('an author who no longer exists is absent, not a placeholder', async () => {
  const found = await authorsOf(world() as never, T, ['u-deleted']);
  assert.equal(found.get('u-deleted'), undefined);
  const [row] = await withAuthors(world() as never, T,
    [{ id: 9, created_by: 'u-deleted' }]);
  // Null rather than an invented name: the screen says "Not recorded".
  assert.equal(row.author, null);
});

test('nothing is asked when nothing has an author', async () => {
  const db = world();
  const found = await authorsOf(db as never, T, [null, undefined, '']);
  assert.equal(found.size, 0);
  assert.deepEqual(await withAuthors(db as never, T, []), []);
});

test('rows keep everything they had, plus the byline', async () => {
  const rows = await withAuthors(world() as never, T, [
    { id: 1, name: 'Mid-term', created_by: 'u-fac' },
    { id: 2, name: 'Resit', created_by: null },
  ]);
  assert.equal(rows[0].name, 'Mid-term');
  assert.equal(rows[0].author?.name, 'Anjali Rao');
  assert.equal(rows[1].author, null);
});
