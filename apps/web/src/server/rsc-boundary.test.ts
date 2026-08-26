/**
 * Does any Server Component hand a function across the boundary?
 *
 * React cannot serialise a function from a Server Component into a Client
 * Component's props, and the failure is not a warning: the page answers 500.
 * Worse, it answers 500 only when that branch actually renders, so it ships
 * green and breaks on the one screen that carries the prop.
 *
 * It has now happened twice in this product. Once when `ExamRegister` and
 * `SubmissionsTable` took `(row) => string` props from a page -- three screens
 * down. And once when a single `onClick={(e) => e.stopPropagation()}` sat on a
 * download link inside the marking queue, which put every marking screen in
 * the institution behind a 500: a lecturer could not see one submission on any
 * paper, and the API had been returning them correctly the whole time.
 *
 * So this reads the component and page files, and insists that a module
 * without the `'use client'` directive contains no JSX event handler. It is a
 * source scan for the same reason permission-coverage is: a runtime check only
 * sees the branches a test happens to render, and the whole point is the
 * branch nobody rendered.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';

const ROOTS = ['apps/web/src/components', 'apps/web/src/app'];

/** Every .tsx under these roots. */
function tsxFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) tsxFiles(full, out);
    else if (entry.endsWith('.tsx')) out.push(full);
  }
  return out;
}

/**
 * The handlers React refuses to serialise.
 *
 * Matched as a JSX attribute (`onClick={`) rather than anywhere the word
 * appears, so a prop NAMED onSomething in an interface, or a string mentioning
 * it in a comment, does not read as a violation.
 */
const HANDLER = /\son(?:Click|Change|Submit|Input|Focus|Blur|KeyDown|KeyUp|MouseDown|MouseUp|MouseEnter|MouseLeave|Pointer[A-Za-z]+|Touch[A-Za-z]+|Drag[A-Za-z]*|Drop|Scroll|Wheel|Copy|Paste|Cut)\s*=\s*\{/;

test('no Server Component passes an event handler', () => {
  const offenders: string[] = [];
  for (const file of ROOTS.flatMap((r) => tsxFiles(r))) {
    const src = readFileSync(file, 'utf8');
    // The directive has to be the first thing in the module for React to see
    // it, so that is where this looks too.
    if (/^\s*(['"])use client\1/.test(src)) continue;
    const line = src.split('\n').findIndex((l) => HANDLER.test(l));
    if (line >= 0) {
      offenders.push(file.split(sep).join('/') + ':' + (line + 1));
    }
  }
  assert.deepEqual(offenders, [],
    'These are Server Components with a JSX event handler. React cannot send a '
    + 'function to the client, so the page 500s the moment that branch renders — '
    + "add 'use client' to the module, or drop the handler: " + offenders.join(', '));
});
