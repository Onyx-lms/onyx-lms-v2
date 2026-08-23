// Shared QA driver helpers against the live deployment.
import { chromium } from '@playwright/test';

export const BASE = process.env.QA_BASE ?? 'https://onyx-lms-v2.vercel.app';

export const ACCOUNTS = {
  superadmin: { email: 'superadmin@onyx.platform', password: 'Platform#2026!', door: '/onyx/platform/login' },
  admin:      { email: 'admin@demo.onyx',     password: 'Demo#2026!' },
  faculty:    { email: 'faculty@demo.onyx',   password: 'Demo#2026!' },
  exams:      { email: 'exams@demo.onyx',     password: 'Demo#2026!' },
  placement:  { email: 'placement@demo.onyx', password: 'Demo#2026!' },
  employer:   { email: 'employer@demo.onyx',  password: 'Demo#2026!' },
  guardian:   { email: 'guardian@demo.onyx',  password: 'Demo#2026!' },
  student:    { email: 'student@demo.onyx',   password: 'Demo#2026!' },
  // second tenant, richer seed data
  m_admin:    { email: 'kavya.rao@meridian.edu',     password: 'Demo#2026!' },
  m_faculty:  { email: 'leela.iyer@meridian.edu',    password: 'Demo#2026!' },
  m_student:  { email: 'ananya.krishnan@meridian.edu', password: 'Demo#2026!' },
  m_placement:{ email: 'nisha.verma@meridian.edu',   password: 'Demo#2026!' },
  m_guardian: { email: 'sunita.pillai@example.com',  password: 'Demo#2026!' },
  m_exams:    { email: 'ravi.chandran@meridian.edu', password: 'Demo#2026!' },
};

export async function launch() {
  const browser = await chromium.launch();
  return browser;
}

/** New page with console/pageerror/response capture attached. */
export async function newPage(ctx) {
  const page = await ctx.newPage();
  page.__console = [];
  page.__pageerrors = [];
  page.__failedReq = [];
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') {
      page.__console.push({ type: m.type(), text: m.text().slice(0, 400) });
    }
  });
  page.on('pageerror', (e) => page.__pageerrors.push(String(e).slice(0, 400)));
  page.on('requestfailed', (r) => {
    const f = r.failure();
    page.__failedReq.push({ url: r.url().slice(0, 200), err: f?.errorText });
  });
  page.on('response', (r) => {
    const s = r.status();
    if (s >= 400 && r.url().startsWith(BASE)) {
      (page.__badResp ??= []).push({ url: r.url().replace(BASE, '').slice(0, 200), status: s });
    }
  });
  return page;
}

export function drain(page) {
  const out = {
    console: page.__console.splice(0),
    pageerrors: page.__pageerrors.splice(0),
    failedReq: page.__failedReq.splice(0),
    badResp: (page.__badResp ?? []).splice(0),
  };
  return out;
}

export async function signIn(page, key) {
  const a = ACCOUNTS[key];
  if (!a) throw new Error('no account ' + key);
  const door = a.door ?? '/onyx/login';
  await page.goto(BASE + door, { waitUntil: 'domcontentloaded' });
  await page.locator('#email').fill(a.email);
  await page.locator('#password').fill(a.password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL((u) => !u.pathname.endsWith('/login'), { timeout: 30000 });
  await page.waitForLoadState('domcontentloaded');
  return page.url().replace(BASE, '');
}

const ERROR_PATTERNS = [
  /Application error: a (server|client)-side exception/i,
  /Internal Server Error/i,
  /This page could not be found/i,
  /Unhandled Runtime Error/i,
  /500\s*[-|:]\s*/,
];

/** Visit a path, return a verdict record. */
export async function visit(page, path, opts = {}) {
  drain(page);
  let status = null, err = null;
  const t0 = Date.now();
  try {
    const resp = await page.goto(BASE + path, { waitUntil: 'domcontentloaded', timeout: 40000 });
    status = resp?.status() ?? null;
  } catch (e) {
    err = String(e).slice(0, 250);
  }
  const ms = Date.now() - t0;
  let body = '';
  try { body = (await page.locator('body').innerText({ timeout: 10000 })).slice(0, 6000); } catch {}
  const noise = drain(page);
  const landed = page.url().replace(BASE, '');
  const matched = ERROR_PATTERNS.filter((r) => r.test(body)).map(String);
  return {
    path, landed, status, ms, nav_error: err,
    errorText: matched,
    h1: (body.split('\n').find((l) => l.trim().length > 2) ?? '').slice(0, 120),
    empty: body.trim().length < 40,
    pageerrors: noise.pageerrors,
    consoleErrors: noise.console.filter((c) => c.type === 'error'),
    badResp: noise.badResp,
    bodyLen: body.length,
    snippet: opts.snippet ? body.slice(0, 1200) : undefined,
  };
}

export function verdict(r) {
  if (r.nav_error) return 'FAIL';
  if (r.status && r.status >= 500) return 'FAIL';
  if (r.errorText.length) return 'FAIL';
  if (r.pageerrors.length) return 'FAIL';
  if (r.empty) return 'FAIL';
  if (r.status === 404) return 'WARN';
  if (r.consoleErrors.length || (r.badResp ?? []).length) return 'WARN';
  return 'PASS';
}
