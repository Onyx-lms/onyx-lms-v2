/**
 * Tests for the router shim's matcher.
 *
 * This exists because a precedence bug here is silent. Nothing throws, no
 * request 500s -- `GET /api/blogs/categories` simply arrives at the handler for
 * `GET /api/blogs/:slug` with `slug: "categories"`, which dutifully looks up a
 * post by that slug and 404s. Across 574 routes that is a very expensive kind
 * of quiet.
 *
 * The ambiguous pairs asserted below are not invented: they were extracted from
 * the real route files, all eight of them. If the matcher regresses, these are
 * the endpoints that break.
 *
 *   node --test apps/web/src/server/router.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRouter, createReply, REPLY_SENT, errorBody, NOT_FOUND_BODY } from './router.ts';

/** Registers `paths` and reports which pattern a request resolves to. */
function routerWith(paths: [string, string][]) {
  const r = createRouter();
  for (const [method, path] of paths) {
    const m = method.toLowerCase() as 'get' | 'post' | 'put' | 'patch' | 'delete';
    r[m](path, () => path);
  }
  return (method: string, pathname: string) => {
    const hit = r.match(method, pathname);
    return hit ? { pattern: hit.route.pattern, params: hit.params } : null;
  };
}

test('a static segment beats a parameter at the same depth', () => {
  // Registered param-first on purpose: if precedence came from insertion order
  // rather than specificity, every one of these would resolve to the param.
  const match = routerWith([
    ['GET', '/api/blogs/:slug'],
    ['GET', '/api/blogs/categories'],
    ['GET', '/api/blogs/popular'],
  ]);
  assert.equal(match('GET', '/api/blogs/categories')?.pattern, '/api/blogs/categories');
  assert.equal(match('GET', '/api/blogs/popular')?.pattern, '/api/blogs/popular');
  // ...and anything else still reaches the parameter.
  assert.equal(match('GET', '/api/blogs/how-we-ship')?.pattern, '/api/blogs/:slug');
  assert.equal(match('GET', '/api/blogs/how-we-ship')?.params.slug, 'how-we-ship');
});

test('every real ambiguous pair in the codebase resolves to the static route', () => {
  // Extracted from the route files; all eight that exist.
  const pairs: [string, string][] = [
    ['/api/blogs/categories', '/api/blogs/:slug'],
    ['/api/blogs/popular', '/api/blogs/:slug'],
    ['/api/bootcamps/categories', '/api/bootcamps/:slug'],
    ['/api/courses/facets', '/api/courses/:slug'],
    ['/api/courses/compare', '/api/courses/:slug'],
    ['/api/onyx/interviews/mine', '/api/onyx/interviews/:id'],
    ['/api/onyx/workspaces/all', '/api/onyx/workspaces/:id'],
    ['/api/onyx/tickets/breaches', '/api/onyx/tickets/:id'],
  ];
  for (const [staticPath, paramPath] of pairs) {
    // Register the parameter FIRST, the harder ordering.
    const match = routerWith([['GET', paramPath], ['GET', staticPath]]);
    assert.equal(match('GET', staticPath)?.pattern, staticPath,
      staticPath + ' must not be captured by ' + paramPath);
  }
});

test('deeper routes are not shadowed by shallower ones', () => {
  const match = routerWith([
    ['GET', '/api/onyx/courses/:id'],
    ['GET', '/api/onyx/courses/:id/outline'],
    ['GET', '/api/onyx/courses/:id/attendance'],
    ['GET', '/api/onyx/courses/:id/attendance/analytics'],
    ['GET', '/api/onyx/courses/:id/attendance/export.csv'],
  ]);
  assert.equal(match('GET', '/api/onyx/courses/119')?.pattern, '/api/onyx/courses/:id');
  assert.equal(match('GET', '/api/onyx/courses/119/outline')?.pattern, '/api/onyx/courses/:id/outline');
  assert.equal(match('GET', '/api/onyx/courses/119/attendance/analytics')?.pattern,
    '/api/onyx/courses/:id/attendance/analytics');
  // A dot in a literal segment is a literal dot, not a wildcard.
  assert.equal(match('GET', '/api/onyx/courses/119/attendance/export.csv')?.pattern,
    '/api/onyx/courses/:id/attendance/export.csv');
});

