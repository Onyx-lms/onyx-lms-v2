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
  otpFor, pageFetch,
} from './helpers.ts';

const T = { name: 'Enrol College ' + RUN, slug: 'enrol-' + RUN };
const adminEmail = mail('enrol', 'admin');

/** The institution's own domain, unique per run so two runs cannot collide. */
const DOMAIN = 'enrol-' + RUN + '.test';
const SIGNUP_PASSWORD = 'Registered#2026';

/**
 * A second domain on the same institution, for the one test that sends.
 *
 * Supabase will not mail a code to a domain that cannot receive one -- it
 * checks deliverability and refuses `.test` outright -- so the run-unique
 * fixture domain above works for every check that stops BEFORE sending and for
 * none that gets that far. That is the right behaviour in the product (an
 * institution whose domain has no mail server cannot verify anybody) and it
 * leaves this suite needing one address that is genuinely deliverable.
 *
 * mailinator.com is a public throwaway inbox: real MX records, nothing to
 * bounce, and nothing private in a six-digit code for an institution that is
 * deleted at the end of the run. It is on the product's own consumer-mail
 * blocklist, which is exactly why it belongs here -- an institution that
 * DECLARES a domain outranks that list, and this proves it.
 */
const SENDABLE_DOMAIN = 'mailinator.com';
const SENDABLE = 'onyx-enrol-' + RUN + '@' + SENDABLE_DOMAIN;

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
    body: { student_signup: true, signup_domains: DOMAIN + ',' + SENDABLE_DOMAIN },
  });
  expect(saved.status, 'registration could not be opened').toBe(200);
});

