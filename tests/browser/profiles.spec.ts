/**
 * A profile with an address somebody can send to a person.
 *
 * "Your profile" lived at one URL for everybody, and everything on it was
 * derived -- courses, marks, awarded skills -- which made it a record rather
 * than a profile. There was nothing a person could say about themselves, and
 * nothing anybody else could open.
 *
 * The rules worth holding are all about what does NOT happen: a handle nobody
 * has claimed is a 404, a profile switched off is the same 404 (so the address
 * cannot be used to discover who exists), and a public page never carries an
 * email address, a phone number, a roll number or a mark.
 */
import { test, expect, request as playwrightRequest } from '@playwright/test';

const API = process.env.E2E_API ?? process.env.E2E_WEB ?? 'http://127.0.0.1:5173';
const PW = 'Demo#2026!';
const HANDLE = 'abc24-001';

async function token(email: string) {
  const ctx = await playwrightRequest.newContext({ baseURL: API });
  const res = await ctx.post('/api/onyx/auth/login', { data: { email, password: PW } });
  const body = await res.json();
  await ctx.dispose();
  return body.data.token as string;
}

async function patch(tok: string, data: unknown) {
  const ctx = await playwrightRequest.newContext({
    baseURL: API, extraHTTPHeaders: { Authorization: 'Bearer ' + tok },
  });
  const res = await ctx.patch('/api/onyx/my/profile-details', { data });
  const body = await res.json().catch(() => ({}));
  await ctx.dispose();
  return { status: res.status(), body };
}

test.beforeAll(async () => {
  // The demo learner publishes a profile these tests can read.
  await patch(await token('student@demo.onyx'), {
    username: HANDLE,
    headline: 'Final-year B.Sc. Computer Science student',
    bio: 'I like building small tools that do one thing well.',
    skills_text: 'Python, SQL, Data structures',
    interests: 'Data engineering',
    experience: 'Summer intern at a logistics startup.',
    profile_public: true,
  });
});

test('the address carries the handle, and shows what its owner wrote', async ({ page }) => {
  await page.goto('/onyx/p/' + HANDLE);

  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Sam Student');
  await expect(page.getByText('Final-year B.Sc. Computer Science student')).toBeVisible();
  await expect(page.getByText('Python', { exact: true })).toBeVisible();
  await expect(page.getByText('ABC Institution')).toBeVisible();

  // Signed out, and it still answers -- a link that demands a login is not a
  // link anybody can share.
  expect((await page.context().cookies()).length).toBe(0);
});

test('a public profile carries nothing private', async ({ page }) => {
  await page.goto('/onyx/p/' + HANDLE);
  const text = await page.locator('body').innerText();
  for (const secret of ['student@demo.onyx', 'ABC24-001', '@demo.onyx']) {
    expect(text).not.toContain(secret);
  }
});

test('an unclaimed handle and a private profile are the same answer', async ({ page }) => {
  const missing = await page.goto('/onyx/p/nobody-has-this-handle');
  expect(missing?.status()).toBe(404);

  const student = await token('student@demo.onyx');
  await patch(student, { profile_public: false });
  const hidden = await page.goto('/onyx/p/' + HANDLE);
  expect(hidden?.status()).toBe(404);

  await patch(student, { profile_public: true });
});

test('a handle is claimed once, and has to be usable in a URL', async () => {
  const faculty = await token('faculty@demo.onyx');

  const taken = await patch(faculty, { username: HANDLE });
  expect(taken.status).toBe(409);

  const spaces = await patch(faculty, { username: 'no spaces!' });
  expect(spaces.status).toBe(422);
});

test('publishing without an address is refused, not half-done', async () => {
  const exams = await token('exams@demo.onyx');
  const res = await patch(exams, { profile_public: true });
  expect(res.status).toBe(422);
  expect(JSON.stringify(res.body)).toContain('username');
});

test('the owner sees the link on their own profile', async ({ page }) => {
  await page.goto('/onyx/login');
  await page.locator('#email').fill('student@demo.onyx');
  await page.locator('#password').fill(PW);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL((url) => !url.pathname.endsWith('/login'), { timeout: 15_000 });

  await page.goto('/onyx/profile');
  await expect(page.getByRole('heading', { name: 'Your public profile' })).toBeVisible();
  await expect(page.getByText('/onyx/p/' + HANDLE)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Copy link' })).toBeVisible();
});
