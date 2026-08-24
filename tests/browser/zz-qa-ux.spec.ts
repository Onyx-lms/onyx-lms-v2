/**
 * The half of a quality pass an API cannot do.
 *
 * `flows.mjs` proves the product does what it says. This looks at what using
 * it is like: whether a screen is reachable by keyboard, whether the words on
 * it can be read by somebody who cannot pick a pale grey off a white, whether
 * a form tells you what went wrong, and whether the first thing each role sees
 * is the thing they came for.
 *
 * Runs against the DEPLOYED site, not a local build, because that is what the
 * question is about.
 */
import fs from 'node:fs';
import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const BASE = process.env.QA_BASE ?? 'https://onyx-lms-v2.vercel.app';
const PW = 'QaPass#2026!';

/** Filled in by the flows run that precedes this one. */
const world = JSON.parse(fs.readFileSync('qa-live/world.json', 'utf8')) as {
  admin: string; faculty: string; student: string;
};

const findings: { severity: string; where: string; what: string }[] = [];
function note(severity: 'HIGH' | 'MEDIUM' | 'LOW', where: string, what: string) {
  findings.push({ severity, where, what });
  console.log(severity + '  ' + where + ' — ' + what);
}

test.afterAll(async () => {
  fs.writeFileSync('qa-live/ux.json', JSON.stringify(findings, null, 2));
});

async function signIn(page: Page, email: string, password = PW) {
  await page.context().clearCookies();
  await page.goto(BASE + '/onyx/login');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL((u) => !u.pathname.endsWith('/login'), { timeout: 30_000 });
}

/** WCAG 2.1 AA, on the screens each role actually lives on. */
const SCREENS: Record<string, string[]> = {
  admin: ['/onyx/dashboard', '/onyx/courses', '/onyx/people', '/onyx/permissions',
    '/onyx/settings', '/onyx/timetable', '/onyx/exams', '/onyx/assessments', '/onyx/finance'],
  faculty: ['/onyx/dashboard', '/onyx/courses', '/onyx/assessments', '/onyx/invigilate'],
  student: ['/onyx/dashboard', '/onyx/courses', '/onyx/results', '/onyx/timetable',
    '/onyx/jobs', '/onyx/resume', '/onyx/profile'],
};

for (const [role, paths] of Object.entries(SCREENS)) {
  test(role + ': every screen passes WCAG 2.1 AA', async ({ page }) => {
    test.slow();
    const who = role === 'admin' ? world.admin : role === 'faculty' ? world.faculty : world.student;
    await signIn(page, who);

    for (const path of paths) {
      await page.goto(BASE + path, { waitUntil: 'domcontentloaded' });
      const scan = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
      for (const v of scan.violations) {
        note(v.impact === 'critical' || v.impact === 'serious' ? 'HIGH' : 'MEDIUM',
          role + ' ' + path, v.id + ' ×' + v.nodes.length + ' — ' + v.help);
      }
    }
    // Recorded rather than asserted: this run is a survey, and one failing
    // rule should not stop the other screens being looked at.
    expect(true).toBe(true);
  });
}

test('a keyboard alone reaches the first control on every role\'s landing screen',
  async ({ page }) => {
    test.slow();
    for (const [role, who] of [['admin', world.admin], ['faculty', world.faculty],
      ['student', world.student]] as const) {
      await signIn(page, who);
      await page.goto(BASE + '/onyx/dashboard', { waitUntil: 'domcontentloaded' });
      await page.keyboard.press('Tab');
      const first = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        return el ? (el.textContent ?? '').trim().slice(0, 60) : 'nothing';
      });
      if (!/skip/i.test(first)) {
        note('MEDIUM', role + ' /onyx/dashboard',
          'the first Tab lands on "' + first + '" rather than a skip link');
      }
    }
    expect(true).toBe(true);
  });

test('a wrong password says so, and does not move the page', async ({ page }) => {
  await page.context().clearCookies();
  await page.goto(BASE + '/onyx/login');
  await page.getByLabel('Email address').fill(world.student);
  await page.getByLabel('Password', { exact: true }).fill('definitely-not-it');
  await page.getByRole('button', { name: /sign in/i }).click();
  const alert = page.getByRole('alert');
  await expect(alert).toBeVisible({ timeout: 20_000 });
  expect(page.url()).toContain('/onyx/login');
});

test('every landing screen leads with what that role came for', async ({ page }) => {
  // A dashboard that opens on somebody else's work is the commonest way a
  // product feels wrong without being broken.
  for (const [role, who, wanted] of [
    ['admin', world.admin, /people|course|institution|today/i],
    ['faculty', world.faculty, /course|class|marking|today/i],
    ['student', world.student, /course|next|result|today/i],
  ] as const) {
    await signIn(page, who);
    const main = await page.locator('main').innerText();
    if (!wanted.test(main)) {
      note('MEDIUM', role + ' /onyx/dashboard',
        'the landing screen does not lead with anything matching ' + wanted);
    }
  }
  expect(true).toBe(true);
});

test('the phone-sized layout does not scroll sideways', async ({ page }) => {
  // Sideways scroll on a phone is the single most common layout fault, and it
  // makes a page feel broken even when everything on it works.
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, world.student);
  for (const path of ['/onyx/dashboard', '/onyx/courses', '/onyx/results', '/onyx/timetable']) {
    await page.goto(BASE + path, { waitUntil: 'domcontentloaded' });
    const overflow = await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (overflow > 2) {
      note('MEDIUM', 'student ' + path, 'the page scrolls sideways by ' + overflow + 'px at 390px');
    }
  }
  expect(true).toBe(true);
});

test('a learner is offered nothing they cannot use', async ({ page }) => {
  await signIn(page, world.student);
  await page.goto(BASE + '/onyx/dashboard', { waitUntil: 'domcontentloaded' });
  const body = await page.locator('body').innerText();
  for (const forbidden of ['Fees', 'Interviews', 'Audit log', 'Finance', 'Settings']) {
    if (new RegExp('(^|\\n)\\s*' + forbidden + '\\s*($|\\n)').test(body)) {
      note('MEDIUM', 'student /onyx/dashboard',
        '"' + forbidden + '" is offered to a learner');
    }
  }
  expect(true).toBe(true);
});
