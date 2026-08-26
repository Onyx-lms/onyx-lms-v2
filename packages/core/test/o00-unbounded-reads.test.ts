/**
 * Reads that grow with an institution, and are not bounded.
 *
 * This is the guard for the single most repeated defect in this product. Nine
 * times now, a query has read a table that grows with the size of the
 * institution, named no range, and been quietly truncated:
 *
 *   an institution of 1,440 reported as 943 on its own overview
 *   a course roster of 1,440 that returned 1,000
 *   a members list of 1,445 that returned 1,000
 *   a catalogue that said one course had 1,000 students and the rest none
 *   an exam clash check that stopped looking after a thousand candidates
 *   a whole roster that came back with 1,446 rows and zero names
 *   441 of a lecturer's own students rendered as "Unknown"
 *   a console tally that reported 63 of 64 courses as empty
 *
 * None of them errored. That is the whole problem: PostgREST answers a request
 * with no `.range()` by returning AT MOST a thousand rows and a 200. `.limit()`
 * does not help -- the cap is applied first, so `.limit(5000)` returns a
 * thousand. The result is always a plausible number that is wrong, on a screen
 * nobody has reason to doubt.
 *
 * WHY A BASELINE RATHER THAN A BAN. Most unranged reads are perfectly safe:
 * one attempt's answers, one session's register, one course's faculty. A test
 * that failed on all of them would flag ninety-two sites, and a test that
 * cries wolf ninety-two times is a test somebody deletes. So this flags only
 * the dangerous shape -- a LIST read from a growth table, scoped to the whole
 * institution and to no single parent row -- and pins the ones that exist
 * today. A new one fails; fixing an old one means deleting a line from the
 * list, which is the direction this should only ever move.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';

const DIR = 'packages/core/src/onyx';

/** Tables whose row count rises with the institution's size. */
const GROWS = [
  'onyx_enrollments', 'onyx_memberships', 'onyx_assessment_attempts',
  'onyx_assessment_answers', 'onyx_exam_marks', 'onyx_code_submissions',
  'onyx_lesson_progress', 'onyx_attendance_records', 'onyx_questions',
];

/**
 * Columns that narrow a read to one parent's children.
 *
 * One attempt has ten answers; one session has sixty records. Those are
 * bounded by the shape of the data rather than by a range, and adding one
 * would be noise.
 */
const NARROWED = new RegExp(
  "\\.eq\\('(course_id|assessment_id|attempt_id|exam_id|session_id|bank_id"
  + "|problem_id|user_id|lesson_id|id|program_id|semester_id|domain_id"
  + "|invoice_id|ticket_id|discussion_id|workspace_id|module_id|contest_id"
  + "|job_id|round_id|batch_id|structure_id)'",
);

/**
 * The sites that exist today, each one looked at.
 *
 * Every entry here is either safe for a reason -- a handful of administrators,
 * a sweep that runs on a timer and re-runs -- or a fix waiting to be done. It
 * is NOT a list of approved shortcuts: shrinking it is the point.
 */
const KNOWN = [
  'assess.service.ts:onyx_assessment_attempts',
  'assess.service.ts:onyx_assessment_attempts',
  'assess.service.ts:onyx_questions',
  'codelab.service.ts:onyx_code_submissions',
  'platform.service.ts:onyx_assessment_attempts',
  'platform.service.ts:onyx_exam_marks',
  'platform.service.ts:onyx_memberships',
  'platform.service.ts:onyx_memberships',
  'platform.service.ts:onyx_memberships',
  'proctor.service.ts:onyx_assessment_attempts',
  'sections.service.ts:onyx_memberships',
  'tenancy.service.ts:onyx_memberships',
  'tenancy.service.ts:onyx_memberships',
  'tenancy.service.ts:onyx_memberships',
];

/** Every institution-wide list read with no range on it. */
function unbounded(): string[] {
  const found: string[] = [];
  for (const file of readdirSync(DIR).filter((f) => f.endsWith('.ts'))) {
    const src = readFileSync(DIR + '/' + file, 'utf8');
    for (const table of GROWS) {
      const needle = ".from('" + table + "')";
      let at = -1;
      while ((at = src.indexOf(needle, at + 1)) >= 0) {
        /*
         * The statement, to its terminating `;` or the next query in the same
         * Promise.all -- whichever comes first. Without the second bound, two
         * queries on one line read as one and the first one's `head: true`
         * excuses the second.
         */
        let end = src.length;
        for (const stop of [';', '\n      this.#db', '\n        this.#db']) {
          const j = src.indexOf(stop, at + 1);
          if (j >= 0 && j < end) end = j;
        }
        const stmt = src.slice(at, end);

        if (/\.(insert|update|delete|upsert)\(/.test(stmt)) continue;  // a write
        if (/\.maybeSingle\(|\.single\(/.test(stmt)) continue;         // one row
        if (/head:\s*true|,\s*head\)/.test(stmt)) continue;            // a COUNT
        if (/\.range\(|\.limit\(/.test(stmt)) continue;                // bounded
        if (NARROWED.test(stmt)) continue;                             // one parent
        if (/\.in\(/.test(stmt)) continue;                             // a known id list
        found.push(file + ':' + table);
      }
    }
  }
  return found.sort();
}

test('no NEW unbounded institution-wide read', () => {
  const now = unbounded();
  const known = [...KNOWN].sort();

  const added = [...now];
  for (const k of known) {
    const i = added.indexOf(k);
    if (i >= 0) added.splice(i, 1);
  }
  assert.deepEqual(added, [],
    'A list read from a table that grows with the institution, scoped to the '
    + 'whole tenant and given no `.range()`. PostgREST will return at most a '
    + 'thousand rows and a 200, so this will be silently wrong at scale. Page '
    + 'it, or count it with `head: true`: ' + added.join(', '));
});

test('the baseline shrinks, and never quietly grows', () => {
  /*
   * The other direction. When one of these is paged, its line has to come out
   * of KNOWN -- otherwise the list rots into a set of names nobody can map to
   * anything, and the next person reads it as fourteen approved shortcuts
   * rather than fourteen things still to do.
   */
  const now = unbounded();
  const stale = [...KNOWN].sort();
  for (const n of now) {
    const i = stale.indexOf(n);
    if (i >= 0) stale.splice(i, 1);
  }
  assert.deepEqual(stale, [],
    'These are pinned in KNOWN and no longer exist -- someone fixed them. '
    + 'Delete the lines: ' + stale.join(', '));
});