test.afterAll(async () => {
  await withDb(async (c) => {
    await c.query('DELETE FROM public."onyx_users" WHERE email LIKE $1', ['%@' + DOMAIN]);
    await c.query("DELETE FROM public.\"onyx_users\" WHERE email LIKE $1",
      ['%@sub.' + DOMAIN]);
    // Asking for a code creates a passwordless auth.users row before any
    // profile exists, and an abandoned registration leaves one behind on
    // purpose. Harmless in the product -- it grants nothing -- but this suite
    // makes one per run under a domain that is unique per run, so without this
    // they pile up in the project's auth table for ever.
    await c.query('DELETE FROM public."onyx_users" WHERE email = $1', [SENDABLE]);
    await c.query("DELETE FROM auth.users WHERE email LIKE $1 OR email LIKE $2 OR email = $3",
      ['%@' + DOMAIN, '%@sub.' + DOMAIN, SENDABLE]);
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
    // Two Supabase round trips and a real send, on top of the form itself.
    test.slow();
    // The one test in this file that actually asks Supabase to send. See
    // SENDABLE for why it cannot use the fixture domain.
    const email = SENDABLE;
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
    await page.getByRole('button', { name: 'Send me a code' }).click();

    // The second screen. The password is asked for HERE and not before: until
    // the code comes back this product holds nothing at all for an address
    // nobody has proved they own.
    await expect(page.getByText(/We sent a code to/)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(email)).toBeVisible();

    await page.getByLabel('Verification code').fill(await otpFor(email, SIGNUP_PASSWORD));
    await page.getByLabel('Choose a password').fill(SIGNUP_PASSWORD);
    await page.getByRole('button', { name: 'Create my account' }).click();

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

  const made = await api('/api/onyx/auth/signup/verify', {
    method: 'POST',
    body: {
      name: 'Arun Kumar', email, password: SIGNUP_PASSWORD,
      phone: '9000000002', roll_number: 'EN-002',
      code: await otpFor(email, SIGNUP_PASSWORD),
    },
  });
  expect(made.status, 'a subdomain address could not register').toBe(200);
});

test('a personal address finds nothing, and is told what to do', async () => {
  const found = await api<{ id: number } | null>(
    '/api/onyx/auth/signup/institution?email=' + encodeURIComponent('someone@gmail.com'));
  expect(found.data ?? null, 'a personal address matched an institution').toBeNull();

  const refused = await api('/api/onyx/auth/signup/start', {
    method: 'POST', body: { email: 'someone@gmail.com' },
  });
  expect(refused.status).toBeGreaterThanOrEqual(400);
  // The message names the domain and says who can fix it. "No institution
  // accepts that" leaves somebody staring at a form with nothing to try.
  expect(String(refused.message)).toContain('gmail.com');
});

test('a free mailbox cannot be smuggled past by naming an open institution', async () => {
  // The refusal above is the easy one: gmail.com matches no institution, so it
  // fails for that reason alone and would fail identically with no rule about
  // consumer mail at all. THIS is the one the rule exists for -- an
  // institution that takes anyone who picks it from the dropdown, where the
  // address is the only evidence of who somebody is.
  const token = await adminToken(adminEmail);
  const opened = await api('/api/onyx/tenant/settings', {
    method: 'PATCH', token, body: { signup_mode: 'open' },
  });
  expect(opened.status).toBe(200);

  try {
    const refused = await api('/api/onyx/auth/signup/start', {
      method: 'POST', body: { email: 'someone@gmail.com', tenant_id: w.tenantId },
    });
    expect(refused.status, 'gmail registered at an open institution').toBe(422);
    expect(String(refused.message)).toMatch(/institution gave you/i);

    /*
     * And the rule is about the mailbox, not about picking from a list: an
     * organisation address at the same institution gets PAST it.
     *
     * Proved by which refusal it earns rather than by a 200, because the
     * fixture domain is a `.test` one that cannot receive mail -- so this call
     * clears every rule and then fails at the send, with a message about
     * delivery. Distinguishing the two failures is the whole assertion: the
     * consumer rule stopped gmail before anything was attempted, and did not
     * stop this.
     *
     * Asserting a 200 here would mean a second deliverable address and a
     * second real email per run, for no more proof than this.
     */
    const fine = await api('/api/onyx/auth/signup/start', {
      method: 'POST',
      body: { email: 'newcomer@' + DOMAIN, tenant_id: w.tenantId },
    });
    expect(String(fine.message), 'an organisation address hit the consumer rule')
      .not.toMatch(/institution gave you/i);
    expect(String(fine.message)).toMatch(/does not appear to accept email/i);
  } finally {
    await api('/api/onyx/tenant/settings', {
      method: 'PATCH', token, body: { signup_mode: 'domain' },
    });
  }
});

test('the code is what creates the account -- nothing before it', async () => {
  // Asking for a code must leave no membership behind. Otherwise the
  // verification is decoration: whoever typed the address is already in.
  const email = 'ghost@' + DOMAIN;
  // Not asserted to succeed: the fixture domain cannot receive mail, so this
  // clears every rule and then fails at the send. Either way it must not have
  // created anybody, which is the whole point -- a registration that got as
  // far as asking for a code and no further has to leave nothing behind.
  await api('/api/onyx/auth/signup/start', { method: 'POST', body: { email } });

  await withDb(async (c) => {
    const { rows } = await c.query(
      'SELECT id FROM public."onyx_users" WHERE email = $1', [email]);
    expect(rows.length, 'asking for a code created a profile').toBe(0);
  });

  // And a wrong code creates nothing either.
  const wrong = await api('/api/onyx/auth/signup/verify', {
    method: 'POST',
    body: {
      name: 'Ghost', email, password: SIGNUP_PASSWORD,
      phone: '9000000003', roll_number: 'EN-003', code: '00000000',
    },
  });
  expect(wrong.status).toBe(422);
  await withDb(async (c) => {
    const { rows } = await c.query(
      'SELECT id FROM public."onyx_users" WHERE email = $1', [email]);
    expect(rows.length, 'a wrong code created a profile').toBe(0);
  });
});

test('a lookalike domain is refused', async () => {
  // The unit tests cover the rule exhaustively; this is the one that must be
  // true through the real route as well, because it is the one that matters.
  const found = await api<{ id: number } | null>(
    '/api/onyx/auth/signup/institution?email='
    + encodeURIComponent('attacker@' + DOMAIN + '.attacker.com'));
  expect(found.data ?? null, 'a lookalike domain picked an institution').toBeNull();
});

test('the profile shows each editor exactly once', async ({ page }) => {
  // A regression guard for a duplicated component, not a style rule. The
  // script that first mounted the identity editor crashed partway and was
  // re-run, so the page rendered two identical 'Your details' cards -- each
  // with its own name field, its own picture control and its own Save. Two
  // forms writing the same record is worse than it looks: whichever was
  // touched last wins, and neither shows what the other did.
  await signInViaForm(page, SENDABLE, SIGNUP_PASSWORD);
  await page.goto('/onyx/profile');

  await expect(page.getByText('Your details', { exact: true }))
    .toHaveCount(1, { timeout: 20_000 });
  await expect(page.getByLabel('Your name')).toHaveCount(1);
  await expect(page.getByLabel('Phone')).toHaveCount(1);
  await expect(page.getByText('Your public profile', { exact: true })).toHaveCount(1);
});

test('a student edits their own name, and it is their name everywhere', async ({ page }) => {
  await signInViaForm(page, SENDABLE, SIGNUP_PASSWORD);
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
      'SELECT name FROM public."onyx_users" WHERE email=$1', [SENDABLE]);
    expect(String(rows[0].name)).toBe('Priya Raman-Iyer');
  });
});

