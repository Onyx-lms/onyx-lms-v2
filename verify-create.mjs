import { chromium } from '@playwright/test';
const WEB = process.argv[2];
const b = await chromium.launch();

const CREATE = /create a profile/i;
const scan = async (page, where) => {
  const aside = page.locator('aside');
  const inSidebar = await aside.getByRole('button', { name: CREATE }).count()
    + await aside.getByRole('link', { name: CREATE }).count();
  const anywhere = await page.getByRole('button', { name: CREATE }).count();
  console.log(where.padEnd(46), '| in sidebar:', inSidebar, '| anywhere on page:', anywhere);
};

const scanMenu = async (page, where) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /open navigation/i }).click();
  await page.waitForTimeout(500);
  const n = await page.getByRole('button', { name: CREATE }).count();
  console.log(where.padEnd(46), '| in phone menu:', n);
  await page.setViewportSize({ width: 1440, height: 950 });
};

// ---- super admin -------------------------------------------------------
{
  const page = await (await b.newContext({ viewport: { width: 1440, height: 950 } })).newPage();
  await page.goto(WEB + '/onyx/platform/login');
  await page.getByLabel(/email/i).fill('superadmin@onyx.platform');
  await page.getByLabel(/password/i).fill('Platform#2026!');
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL((u) => !u.pathname.endsWith('/login'), { timeout: 20000 });

  for (const p of ['/onyx/platform', '/onyx/platform/tenants/1', '/onyx/platform/tenants/1/students',
    '/onyx/platform/tenants/1/faculty', '/onyx/platform/tenants/1/staff', '/onyx/platform/admins']) {
    await page.goto(WEB + p, { waitUntil: 'networkidle' });
    await scan(page, 'SUPER ' + p);
  }
  await page.goto(WEB + '/onyx/platform/tenants/1/students', { waitUntil: 'networkidle' });
  await scanMenu(page, 'SUPER /tenants/1/students');

  // What replaced it, per roster tab.
  for (const [p, label] of [['/onyx/platform/tenants/1/students', 'Add a student'],
    ['/onyx/platform/tenants/1/faculty', 'Add a faculty member'],
    ['/onyx/platform/tenants/1/staff', 'Add someone']]) {
    await page.goto(WEB + p, { waitUntil: 'networkidle' });
    console.log('SUPER replacement on', p.split('/').pop().padEnd(10), '->',
      await page.getByRole('button', { name: label }).count(), 'x', JSON.stringify(label));
  }
}

// ---- institution admin -------------------------------------------------
{
  const page = await (await b.newContext({ viewport: { width: 1440, height: 950 } })).newPage();
  await page.goto(WEB + '/onyx/login');
  await page.locator('#email').fill('admin@demo.onyx');
  await page.locator('#password').fill('Demo#2026!');
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL((u) => !u.pathname.endsWith('/login'), { timeout: 20000 });

  for (const p of ['/onyx/dashboard', '/onyx/people', '/onyx/people?role=student',
    '/onyx/people?role=faculty', '/onyx/courses', '/onyx/settings']) {
    await page.goto(WEB + p, { waitUntil: 'networkidle' });
    await scan(page, 'ADMIN ' + p);
  }
  await page.goto(WEB + '/onyx/dashboard', { waitUntil: 'networkidle' });
  await scanMenu(page, 'ADMIN /onyx/dashboard');

  for (const [p, label] of [['/onyx/people?role=student', 'Add a student'],
    ['/onyx/people?role=faculty', 'Add a faculty member'], ['/onyx/people', 'Add someone']]) {
    await page.goto(WEB + p, { waitUntil: 'networkidle' });
    console.log('ADMIN replacement on', p.padEnd(28), '->',
      await page.getByRole('button', { name: label }).count(), 'x', JSON.stringify(label));
  }
}
await b.close();
