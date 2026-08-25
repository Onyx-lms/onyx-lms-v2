/**
 * Which of a paper's variants a candidate sits, so neighbours differ.
 *
 * **The requirement, in the client's words.** "A question coming for roll
 * number one should not be coming for two to ten. It should only come for
 * eleven again." That is the arrangement every invigilated hall uses: a run of
 * candidates sitting side by side each get a different paper, and the sets
 * repeat only far enough apart that the repeat is out of arm's reach.
 *
 * So a paper is dealt as one of `PAPER_VARIANTS` sets that share NO questions,
 * chosen by the candidate's position rather than at random.
 *
 * **Why not the random shuffle that was here.** `seededShuffle(pool, seed)`
 * with the candidate in the seed gives every candidate an independent random
 * subset — which sounds stronger and is weaker for this purpose. Independent
 * draws overlap: with a bank of 30 and a paper of 5, two adjacent candidates
 * share at least one question about six times in ten. Randomness gives you no
 * guarantee about the person next to you, and the person next to you is the
 * entire threat model.
 *
 * What this gives instead is a guarantee: within one run of ten, no two
 * candidates hold a question in common.
 */

/**
 * Ten, because that is what was asked for, and because it is the right order
 * of magnitude: a row in an examination hall is rarely more than ten wide, and
 * a bank has to carry `variants × take` questions to support it. Twenty
 * variants of a five-question paper needs a hundred questions.
 */
export const PAPER_VARIANTS = 10;

/**
 * How many variants a bank can actually support, without repeating a question.
 *
 * A paper cannot have more disjoint sets than its bank has room for: 12
 * questions taken 5 at a time is two clean sets and a remainder, not ten. The
 * honest answer is to say so and rotate through the two, rather than to claim
 * ten and quietly hand the same questions to candidates three and one.
 *
 * Never zero: a bank exactly the size of the paper is one variant, which is
 * the same paper for everybody and is a legitimate thing to set.
 */
export function variantsAvailable(poolSize: number, take: number): number {
  if (take <= 0) return 1;
  return Math.max(1, Math.min(PAPER_VARIANTS, Math.floor(poolSize / take)));
}

/**
 * The number in a roll number, where there is one.
 *
 * "Roll number one" is what the requirement is written in terms of, and roll
 * numbers in this product are strings an institution chooses: `MR-CSE-001`,
 * `2024/AI/17`, `CS101`. The trailing run of digits is the part that counts,
 * because it is the part that increments — a leading year or branch code is
 * shared by everybody in the group and would put them all on one variant.
 *
 * Null where there is no number at all, which is a real case: an institution
 * that does not use roll numbers still has to have its papers dealt.
 */
export function rollOrdinal(rollNumber: string | null | undefined): number | null {
  if (!rollNumber) return null;
  const runs = String(rollNumber).match(/\d+/g);
  if (!runs || !runs.length) return null;
  const last = runs[runs.length - 1]!;
  // Parsed off the end rather than the whole string, and capped: a roll number
  // carrying a fourteen-digit national id would overflow into a float and
  // stop being an integer some way before that.
  const n = Number(last.slice(-9));
  return Number.isFinite(n) ? n : null;
}

/**
 * A stable number for a candidate with no roll number.
 *
 * FNV-1a over the user id. Deterministic, so the same candidate is dealt the
 * same variant on every attempt of the same paper — a paper that changed
 * underneath somebody who refreshed would be a different paper, and their
 * answers would no longer match their questions.
 */
function hashOrdinal(userId: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < userId.length; i += 1) {
    h ^= userId.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

/**
 * Which variant this candidate sits.
 *
 * By roll number where there is one, so the rotation matches the seating: 1
 * through 10 are ten different papers and 11 is the first one again, which is
 * exactly the arrangement asked for. By a hash of the user id otherwise, so an
 * institution without roll numbers still gets spread rather than everybody
 * landing on variant zero.
 *
 * The paper is NOT part of the choice, deliberately. Two papers sat by the
 * same run of candidates should rotate the same way — a candidate who is
 * always on variant three is not a problem, whereas a rotation that reshuffles
 * per paper can put the same two neighbours together on both.
 */
export function variantFor(
  rollNumber: string | null | undefined,
  userId: string,
  variants: number,
): number {
  if (variants <= 1) return 0;
  const ordinal = rollOrdinal(rollNumber);
  if (ordinal !== null) {
    // One-based on the register, zero-based here: roll 1 is the first variant.
    return ((ordinal - 1) % variants + variants) % variants;
  }
  return hashOrdinal(userId) % variants;
}

/**
 * Which of a bank's sets this candidate sits, as an index into them.
 *
 * The same rotation as `variantFor`, expressed over however many sets the
 * setter actually wrote rather than over a fixed ten: a bank of three sets
 * rotates 1, 2, 3, 1, 2, 3, and a bank of one gives everybody the same paper,
 * which is a legitimate thing to set and is what every bank written before
 * sets existed is.
 */
export function setIndexFor(
  rollNumber: string | null | undefined,
  userId: string,
  setCount: number,
): number {
  return variantFor(rollNumber, userId, Math.max(1, setCount));
}

/**
 * The slice of the pool one variant is dealt.
 *
 * The pool arrives already ordered — shuffled once per PAPER, not per
 * candidate, so every candidate on variant three is dealt the same three
 * questions and the sets stay disjoint. Slicing rather than sampling is what
 * makes "no two of ten share a question" true by construction rather than by
 * probability.
 */
export function variantSlice<T>(pool: T[], take: number, variant: number): T[] {
  const start = variant * take;
  return pool.slice(start, start + take);
}
