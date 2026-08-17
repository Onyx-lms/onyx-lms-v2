import { test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { validate } from '../src/http/validate.ts';
import { HttpError, ok } from '../src/http/errors.ts';
import { paginate, parsePageQuery } from '../src/http/pagination.ts';
import {
  RateLimiter, MemoryRateLimitStore, SupabaseRateLimitStore,
} from '../src/http/rate-limit.ts';

test('validation failures come back field-keyed like Laravel', () => {
  const schema = z.object({ email: z.string().email(), password: z.string().min(8) });
  try {
    validate(schema, { email: 'nope', password: 'x' });
    assert.fail('should have thrown');
  } catch (e) {
    const err = e as HttpError;
    assert.equal(err.status, 422);
    assert.ok(err.errors?.['email']?.length);
    assert.ok(err.errors?.['password']?.length);
  }
});

test('valid input passes through parsed', () => {
  const schema = z.object({ page: z.coerce.number() });
  assert.deepEqual(validate(schema, { page: '3' }), { page: 3 });
});

test('success envelope carries flash level', () => {
  assert.deepEqual(ok({ id: 1 }), { ok: true, data: { id: 1 } });
  assert.deepEqual(ok({ id: 1 }, 'Saved'), {
    ok: true, data: { id: 1 }, message: 'Saved', level: 'success',
  });
});

test('pagination envelope matches Laravel paginate() field names', () => {
  const q = parsePageQuery({ page: '2', per_page: '10' });
  const page = paginate([{ id: 11 }, { id: 12 }], 25, q, '/api/courses');
  assert.equal(page.current_page, 2);
  assert.equal(page.per_page, 10);
  assert.equal(page.last_page, 3);
  assert.equal(page.total, 25);
  assert.equal(page.from, 11);
  assert.equal(page.to, 12);
  assert.equal(page.next_page_url, '/api/courses?page=3');
  assert.equal(page.prev_page_url, '/api/courses?page=1');
  for (const key of ['current_page', 'data', 'first_page_url', 'from', 'last_page',
    'last_page_url', 'links', 'next_page_url', 'path', 'per_page',
    'prev_page_url', 'to', 'total']) {
    assert.ok(key in page, 'missing Laravel field ' + key);
  }
});

test('empty result set reports null from/to like Laravel', () => {
  const page = paginate([], 0, parsePageQuery({}), '/api/courses');
  assert.equal(page.from, null);
  assert.equal(page.to, null);
  assert.equal(page.last_page, 1);
});

test('rate limiter reproduces throttle:6,1', async () => {
  const limiter = new RateLimiter(new MemoryRateLimitStore());
  for (let i = 1; i <= 6; i++) {
    assert.equal((await limiter.check('user:1', 6)).allowed, true, 'attempt ' + i);
  }
  assert.equal((await limiter.check('user:1', 6)).allowed, false, '7th attempt blocked');
  assert.equal((await limiter.check('user:2', 6)).allowed, true, 'other key unaffected');
});

test('the Supabase store counts from the row the database returns', async () => {
  // Stands in for the shared bucket: the count comes back from Postgres, not from
  // anything this process remembers -- which is the whole point of the change.
  let calls = 0;
  const store = new SupabaseRateLimitStore({
    rpc: async (fn, args) => {
      assert.equal(fn, 'onyx_rate_limit_hit');
      assert.equal(args['p_window_seconds'], 60);
      calls += 1;
      return {
        data: [{ count: calls, reset_at: new Date(Date.now() + 60_000).toISOString() }],
        error: null,
      };
    },
  });
  const limiter = new RateLimiter(store);
  for (let i = 1; i <= 6; i++) {
    assert.equal((await limiter.check('login:1.2.3.4:a@b.c', 6)).allowed, true, 'attempt ' + i);
  }
  assert.equal((await limiter.check('login:1.2.3.4:a@b.c', 6)).allowed, false, '7th blocked');
});

test('the Supabase store fails OPEN when the database is unreachable', async () => {
  // Deliberate: the limiter guards against repetition, not catastrophe. Refusing
  // on error would turn a blip in one table into "nobody can sign in", which is a
  // far worse outage than the one it would be preventing.
  const errors: string[] = [];
  const store = new SupabaseRateLimitStore(
    { rpc: async () => ({ data: null, error: { message: 'connection refused' } }) },
    (m) => errors.push(m),
  );
  const limiter = new RateLimiter(store);
  for (let i = 0; i < 20; i++) {
    assert.equal((await limiter.check('k', 6)).allowed, true, 'allowed despite the failure');
  }
  assert.equal(errors.length, 20, 'and every failure is reported, never swallowed');
  assert.match(errors[0]!, /connection refused/);
});

test('the Supabase store rejects a malformed row rather than trusting it', async () => {
  const errors: string[] = [];
  const store = new SupabaseRateLimitStore(
    { rpc: async () => ({ data: [], error: null }) },
    (m) => errors.push(m),
  );
  // An empty result set is not "count 0, therefore allowed" -- it is a broken
  // contract, and it is reported as one before failing open.
  assert.equal((await new RateLimiter(store).check('k', 6)).allowed, true);
  assert.match(errors[0]!, /returned no row/);
});
