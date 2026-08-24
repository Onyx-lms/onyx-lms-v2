/**
 * The show/hide control on every credential field.
 *
 * Checks the behaviour rather than the pixels: the input starts masked, the
 * button reveals it, the accessible name says what pressing it will do, and --
 * the one that would be a real bug -- pressing it does NOT submit the form it
 * sits inside.
 */
import { chromium } from '@playwright/test';

const BASE = process.env.QA_BASE ?? 'http://localhost:5199';
let failures = 0;
const ok = (l, c, d = '') => {
  console.log((c ? '  PASS  ' : '  FAIL  ') + l + (d ? ' - ' + d : ''));
  if (!c) failures += 1;
};

const browser = await chromium.launch();

async function checkField(page, path, fieldId, label) {
  await page.goto(BASE + path, { waitUntil: 'domcontentloaded' });
  const input = page.locator('#' + fieldId);
  await input.waitFor({ state: 'visible', timeout: 40000 });

  ok(label + ' starts masked', await input.getAttribute('type') === 'password');

  // Wait for React to attach before pressing anything. Both sign-in forms keep
  // their submit button disabled until hydration (see useHydrated), which is
  // the honest signal that the page is live -- and on a real origin the gap is
  // long enough that a test clicking immediately measures the network, not the
  // control.
  const submit = page.getByRole('button', { name: /sign in|add|save|create/i }).first();
  if (await submit.count()) {
    for (let i = 0; i < 60 && !(await submit.isEnabled()); i += 1) await page.waitForTimeout(500);
  }

  const toggle = page.locator('button[aria-controls="' + fieldId + '"]');
  ok(label + ' has a toggle beside it', await toggle.count() === 1);
  ok(label + ' toggle is a button, not a submit',
    await toggle.getAttribute('type') === 'button');
  ok(label + ' toggle says what it does',
    /show password/i.test(await toggle.getAttribute('aria-label') ?? ''),
    await toggle.getAttribute('aria-label'));

  await input.fill('Secret#2026!');
  const urlBefore = page.url();
  await toggle.click();
  await page.waitForTimeout(250);

  ok(label + ' reveals the text when pressed',
    await input.getAttribute('type') === 'text');
  ok(label + ' keeps what was typed', await input.inputValue() === 'Secret#2026!');
  ok(label + ' toggle now offers to hide',
    /hide password/i.test(await toggle.getAttribute('aria-label') ?? ''));
  ok(label + ' toggle reports its state to a screen reader',
    await toggle.getAttribute('aria-pressed') === 'true');
  // The bug a naive toggle ships with: a <button> with no type inside a form
  // is a submit button, so "show password" submits a half-typed sign-in.
  ok(label + ' pressing it did not submit the form', page.url() === urlBefore,
    page.url());

  await toggle.click();
  await page.waitForTimeout(200);
  ok(label + ' hides it again', await input.getAttribute('type') === 'password');
}

{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  console.log('\n=== The two sign-in doors ===');
  await checkField(page, '/onyx/login', 'password', 'Institution sign-in');
  await checkField(page, '/onyx/platform/login', 'password', 'Platform sign-in');
  await page.goto(BASE + '/onyx/login', { waitUntil: 'domcontentloaded' });
  await page.locator('#password').fill('Demo#2026!');
  await page.locator('button[aria-controls="password"]').click();
  await page.screenshot({ path: 'qa-password-login.png' });
  await ctx.close();
}

// The form still signs in with the field swapped out: the toggle wraps the
// input in a div, and an uncontrolled form reads it through FormData.
{
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  console.log('\n=== The form still signs in ===');
  await page.goto(BASE + '/onyx/login', { waitUntil: 'domcontentloaded' });
  await page.locator('#email').fill('admin@demo.onyx');
  await page.locator('#password').fill('Demo#2026!');
  const btn = page.getByRole('button', { name: /sign in/i });
  for (let i = 0; i < 60 && !(await btn.isEnabled()); i += 1) await page.waitForTimeout(500);
  // Revealed first, so what is submitted is the value of a text input rather
  // than a password one.
  await page.locator('button[aria-controls="password"]').click();
  await btn.click();
  await page.waitForURL((u) => !u.pathname.endsWith('/login'), { timeout: 40000 })
    .catch(() => {});
  ok('signing in works with the password revealed',
    !page.url().includes('/login'), page.url().replace(BASE, ''));

  // Setting somebody ELSE'S password is where a typo is not a retry but an
  // account nobody can open.
  console.log('\n=== Behind a session ===');
  await page.goto(BASE + '/onyx/people', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  const add = page.getByRole('button', { name: /add (a )?(person|someone|member)/i }).first();
  if (await add.count()) {
    await add.click();
    await page.waitForTimeout(700);
    const pw = page.locator('#ap-password');
    const tog = page.locator('button[aria-controls="ap-password"]');
    ok('the add-a-person form has a password toggle',
      (await pw.count()) > 0 && (await tog.count()) === 1);
    if (await pw.count()) {
      await pw.fill('Temp#2026!');
      await tog.click();
      await page.waitForTimeout(250);
      ok('an operator can read the password they are setting for somebody else',
        await pw.getAttribute('type') === 'text');
      await page.screenshot({ path: 'qa-password-people.png' });
    }
  } else {
    ok('the People screen offers adding a person', false, 'button not found');
  }
  await ctx.close();
}

// Sign-up's password sits on step two, behind an emailed code, so it cannot be
// reached from a cold load. It is the same component as the two proven above;
// what is checked here is that the page itself still renders.
{
  const src = await fetch(BASE + '/onyx/signup').then((r) => r.text());
  ok('the sign-up page renders its first step', src.includes('Create your account'));
}

await browser.close();
console.log('\n' + (failures ? failures + ' FAILURES' : 'password toggles work'));
process.exitCode = failures ? 1 : 0;
