/**
 * Every registered route resolves to itself.
 *
 * The matcher's precedence rules are tested in router.test.ts against
 * hand-picked pairs. This is the complement: it takes the REAL table -- all 574
 * routes across both products -- builds a concrete request path from each
 * pattern, and asserts the matcher hands that request back to the same route it
 * came from.
 *
 * It catches the class of failure that hand-picked cases cannot: a route that
 * nothing else covers, shadowed by a route nobody thought to compare it with.
 * Probing over HTTP cannot check this, because "route not matched" and "row not
 * found" are both a 404 carrying the same envelope -- the distinction only exists
 * inside the table.
 *
 *   node --test apps/web/src/server/route-table.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

/** The repo-root .env, the same way next.config.mjs loads it. */
function loadRootEnv(): void {
  const path = new URL('../../../../.env', import.meta.url);
  if (!fs.existsSync(path)) return;
  for (const line of fs.readFileSync(path, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq < 1) continue;
    const key = t.slice(0, eq).trim();
    if (process.env[key] === undefined) process.env[key] = t.slice(eq + 1).trim();
  }
}

/** `/api/onyx/courses/:id/outline` -> `/api/onyx/courses/1/outline`. */
function concrete(pattern: string): string {
  return pattern.split('/').map((s) => (s.startsWith(':') ? '1' : s)).join('/');
}

test('all 574 registered routes resolve to themselves', async () => {
  loadRootEnv();
  const { routeTable } = await import('./routes.ts');
  const table = routeTable();
  const routes = table.routes;

  assert.ok(routes.length > 500, 'expected the full table, got ' + routes.length);

  const unreachable: string[] = [];
  const misrouted: string[] = [];

  for (const route of routes) {
    const hit = table.match(route.method, concrete(route.pattern));
    if (!hit) {
      unreachable.push(route.method + ' ' + route.pattern);
      continue;
    }
    // A parameterised route can legitimately be answered by a more specific
    // static one -- `/api/blogs/:slug` filled in as `/api/blogs/1` is still the
    // param route, but `/api/onyx/exams/:id` as `/api/onyx/exams/1` must not be
    // captured by some `/api/onyx/exams/upcoming`. Only flag a mismatch when the
    // winner is NOT more specific, which is the case that is actually wrong.
    if (hit.route.pattern !== route.pattern && hit.route.statics <= route.statics) {
      misrouted.push(route.method + ' ' + route.pattern + ' -> ' + hit.route.pattern);
    }
  }

  assert.deepEqual(unreachable, [], 'these routes are registered but unreachable');
  assert.deepEqual(misrouted, [], 'these routes are shadowed by a less specific one');
  console.log('    ' + routes.length + ' routes, all reachable');
});

test('both products are actually registered, not just one', async () => {
  loadRootEnv();
  const { routeTable } = await import('./routes.ts');
  const patterns = routeTable().routes.map((r) => r.pattern);

  // Onyx and the Laravel port share this table. A registration silently dropped
  // from routes.ts would leave one product's routes simply absent -- every
  // request 404ing, with nothing failing at build or type-check time.
  const onyx = patterns.filter((p) => p.startsWith('/api/onyx/')).length;
  const port = patterns.filter((p) => p.startsWith('/api/') && !p.startsWith('/api/onyx/')).length;

  assert.ok(onyx > 250, 'Onyx routes look absent or truncated: ' + onyx);
  assert.ok(port > 250, 'the port product\'s routes look absent or truncated: ' + port);
  console.log('    onyx ' + onyx + ', port ' + port + ', plus /health');
});

test('no route pattern is registered twice for the same method', async () => {
  loadRootEnv();
  const { routeTable } = await import('./routes.ts');
  const seen = new Map<string, number>();
  for (const r of routeTable().routes) {
    const key = r.method + ' ' + r.pattern;
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  // A duplicate is not an error the matcher reports -- the first wins and the
  // second is dead code, which is exactly the kind of thing that survives a
  // migration unnoticed.
  const dupes = [...seen.entries()].filter(([, n]) => n > 1).map(([k, n]) => k + ' x' + n);
  assert.deepEqual(dupes, [], 'duplicate registrations -- the later one is unreachable');
});
