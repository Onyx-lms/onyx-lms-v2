/**
 * Onyx O03 web layer -- the Code Lab pages.
 *
 * The API tests prove that a hidden case never leaves the server. These prove
 * the page does not undo that: the answer key must not be in the HTML, and it
 * must not be in the RSC payload either, which is where a "just pass the whole
 * problem down as props" mistake would put it.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { api, createTenant, webPage, withDb, WEB, RUN, onyxWebLogin } from './harness.ts';

/** The rendered document, without the RSC payload. See o01-web.e2e.ts. */
const dom = (html: string) => html.replace(/<script[\s\S]*?<\/script>/g, '');

/** React splits interpolated text with comment markers; prose needs them gone. */
const text = (html: string) => dom(html).replace(/<!--.*?-->/g, '');

const pw = 'OnyxTest#2026';
const mail = (who: string) => 'cw.' + who + '.' + RUN + '@onyx.test';
const T = { name: 'Code Web College ' + RUN, slug: 'code-web-' + RUN };

const SECRET_INPUT = 'WEB-HIDDEN-INPUT-' + RUN;
const SECRET_OUTPUT = 'WEB-HIDDEN-ANSWER-' + RUN;

const w = {
  cookies: {} as Record<string, string>,
  ids: {} as Record<string, string>,
  course: 0, problem: 0, workspace: 0,
};

