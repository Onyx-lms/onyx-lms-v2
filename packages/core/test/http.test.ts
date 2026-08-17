import { test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { validate } from '../src/http/validate.ts';
import { HttpError, ok } from '../src/http/errors.ts';
import { paginate, parsePageQuery } from '../src/http/pagination.ts';
import { RateLimiter, MemoryRateLimitStore } from '../src/http/rate-limit.ts';

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

test('rate limiter reproduces throttle:6,1', () => {
  const limiter = new RateLimiter(new MemoryRateLimitStore());
  for (let i = 1; i <= 6; i++) {
    assert.equal(limiter.check('user:1', 6).allowed, true, 'attempt ' + i);
  }
  assert.equal(limiter.check('user:1', 6).allowed, false, '7th attempt blocked');
  assert.equal(limiter.check('user:2', 6).allowed, true, 'other key unaffected');
});
