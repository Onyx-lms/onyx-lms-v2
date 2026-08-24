/**
 * F-03 / F-04 / F-07 -- one login, per role, through the real sign-in form.
 *
 * tests/browser/auth.spec.ts already proves the sign-in mechanics (wrong
 * password, keyboard-only, sign-out) for a single admin. tests/browser/
 * navigation.spec.ts already proves admin vs student vs faculty nav. This
 * file is the piece neither covers: that all six memberships this build
 * actually supports (student, faculty, exams, placement, employer, admin --
 * `guardian` is O07 and not creatable yet, see CLAUDE.md) can each sign in
 * through the real form, land somewhere real, and see exactly their own menu
 * -- no more, no less -- per apps/web/src/lib/onyx-nav.ts.
 */
import { test, expect } from '@playwright/test';
import {
  RUN, mail, createTenant, adminToken, addMember, signInViaForm, cleanupTenants,
} from './helpers.ts';

const T = { name: 'Browser Roles College ' + RUN, slug: 'browser-roles-' + RUN };

const ROLE_EMAIL = {
  admin: mail('browser.roles', 'admin'),
  faculty: mail('browser.roles', 'faculty'),
  student: mail('browser.roles', 'student'),
  exams: mail('browser.roles', 'exams'),
  placement: mail('browser.roles', 'placement'),
  employer: mail('browser.roles', 'employer'),
} as const;

// The label the tenant switcher card prints for each role -- ROLE_LABELS in
// apps/web/src/lib/onyx-nav.ts is the source of truth this is checked against.
const ROLE_LABEL: Record<keyof typeof ROLE_EMAIL, string> = {
  admin: 'Administrator',
  faculty: 'Faculty',
  student: 'Student',
  exams: 'Examinations',
  placement: 'Placement',
  employer: 'Employer',
};

// A link every role in the map should see, and one it should never see --
// lifted straight from onyx-nav.ts's five menus.
const NAV_EXPECT: Record<keyof typeof ROLE_EMAIL, { has: string; lacks: string }> = {
  // Not 'Audit log': that was deliberately taken out of the administrator's
  // menu (it is a forensic screen reached from the dashboard, and the route is
  // untouched). Students is the link only an admin and faculty get.
  admin: { has: 'Students', lacks: 'Your posts' },
  faculty: { has: 'People', lacks: 'Audit log' },
  student: { has: 'Practice', lacks: 'People' },
  exams: { has: 'Examinations', lacks: 'Programmes' },
  placement: { has: 'Placement', lacks: 'People' },
  employer: { has: 'Your posts', lacks: 'Dashboard' },
};

test.describe('every role can sign in through the real form', () => {
  test.beforeAll(async () => {
    await createTenant(T.name, T.slug, 'Admin', ROLE_EMAIL.admin);
    const token = await adminToken(ROLE_EMAIL.admin);
    await addMember(token, 'Faculty', ROLE_EMAIL.faculty, 'faculty');
    await addMember(token, 'Student', ROLE_EMAIL.student, 'student');
    await addMember(token, 'Exams', ROLE_EMAIL.exams, 'exams');
    await addMember(token, 'Placement', ROLE_EMAIL.placement, 'placement');
    await addMember(token, 'Employer', ROLE_EMAIL.employer, 'employer');
  });

  test.afterAll(async () => {
    await cleanupTenants([T.slug], 'browser.roles.%.' + RUN + '@onyx.test');
  });

  for (const role of Object.keys(ROLE_EMAIL) as (keyof typeof ROLE_EMAIL)[]) {
    test('signs in as ' + role + ', lands correctly, and sees only its own nav', async ({ page }) => {
      await signInViaForm(page, ROLE_EMAIL[role]);

      // Employer is the one role whose menu has no "Dashboard" entry (F-07 --
      // an outsider gets only their own posts and interviews), but the
      // sign-in redirect itself always lands on /onyx/dashboard, and the
      // dashboard renders for every role.
      await expect(page).toHaveURL(/\/onyx\/dashboard$/);

      // The tenant switcher card names the institution and, right under it,
      // this person's role in it: proof the token's role claim reached the
      // page, not just that login succeeded. Located by data-testid rather
      // than by its Tailwind classes -- the previous locator pinned
      // `.rounded-xl.border-slate-200.p-4`, so restyling the shell failed six
      // tests that had found nothing wrong with the product.
      const card = page.getByTestId('tenant-card').first();
      await expect(card.getByText(T.name)).toBeVisible();
      await expect(card.getByText(ROLE_LABEL[role], { exact: true })).toBeVisible();

      // The desktop sidebar specifically: below `lg` the shell also renders a
      // bottom tab bar, so `getByRole('navigation')` can match more than one.
      const nav = page.locator('aside nav');
      const expect_ = NAV_EXPECT[role];
      await expect(nav.getByRole('link', { name: expect_.has })).toBeVisible();
      await expect(nav.getByRole('link', { name: expect_.lacks })).toHaveCount(0);
    });
  }

  test('a person with no membership anywhere gets a clear error, not a crash', async ({ page }) => {
    await page.goto('/onyx/login');
    await page.getByLabel('Email address').fill('nobody.' + RUN + '@onyx.test');
    await page.getByLabel('Password', { exact: true }).fill('WhateverPassword#1');
    await page.getByRole('button', { name: /sign in/i }).click();
    const alert = page.locator('form').getByRole('alert');
    await expect(alert).toBeVisible();
    await expect(page).toHaveURL(/\/onyx\/login$/);
  });

  test('an employer -- the one role with no admin/staff pages -- is turned back from the roster', async ({ page }) => {
    await signInViaForm(page, ROLE_EMAIL.employer);
    await page.goto('/onyx/people');
    await expect(page).toHaveURL(/\/onyx\/denied$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(/not part of your role/i);
  });

  test('a student is turned back from finance, the audit log, and the roster', async ({ page }) => {
    await signInViaForm(page, ROLE_EMAIL.student);
    for (const path of ['/onyx/finance', '/onyx/audit', '/onyx/people']) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/onyx\/denied$/);
    }
  });
});
