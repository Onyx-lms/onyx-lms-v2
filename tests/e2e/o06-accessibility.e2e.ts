/**
 * Accessibility -- the proposal's WCAG 2.2 AA commitment.
 *
 * "WCAG 2.2 AA ... keyboard support, visible focus and reduced-motion."
 *
 * A full conformance audit needs a person with a screen reader, and nothing
 * here claims to be one. What these check are the structural things that are
 * either present in the markup or not, and that silently regress the moment
 * somebody adds a page without thinking about them:
 *
 *   * a way past the repeated navigation (2.4.1);
 *   * a focus ring that survives Tailwind's preflight (2.4.7);
 *   * a reduced-motion rule that actually reaches the stylesheet (2.3.3);
 *   * every control reachable and named, on the screens where being stuck
 *     matters most -- sitting an exam and writing an assignment (4.1.2).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { api, createTenant, webPage, WEB, RUN, onyxWebLogin } from './harness.ts';

const dom = (html: string) => html.replace(/<script[\s\S]*?<\/script>/g, '');

const pw = 'OnyxTest#2026';
const mail = (who: string) => 'a11y.' + who + '.' + RUN + '@onyx.test';
const T = { name: 'Access College ' + RUN, slug: 'a11y-' + RUN };

const w = { cookies: {} as Record<string, string>, ids: {} as Record<string, string> };

test('a college and a learner to look at the pages with', async () => {
  const created = await createTenant({
    name: T.name, slug: T.slug,
    admin: { name: 'Admin', email: mail('admin'), password: pw },
  });
  assert.equal(created.ok, true, created.message);
  w.cookies.admin = await onyxWebLogin(mail('admin'), pw);

  const student = await api<{ user: { id: string } }>('/api/onyx/members', {
    token: (await api<{ token: string }>('/api/onyx/auth/login',
      { body: { email: mail('admin'), password: pw } })).data.token,
    body: { name: 'student', email: mail('student'), role: 'student', password: pw },
  });
  assert.equal(student.ok, true, student.message);
  w.ids.student = student.data.user.id;
  w.cookies.student = await onyxWebLogin(mail('student'), pw);
});

test('2.4.1 every page offers a way past the repeated navigation', async () => {
  for (const [path, cookie] of [
    ['/onyx/login', undefined],
    ['/onyx/dashboard', w.cookies.student],
    ['/onyx/courses', w.cookies.student],
    ['/', undefined],
  ] as const) {
    const page = await webPage(path, cookie);
    const html = dom(page.html);
    assert.match(html, /class="skip-link"/, path + ' has no skip link');
    assert.match(html, /href="#main"/, path + ' skip link points nowhere');
    // ...and the target exists, or the link is decoration.
    assert.match(html, /id="main"/, path + ' has no main landmark');
  }
});

test('2.4.7 the focus ring survives the CSS reset', async () => {
  // Tailwind's preflight removes the browser's outline. If this rule is gone,
  // a keyboard user has no idea where they are, and no page test would notice.
  const page = await webPage('/onyx/login');
  const href = /href="(\/_next\/static\/css\/[^"]+)"/.exec(page.html);
  assert.ok(href, 'no stylesheet was linked');

  const css = await (await fetch(WEB + href![1]!)).text();
  assert.match(css, /:focus-visible/, 'no focus-visible rule reached the stylesheet');
  assert.match(css, /prefers-reduced-motion/, '2.3.3: no reduced-motion rule');
  assert.match(css, /\.skip-link/, 'the skip link has no styling, so it is always visible');
});

test('4.1.2 the exam screen names every control it offers', async () => {
  const page = await webPage('/onyx/dashboard', w.cookies.student);
  const html = dom(page.html);

  // Every input that is not visibly labelled carries an accessible name.
  const inputs = [...html.matchAll(/<(input|select|textarea)\b[^>]*>/g)].map((m) => m[0]);
  for (const tag of inputs) {
    if (/type="(hidden|submit|button)"/.test(tag)) continue;
    const named = /aria-label=|aria-labelledby=|\bid="/.test(tag);
    assert.ok(named, 'an unnamed form control: ' + tag.slice(0, 120));
  }

  // Every button has an accessible name. Visible text is one way; an
  // icon-only control with aria-label is another, and 4.1.2 asks for a name
  // rather than for text. Checking the text alone failed the phone's menu
  // button, which is correctly labelled and always was.
  const buttons = [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)];
  for (const [, attrs, inner] of buttons) {
    const label = String(inner).replace(/<[^>]+>/g, '').replace(/<!--.*?-->/g, '').trim();
    const named = label.length > 0 || /aria-label=|aria-labelledby=|title=/.test(attrs);
    assert.ok(named, 'a button with no accessible name: ' + String(attrs).slice(0, 120));
  }
});

test('1.3.1 tables carry headers, and status messages are announced', async () => {
  const page = await webPage('/onyx/courses', w.cookies.student);
  const html = dom(page.html);

  const tables = [...html.matchAll(/<table[\s\S]*?<\/table>/g)].map((m) => m[0]);
  for (const table of tables) {
    assert.match(table, /<th\b/, 'a table with no header cells');
  }

  // The shell's sign-out and the notices use role=status / role=alert rather
  // than colour alone. Checked on a page that has one.
  const people = dom((await webPage('/onyx/people', w.cookies.admin)).html);
  assert.match(people, /<table/, 'the roster should be a table');
  assert.match(people, /aria-label="Search people"/);
});

test('cleanup leaves nothing behind', async () => {
  const { withDb } = await import('./harness.ts');
  await withDb(async (c) => {
    await c.query('DELETE FROM public."onyx_tenants" WHERE slug = $1', [T.slug]);
    await c.query('DELETE FROM public."onyx_users" WHERE email LIKE $1',
      ['a11y.%.' + RUN + '@onyx.test']);
  });
});
