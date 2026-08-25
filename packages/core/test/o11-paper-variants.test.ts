/**
 * Onyx O11 unit tests -- ten papers, rotating by roll number.
 *
 * The requirement, in the client's words: "a question coming for roll number
 * one should not be coming for two to ten. It should only come for eleven
 * again." That is a GUARANTEE about neighbours, and the reason the random
 * per-candidate shuffle this replaced was not good enough: independent draws
 * overlap, and randomness promises nothing about the person sitting next to
 * you.
 *
 * So the claims here are about disjointness and repetition, not about
 * distribution.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PAPER_VARIANTS, variantsAvailable, variantFor, variantSlice, rollOrdinal,
} from '../src/onyx/paper-variants.ts';

/** A bank big enough for ten clean sets of five. */
const POOL = Array.from({ length: 50 }, (_, i) => 'q' + (i + 1));
const TAKE = 5;

/** The paper one candidate is dealt, by roll number. */
const paperFor = (roll: string, pool = POOL, take = TAKE) =>
  variantSlice(pool, take, variantFor(roll, 'u-' + roll, variantsAvailable(pool.length, take)));

// --------------------------------------------------------------- the rule

test('ASS-11 no two of the first ten roll numbers share a question', () => {
  // The guarantee the whole change exists for.
  const papers = Array.from({ length: PAPER_VARIANTS }, (_, i) => paperFor(String(i + 1)));
  for (let a = 0; a < papers.length; a += 1) {
    for (let b = a + 1; b < papers.length; b += 1) {
      const shared = papers[a]!.filter((q) => papers[b]!.includes(q));
      assert.deepEqual(shared, [],
        'roll ' + (a + 1) + ' and roll ' + (b + 1) + ' share ' + shared.join(', '));
    }
  }
});

test('ASS-11 roll eleven sits the same paper as roll one, and not before', () => {
  const first = paperFor('1');
  for (let roll = 2; roll <= 10; roll += 1) {
    assert.notDeepEqual(paperFor(String(roll)), first,
      'roll ' + roll + ' repeated roll 1 early');
  }
  assert.deepEqual(paperFor('11'), first, 'roll 11 did not come back round to roll 1');
  assert.deepEqual(paperFor('21'), first);
  assert.deepEqual(paperFor('12'), paperFor('2'));
});

test('ASS-11 every candidate gets a full paper', () => {
  for (let roll = 1; roll <= 25; roll += 1) {
    assert.equal(paperFor(String(roll)).length, TAKE,
      'roll ' + roll + ' was dealt a short paper');
  }
});

// -------------------------------------------------- what a roll number is

test('ASS-11 the number is read off the END of a roll number', () => {
  // A leading year or branch is shared by the whole group; taking it would
  // put every candidate in the cohort on one variant.
  assert.equal(rollOrdinal('MR-CSE-001'), 1);
  assert.equal(rollOrdinal('2024/AI/17'), 17);
  assert.equal(rollOrdinal('CS101'), 101);
  assert.equal(rollOrdinal('7'), 7);
});

test('ASS-11 a roll number with no digits, or none at all, still deals', () => {
  assert.equal(rollOrdinal('ALPHA'), null);
  assert.equal(rollOrdinal(null), null);
  assert.equal(rollOrdinal(''), null);
  // And the candidate is still given a variant, from their id.
  const v = variantFor(null, 'user-abc', PAPER_VARIANTS);
  assert.ok(Number.isInteger(v) && v >= 0 && v < PAPER_VARIANTS, 'no variant for a roll-less user');
});

test('ASS-11 candidates with no roll number are spread, not all on variant zero', () => {
  const seen = new Set<number>();
  for (let i = 0; i < 200; i += 1) {
    seen.add(variantFor(null, 'user-' + i, PAPER_VARIANTS));
  }
  assert.ok(seen.size >= 8,
    'roll-less candidates landed on only ' + seen.size + ' of ' + PAPER_VARIANTS + ' variants');
});

test('ASS-11 the same candidate is dealt the same variant every time', () => {
  // A paper that changed under somebody who refreshed would be a different
  // paper, and their saved answers would no longer match their questions.
  const once = variantFor('MR-CSE-042', 'u-42', PAPER_VARIANTS);
  for (let i = 0; i < 20; i += 1) {
    assert.equal(variantFor('MR-CSE-042', 'u-42', PAPER_VARIANTS), once);
  }
});

// ------------------------------------------- what a small bank can support

test('ASS-11 a bank supports only as many clean sets as it has room for', () => {
  // 12 taken 5 at a time is two sets and a remainder, not ten. Claiming ten
  // would hand candidates one and three the same questions while saying they
  // were different.
  assert.equal(variantsAvailable(12, 5), 2);
  assert.equal(variantsAvailable(50, 5), 10);
  assert.equal(variantsAvailable(500, 5), 10, 'more than ten sets is not offered');
  // A bank exactly the size of the paper is one variant: the same paper for
  // everybody, which is a legitimate thing to set.
  assert.equal(variantsAvailable(5, 5), 1);
  assert.equal(variantsAvailable(3, 5), 1, 'a bank too small still deals something');
});

test('ASS-11 with two sets available, the rotation is two, and stays disjoint', () => {
  const pool = Array.from({ length: 12 }, (_, i) => 'q' + i);
  const a = paperFor('1', pool);
  const b = paperFor('2', pool);
  assert.deepEqual(a.filter((q) => b.includes(q)), [], 'the two available sets overlapped');
  assert.deepEqual(paperFor('3', pool), a, 'the rotation did not wrap at two');
});

test('ASS-11 one variant means everybody sits the same paper, and it is full', () => {
  const pool = Array.from({ length: 5 }, (_, i) => 'q' + i);
  assert.deepEqual(paperFor('1', pool), paperFor('7', pool));
  assert.equal(paperFor('1', pool).length, 5);
});

// -------------------------------------------------------------- the edges

test('ASS-11 a roll number of zero or a negative does not fall off the rotation', () => {
  // `(0 - 1) % 10` is -1 in JavaScript, which would slice from a negative
  // offset and hand back the END of the pool -- a short paper, silently.
  for (const roll of ['0', 'MR-000']) {
    const dealt = paperFor(roll);
    assert.equal(dealt.length, TAKE, 'roll ' + roll + ' was dealt ' + dealt.length);
  }
});

test('ASS-11 a very long roll number is still an integer', () => {
  // A fourteen-digit national id overflows into a float long before this.
  const v = variantFor('2024123456789012', 'u-x', PAPER_VARIANTS);
  assert.ok(Number.isInteger(v) && v >= 0 && v < PAPER_VARIANTS, 'variant was ' + v);
});
