/**
 * Permissions as a screen of their own, and as a decision about one person.
 *
 * Three changes, and the one worth testing hardest is the middle one, because
 * it is authorization:
 *
 *   * Permissions left Settings for "Roles and permissions". A settings page
 *     is about the site; who is allowed to run the institution is not a
 *     setting.
 *
 *   * An administrator can find one person and give or take a capability from
 *     them by name. The role, and everybody else who shares it, is untouched.
 *     Before this, granting a lecturer one extra thing meant promoting every
 *     lecturer.
 *
 *   * The community an institution runs is a link on Jobs, set by an
 *     administrator.
 *
 * The end-to-end assertion is the point: a grant made on the screen has to
 * change what the API accepts from that person. A screen that stores a
 * preference nothing reads is worse than no feature, because it looks like one.
 */
import { test, expect } from '@playwright/test';
import {
  withDb, RUN, api, PASSWORD, mail, createTenant, adminToken, addMember, signInViaForm,
  cleanupTenants,
} from './helpers.ts';

const T = { name: 'Grant College ' + RUN, slug: 'grant-' + RUN };
const adminEmail = mail('grant', 'admin');
const facultyEmail = mail('grant', 'fay');
const otherFacultyEmail = mail('grant', 'omar');

const w = { tenantId: 0, facultyMembershipId: 0 };

test.describe.configure({ mode: 'serial' });

/** A token for one of the seeded people. */
async function tokenFor(email: string): Promise<string> {
  const res = await api<{ token: string }>('/api/onyx/auth/login',
    { body: { email, password: PASSWORD } });
  if (!res.ok) throw new Error('sign-in failed for ' + email + ': ' + res.message);
  return res.data.token;
}

test.beforeAll(async () => {
  await createTenant(T.name, T.slug, 'Grant Admin', adminEmail);
  const token = await adminToken(adminEmail);
  await addMember(token, 'Fay Faculty', facultyEmail, 'faculty');
  await addMember(token, 'Omar Other', otherFacultyEmail, 'faculty');

  w.tenantId = await withDb(async (c) => Number((await c.query(
    'SELECT id FROM public."onyx_tenants" WHERE slug=$1', [T.slug])).rows[0].id));

  const members = await api('/api/onyx/members', { token });
  const roster = members.data as { id: number; user: { email: string } | null }[];
  w.facultyMembershipId = roster.find((m) => m.user?.email === facultyEmail)!.id;

  // Take a capability off faculty at the role level, so the personal grant
  // below has something real to restore.
  const before = await api('/api/onyx/permissions', { token });
  const matrix = Object.fromEntries(
    (before.data as { capabilities: { key: string; holders_now: string[] }[] })
      .capabilities.map((c) => [c.key, c.holders_now]));
  expect(matrix['courses.create'], 'fixture: faculty create courses by default')
    .toContain('faculty');
  const saved = await api('/api/onyx/permissions', {
    method: 'PUT', token,
    body: { permissions: { ...matrix, 'courses.create': ['admin'] } },
  });
  expect(saved.status, 'could not revoke at the role level').toBe(200);
});

test.afterAll(async () => {
  await cleanupTenants([T.slug], 'grant.%.' + RUN + '@onyx.test');
});

test('the role change stops both lecturers, which is the problem being solved',
  async () => {
    // The state institutions get stuck in: the only lever is the role, and it
    // moves everybody at once.
    for (const email of [facultyEmail, otherFacultyEmail]) {
      const refused = await api('/api/onyx/courses', {
        method: 'POST', token: await tokenFor(email),
        body: { code: 'X' + RUN.slice(-4), title: 'Should not exist', credits: 3 },
      });
      expect(refused.status, email + ' could still create a course').toBe(403);
    }
  });

