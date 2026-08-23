/**
 * A student registering themselves, and then owning their own profile.
 *
 * Three complaints in one: the sign-up form "not working" for students, no way
 * to edit your own name or add a picture, and an avatar in the corner that
 * does nothing when you click it.
 *
 * The sign-up half turned out not to be broken so much as narrow. An
 * institution is identified from the DOMAIN of the address a student types --
 * that part worked -- but only for an exact match against the list an
 * administrator had typed. Universities issue addresses on department
 * subdomains, so `priya@cse.meridian.edu` found nothing while
 * `priya@meridian.edu` worked, which from the outside is a form that refuses
 * real students for no visible reason.
 *
 * The matching rule and its refusals are unit-tested next door in
 * o01-signup-domains.test.ts, including the ones that matter -- a domain that
 * merely ends with or contains a listed one is NOT a match, or anybody who can
 * buy `meridian.edu.attacker.com` picks their own institution. What this file
 * proves is the other half: that the rule is wired to a form somebody can use,
 * and that the account it creates lands in the right institution.
 */
import { test, expect } from '@playwright/test';
import {
  withDb, RUN, api, PASSWORD, mail, createTenant, adminToken, signInViaForm, cleanupTenants,
} from './helpers.ts';

const T = { name: 'Enrol College ' + RUN, slug: 'enrol-' + RUN };
const adminEmail = mail('enrol', 'admin');

/** The institution's own domain, unique per run so two runs cannot collide. */
const DOMAIN = 'enrol-' + RUN + '.test';
const SIGNUP_PASSWORD = 'Registered#2026';

const w = { tenantId: 0 };

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  await createTenant(T.name, T.slug, 'Enrol Admin', adminEmail);
  w.tenantId = await withDb(async (c) => Number((await c.query(
    'SELECT id FROM public."onyx_tenants" WHERE slug=$1', [T.slug])).rows[0].id));

  // Registration opened, for this institution's domain. Exactly what an
  // administrator does on Settings.
  const token = await adminToken(adminEmail);
  const saved = await api('/api/onyx/tenant/settings', {
    method: 'PATCH', token,
    body: { student_signup: true, signup_domains: DOMAIN },
  });
  expect(saved.status, 'registration could not be opened').toBe(200);
});

test.afterAll(async () => {
  await withDb(async (c) => {
    await c.query('DELETE FROM public."onyx_users" WHERE email LIKE $1', ['%@' + DOMAIN]);
    await c.query("DELETE FROM public.\"onyx_users\" WHERE email LIKE $1",
      ['%@sub.' + DOMAIN]);
  });
  await cleanupTenants([T.slug], 'enrol.%.' + RUN + '@onyx.test');
});

test('the form names the institution as soon as it recognises the address', async ({ page }) => {
  await page.context().clearCookies();
  await page.goto('/onyx/signup');

  // Before an address, it cannot know -- and says nothing rather than guessing.
  await expect(page.getByRole('heading', { name: /create your account/i })).toBeVisible();

  await page.getByLabel(/email/i).first().fill('priya@' + DOMAIN);
  // Blurred, because the lookup fires on blur rather than on every keystroke --
  // which is the right trade for a request per character, and means a test
  // that only types is asserting against a form that was never asked.
  await page.getByLabel(/email/i).first().blur();
  // Naming the institution back is what tells somebody they typed the right
  // address, before they have filled in anything else.
  await expect(page.getByText(T.name).first()).toBeVisible({ timeout: 20_000 });
});

