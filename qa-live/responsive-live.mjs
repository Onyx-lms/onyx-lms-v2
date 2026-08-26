/**
 * Does the deployed product work on a phone?
 *
 * The browser suite (tests/browser/responsive.spec.ts) asserts the same rule
 * against a local build; this runs it against what is actually deployed, as a
 * real signed-in person, on the demo institution. Both exist because they fail
 * for different reasons: the spec catches a regression before it ships, this
 * catches one that shipped.
 *
 * The rule is one line: **the document must never be wider than the
 * viewport.** A table that overflows, an unbroken email address, a card with a
 * fixed width, a grid that does not stack — every one of them shows up as
 * horizontal scroll on the body, and every one of them makes the header, the
 * navigation and every button drift out from under the thumb. Wide content is
 * allowed to scroll; it must scroll inside its own container.
 *
 * Read-only: it signs in, it looks, it measures.
 *
 *   node --env-file=.env qa-live/responsive-live.mjs
 */
import { chromium } from '@playwright/test';

const BASE = process.env.QA_BASE ?? 'https://onyx-lms-v2.vercel.app';
const DOMAIN = 'mrdemo.test';

const SIZES = [
  { name: 'small phone', width: 360, height: 740 },
  { name: 'large phone', width: 414, height: 896 },
  { name: 'tablet', width: 768, height: 1024 },
];

const AS_STUDENT = ['/onyx/dashboard', '/onyx/courses', '/onyx/exams', '/onyx/assessments',
  '/onyx/timetable', '/onyx/results', '/onyx/practice', '/onyx/workspaces', '/onyx/profile'];
const AS_STAFF = ['/onyx/dashboard', '/onyx/people', '/onyx/people?role=student',
  '/onyx/courses', '/onyx/exams', '/onyx/assessments', '/onyx/invigilate'];

const results = [];
function check(label, pass, detail = '') {
  results.push({ label, pass, detail });
  console.log((pass ? 'ok    ' : 'FAIL  ') + label.padEnd(52), detail);
}

/** How far the page can be scrolled sideways, and what is doing it. */
const MEASURE = () => {
  const doc = document.documentElement;
  const over = Math.max(0, doc.scrollWidth - doc.clientWidth);
  if (!over) return { over, blame: '' };
  const limit = doc.clientWidth;
  const blame = [];
  for (const el of Array.from(document.querySelectorAll('body *'))) {
    const e = el;
    const wide = e.scrollWidth > e.clientWidth + 1;
    const style = getComputedStyle(e);
    const scrolls = style.overflowX === 'auto' || style.overflowX === 'scroll';
    const past = e.getBoundingClientRect().right > limit + 1;
    if ((!wide || scrolls) && !past) continue;
    if (scrolls) continue;
    blame.push(e.tagName.toLowerCase() + '.'
      + String(e.className ?? '').split(/\s+/).slice(0, 3).join('.'));
    if (blame.length >= 3) break;
  }
  return { over, blame: blame.join(' ') };
};

const browser = await chromium.launch();

async function signIn(context, email, password) {
  const page = await context.newPage();
  await page.goto(BASE + '/onyx/login');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL(/\/onyx\/(dashboard|courses)/, { timeout: 45_000 });
  await page.close();
}

for (const size of SIZES) {
  console.log('\n== ' + size.name + ' (' + size.width + 'px) ==');
  for (const who of [
    { role: 'student', email: 'alpha-cse.007@' + DOMAIN, pw: 'Student#2026!', paths: AS_STUDENT },
    { role: 'admin', email: 'admin@' + DOMAIN, pw: 'MrDemo#2026!', paths: AS_STAFF },
  ]) {
    const context = await browser.newContext({
      viewport: { width: size.width, height: size.height },
      // A phone's own user agent, so anything keyed off it behaves as it would.
      isMobile: size.width < 768,
      hasTouch: size.width < 768,
    });
    await signIn(context, who.email, who.pw);
    const page = await context.newPage();

    let worst = 0;
    let worstWhere = '';
    let blamed = '';
    for (const path of who.paths) {
      await page.goto(BASE + path, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(400);
      const { over, blame } = await page.evaluate(MEASURE);
      if (over > worst) { worst = over; worstWhere = path; blamed = blame; }
    }
    check(who.role + ': every screen fits the width', worst <= 1,
      worst ? worstWhere + ' overflows by ' + worst + 'px (' + blamed + ')'
        : who.paths.length + ' screens, none scroll sideways');

    // The navigation, which is the one thing that must never be unreachable.
    await page.goto(BASE + '/onyx/dashboard', { waitUntil: 'domcontentloaded' });
    if (size.width < 1024) {
      const opener = page.getByRole('button', { name: /menu|navigation/i }).first();
      const there = await opener.isVisible().catch(() => false);
      check(who.role + ': the menu button is there', there,
        there ? 'the drawer can be opened' : 'no way into the navigation');
      if (there) {
        await opener.click();
        const drawer = await page.getByRole('navigation', { name: /all sections/i })
          .isVisible().catch(() => false);
        check(who.role + ': and it opens the navigation', drawer);
      }
    } else {
      const rail = await page.getByRole('navigation', { name: /main/i })
        .isVisible().catch(() => false);
      check(who.role + ': the sidebar is shown', rail);
    }

    /*
     * Nothing may be too small to hit — WCAG 2.2 AA 2.5.8, which is 24x24.
     *
     * With the standard's own exception, which matters: a link INSIDE a
     * sentence is exempt, because making it 24px tall would either break the
     * line spacing of the paragraph around it or leave overlapping targets.
     * "How this is worked out" in a paragraph is not a fault; a navigation
     * item at 23px is. Testing without the exception reports the prose and
     * buries the real one.
     */
    const tiny = await page.evaluate(() => {
      const small = [];
      for (const el of Array.from(document.querySelectorAll('a, button'))) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        if (r.height >= 24 && r.width >= 24) continue;
        if (!(el instanceof HTMLElement) || !el.innerText.trim()) continue;
        // Inline in running text: the standard exempts it by name.
        const display = getComputedStyle(el).display;
        const inSentence = display === 'inline' || display === 'inline-block';
        const proseParent = el.parentElement
          && ['P', 'LI', 'SPAN', 'TD', 'DD', 'FIGCAPTION', 'LABEL']
            .includes(el.parentElement.tagName);
        if (inSentence && proseParent) continue;
        small.push(el.innerText.trim().slice(0, 20) + ' ' + Math.round(r.width)
          + '×' + Math.round(r.height));
        if (small.length >= 3) break;
      }
      return small;
    });
    check(who.role + ': every control is big enough to tap', tiny.length === 0,
      tiny.length ? tiny.join(', ') : 'nothing under 24×24');

    await context.close();
  }
}

await browser.close();

const passed = results.filter((r) => r.pass).length;
const failed = results.filter((r) => !r.pass);
console.log('\n' + '='.repeat(72));
console.log(passed + ' pass, ' + failed.length + ' fail, of ' + results.length);
for (const x of failed) console.log('  FAIL ' + x.label + ' -- ' + x.detail);
process.exit(failed.length ? 1 : 0);
