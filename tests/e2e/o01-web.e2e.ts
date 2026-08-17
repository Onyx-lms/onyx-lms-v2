/**
 * Onyx O01 web layer -- F-06 onboarding and switching, F-07 the shell.
 *
 * The API tests prove the boundary. These prove the pages sit on the right side
 * of it: that a signed-out visitor is sent to sign in, that the shell renders
 * the institution in the token rather than one from the URL, and that the
 * role-aware navigation matches what the API would actually allow.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { api, createTenant, webPage, withDb, WEB, RUN, onyxWebLogin } from './harness.ts';

/**
 * React splits interpolated text with HTML comments, so "belong to {n}
 * institutions" reaches the wire as "belong to <!-- -->2<!-- --> institutions".
 * Matching rendered prose means removing them first.
 */
const text = (html: string) => html.replace(/<!--.*?-->/g, '');

/**
 * The rendered document, without the RSC payload.
 *
 * Next serialises the root layout's not-found boundary into every page, so raw
 * source contains markup that is never displayed. What a visitor sees is the
 * DOM, and that is what these assertions are about.
 */
const dom = (html: string) => html.replace(/<script[\s\S]*?<\/script>/g, '');

const pw = 'OnyxTest#2026';
const mail = (who: string) => 'web.' + who + '.' + RUN + '@onyx.test';
const A = { name: 'Web University ' + RUN, slug: 'web-uni-' + RUN };
const B = { name: 'Web Institute ' + RUN, slug: 'web-inst-' + RUN };

const state = {
  alpha: 0, beta: 0,
  cookies: {} as Record<string, string>,
};

test('the sign-in and onboarding pages render for a visitor', async () => {
  const login = await webPage('/onyx/login');
  assert.equal(login.status, 200);
  assert.match(login.html, /Sign in to Onyx/);

  // /onyx/signup used to carry a form that created an institution and made
  // whoever filled it in the administrator. It is now a dead end that says so:
  // still 200, because the sign-in page links to it and it is worth explaining,
  // but with nothing on it that creates anything.
  const signup = await webPage('/onyx/signup');
  assert.equal(signup.status, 200);
  assert.match(signup.html, /no longer something you can do yourself/i);
  assert.match(signup.html, /first administrator/i);
  assert.ok(!dom(signup.html).includes('<form'), 'the closed signup page still offers a form');
});

test('a signed-out visitor is sent to sign in, not to an empty shell', async () => {
  for (const path of ['/onyx', '/onyx/dashboard', '/onyx/people', '/onyx/audit']) {
    const res = await webPage(path);
    assert.equal(res.status, 307, path + ' did not redirect');
    // A 200 here would mean a page rendered without a tenant in scope.
  }
});

/**
 * The web origin no longer has a way to create an institution.
 *
 * This used to be the "an institution can be created from the web and signed
 * into" test, and it passed against an open proxy: POST /api/onyx/signup on
 * this origin forwarded, unauthenticated, to POST /api/onyx/tenants. That
 * entry is gone from the allow-list, and a route that is not in the map is not
 * reachable -- which is the half of the promise a test can actually check.
 */
test('the web origin offers no way to create an institution', async () => {
  const res = await fetch(WEB + '/api/onyx/signup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Backdoor ' + RUN, slug: 'backdoor-' + RUN,
      admin: { name: 'Backdoor', email: mail('backdoor'), password: pw },
    }),
  });
  assert.equal(res.status, 404, 'the web signup proxy still creates institutions');

  await withDb(async (c) => {
    const { rows } = await c.query(
      'SELECT slug FROM public."onyx_tenants" WHERE slug = $1', ['backdoor-' + RUN]);
    assert.equal(rows.length, 0, 'the refused web signup still created an institution');
  });
});