test('a student registers with their institution address and lands inside it',
  async ({ page }) => {
    const email = 'priya@' + DOMAIN;
    await page.context().clearCookies();
    await page.goto('/onyx/signup');

    // Every field the form marks required. A mobile number and a roll number
    // are among them -- the roll number is how marks, seating and registers
    // find this person later -- so filling only name, email and password left
    // the browser blocking submit on a field the test never mentioned.
    await page.getByLabel('Full name').fill('Priya Raman');
    await page.getByLabel('Organisation email').fill(email);
    await page.getByLabel('Organisation email').blur();
    await page.getByLabel('Mobile number').fill('9000000001');
    await page.getByLabel('Roll number').fill('EN-001');
    await page.getByLabel('Password').fill(SIGNUP_PASSWORD);
    await page.getByRole('button', { name: /create|sign up|register/i }).first().click();

    // Straight in, signed in, at their own institution -- not back to a login
    // form to type the same details again.
    await page.waitForURL((u) => !u.pathname.includes('/signup'), { timeout: 30_000 });

    // Asked of the account menu rather than of the page, because the header
    // also prints the institution in a span that is hidden at most widths --
    // a locator that finds it there resolves to something nobody can see.
    await page.getByRole('button', { name: /^Account:/ }).click();
    await expect(page.getByRole('menu', { name: 'Account' }))
      .toContainText(T.name, { timeout: 20_000 });

    // And the account is a student OF that institution, which is the part a
    // screen cannot show convincingly.
    await withDb(async (c) => {
      const { rows } = await c.query(
        `SELECT m.role, m.tenant_id FROM public."onyx_memberships" m
           JOIN public."onyx_users" u ON u.id = m.user_id
          WHERE u.email = $1`, [email]);
      expect(rows.length, 'the new account belongs to exactly one institution').toBe(1);
      expect(String(rows[0].role)).toBe('student');
      expect(Number(rows[0].tenant_id)).toBe(w.tenantId);
    });
  });

test('a department subdomain finds the same institution', async () => {
  // The case the complaint was really about: an institution lists its domain,
  // and its students are issued addresses under a department subdomain.
  const email = 'arun@sub.' + DOMAIN;
  const found = await api<{ id: number; name: string } | null>(
    '/api/onyx/auth/signup/institution?email=' + encodeURIComponent(email));
  expect(found.status).toBe(200);
  expect(found.data?.id, 'a subdomain address found no institution').toBe(w.tenantId);

  const made = await api('/api/onyx/auth/signup', {
    method: 'POST',
    body: { name: 'Arun Kumar', email, password: SIGNUP_PASSWORD },
  });
  expect(made.status, 'a subdomain address could not register').toBe(200);
});

test('a personal address finds nothing, and is told what to do', async () => {
  const found = await api<{ id: number } | null>(
    '/api/onyx/auth/signup/institution?email=' + encodeURIComponent('someone@gmail.com'));
  expect(found.data ?? null, 'a personal address matched an institution').toBeNull();

  const refused = await api('/api/onyx/auth/signup', {
    method: 'POST',
    body: { name: 'Nobody', email: 'someone@gmail.com', password: SIGNUP_PASSWORD },
  });
  expect(refused.status).toBeGreaterThanOrEqual(400);
  // The message names the domain and says who can fix it. "No institution
  // accepts that" leaves somebody staring at a form with nothing to try.
  expect(String(refused.message)).toContain('gmail.com');
});

test('a lookalike domain is refused', async () => {
  // The unit tests cover the rule exhaustively; this is the one that must be
  // true through the real route as well, because it is the one that matters.
  const found = await api<{ id: number } | null>(
    '/api/onyx/auth/signup/institution?email='
    + encodeURIComponent('attacker@' + DOMAIN + '.attacker.com'));
  expect(found.data ?? null, 'a lookalike domain picked an institution').toBeNull();
});

test('a student edits their own name, and it is their name everywhere', async ({ page }) => {
  await signInViaForm(page, 'priya@' + DOMAIN, SIGNUP_PASSWORD);
  await page.goto('/onyx/profile');

  const name = page.getByLabel('Your name');
  await expect(name).toHaveValue('Priya Raman');
  await name.fill('Priya Raman-Iyer');
  await page.getByRole('button', { name: 'Save', exact: true }).first().click();
  await expect(page.getByText('Saved.').first()).toBeVisible({ timeout: 20_000 });

  await page.reload();
  await expect(page.getByLabel('Your name')).toHaveValue('Priya Raman-Iyer');

  await withDb(async (c) => {
    const { rows } = await c.query(
      'SELECT name FROM public."onyx_users" WHERE email=$1', ['priya@' + DOMAIN]);
    expect(String(rows[0].name)).toBe('Priya Raman-Iyer');
  });
});

test('a blank name is refused rather than saved', async ({ page }) => {
  // A name is on every register, results sheet and certificate. Blank would
  // show an email address in all of them.
  await signInViaForm(page, 'priya@' + DOMAIN, SIGNUP_PASSWORD);
  await page.goto('/onyx/profile');

  await page.getByLabel('Your name').fill('   ');
  // The button refuses before the request does -- the API refuses too, and
  // both saying no is the point rather than a duplication.
  await expect(page.getByRole('button', { name: 'Save', exact: true }).first())
    .toBeDisabled();

  const refused = await page.request.patch('/api/proxy/onyx/my/profile-details', {
    data: { name: '   ' },
  });
  expect(refused.status()).toBeGreaterThanOrEqual(400);
});

