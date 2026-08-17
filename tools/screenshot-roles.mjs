/**
 * One-off documentation aid: signs in as every demo role through the real
 * login form, walks every page that role's own nav offers, and saves a
 * full-page screenshot of each -- for docs/roles/*.md.
 *
 * Not a test. No assertions; a missing element just means the page had
 * nothing there for that role, which is exactly what the docs need to show.
 *
 * Run with the dev servers already up:
 *   node tools/screenshot-roles.mjs
 */
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const WEB = process.env.E2E_WEB ?? 'http://127.0.0.1:5175';
const OUT = path.join(process.cwd(), 'docs', 'roles', 'screenshots');
const PASSWORD = 'Demo#2026!';
const PLATFORM_PASSWORD = 'Platform#2026!';
const VIEWPORT = { width: 1440, height: 900 };

const page1 = (url, slug) => ({ url, slug });

const ROLES = {
  student: {
    email: 'student@demo.onyx', landing: '/onyx/dashboard',
    pages: [
      page1('/onyx/dashboard', 'dashboard'),
      page1('/onyx/courses', 'courses'),
      page1('/onyx/practice', 'practice'),
      page1('/onyx/workspaces', 'workspaces'),
      page1('/onyx/assessments', 'assessments'),
      page1('/onyx/exams', 'exams'),
      page1('/onyx/results', 'results'),
      page1('/onyx/contests', 'contests'),
      page1('/onyx/timetable', 'timetable'),
      page1('/onyx/fees', 'fees'),
      page1('/onyx/support', 'support'),
      page1('/onyx/jobs', 'jobs'),
      page1('/onyx/interviews', 'interviews'),
      page1('/onyx/profile', 'profile'),
      page1('/onyx/inbox', 'inbox'),
    ],
  },
  faculty: {
    email: 'faculty@demo.onyx', landing: '/onyx/dashboard',
    pages: [
      page1('/onyx/dashboard', 'dashboard'),
      page1('/onyx/courses', 'courses'),
      page1('/onyx/practice', 'practice'),
      page1('/onyx/workspaces', 'workspaces'),
      page1('/onyx/assessments', 'assessments'),
      page1('/onyx/exams', 'exams'),
      page1('/onyx/invigilate', 'invigilate'),
      page1('/onyx/programs', 'programs'),
      page1('/onyx/timetable', 'timetable'),
      page1('/onyx/allocations', 'allocations'),
      page1('/onyx/people', 'people'),
      page1('/onyx/support', 'mentor-queue'),
      page1('/onyx/inbox', 'inbox'),
    ],
  },
  exams: {
    email: 'exams@demo.onyx', landing: '/onyx/exams',
    pages: [
      page1('/onyx/assessments', 'assessments'),
      page1('/onyx/invigilate', 'invigilate'),
      page1('/onyx/exams', 'exams'),
      page1('/onyx/timetable', 'timetable'),
      page1('/onyx/certificates', 'certificates'),
      page1('/onyx/inbox', 'inbox'),
    ],
  },
  placement: {
    email: 'placement@demo.onyx', landing: '/onyx/placement',
    pages: [
      page1('/onyx/placement', 'placement'),
      page1('/onyx/jobs', 'jobs'),
      page1('/onyx/interviews', 'interviews'),
      page1('/onyx/contests', 'contests'),
      page1('/onyx/certificates', 'certificates'),
      page1('/onyx/inbox', 'inbox'),
    ],
  },
  employer: {
    email: 'employer@demo.onyx', landing: '/onyx/jobs',
    pages: [
      page1('/onyx/jobs', 'jobs'),
      page1('/onyx/interviews', 'interviews'),
      page1('/onyx/inbox', 'inbox'),
    ],
  },
  guardian: {
    email: 'guardian@demo.onyx', landing: '/onyx/family',
    pages: [
      page1('/onyx/family', 'family'),
      page1('/onyx/inbox', 'inbox'),
    ],
  },
  admin: {
    email: 'admin@demo.onyx', landing: '/onyx/dashboard',
    pages: [
      page1('/onyx/dashboard', 'dashboard'),
      page1('/onyx/courses', 'courses'),
      page1('/onyx/workspaces', 'workspaces'),
      page1('/onyx/assessments', 'assessments'),
      page1('/onyx/invigilate', 'invigilate'),
      page1('/onyx/exams', 'exams'),
      page1('/onyx/contests', 'contests'),
      page1('/onyx/certificates', 'certificates'),
      page1('/onyx/programs', 'programs'),
      page1('/onyx/timetable', 'timetable'),
      page1('/onyx/allocations', 'allocations'),
      page1('/onyx/people?role=student', 'people-students'),
      page1('/onyx/people?role=faculty', 'people-faculty'),
      page1('/onyx/finance', 'finance'),
      page1('/onyx/placement', 'placement'),
      page1('/onyx/jobs', 'jobs'),
      page1('/onyx/support', 'mentor-queue'),
      page1('/onyx/inbox', 'inbox'),
      page1('/onyx/audit', 'audit'),
    ],
  },
};