test('an institution set up for it can be signed into from the web', async () => {
  // The institutions these pages are rendered from are now created the only way
  // they can be: by the platform operator, through the platform-authenticated
  // helper in the harness. Everything below this line is unchanged -- what is
  // being proved is still the shell, the navigation and the switcher.
  const create = async (t: { name: string; slug: string }, adminEmail: string) => {
    const res = await createTenant({
      name: t.name, slug: t.slug,
      admin: { name: t.name + ' Admin', email: adminEmail, password: pw },
    });
    assert.equal(res.ok, true, 'create ' + t.slug + ' failed: ' + res.message);
    return Number(res.data.tenant.id);
  };

  state.alpha = await create(A, mail('alpha.admin'));
  state.beta = await create(B, mail('beta.admin'));
  state.cookies.alpha = await onyxWebLogin(mail('alpha.admin'), pw);
  state.cookies.beta = await onyxWebLogin(mail('beta.admin'), pw);
});

test('the shell names the institution from the token', async () => {
  const alpha = await webPage('/onyx/dashboard', state.cookies.alpha);
  assert.equal(alpha.status, 200, 'dashboard did not render');
  assert.match(dom(alpha.html), new RegExp(A.name));
  assert.ok(!dom(alpha.html).includes(B.name), 'the shell showed another institution');

  const beta = await webPage('/onyx/dashboard', state.cookies.beta);
  assert.match(dom(beta.html), new RegExp(B.name));
  assert.ok(!dom(beta.html).includes(A.name), 'the shell showed another institution');
});

test('navigation matches the role, and the pages agree', async () => {
  // Build a roster so there is something to see and someone to be.
  const add = async (tenantCookie: string, who: string, role: string) => {
    const res = await fetch(WEB + '/api/proxy/onyx/members', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: tenantCookie },
      body: JSON.stringify({ name: who, email: mail(who), role, password: pw }),
    });
    const body = await res.json();
    assert.equal(body.ok, true, 'invite ' + who + ' failed: ' + body.message);
  };
  await add(state.cookies.alpha, 'student', 'student');
  await add(state.cookies.alpha, 'faculty', 'faculty');

  const admin = await webPage('/onyx/dashboard', state.cookies.alpha);
  assert.match(admin.html, /Audit log/, 'an admin was not offered the audit log');
  assert.match(admin.html, /People/);

  const facultyCookie = await onyxWebLogin(mail('faculty'), pw);
  const faculty = await webPage('/onyx/dashboard', facultyCookie);
  assert.match(faculty.html, /People/, 'faculty was not offered the roster');
  assert.ok(!faculty.html.includes('Audit log'), 'faculty was offered the audit log');

  const studentCookie = await onyxWebLogin(mail('student'), pw);
  const student = await webPage('/onyx/dashboard', studentCookie);
  assert.ok(!student.html.includes('People'), 'a student was offered the roster');
  assert.ok(!student.html.includes('Audit log'), 'a student was offered the audit log');

  // And the links are not the control: going straight to the page is refused.
  assert.equal((await webPage('/onyx/people', studentCookie)).status, 307);
  assert.equal((await webPage('/onyx/audit', facultyCookie)).status, 307);
  assert.equal((await webPage('/onyx/audit', state.cookies.alpha)).status, 200);
});

test('the roster page shows one institution and offers editing only to admins', async () => {
  const admin = await webPage('/onyx/people', state.cookies.alpha);
  assert.equal(admin.status, 200);
  assert.match(dom(admin.html), new RegExp(mail('student')));
  assert.ok(!admin.html.includes(mail('beta.admin')), 'the roster leaked another institution');

  const facultyCookie = await onyxWebLogin(mail('faculty'), pw);
  const faculty = await webPage('/onyx/people', facultyCookie);
  assert.equal(faculty.status, 200);
  assert.match(dom(faculty.html), new RegExp(mail('student')), 'faculty could not read the roster');
  assert.ok(!dom(faculty.html).includes('Remove'), 'faculty was offered a remove control');
});