test('a blank name is refused rather than saved', async ({ page }) => {
  // A name is on every register, results sheet and certificate. Blank would
  // show an email address in all of them.
  await signInViaForm(page, SENDABLE, SIGNUP_PASSWORD);
  await page.goto('/onyx/profile');

  await page.getByLabel('Your name').fill('   ');
  // The button refuses before the request does -- the API refuses too, and
  // both saying no is the point rather than a duplication.
  await expect(page.getByRole('button', { name: 'Save', exact: true }).first())
    .toBeDisabled();

  const refused = await pageFetch(page, '/api/proxy/onyx/my/profile-details',
    { method: 'PATCH', data: { name: '   ' } });
  expect(refused.status).toBeGreaterThanOrEqual(400);
});

test('a profile picture is an upload, never a link', async ({ page }) => {
  await signInViaForm(page, SENDABLE, SIGNUP_PASSWORD);
  await page.goto('/onyx/profile');
  await expect(page.getByLabel(/add a picture|change picture/i)).toBeVisible();

  // The field ends up in an <img src>, so an off-site address is refused: it
  // would turn every page showing this person into a request to somebody
  // else's server.
  for (const evil of ['https://attacker.example/pixel.png', '//attacker.example/p.png',
    'javascript:alert(1)', 'etc/passwd']) {
    const res = await pageFetch(page, '/api/proxy/onyx/my/profile-details',
      { method: 'PATCH', data: { photo: evil } });
    expect(res.status, 'accepted a photo of ' + evil).toBeGreaterThanOrEqual(400);
  }
});

test('the avatar in the corner opens an account menu', async ({ page }) => {
  await signInViaForm(page, SENDABLE, SIGNUP_PASSWORD);
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
  await expect(menu).toContainText(SENDABLE);

  // Escape closes it, because that is what a keyboard user tries first.
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();

  await avatar.click();
  await menu.getByRole('menuitem', { name: /your profile/i }).click();
  await page.waitForURL((u) => u.pathname === '/onyx/profile', { timeout: 20_000 });
});