test('multiple parameters in one pattern all bind', () => {
  const match = routerWith([['DELETE', '/api/admin/tutor/:kind/:id']]);
  const hit = match('DELETE', '/api/admin/tutor/subject/42');
  assert.equal(hit?.pattern, '/api/admin/tutor/:kind/:id');
  assert.deepEqual(hit?.params, { kind: 'subject', id: '42' });
});

test('method is part of the match', () => {
  const match = routerWith([
    ['GET', '/api/onyx/courses/:id'],
    ['DELETE', '/api/onyx/courses/:id'],
  ]);
  assert.equal(match('GET', '/api/onyx/courses/7')?.pattern, '/api/onyx/courses/:id');
  assert.equal(match('PATCH', '/api/onyx/courses/7'), null, 'an unregistered method must not match');
  // Lowercase from a raw request must still resolve.
  assert.equal(match('get', '/api/onyx/courses/7')?.pattern, '/api/onyx/courses/:id');
});

test('segment count must agree exactly', () => {
  const match = routerWith([['GET', '/api/onyx/courses/:id']]);
  assert.equal(match('GET', '/api/onyx/courses'), null, 'too few segments');
  assert.equal(match('GET', '/api/onyx/courses/7/outline'), null, 'too many segments');
});

test('trailing slashes and doubled slashes are equivalent, and a param never matches empty', () => {
  const match = routerWith([['GET', '/api/onyx/courses/:id']]);
  assert.equal(match('GET', '/api/onyx/courses/7/')?.params.id, '7', 'trailing slash');
  assert.equal(match('GET', '/api//onyx/courses/7')?.params.id, '7', 'doubled slash');
  // `/api/onyx/courses//` collapses to 3 segments, so the :id route cannot match
  // -- which is correct: there is no id.
  assert.equal(match('GET', '/api/onyx/courses//'), null, 'empty parameter');
});

test('parameters arrive percent-decoded', () => {
  const match = routerWith([['GET', '/api/onyx/members/:userId']]);
  // Onyx user ids are Supabase uuids; slugs and emails also travel as params.
  assert.equal(match('GET', '/api/onyx/members/a%40b.com')?.params.userId, 'a@b.com');
  assert.equal(match('GET', '/api/onyx/members/two%20words')?.params.userId, 'two words');
  // A malformed escape must not throw the whole request away.
  assert.equal(match('GET', '/api/onyx/members/100%')?.params.userId, '100%');
});

test('an unmatched path returns null so the caller can produce the 404 envelope', () => {
  const match = routerWith([['GET', '/api/onyx/courses/:id']]);
  assert.equal(match('GET', '/api/nope'), null);
  assert.deepEqual(NOT_FOUND_BODY, { ok: false, level: 'error', message: 'Not found.' });
});

test('the /api/proxy prefix resolves to the same route as the bare path', () => {
  // 122 client call sites still use /api/proxy/*, a leftover from when the API was
  // on another origin and a handler had to attach the httpOnly token for them.
  // The catch-all strips the `proxy` segment; this pins the two mistakes that are
  // easy to make and impossible to notice, since both just 404 for every one of
  // those 122 sites:
  //
  //   * slicing the whole '/api/proxy' prefix, leaving '/settings' -- no route
  //     declares that
  //   * relying on a next.config rewrite, which routes the request here but
  //     leaves request.url reading '/api/proxy/...'
  //
  // Kept in step with routePathFor() in app/api/[...path]/route.ts.
  const strip = (pathname: string) => (pathname.startsWith('/api/proxy/')
    ? '/api/' + pathname.slice('/api/proxy/'.length)
    : pathname);

  const match = routerWith([
    ['GET', '/api/settings'],
    ['GET', '/api/onyx/courses/:id'],
  ]);

  assert.equal(match('GET', strip('/api/proxy/settings'))?.pattern, '/api/settings');
  assert.equal(match('GET', strip('/api/proxy/onyx/courses/7'))?.pattern, '/api/onyx/courses/:id');
  assert.equal(match('GET', strip('/api/proxy/onyx/courses/7'))?.params.id, '7');

  // The bare paths must be untouched by the stripping.
  assert.equal(match('GET', strip('/api/settings'))?.pattern, '/api/settings');
  // And a word merely beginning with "proxy" is not the prefix.
  assert.equal(strip('/api/proxying'), '/api/proxying');
});

