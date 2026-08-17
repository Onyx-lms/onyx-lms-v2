/**
 * Guards the one way the after-dispatch table can rot silently.
 *
 * Its keys are route patterns written as strings. If a route is ever renamed --
 * `/api/onyx/problems/:id/submit` to `/api/onyx/problems/:id/submissions`, say --
 * nothing breaks loudly: the lookup simply misses, no follow-up is scheduled, and
 * submitted code is never graded until the next pg_cron minute. Every request
 * still returns 200. The only symptom is latency nobody can attribute.
 *
 * So assert the keys against the real route table rather than trusting them.
 *
 *   node --test apps/web/src/server/after-dispatch.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AFTER_KEYS, afterFor } from './after-dispatch.ts';

test('every after-dispatch key names a route that actually exists', async () => {
  // Importing routes.ts builds the container, which needs the Supabase env. Read
  // it from the repo-root .env the same way next.config.mjs does, so this test
  // does not need its own copy of the credentials.
  const fs = await import('node:fs');
  const envPath = new URL('../../../../.env', import.meta.url);
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const eq = t.indexOf('=');
      if (eq < 1) continue;
      const key = t.slice(0, eq).trim();
      if (process.env[key] === undefined) process.env[key] = t.slice(eq + 1).trim();
    }
  }

  const { routeTable } = await import('./routes.ts');
  const registered = new Set(routeTable().routes.map((r) => r.method + ' ' + r.pattern));

  assert.ok(AFTER_KEYS.length > 0, 'the table should not be empty -- grading depends on it');
  for (const key of AFTER_KEYS) {
    assert.ok(registered.has(key),
      key + ' is in the after-dispatch table but is not a registered route. '
      + 'If the route was renamed, update after-dispatch.ts -- otherwise submitted '
      + 'code is only graded on the next pg_cron tick.');
  }
});

test('afterFor is case-insensitive on the method and misses cleanly', () => {
  const [first] = AFTER_KEYS;
  assert.ok(first, 'expected at least one entry');
  const [method, pattern] = first.split(' ');
  assert.equal(typeof afterFor(method!.toLowerCase(), pattern!), 'function');
  assert.equal(afterFor('GET', '/api/definitely/not/registered'), undefined);
});