async function viaWeb<T = any>(path: string, cookie: string, init: {
  method?: string; body?: unknown;
} = {}) {
  const res = await fetch(WEB + '/api/proxy/onyx/' + path, {
    method: init.method ?? (init.body !== undefined ? 'POST' : 'GET'),
    headers: {
      cookie,
      ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, ok: Boolean(json.ok), data: json.data as T, message: json.message };
}

test('a college with a published problem and a workspace', async () => {
  const created = await createTenant({
    name: T.name, slug: T.slug,
    admin: { name: 'Admin', email: mail('admin'), password: pw },
  });
  assert.equal(created.ok, true, created.message);
  w.cookies.admin = await onyxWebLogin(mail('admin'), pw);

  for (const [who, role] of [['faculty', 'faculty'], ['student', 'student']] as const) {
    const r = await viaWeb<{ user: { id: string } }>('members', w.cookies.admin,
      { body: { name: who, email: mail(who), role, password: pw } });
    assert.equal(r.ok, true, r.message);
    w.ids[who] = r.data.user.id;
    w.cookies[who] = await onyxWebLogin(mail(who), pw);
  }

  const course = await viaWeb<{ id: number }>('courses', w.cookies.admin,
    { body: { code: 'CW101', title: 'Code Web Course' } });
  w.course = Number(course.data.id);
  await viaWeb('courses/' + w.course + '/faculty', w.cookies.admin,
    { body: { user_id: w.ids.faculty } });
  await viaWeb('courses/' + w.course, w.cookies.admin,
    { method: 'PATCH', body: { status: 1 } });
  await viaWeb('courses/' + w.course + '/enroll', w.cookies.admin,
    { body: { user_id: w.ids.student } });

  const problem = await viaWeb<{ id: number }>('problems', w.cookies.faculty, {
    body: {
      title: 'Web Echo', statement: 'Print the input.', difficulty: 'medium',
      topic: 'strings', languages: ['python'], starter_code: { python: '# start here' },
      solution: 'print(input())', solution_rule: 'never',
    },
  });
  assert.equal(problem.ok, true, problem.message);
  w.problem = Number(problem.data.id);

  await viaWeb('problems/' + w.problem + '/tests', w.cookies.faculty, {
    method: 'PUT',
    body: {
      tests: [
        { name: 'Example', stdin: 'hi', expected_stdout: 'hi', is_hidden: false },
        { name: 'Secret', stdin: SECRET_INPUT, expected_stdout: SECRET_OUTPUT, is_hidden: true },
      ],
    },
  });
  await viaWeb('problems/' + w.problem + '/hints', w.cookies.faculty, {
    method: 'PUT',
    body: { hints: [{ body: 'Read a line first', penalty_percent: 10 }] },
  });
  const published = await viaWeb('problems/' + w.problem + '/publish', w.cookies.faculty,
    { method: 'POST' });
  assert.equal(published.ok, true, published.message);

  const workspace = await viaWeb<{ id: number }>('workspaces', w.cookies.student, {
    body: { title: 'Web Project', language: 'python', entry_path: 'main.py', course_id: w.course },
  });
  w.workspace = Number(workspace.data.id);
});

test('the problem bank lists by topic and difficulty', async () => {
  const page = await webPage('/onyx/practice', w.cookies.student);
  assert.equal(page.status, 200);
  const html = dom(page.html);
  assert.match(html, /Web Echo/);
  assert.match(html, /strings/);
  assert.match(html, /Medium|medium/);

  // A filter that matches nothing says so rather than showing everything.
  const filtered = dom((await webPage('/onyx/practice?difficulty=hard', w.cookies.student)).html);
  assert.ok(!filtered.includes('Web Echo'), 'the difficulty filter did nothing');
});

test('the answer key is nowhere in what a learner is served', async () => {
  const page = await webPage('/onyx/practice/' + w.problem, w.cookies.student);
  assert.equal(page.status, 200);

  // Not in the DOM, and not in the RSC payload either -- the payload is where
  // "pass the whole problem down as props" would put it, and it is readable by
  // anyone with the page.
  assert.ok(!page.html.includes(SECRET_INPUT), 'a hidden test input reached the browser');
  assert.ok(!page.html.includes(SECRET_OUTPUT), 'a hidden expected output reached the browser');
  assert.ok(!page.html.includes('print(input())'), 'the worked solution reached the browser');

  // The visible example is part of the statement and does appear.
  const html = dom(page.html);
  assert.match(html, /Print the input\./);
  assert.match(html, /Example/);
  assert.match(text(page.html), /1 further case is hidden/);

  // An unrevealed hint is not in the page either.
  assert.ok(!page.html.includes('Read a line first'), 'an unrevealed hint reached the browser');
  assert.match(html, /Show the next hint/);
  assert.match(html, /costs 10%/);
});

test('faculty see their own answer key on the same page', async () => {
  const staff = await webPage('/onyx/practice/' + w.problem, w.cookies.faculty);
  assert.equal(staff.status, 200);
  // They wrote it. Hiding it from them would make the bank unmaintainable.
  assert.ok(staff.html.includes(SECRET_INPUT), 'faculty could not see their own answer key');
});

test('revealing a hint shows one, and only one', async () => {
  const revealed = await viaWeb<{ body: string; remaining: number }>(
    'problems/' + w.problem + '/hint', w.cookies.student, { method: 'POST' });
  assert.equal(revealed.ok, true, revealed.message);
  assert.equal(revealed.data.body, 'Read a line first');
  assert.equal(revealed.data.remaining, 0);

  const after = dom((await webPage('/onyx/practice/' + w.problem, w.cookies.student)).html);
  assert.match(after, /Read a line first/);
  assert.match(after, /You have seen every hint/);
});

test('the editor and run controls are on the page', async () => {
  const page = (await webPage('/onyx/practice/' + w.problem, w.cookies.student)).html;
  const html = dom(page);
  // The fallback textarea is server-rendered, so the page is usable before --
  // and without -- Monaco.
  assert.match(html, /aria-label="Code editor"/);
  assert.match(html, /# start here/, 'the starter code was not loaded');
  assert.match(html, />Run</);
  assert.match(html, />Submit</);
  assert.match(text(page), /Run checks the 1 visible case/);
});

test('a workspace opens with its tree, and a mentor cannot edit it', async () => {
  await viaWeb('workspaces/' + w.workspace + '/files', w.cookies.student, {
    method: 'PUT',
    body: {
      files: [
        { path: 'main.py', content: 'print("v1")' },
        { path: 'lib/util.py', content: 'X = 1' },
      ],
    },
  });
  await viaWeb('workspaces/' + w.workspace + '/snapshots', w.cookies.student,
    { body: { label: 'First cut' } });

  const owner = dom((await webPage('/onyx/workspaces/' + w.workspace, w.cookies.student)).html);
  assert.match(owner, /main\.py/);
  assert.match(owner, /lib\/util\.py/);
  assert.match(owner, /First cut/);
  assert.match(owner, />Save</);
  assert.match(owner, /Take a snapshot/);
  assert.match(owner, />Restore</);

  const mentor = dom((await webPage('/onyx/workspaces/' + w.workspace, w.cookies.faculty)).html);
  assert.match(mentor, /main\.py/, 'a mentor could not open a project on their course');
  // Review is a comment, not a rewrite, and the page says so rather than
  // offering a save that would be refused.
  assert.match(mentor, /You are reviewing this project/);
  assert.ok(!mentor.includes('Take a snapshot'), 'a mentor was offered snapshot controls');
  assert.ok(!mentor.includes('>Restore<'), 'a mentor was offered restore');
});

test('navigation offers Code Lab to every role', async () => {
  for (const who of ['student', 'faculty', 'admin'] as const) {
    const html = dom((await webPage('/onyx/dashboard', w.cookies[who]!)).html);
    assert.match(html, /Practice/, who + ' was not offered practice');
    assert.match(html, /Workspaces/, who + ' was not offered workspaces');
  }
});

test('cleanup leaves nothing behind', async () => {
  await withDb(async (c) => {
    await c.query('DELETE FROM public."onyx_tenants" WHERE slug = $1', [T.slug]);
    await c.query('DELETE FROM public."onyx_users" WHERE email LIKE $1',
      ['cw.%.' + RUN + '@onyx.test']);
  });
  // 403, not 401: credentials live in Supabase Auth now (ADR-011), separate
  // from the onyx_users profile row this deletes, so signInWithPassword
  // still succeeds and the rejection comes from the missing profile, one
  // step later. Access is equally denied either way.
  const gone = await api('/api/onyx/auth/login', { body: { email: mail('admin'), password: pw } });
  assert.equal(gone.status, 403);
});
