/**
 * One browser-driven smoke check per delivered pillar of the proposal at
 * <https://onyx.proposal.ezil.work/>, exercised as the role the requirement
 * actually names rather than a hard-coded one.
 *
 * This is deliberately NOT a re-test of business logic already covered by
 * tests/e2e/o0*.e2e.ts (292 HTTP-level tests -- grading correctness, queueing,
 * RLS, autosave). What only a real browser proves is that the page a given
 * role lands on actually renders the copy and controls that role's job
 * implies -- e.g. that a student's Assessments page really does say "Your
 * tests, and your results" rather than crashing or showing the staff view.
 *
 * Coverage note: O06 (progress dashboard, course Q&A) is not built yet per
 * README's status table, and there is no `guardian`-role account to test
 * with (CMP-04, the parent portal, has no member-creation path -- see
 * login-roles.spec.ts). CMP-01b (timetable) and CMP-03 (fees/finance) ARE
 * live -- confirmed against the API directly, not assumed from the table --
 * and are covered below. CMP-02 (exam scheduling, halls, seating) has no
 * page under apps/web/src/app/onyx yet, so there is nothing to smoke-test.
 */
import { test, expect } from '@playwright/test';
import {
  RUN, mail, createTenant, adminToken, addMember, signInViaForm, cleanupTenants,
} from './helpers.ts';

const T = { name: 'Browser Pillars Institute ' + RUN, slug: 'browser-pillars-' + RUN };
const adminEmail = mail('browser.pillars', 'admin');
const facultyEmail = mail('browser.pillars', 'faculty');
const studentEmail = mail('browser.pillars', 'student');
const examsEmail = mail('browser.pillars', 'exams');
const employerEmail = mail('browser.pillars', 'employer');