test('a profile picture is an upload, never a link', async ({ page }) => {
  await signInViaForm(page, 'priya@' + DOMAIN, SIGNUP_PASSWORD);
  await page.goto('/onyx/profile');
  await expect(page.getByLabel(/add a picture|change picture/i)).toBeVisible();

  // The field ends up in an <img src>, so an off-site address is refused: it
  // would turn every page showing this person into a request to somebody
  // else's server.
  for (const evil of ['https://attacker.example/pixel.png', '//attacker.example/p.png',
    'javascript:alert(1)', 'etc/passwd']) {
    const res = await page.request.patch('/api/proxy/onyx/my/profile-details', {
      data: { photo: evil },
    });
    expect(res.status(), 'accepted a photo of ' + evil).toBeGreaterThanOrEqual(400);
  }
});

test('the avatar in the corner opens an account menu', async ({ page }) => {
  await signInViaForm(page, 'priya@' + DOMAIN, SIGNUP_PASSWORD);
  await page.goto('/onyx/dashboard');

  // It used to be a span with aria-hidden: not a button, not reachable by
  // keyboard, and it did nothing when clicked.
  const avatar = page.getByRole('button', { name: /^Account:/ });
  await expect(avatar).toBeVisible();
  await expect(avatar).toHaveAttribute('aria-expanded', 'false');

  await avatar.click();
  await expect(avatar).toHaveAttribute('aria-expanded', 'true');
  const menu = page.getByRole('menu', { name: 'Account' });
  await expect(menu).toBeVisible();
  // Who you are signed in as, which on a shared machine is worth saying before
  // either of the two things you can do.
  await expect(menu).toContainText('priya@' + DOMAIN);

  // Escape closes it, because that is what a keyboard user tries first.
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();

  await avatar.click();
  await menu.getByRole('menuitem', { name: /your profile/i }).click();
  await page.waitForURL((u) => u.pathname === '/onyx/profile', { timeout: 20_000 });
});

test('signing out from that menu really signs you out', async ({ page }) => {
  await signInViaForm(page, 'priya@' + DOMAIN, SIGNUP_PASSWORD);
  await page.goto('/onyx/dashboard');

  await page.getByRole('button', { name: /^Account:/ }).click();
  await page.getByRole('menu', { name: 'Account' })
    .getByRole('menuitem', { name: /sign out/i }).click();
  await page.waitForURL(/\/onyx\/login/, { timeout: 20_000 });

  // Not just redirected -- the session is gone, so the dashboard is unreachable
  // in the browser that was signed in a moment ago.
  await page.goto('/onyx/dashboard');
  await expect(page).toHaveURL(/\/onyx\/login/);
});

/**
 * The other way in: the student picks their institution.
 *
 * Plenty of colleges never issue email addresses at all, and their students
 * are on personal accounts through no fault of theirs. Identifying an
 * institution from the domain cannot help those people, so an institution can
 * instead let somebody CHOOSE it from a list.
 *
 * The whole design turns on one thing: a name picked from a dropdown is a
 * claim, not evidence. If picking were enough, anybody on the internet could
 * select a real college and be inside it -- reading its catalogue, joining its
 * open courses, appearing on its rosters. So the membership is created PENDING
 * and somebody at the institution decides, and these tests are mostly about
 * proving that a pending account really is not an account yet.
 */
