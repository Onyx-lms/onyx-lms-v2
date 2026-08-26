/**
 * Is every capability actually checked somewhere?
 *
 * The failure this exists to catch has no symptom until somebody relies on it:
 * a capability is declared, listed on the settings screen with a switch beside
 * it, and no route ever asks. An administrator turns it off, the screen agrees
 * it is off, and the lecturer carries on doing the thing. That is worse than
 * not offering the switch, because it is a promise the product breaks quietly.
 *
 * Thirty-seven routes were in exactly that state -- courses, assignments,
 * question banks, papers, marks, seating, Code Lab and careers all had keys
 * nobody enforced -- so this reads the route files and insists every key in
 * the catalogue appears in at least one `assertCan` call.
 *
 * It is a source scan rather than a runtime check on purpose: a runtime check
 * can only see the routes a test happens to call, and the whole point is the
 * route nobody thought about.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { CAPABILITIES } from '@onyx/core';

const DIR = 'apps/web/src/server/routes/onyx';

function routeSource(): string {
  return readdirSync(DIR)
    .filter((f) => f.endsWith('.routes.ts'))
    .map((f) => readFileSync(DIR + '/' + f, 'utf8'))
    .join('\n');
}

/**
 * Every capability key any `assertCan` call mentions.
 *
 * Not "the fourth argument", which is what the first version of this looked
 * for and why it reported `people.roll_numbers` as unenforced when it is in
 * fact enforced: that route picks between two keys with a ternary, because a
 * body carrying only a roll number is a narrower act than editing a person.
 * So this reads the whole call and takes every quoted key out of it -- a scan
 * that survives the next route with a good reason to choose.
 */
function enforcedKeys(src: string): Set<string> {
  const keys = new Set<string>();
  const CALL = /assertCan\(/g;
  const KEY = /'([a-z_]+\.[a-z_]+)'/g;
  for (const m of src.matchAll(CALL)) {
    let depth = 0;
    let i = (m.index ?? 0) + 'assertCan'.length;
    const from = i;
    for (; i < src.length; i += 1) {
      if (src[i] === '(') depth += 1;
      else if (src[i] === ')') { depth -= 1; if (depth === 0) break; }
    }
    for (const q of src.slice(from, i).matchAll(KEY)) keys.add(q[1]);
  }
  return keys;
}


test('every capability is enforced by at least one route', () => {
  const src = routeSource();
  const enforced = enforcedKeys(src);
  const declared = CAPABILITIES.map((c) => c.key);
  const orphans = declared.filter((k) => !enforced.has(k));
  assert.deepEqual(orphans, [],
    'These capabilities have a switch on the settings screen and no route that '
    + 'checks them, so turning them off changes nothing: ' + orphans.join(', '));
});

test('every enforced key is one the catalogue declares', () => {
  // The other direction, which catches a typo: `assertCan(…, 'assess.bank')`
  // throws nothing and silently gates on a key nobody can grant, so the act
  // becomes unreachable for everyone except an administrator.
  const src = routeSource();
  const enforced = [...enforcedKeys(src)];
  const declared = new Set<string>(CAPABILITIES.map((c) => c.key));
  const unknown = enforced.filter((k) => !declared.has(k));
  assert.deepEqual(unknown, [], 'Checked but not declared: ' + unknown.join(', '));
});

test('the two halves of assignment work are separate keys', () => {
  /*
   * Setting work and marking it are different jobs done by different people --
   * a teaching assistant marks what they did not set. Assessment already
   * splits exactly here (assess.papers / assess.mark) and assignments were the
   * one place that did not, so this pins the split rather than leaving it to
   * be quietly merged back into one key later.
   */
  const keys = CAPABILITIES.map((c) => c.key);
  assert.ok(keys.includes('assignments.set'));
  assert.ok(keys.includes('assignments.grade'));

  const src = routeSource();
  for (const [key, route] of [
    ['assignments.set', "app.post('/api/onyx/courses/:id/assignments'"],
    ['assignments.grade', "app.post('/api/onyx/submissions/:id/grade'"],
  ] as const) {
    const at = src.indexOf(route);
    assert.ok(at > 0, route + ' is missing');
    assert.match(src.slice(at, at + 700), new RegExp("'" + key.replace('.', '\.') + "'"),
      route + ' should be gated by ' + key);
  }
});