test.describe('proposal pillars, one browser check each', () => {
  test.beforeAll(async () => {
    await createTenant(T.name, T.slug, 'Admin', adminEmail);
    const token = await adminToken(adminEmail);
    await addMember(token, 'Faculty', facultyEmail, 'faculty');
    await addMember(token, 'Student', studentEmail, 'student');
    await addMember(token, 'Exams', examsEmail, 'exams');
    await addMember(token, 'Employer', employerEmail, 'employer');
  });

  test.afterAll(async () => {
    await cleanupTenants([T.slug], 'browser.pillars.%.' + RUN + '@onyx.test');
  });

  // ---- Onyx Learn (LRN-01: program/semester-mapped catalog) --------------
  test('Learn: the catalog reads differently for a learner than for the people running it', async ({ page }) => {
    // Asserted through what the two roles are OFFERED rather than through the
    // subtitle each is given. The old version matched the strapline verbatim,
    // so rewording the page failed a test that had found no defect -- and a
    // learner and a lecturer being handed the same strapline would have passed
    // it, which is the thing the test is named after.
    await signInViaForm(page, studentEmail);
    await page.goto('/onyx/courses');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Courses');
    // A learner is shown the catalogue and is never offered course authoring.
    // 'All courses' is the catalogue section. (This asserted a heading named
    // 'Catalogue', which this page has never rendered -- the test had been
    // failing on a name nobody chose.)
    await expect(page.getByRole('heading', { name: 'All courses' })).toBeVisible();
    await expect(page.getByRole('button', { name: /create a course/i })).toHaveCount(0);

    await page.context().clearCookies();
    await signInViaForm(page, facultyEmail);
    await page.goto('/onyx/courses');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Courses');
    // The people running it get the whole register rather than a catalogue of
    // what is left to join.
    await expect(page.getByRole('heading', { name: 'All courses' })).toBeVisible();
    // ...and the means to add to it, which is deliberate. Since the capability
    // model landed, "Create courses" (courses.create) is held by admin and
    // faculty and granted to faculty by default -- an institution that
    // disagrees turns it off in Settings. This asserted 0 from before that
    // existed, so it had been failing on a rule the product no longer has.
    // What must stay true is that the screen and the API agree, which they do:
    // assertCan runs on both sides. A learner, who can never hold the
    // capability, still gets nothing -- asserted above.
    await expect(page.getByRole('button', { name: /create a course/i })).toHaveCount(1);

    await page.context().clearCookies();
    await signInViaForm(page, adminEmail);
    await page.goto('/onyx/courses');
    await expect(page.getByRole('button', { name: /create a course/i })).toBeVisible();
  });

  // ---- Onyx Code Lab (LAB-01/LAB-04: browser IDE, problem bank) ----------
  test('Code Lab: the problem bank is reachable and role-aware, including for a student with nothing solved yet', async ({ page }) => {
    await signInViaForm(page, studentEmail);
    await page.goto('/onyx/practice');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Practice');
    await expect(page.getByText('Work through problems and get graded instantly.')).toBeVisible();
    // Difficulty filters are the entry point into LAB-01's editor for whatever
    // problems this tenant has; the bank being empty on a fresh institution
    // must not be a broken page.
    await expect(page.getByRole('link', { name: 'All' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Easy' })).toBeVisible();

    await page.context().clearCookies();
    await signInViaForm(page, facultyEmail);
    await page.goto('/onyx/practice');
    await expect(page.getByText('The problem bank, drafts included.')).toBeVisible();
  });

  // ---- Onyx Assess (ASS-01: timed engine; ASS-04: results) ---------------
  test('Assess: a student sees their own tests and results, exams staff see the papers set', async ({ page }) => {
    await signInViaForm(page, studentEmail);
    await page.goto('/onyx/assessments');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Assessments');
    await expect(page.getByText('Your tests, and your results.')).toBeVisible();

    await page.context().clearCookies();
    await signInViaForm(page, examsEmail);
    await page.goto('/onyx/assessments');
    await expect(page.getByText('Papers set at this institution.')).toBeVisible();
  });

  // ---- Onyx Career (CAR-04: job board; CAR-03: public verification) ------
  test('Career: an employer sees their own posts, a student sees openings shared with the institution', async ({ page }) => {
    await signInViaForm(page, employerEmail);
    await page.goto('/onyx/jobs');
    await expect(page.getByText('Your posts at ' + T.name + '.')).toBeVisible();

    await page.context().clearCookies();
    await signInViaForm(page, studentEmail);
    await page.goto('/onyx/jobs');
    await expect(page.getByText('Openings shared with this institution.')).toBeVisible();
  });

  test('Career: a credential can be checked publicly, with no account and no session', async ({ page }) => {
    // Fresh context: nobody has signed in here at all, proving CLAUDE.md's
    // claim that /api/onyx/verify (and the page in front of it) works for a
    // verifier who has no login and never will.
    await page.goto('/onyx/verify/this-credential-does-not-exist-' + RUN);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('No such credential');
    await expect(page.getByText(/nothing is registered under that credential id/i)).toBeVisible();
  });

  // ---- Onyx Campus (CMP-01b timetable, CMP-03 fees/finance) --------------
  // README's sprint table lists O07 (Campus operations) as "not started",
  // but apps/api/src/routes/onyx/campus.routes.ts is registered in server.ts
  // and answers for real: confirmed directly against the API (200, not 404)
  // before trusting the page. Whatever the table says, this is live.
  test('Campus: a learner sees their own fees and the published timetable; finance stays admin-only', async ({ page }) => {
    await signInViaForm(page, studentEmail);

    await page.goto('/onyx/fees');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Fees');
    await expect(page.getByText('Nothing outstanding.')).toBeVisible();

    await page.goto('/onyx/timetable');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Timetable');

    // requireOnyxPageRole('admin') turns a learner back before the page ever
    // fetches finance data -- proven again here against a real learner, in
    // addition to the RBAC sweep in login-roles.spec.ts.
    await page.goto('/onyx/finance');
    await expect(page).toHaveURL(/\/onyx\/denied$/);

    await page.context().clearCookies();
    await signInViaForm(page, adminEmail);
    await page.goto('/onyx/finance');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Finance');
  });
});