const PLATFORM_PAGES = [
  page1('/onyx/platform', 'institutions'),
  page1('/onyx/platform/tenants/279', 'tenant-detail'),
  page1('/onyx/platform/admins', 'admins'),
  page1('/onyx/platform/audit', 'audit'),
];

async function shoot(page, url, outFile) {
  await page.goto(WEB + url, { waitUntil: 'networkidle', timeout: 20_000 }).catch(async () => {
    // Some pages (contests with no active run, etc.) settle slower than
    // networkidle allows for; a plain load is good enough for a screenshot.
    await page.goto(WEB + url, { waitUntil: 'load', timeout: 20_000 });
  });
  await page.waitForTimeout(400); // let client-side widgets (charts, polling) settle
  await page.screenshot({ path: outFile, fullPage: true });
  console.log('  ' + outFile.replace(process.cwd() + path.sep, ''));
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();

  // Shared, role-agnostic login screens.
  {
    const ctx = await browser.newContext({ viewport: VIEWPORT });
    const page = await ctx.newPage();
    console.log('login pages');
    await shoot(page, '/onyx/login', path.join(OUT, 'login-tenant.png'));
    await shoot(page, '/onyx/platform/login', path.join(OUT, 'login-platform.png'));
    await ctx.close();
  }

  for (const [role, cfg] of Object.entries(ROLES)) {
    console.log(role);
    const dir = path.join(OUT, role);
    fs.mkdirSync(dir, { recursive: true });
    const ctx = await browser.newContext({ viewport: VIEWPORT });
    const page = await ctx.newPage();
    await page.goto(WEB + '/onyx/login');
    await page.getByLabel('Email address').fill(cfg.email);
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByRole('button', { name: /sign in/i }).click();
    await page.waitForURL('**' + cfg.landing, { timeout: 15_000 });
    for (const p of cfg.pages) {
      await shoot(page, p.url, path.join(dir, p.slug + '.png'));
    }
    await ctx.close();
  }

  {
    console.log('platform');
    const dir = path.join(OUT, 'platform');
    fs.mkdirSync(dir, { recursive: true });
    const ctx = await browser.newContext({ viewport: VIEWPORT });
    const page = await ctx.newPage();
    await page.goto(WEB + '/onyx/platform/login');
    await page.getByLabel('Email address').fill('superadmin@onyx.platform');
    await page.getByLabel('Password').fill(PLATFORM_PASSWORD);
    await page.getByRole('button', { name: /sign in/i }).click();
    await page.waitForURL('**/onyx/platform', { timeout: 15_000 });
    for (const p of PLATFORM_PAGES) {
      await shoot(page, p.url, path.join(dir, p.slug + '.png'));
    }
    await ctx.close();
  }

  await browser.close();
  console.log('done');
}

main().catch((err) => { console.error(err); process.exit(1); });