/* ------------------------------------------------------------------ reply --- */

test('reply records headers, status, cookies and the sent body', () => {
  const { reply, captured } = createReply();
  const returned = reply.header('Content-Type', 'text/csv').status(201).send('a,b');
  assert.equal(returned, REPLY_SENT, 'send() returns the sentinel so the caller knows it was used');
  assert.equal(captured.status, 201);
  assert.equal(captured.headers['content-type'], 'text/csv', 'header names are lowercased');
  assert.equal(captured.body, 'a,b');
  assert.equal(captured.didSend, true);
});

test('a header set before a throw is still captured', () => {
  // The login route does exactly this: sets Retry-After, then throws
  // tooManyRequests(). Fastify keeps the header on the error response, so the
  // catch-all must read `captured` on the error path too.
  const { reply, captured } = createReply();
  reply.header('Retry-After', '60');
  assert.equal(captured.headers['retry-after'], '60');
  assert.equal(captured.didSend, false, 'nothing was sent -- only a header was set');
});

test('clearCookie expires the cookie rather than just naming it', () => {
  const { reply, captured } = createReply();
  reply.clearCookie('onyx_token', { path: '/' });
  const c = captured.cookies[0]!;
  assert.equal(c.name, 'onyx_token');
  assert.equal(c.value, '');
  assert.equal(c.opts.maxAge, 0);
  assert.equal(c.opts.path, '/');
});

test('code() and status() are interchangeable, as they are in Fastify', () => {
  const a = createReply(); a.reply.code(418);
  const b = createReply(); b.reply.status(418);
  assert.equal(a.captured.status, b.captured.status);
});

/* ------------------------------------------------------------------ errors -- */

test('errorBody reproduces the single failure envelope', async () => {
  const { HttpError } = await import('@onyx/core');
  const got = errorBody(new HttpError(422, 'That is not a late policy.'));
  assert.equal(got.status, 422);
  assert.deepEqual(got.body, { ok: false, level: 'error', message: 'That is not a late policy.' });
});

test('an HttpError from a SECOND copy of @onyx/core is still recognised', () => {
  // The bug this guards: under Next the route files reach @onyx/core by relative
  // path while router.ts imports it by package name, and the bundler resolves
  // those to two separate copies. `instanceof` across them is false, so
  // `GET /api/onyx/me` with no token answered 500 carrying the body of a 401 --
  // because the generic branch echoes err.message in development and the message
  // was "Unauthenticated." Wrong status, plausible body, no stack trace.
  //
  // A hand-built stand-in stands for that other copy: same shape, different
  // constructor, exactly as the real duplicate would be.
  class ForeignHttpError extends Error {
    status = 401;
    level = 'error' as const;
    constructor(message: string) { super(message); this.name = 'HttpError'; }
    toBody() { return { ok: false as const, level: this.level, message: this.message }; }
  }

  const got = errorBody(new ForeignHttpError('Unauthenticated.'));
  assert.equal(got.status, 401, 'must not fall through to the generic 500 branch');
  assert.deepEqual(got.body, { ok: false, level: 'error', message: 'Unauthenticated.' });
});

test('a plain Error named HttpError but lacking the contract is still a 500', () => {
  // The structural check must not be so loose that any error claiming the name
  // gets to choose its own status.
  const impostor = new Error('nice try');
  impostor.name = 'HttpError';
  assert.equal(errorBody(impostor).status, 500);
});

test('an unexpected error is a 500 that leaks nothing in production', () => {
  const prior = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = 'production';
    const hidden = errorBody(new Error('connection string postgres://user:pw@host'));
    assert.equal(hidden.status, 500);
    assert.deepEqual(hidden.body, { ok: false, level: 'error', message: 'Something went wrong.' });

    process.env.NODE_ENV = 'development';
    const shown = errorBody(new Error('boom')) as { body: { message: string } };
    assert.equal(shown.body.message, 'boom', 'developers see the real message');
  } finally {
    process.env.NODE_ENV = prior;
  }
});