test.describe('choosing an institution instead', () => {
  const T2 = { name: 'Choose College ' + RUN, slug: 'choose-' + RUN };
  const chooseAdmin = mail('choose', 'admin');
  const applicant = 'applicant.' + RUN + '@personal.test';

  test.beforeAll(async () => {
    await createTenant(T2.name, T2.slug, 'Choose Admin', chooseAdmin);
    const token = await adminToken(chooseAdmin);
    // Open, but by request rather than by domain -- and with no domains at
    // all, which is the situation this mode exists for.
    const saved = await api('/api/onyx/tenant/settings', {
      method: 'PATCH', token,
      body: { student_signup: true, signup_domains: '', signup_mode: 'request' },
    });
    expect(saved.status).toBe(200);
  });

  test.afterAll(async () => {
    await withDb(async (c) => {
      await c.query('DELETE FROM public."onyx_users" WHERE email = $1', [applicant]);
    });
    await cleanupTenants([T2.slug], 'choose.%.' + RUN + '@onyx.test');
  });

  test('it appears in the list a student picks from', async () => {
    const list = await api<{ id: number; name: string }[]>(
      '/api/onyx/auth/signup/institutions');
    expect(list.status).toBe(200);
    expect(list.data.map((t) => t.name)).toContain(T2.name);

    // The domain-only institution from the tests above must NOT be offered:
    // it registers people by their address and has not asked to be chosen.
    expect(list.data.map((t) => t.name), 'a domain-only institution was offered as a choice')
      .not.toContain(T.name);
  });

  test('a personal address registers by choosing, and waits', async () => {
    const made = await api<{ pending?: boolean }>('/api/onyx/auth/signup', {
      method: 'POST',
      body: {
        name: 'Chosen Applicant', email: applicant, password: SIGNUP_PASSWORD,
        phone: '9000000009', roll_number: 'CH-1',
        tenant_id: await withDb(async (c) => Number((await c.query(
          'SELECT id FROM public."onyx_tenants" WHERE slug=$1', [T2.slug])).rows[0].id)),
      },
    });
    expect(made.status, 'a chosen institution refused a registration').toBe(200);
    expect(made.data.pending, 'a picked institution let somebody straight in').toBe(true);

    // Created, but not a member yet.
    await withDb(async (c) => {
      const { rows } = await c.query(
        `SELECT m.status FROM public."onyx_memberships" m
           JOIN public."onyx_users" u ON u.id = m.user_id
          WHERE u.email = $1`, [applicant]);
      expect(rows.length).toBe(1);
      expect(Number(rows[0].status), 'the membership should be pending').toBe(0);
    });
  });

  test('and cannot sign in until somebody says so', async () => {
    // The claim the whole design rests on. A pending membership is not a way
    // in, and it needs no special enforcement: membershipsFor selects
    // status = 1 and signIn refuses an account with no active membership.
    const refused = await api('/api/onyx/auth/login', {
      body: { email: applicant, password: SIGNUP_PASSWORD },
    });
    expect(refused.status, 'somebody nobody approved was able to sign in')
      .toBeGreaterThanOrEqual(400);
  });

  test('an administrator sees the request and lets them in', async ({ page }) => {
    await signInViaForm(page, chooseAdmin);
    await page.goto('/onyx/people');

    // Above the roster, because it is the only thing on that page somebody is
    // waiting on.
    await expect(page.getByText('Waiting to join · 1')).toBeVisible({ timeout: 20_000 });
    // Scoped to the requests table: a pending person is deliberately NOT in
    // the roster below, and once approved they appear there in two
    // responsive variants, so an unscoped locator is ambiguous either way.
    const queue = page.getByRole('table', { name: /waiting to be admitted/i });
    await expect(queue).toContainText(applicant);

    await page.getByRole('button', { name: /let them in/i }).click();
    await expect(page.getByText('Waiting to join · 1')).toHaveCount(0, { timeout: 20_000 });

    await expect.poll(async () => withDb(async (c) => {
      const { rows } = await c.query(
        `SELECT m.status FROM public."onyx_memberships" m
           JOIN public."onyx_users" u ON u.id = m.user_id
          WHERE u.email = $1`, [applicant]);
      return Number(rows[0]?.status ?? -1);
    }), { timeout: 20_000, message: 'the approval did not land' }).toBe(1);
  });

  test('now they can sign in', async () => {
    const ok = await api('/api/onyx/auth/login', {
      body: { email: applicant, password: SIGNUP_PASSWORD },
    });
    expect(ok.status, 'an approved member still could not sign in').toBe(200);
  });

  test('a domain-only institution cannot be picked', async () => {
    // The other institution in this file registers people by their address.
    // Naming it in `tenant_id` must not be a way around that.
    const tenantId = w.tenantId;
    const refused = await api('/api/onyx/auth/signup', {
      method: 'POST',
      body: {
        name: 'Chancer', email: 'chancer.' + RUN + '@personal.test',
        password: SIGNUP_PASSWORD, phone: '9000000010', roll_number: 'X-1',
        tenant_id: tenantId,
      },
    });
    expect(refused.status, 'a domain-only institution accepted a picked registration')
      .toBeGreaterThanOrEqual(400);
  });
});