test('signing out from that menu really signs you out', async ({ page }) => {
  await signInViaForm(page, SENDABLE, SIGNUP_PASSWORD);
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
 * instead let somebody CHOOSE it from a list and be admitted at once.
 *
 * That is the whole behaviour and it is worth being blunt about what it costs:
 * an institution in `open` mode can be joined by anybody who picks it, with no
 * check at all. An earlier version queued those registrations for an
 * administrator; that was overruled deliberately, on the grounds that a queue
 * between a learner and their first lesson is a queue nobody empties. The
 * institution decides, it is off by default, and `domain` is the mode for
 * anyone who wants the address to prove the claim -- which is what these tests
 * hold, by proving a domain-only institution cannot be picked.
 */
test.describe('choosing an institution instead', () => {
  const T2 = { name: 'Choose College ' + RUN, slug: 'choose-' + RUN };
  const chooseAdmin = mail('choose', 'admin');
  const applicant = 'applicant.' + RUN + '@personal.test';
  const w2 = { tenantId: 0 };

  test.beforeAll(async () => {
    await createTenant(T2.name, T2.slug, 'Choose Admin', chooseAdmin);
    w2.tenantId = await withDb(async (c) => Number((await c.query(
      'SELECT id FROM public."onyx_tenants" WHERE slug=$1', [T2.slug])).rows[0].id));

    // Open to anyone, and with no domains at all -- the situation this mode
    // exists for.
    const token = await adminToken(chooseAdmin);
    const saved = await api('/api/onyx/tenant/settings', {
      method: 'PATCH', token,
      body: { student_signup: true, signup_domains: '', signup_mode: 'open' },
    });
    expect(saved.status).toBe(200);
  });

  test.afterAll(async () => {
    await withDb(async (c) => {
      await c.query('DELETE FROM public."onyx_users" WHERE email = $1', [applicant]);
      await c.query('DELETE FROM auth.users WHERE email = $1', [applicant]);
    });
    await cleanupTenants([T2.slug], 'choose.%.' + RUN + '@onyx.test');
  });

  test('it appears in the list a student picks from', async () => {
    const list = await api<{ id: number; name: string }[]>(
      '/api/onyx/auth/signup/institutions');
    expect(list.status).toBe(200);
    expect(list.data.map((t) => t.name)).toContain(T2.name);

    // The domain-only institution from the tests above must NOT be offered:
    // it registers people by their address and has not opened itself up.
    expect(list.data.map((t) => t.name), 'a domain-only institution was offered as a choice')
      .not.toContain(T.name);
  });

  test('a personal address registers by choosing, and is in straight away',
    async ({ page }) => {
      await page.context().clearCookies();
      await page.goto('/onyx/signup');

      await page.getByLabel('Full name').fill('Chosen Applicant');
      await page.getByLabel('Organisation email').fill(applicant);
      await page.getByLabel('Organisation email').blur();

      // The picker appears only once the address has failed to name one.
      const picker = page.getByLabel('Your institution');
      await expect(picker).toBeVisible({ timeout: 20_000 });
      await picker.selectOption({ label: T2.name });

      await page.getByLabel('Mobile number').fill('9000000009');
      await page.getByLabel('Roll number').fill('CH-1');

      /*
       * Finished through the API rather than by clicking on.
       *
       * This institution declares no domains -- that is the mode under test --
       * so the address has to be one the consumer rule allows AND one Supabase
       * will send to, and the fixtures have no domain that is both: a `.test`
       * one cannot receive mail, and every deliverable throwaway domain is on
       * the blocklist precisely because it is a throwaway domain.
       *
       * The two-step form is covered click by click in the test above. What is
       * unique here is the picker and what choosing does, so the picker is
       * asserted in the browser and the registration is completed the way the
       * form would have completed it.
       */
      const made = await api('/api/onyx/auth/signup/verify', {
        method: 'POST',
        body: {
          name: 'Chosen Applicant', email: applicant, password: SIGNUP_PASSWORD,
          phone: '9000000009', roll_number: 'CH-1', tenant_id: w2.tenantId,
          code: await otpFor(applicant, SIGNUP_PASSWORD),
        },
      });
      expect(made.status, String(made.message)).toBe(200);

      await withDb(async (c) => {
        const { rows } = await c.query(
          `SELECT m.status, m.role, m.tenant_id FROM public."onyx_memberships" m
             JOIN public."onyx_users" u ON u.id = m.user_id
            WHERE u.email = $1`, [applicant]);
        expect(rows.length).toBe(1);
        expect(Number(rows[0].status), 'the membership should be active at once').toBe(1);
        expect(String(rows[0].role)).toBe('student');
        expect(Number(rows[0].tenant_id)).toBe(w2.tenantId);
      });
    });

  test('and can sign in again afterwards', async () => {
    // The complaint that produced this design: register, then come back
    // tomorrow and sign in like anybody else.
    const ok = await api('/api/onyx/auth/login', {
      body: { email: applicant, password: SIGNUP_PASSWORD },
    });
    expect(ok.status, 'somebody who registered could not sign back in').toBe(200);
  });

  test('a domain-only institution still cannot be picked', async () => {
    // The other institution in this file registers people by their address.
    // Naming it in `tenant_id` must not be a way around that -- otherwise the
    // picker would let anybody into every institution on the platform.
    const refused = await api('/api/onyx/auth/signup', {
      method: 'POST',
      body: {
        name: 'Chancer', email: 'chancer.' + RUN + '@personal.test',
        password: SIGNUP_PASSWORD, phone: '9000000010', roll_number: 'X-1',
        tenant_id: w.tenantId,
      },
    });
    expect(refused.status, 'a domain-only institution accepted a picked registration')
      .toBeGreaterThanOrEqual(400);
  });
});
