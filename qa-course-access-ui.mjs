/**
 * Open and locked on the screens: the console that sets it, and the learner's
 * catalogue and course page that read it.
 *
 * ABC Institution only (tenant 1).
 */
import { chromium } from '@playwright/test';

const BASE = process.env.QA_BASE ?? 'http://localhost:5199';
const STAMP = Date.now().toString(36);
let failures = 0;
const ok = (l, c, d = '') => {
  console.log((c ? '  PASS  ' : '  FAIL  ') + l + (d ? ' - ' + d : ''));
  if (!c) failures += 1;
};

async function signIn(ctx, door, email, pw) {
  const p = await ctx.newPage();
  await p.goto(BASE + door, { waitUntil: 'domcontentloaded' });
  await p.locator('#email').waitFor({ state: 'visible', timeout: 40000 });
  await p.locator('#email').fill(email);
  await p.locator('#password').fill(pw);
  const btn = p.getByRole('button', { name: /sign in/i });
  for (let i = 0; i < 60 && !(await btn.isEnabled()); i += 1) await p.waitForTimeout(400);
  await btn.click();
  await p.waitForURL((u) => !u.pathname.endsWith('/login'), { timeout: 40000 });
  return p;
}

const browser = await chromium.launch();

// ------------------------------------------------------------- the console --
let lockedTitle;
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await signIn(ctx, '/onyx/platform/login',
    'superadmin@onyx.platform', 'Platform#2026!');
  console.log('\n=== The console sets how a course is joined ===');

  await page.goto(BASE + '/onyx/platform/tenants/1/courses', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);

  const head = (await page.locator('thead').innerText()).toLowerCase();
  ok('the list has a column for how a course is joined', head.includes('joining'), head.trim());
  ok('and a separate one for whether it is published', head.includes('status'));

  const body = await page.locator('body').innerText();
  ok('a published course reads "Published", not "Open"',
    /published/i.test(body) && !/\bOPEN\b(?!\s*·)/.test(body.replace(/Open · free/g, '')),
    'the word Open is now reserved for free-to-join');
  ok('free courses are marked Open · free', /open · free/i.test(body));

  await page.getByRole('button', { name: /add a course/i }).click();
  await page.waitForTimeout(600);
  const opts = await page.locator('#cc-access option').allInnerTexts();
  ok('the create form asks how learners get on',
    opts.some((t) => /open/i.test(t)) && opts.some((t) => /locked/i.test(t)),
    opts.join(' / '));
  ok('it defaults to open', await page.locator('#cc-access').inputValue() === 'open');
  ok('no price is shown while it is free',
    await page.locator('#cc-price').count() === 0);

  lockedTitle = 'UI Locked course ' + STAMP;
  await page.locator('#cc-access').selectOption('locked');
  await page.waitForTimeout(400);
  ok('choosing locked reveals a price', await page.locator('#cc-price').isVisible());
  ok('pre-filled at the house price of 300',
    await page.locator('#cc-price').inputValue() === '300',
    await page.locator('#cc-price').inputValue());

  await page.locator('#cc-code').fill('UIL' + STAMP.slice(-4).toUpperCase());
  await page.locator('#cc-title').fill(lockedTitle);
  await page.screenshot({ path: 'qa-shot-console-course-access.png', fullPage: true });
  await page.getByRole('button', { name: /^(add|create|save)/i }).last().click();
  await page.waitForTimeout(3500);

  const after = await page.locator('body').innerText();
  ok('the new course is listed as locked at ₹300',
    after.includes(lockedTitle) && /locked · ₹300/i.test(after),
    (after.match(/.{0,40}Locked · ₹[\d,.]+/i) ?? ['not found'])[0]);

  /*
   * Publish it through the edit form, which is also how the access fields get
   * exercised on that form. A course is created as a draft whatever its access
   * -- the form says so -- and a draft is correctly absent from the learner's
   * catalogue, so without this step the learner half below would be testing
   * that an unpublished course is hidden, which it already does elsewhere.
   */
  const row = page.locator('tr').filter({ hasText: lockedTitle }).first();
  await row.getByRole('button', { name: /edit/i }).click();
  await page.waitForTimeout(700);
  const statusSel = page.locator('select[name="status"]').first();
  const statusOpts = await statusSel.locator('option').allInnerTexts();
  ok('the edit form calls publication "Published", not "Open"',
    statusOpts.some((t) => /published/i.test(t)) && !statusOpts.some((t) => /^open$/i.test(t)),
    statusOpts.join(' / '));
  const accessSel = page.locator('select[name="access"]').first();
  ok('the edit form carries the course current access',
    await accessSel.inputValue() === 'locked', await accessSel.inputValue());
  ok('and its current price', await page.locator('input[name="price"]').inputValue() === '300');
  await statusSel.selectOption('1');
  await page.getByRole('button', { name: /^save/i }).first().click();
  await page.waitForTimeout(3000);
  ok('the course is published', /published/i.test(await page.locator('body').innerText()));
  await ctx.close();
}

// ------------------------------------------------------------- the learner --
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await signIn(ctx, '/onyx/login', 'student@demo.onyx', 'Demo#2026!');
  console.log('\n=== What the learner sees ===');

  await page.goto(BASE + '/onyx/courses', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  const cat = await page.locator('body').innerText();

  ok('the locked course is on the catalogue', cat.includes(lockedTitle),
    lockedTitle);
  ok('priced at ₹300 where the learner can see it', /₹\s?300/.test(cat),
    (cat.match(/.{0,50}₹\s?300.{0,30}/) ?? ['no price on the catalogue'])[0]);
  ok('and offered as something to buy rather than join',
    /buy for ₹|unlock/i.test(cat),
    (cat.match(/.{0,30}(buy for ₹|unlock).{0,20}/i) ?? ['no purchase control'])[0]);
  ok('a free course is offered as a join, not a purchase',
    /\bstart\b|\bjoin\b/i.test(cat));
  await page.screenshot({ path: 'qa-shot-student-catalogue.png', fullPage: true });

  // The course's own page, which is where a shared link lands.
  const link = page.locator('a[href^="/onyx/courses/"]').filter({ hasText: lockedTitle }).first();
  if (await link.count()) {
    const href = await link.getAttribute('href');
    await page.goto(BASE + href, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);
    const detail = await page.locator('body').innerText();
    ok('the course page says what it costs, and offers to take the money',
      /₹\s?300/.test(detail) && /buy for ₹|unlock/i.test(detail),
      (detail.match(/.{0,40}(buy for ₹|unlock).{0,30}/i) ?? ['no purchase control'])[0]);
    await page.screenshot({ path: 'qa-shot-student-locked-course.png', fullPage: true });
  } else {
    ok('the locked course opens from the catalogue', false, 'no link found');
  }
  await ctx.close();
}

await browser.close();
console.log('\n' + (failures ? failures + ' FAILURES' : 'open and locked read correctly on both sides'));
process.exitCode = failures ? 1 : 0;