test('the switcher appears only for someone who belongs to more than one', async () => {
  const alone = await webPage('/onyx/dashboard', state.cookies.alpha);
  assert.ok(!alone.html.includes('Switch institution'),
    'a switcher was offered to someone with one institution');

  // Put the same person in both, then check they can move between them.
  for (const [cookie, role] of [[state.cookies.alpha, 'faculty'], [state.cookies.beta, 'student']] as const) {
    const res = await fetch(WEB + '/api/proxy/onyx/members', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ name: 'Shared', email: mail('shared'), role, password: pw }),
    });
    assert.equal((await res.json()).ok, true);
  }

  const sharedCookie = await onyxWebLogin(mail('shared'), pw);
  const both = await webPage('/onyx/dashboard', sharedCookie);
  assert.match(both.html, /Switch institution/, 'no switcher for someone in two institutions');
  assert.match(text(dom(both.html)), /belong to 2 institutions/);

  // Switching replaces the cookie, so the next page is rendered in the new
  // tenant's scope rather than the old one's. Compared against the DOM: the
  // switcher legitimately carries both names in its props.
  const first = dom(both.html).includes(A.name) ? A : B;
  const second = first === A ? B : A;
  const target = first === A ? state.beta : state.alpha;

  const res = await fetch(WEB + '/api/onyx/switch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie: sharedCookie },
    body: JSON.stringify({ tenant_id: target }),
  });
  const body = await res.json();
  assert.equal(body.ok, true, 'switch failed: ' + body.message);
  assert.equal(body.data.token, undefined, 'the switch handed a token to the page');

  const switched = (res.headers.getSetCookie?.() ?? [])
    .find((c) => c.startsWith('onyx_tenant_session='))!.split(';')[0]!;
  const after = dom((await webPage('/onyx/dashboard', switched)).html);
  assert.match(after, new RegExp(second.name));
  assert.ok(!after.includes(first.name), 'the old institution survived the switch');
});

test("Onyx does not wear the port's branding", async () => {
  // Two products, one deployment. An institutional platform showing another
  // product's storefront header would be a plain misrepresentation. Both
  // products happen to use the words "Onyx LMS" as of this deployment's
  // current settings, so the string that actually distinguishes them is the
  // port's storefront chrome -- its header, its footer, its "browse courses"
  // CTA -- not the brand name, which the settings page can always change.
  const onyx = dom((await webPage('/onyx/login')).html);
  assert.ok(!onyx.includes('<header'), "the port's header rendered on an Onyx page");
  assert.ok(!onyx.includes('<footer'), "the port's footer rendered on an Onyx page");
  assert.ok(!onyx.includes('Browse courses'), "the port's storefront leaked into Onyx");
  assert.ok(!onyx.includes('Meet the instructors'), "the port's homepage leaked into Onyx");

  // ...and the port still has its own storefront, distinctly its own page.
  const port = dom((await webPage('/')).html);
  assert.match(port, /<header/);
  assert.match(port, /Meet the instructors/, "the port's own homepage did not render");
});

test('the port and Onyx do not share a session', async () => {
  // Both products live on this origin. An Onyx cookie must not authenticate a
  // port page, and it must not be mistaken for one either.
  const portPage = await webPage('/my-courses', state.cookies.alpha);
  assert.equal(portPage.status, 307, 'an Onyx session reached a port page');
  assert.ok(state.cookies.alpha.startsWith('onyx_tenant_session='));
});

test('cleanup leaves nothing behind', async () => {
  await withDb(async (c) => {
    await c.query('DELETE FROM public."onyx_tenants" WHERE slug = ANY($1)', [[A.slug, B.slug]]);
    await c.query('DELETE FROM public."onyx_users" WHERE email LIKE $1', ['web.%.' + RUN + '@onyx.test']);
  });
  // And the API agrees they are gone -- 403, not 401: credentials live in
  // Supabase Auth now (ADR-011), separate from the onyx_users profile row
  // this deletes, so signInWithPassword still succeeds and the rejection
  // comes from the missing profile, one step later. Access is equally
  // denied either way; only the status code differs from before.
  const gone = await api('/api/onyx/auth/login',
    { body: { email: mail('alpha.admin'), password: pw } });
  assert.equal(gone.status, 403);
});
