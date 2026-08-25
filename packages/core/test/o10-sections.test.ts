/**
 * Onyx O10 unit tests -- teaching divisions, and what they decide.
 *
 * A section is the group a learner is actually taught with: Alpha, Beta and
 * Gamma at one institution, Section A, B and C at the next. The rule that
 * matters is the one every screen and every route has to agree on, so it lives
 * in one exported function and is tested here rather than in five places:
 *
 *   * a paper with NO section is for everybody, which is what every row
 *     written before sections existed means and must keep meaning;
 *   * a paper WITH one is for the people in it and nobody else.
 *
 * Getting the first half wrong hides every existing paper from every learner
 * at once. Getting the second wrong deals one section's examination to another.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeDb } from './fake-db.ts';
import { OnyxSectionsService, isForSection } from '../src/onyx/sections.service.ts';
import type { OnyxDb } from '../src/onyx/db.ts';
import { HttpError } from '../src/http/errors.ts';

const T = 1;
const OTHER = 2;
/** An institution with no sections at all, for the seeding tests. */
const FRESH = 3;

function world() {
  const db = new FakeDb({
    onyx_sections: [
      { id: 10, tenant_id: T, name: 'Alpha', code: 'alpha', sort: 1, status: 1,
        created_at: 'now', updated_at: 'now' },
      { id: 11, tenant_id: T, name: 'Beta', code: 'beta', sort: 2, status: 1,
        created_at: 'now', updated_at: 'now' },
      { id: 12, tenant_id: OTHER, name: 'Section A', code: 'a', sort: 1, status: 1,
        created_at: 'now', updated_at: 'now' },
    ],
    onyx_memberships: [
      { id: 100, tenant_id: T, user_id: 'u-alpha', role: 'student', status: 1, section_id: 10 },
      { id: 101, tenant_id: T, user_id: 'u-beta', role: 'student', status: 1, section_id: 11 },
      { id: 102, tenant_id: T, user_id: 'u-none', role: 'student', status: 1, section_id: null },
      { id: 103, tenant_id: T, user_id: 'u-staff', role: 'faculty', status: 1, section_id: null },
    ],
    onyx_assessments: [],
    onyx_exams: [],
  }, { onyx_sections: [['tenant_id', 'code']] });
  return { db, sections: new OnyxSectionsService(db as unknown as OnyxDb) };
}

// ------------------------------------------------------------------ the rule

test('LRN-10 a paper with no section is for everybody, including nobody in one', () => {
  // The compatibility claim. Every assessment and exam that existed before
  // this feature has a null section, and all of them have to stay visible.
  assert.equal(isForSection(null, 10), true);
  assert.equal(isForSection(undefined, 10), true);
  assert.equal(isForSection(null, null), true);
});

test('LRN-10 a paper for one section is for that section and nobody else', () => {
  assert.equal(isForSection(10, 10), true);
  assert.equal(isForSection(10, 11), false);
  // A learner in no section is not in Alpha, so a paper for Alpha is not
  // theirs. This is the case that would otherwise leak by default.
  assert.equal(isForSection(10, null), false);
  assert.equal(isForSection(10, undefined), false);
});

// -------------------------------------------------------------- the service

test('LRN-10 sections are listed in teaching order, not by id or name', async () => {
  const { sections } = world();
  const list = await sections.list(T);
  assert.deepEqual(list.map((s) => s.name), ['Alpha', 'Beta']);
});

test('LRN-10 one institution cannot see or use another section', async () => {
  const { sections } = world();
  const list = await sections.list(T);
  assert.ok(!list.some((s) => Number(s.id) === 12), 'a section from tenant 2 leaked');
  await assert.rejects(() => sections.section(T, 12),
    (e: unknown) => e instanceof HttpError && e.status === 404);
});

test('LRN-10 a code is lower-cased, so "A" and "a" cannot both exist', async () => {
  const { sections } = world();
  const made = await sections.create(T, { name: 'Delta', code: '  DeLtA  ' });
  assert.equal(made.code, 'delta');
  await assert.rejects(() => sections.create(T, { name: 'Another', code: 'DELTA' }),
    (e: unknown) => e instanceof HttpError && e.status === 422);
});

test('LRN-10 a new section is placed last, not between the existing ones', async () => {
  const { sections } = world();
  await sections.create(T, { name: 'Delta', code: 'delta' });
  const list = await sections.list(T);
  assert.deepEqual(list.map((s) => s.name), ['Alpha', 'Beta', 'Delta']);
});

test('LRN-10 a section with people in it is refused deletion, and says why', async () => {
  // Deleting would set every member's section to null silently -- the record
  // of who was taught with whom, gone in one click.
  const { sections } = world();
  await assert.rejects(() => sections.remove(T, 10),
    (e: unknown) => e instanceof HttpError && e.status === 422
      && /Retire it instead/.test(e.message));
});

test('LRN-10 an empty section can be removed', async () => {
  const { sections } = world();
  const made = await sections.create(T, { name: 'Delta', code: 'delta' });
  const gone = await sections.remove(T, Number(made.id));
  assert.equal(gone.removed, true);
});

test('LRN-10 retiring keeps a section off the pickers and keeps its people', async () => {
  const { sections } = world();
  await sections.update(T, 10, { status: 0 });
  assert.ok(!(await sections.list(T)).some((s) => Number(s.id) === 10));
  assert.ok((await sections.list(T, { includeRetired: true }))
    .some((s) => Number(s.id) === 10));
  // The membership is untouched, which is the whole reason to retire.
  assert.equal(await sections.sectionOf(T, 'u-alpha'), 10);
});

test('LRN-10 somebody can be moved between sections and out of every section', async () => {
  const { sections } = world();
  await sections.assign(T, 100, 11);
  assert.equal(await sections.sectionOf(T, 'u-alpha'), 11);
  await sections.assign(T, 100, null);
  assert.equal(await sections.sectionOf(T, 'u-alpha'), null);
});

test('LRN-10 nobody can be moved into another institution section', async () => {
  // The id arrives from a form. Without this check an operator could put one
  // institution's student into another institution's teaching group.
  const { sections } = world();
  await assert.rejects(() => sections.assign(T, 100, 12),
    (e: unknown) => e instanceof HttpError && e.status === 404);
});

test('LRN-10 the head-count counts only the people actually in a section', async () => {
  const { sections } = world();
  const counts = await sections.counts(T);
  assert.equal(counts.get(10), 1);
  assert.equal(counts.get(11), 1);
  // u-none and u-staff are in none, so they are in nobody's count.
  assert.equal([...counts.values()].reduce((a, b) => a + b, 0), 2);
});

test('LRN-10 the starter set is added once and never a second time', async () => {
  // An institution that has renamed or removed its own must not have three
  // put back underneath them.
  const { sections } = world();
  const before = await sections.list(T, { includeRetired: true });
  const after = await sections.seedDefaults(T);
  assert.equal(after.length, before.length, 'seeding added to an institution that had some');
});

test('LRN-10 an institution with none gets the preset it was given', async () => {
  const { sections } = world();
  const made = await sections.seedDefaults(FRESH);
  assert.deepEqual(made.map((s) => s.name), ['Section A', 'Section B', 'Section C']);
});
