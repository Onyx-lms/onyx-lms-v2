/**
 * Endpoints the product cannot reach.
 *
 * Written after the fourth one turned up by accident. Each was the same shape:
 * a route with a service behind it, guards, tests at the unit level, and no
 * screen anywhere that called it -- so the feature was "built" and could not
 * be used. Moderating an exam, putting somebody in a batch, closing a
 * register, and a paper composer replaced by another one and left exported.
 *
 * Finding them one at a time, by tripping over a test, is not a strategy. This
 * lists every Onyx route and every client-side reference to a path, and prints
 * the routes nothing references.
 *
 *   node tools/onyx/unreachable-routes.mjs
 *   node tools/onyx/unreachable-routes.mjs --all   (also list the reachable)
 *
 * ---------------------------------------------------------------------------
 * WHAT IT CANNOT TELL YOU
 * ---------------------------------------------------------------------------
 *
 * This is a text search, and it is deliberately a blunt one: a path is
 * "reachable" if any file under apps/web/src that is not itself a route file
 * mentions it. That means:
 *
 *   * A route called only from a test, a tool or a seed script reads as
 *     UNREACHABLE, which is usually right -- those are not the product.
 *   * A route built from a variable (`'/api/onyx/' + kind + '/' + id`) reads as
 *     unreachable even when a screen does call it. Check before acting.
 *   * A route a screen reaches but that no human can get to -- a page nothing
 *     links to -- reads as reachable. This finds one class of gap, not all.
 *
 * So the output is a list to READ, not a list to act on blindly. Every entry
 * is a question: who is supposed to call this?
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const ROUTES_DIR = 'apps/web/src/server/routes/onyx';
const CLIENT_DIRS = ['apps/web/src/app', 'apps/web/src/components', 'apps/web/src/lib'];
const SHOW_ALL = process.argv.includes('--all');

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (['.ts', '.tsx'].includes(extname(full))) out.push(full);
  }
  return out;
}

// ---- every route the server declares ---------------------------------------
const routes = [];
for (const file of walk(ROUTES_DIR)) {
  const src = readFileSync(file, 'utf8');
  for (const m of src.matchAll(
    /app\.(get|post|patch|put|delete)\(\s*'(\/api\/onyx\/[^']+)'/g)) {
    routes.push({ method: m[1].toUpperCase(), path: m[2], file });
  }
}

// ---- everything the client side says ----------------------------------------
let client = '';
for (const dir of CLIENT_DIRS) {
  for (const file of walk(dir)) {
    // A route file re-read as client code would make every route look
    // reachable by itself.
    if (file.includes('server' + '/routes')) continue;
    client += readFileSync(file, 'utf8') + '\n';
  }
}

/**
 * The literal segments of a path, without its parameters.
 *
 * A screen never writes ':id' -- it writes `'/api/onyx/courses/' + id +
 * '/publish'`. So a path is looked for as its fixed pieces, and a path whose
 * pieces all appear is taken as referenced. Crude, and it errs towards saying
 * "reachable", which is the right way for a tool like this to be wrong.
 */
function referenced(path) {
  const parts = path.split('/').filter((p) => p && !p.startsWith(':'));
  // Drop 'api' and 'onyx', which appear everywhere and prove nothing.
  const meaningful = parts.filter((p) => p !== 'api' && p !== 'onyx');
  if (!meaningful.length) return true;
  return meaningful.every((p) => client.includes(p));
}

const unreachable = routes.filter((r) => !referenced(r.path));
const byFile = new Map();
for (const r of unreachable) {
  byFile.set(r.file, [...(byFile.get(r.file) ?? []), r]);
}

console.log('\n' + routes.length + ' Onyx routes. '
  + unreachable.length + ' have no client-side reference.\n');

for (const [file, rs] of byFile) {
  console.log('  ' + file.replace(/\\/g, '/').replace('apps/web/src/server/routes/onyx/', ''));
  for (const r of rs) console.log('    ' + r.method.padEnd(7) + r.path);
  console.log('');
}

if (SHOW_ALL) {
  console.log('--- reachable ---');
  for (const r of routes.filter((x) => referenced(x.path))) {
    console.log('  ' + r.method.padEnd(7) + r.path);
  }
}

console.log('Each of these is a question, not a defect: who is supposed to call it?');
console.log('A path built from a variable can read as unreachable while a screen\n'
  + 'does call it. Read the header before acting on any of them.\n');