test('permissions have their own screen, and Settings no longer holds them',
  async ({ page }) => {
    await signInViaForm(page, adminEmail);

    await page.goto('/onyx/permissions');
    await expect(page.getByRole('heading', { name: 'Roles and permissions' }))
      .toBeVisible({ timeout: 20_000 });
    // By heading, not by text: the matrix itself says "by role" in a dozen
    // rows, so a bare text locator resolves to all of them.
    await expect(page.getByRole('heading', { name: 'By role' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'By person' })).toBeVisible();

    // Settings keeps what a settings page is for and nothing else.
    await page.goto('/onyx/settings');
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
    await expect(page.getByText('Student registration')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Permissions', exact: true }))
      .toHaveCount(0);

    // And it is reachable from the navigation, not only by typing the URL.
    await expect(page.getByRole('link', { name: 'Roles and permissions' })).toBeVisible();
  });

test('one lecturer is given it back by name, and the other is not', async ({ page }) => {
  await signInViaForm(page, adminEmail);
  await page.goto('/onyx/permissions');

  // Found by name, the way somebody actually looks for a colleague.
  await page.getByLabel('Find a person').fill('Fay');
  await page.getByRole('button', { name: /Fay Faculty/ }).click();

  // The capability is listed with what their role says about it.
  const row = page.locator('li', { hasText: 'Create courses' }).first();
  await expect(row).toBeVisible({ timeout: 20_000 });
  await row.getByRole('button', { name: 'Allow' }).click();
  await page.getByRole('button', { name: /Save their permissions/ }).click();
  await expect(page.getByText('Saved.')).toBeVisible({ timeout: 20_000 });

  // The API now accepts from her what it refuses from her colleague. This is
  // the whole feature: a screen that stored a preference nothing read would
  // be worse than none.
  const hers = await api('/api/onyx/courses', {
    method: 'POST', token: await tokenFor(facultyEmail),
    body: { code: 'FAY' + RUN.slice(-4), title: 'Fay can make this', credits: 3 },
  });
  expect(hers.status, 'the personal grant did not reach the API: ' + hers.message).toBe(200);

  const his = await api('/api/onyx/courses', {
    method: 'POST', token: await tokenFor(otherFacultyEmail),
    body: { code: 'OMR' + RUN.slice(-4), title: 'Omar cannot', credits: 3 },
  });
  expect(his.status, 'granting one lecturer promoted the whole role').toBe(403);
});

test('a grant is recorded against the person, not against the role', async () => {
  // Where it lives matters: on the membership, so the same human can be
  // faculty here and a student elsewhere without carrying this with them.
  await withDb(async (c) => {
    const { rows } = await c.query(
      'SELECT permissions FROM public."onyx_memberships" WHERE id = $1',
      [w.facultyMembershipId]);
    expect(rows[0].permissions).toMatchObject({ 'courses.create': true });

    const tenant = await c.query(
      'SELECT permissions FROM public."onyx_tenants" WHERE id = $1', [w.tenantId]);
    // The role matrix still says admin only -- the grant did not leak upwards.
    expect(JSON.stringify(tenant.rows[0].permissions)).toContain('courses.create');
    expect(JSON.stringify(tenant.rows[0].permissions)).not.toContain('faculty');
  });
});

test('a capability no role may ever hold is not offered for a person either',
  async ({ page }) => {
    /*
     * The invariant that keeps this from being a way round the catalogue.
     * `fees.structures` carries an empty holders list, which in this product
     * means no institution may delegate it below an administrator -- and
     * naming a person is not an exception to that.
     */
    await signInViaForm(page, adminEmail);
    await page.goto('/onyx/permissions');
    await page.getByLabel('Find a person').fill('Fay');
    await page.getByRole('button', { name: /Fay Faculty/ }).click();

    const sealed = page.locator('li', { hasText: 'Fee heads and structures' }).first();
    await expect(sealed).toBeVisible({ timeout: 20_000 });
    // No "Allow" for it -- the screen agrees with the rule rather than
    // offering a switch the save would silently drop.
    await expect(sealed.getByRole('button', { name: 'Allow' })).toHaveCount(0);
    await expect(sealed.getByRole('button', { name: 'Block' })).toBeVisible();

    // And the API refuses it even when asked directly.
    const token = await adminToken(adminEmail);
    const forced = await api('/api/onyx/members/' + w.facultyMembershipId + '/permissions', {
      method: 'PUT', token,
      body: { permissions: { 'fees.structures': true } },
    });
    expect(forced.status).toBe(200);
    const still = await api('/api/onyx/fee-structures', { token: await tokenFor(facultyEmail) });
    expect(still.status, 'a sealed capability was granted by name').toBe(403);
  });

test('the community link is set in Settings and shows on Jobs', async ({ page }) => {
  await signInViaForm(page, adminEmail);
  await page.goto('/onyx/settings');

  await page.getByLabel('Community invite link').fill('https://chat.whatsapp.com/TestInvite');
  await page.getByLabel('Button text').fill('Join our WhatsApp community');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText(/Learners will see it on Jobs/)).toBeVisible({ timeout: 20_000 });

  // A learner finds it where they go looking for it.
  const studentEmail = mail('grant', 'stu');
  await addMember(await adminToken(adminEmail), 'Sam Student', studentEmail, 'student');
  await signInViaForm(page, studentEmail);
  await page.goto('/onyx/jobs');

  const join = page.getByRole('link', { name: /Join our WhatsApp community/ });
  await expect(join).toBeVisible({ timeout: 20_000 });
  await expect(join).toHaveAttribute('href', 'https://chat.whatsapp.com/TestInvite');
  // A new tab, and `noopener` -- otherwise the destination gets a live
  // `window.opener` back into this session.
  await expect(join).toHaveAttribute('target', '_blank');
  await expect(join).toHaveAttribute('rel', /noopener/);
});

test('a javascript link is refused rather than stored', async () => {
  // This becomes an anchor to a third party. `javascript:` in an href is
  // stored XSS with extra steps, so the scheme is checked by name.
  const token = await adminToken(adminEmail);
  const refused = await api('/api/onyx/tenant/community', {
    method: 'PUT', token,
    body: { community_url: 'javascript:alert(1)' },
  });
  expect(refused.status).toBe(422);
  expect(String(refused.message)).toMatch(/http or https/i);

  await withDb(async (c) => {
    const { rows } = await c.query(
      'SELECT community_url FROM public."onyx_tenants" WHERE id = $1', [w.tenantId]);
    expect(String(rows[0].community_url)).not.toContain('javascript');
  });
});
