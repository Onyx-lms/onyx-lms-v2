/**
 * Registering as a student: an organisation address, and a code that proves it
 * is yours.
 *
 * Two rules arrived together and they are not the same rule.
 *
 * **Organisation mail only.** The strong form is the institution's own
 * `signup_domains` -- an administrator listing `meridian.edu` has said what a
 * Meridian address looks like, and o01-signup-domains.test.ts covers that
 * matching in detail. What is new here is the FALLBACK, for an institution
 * that lists nothing and takes whoever picks it from the dropdown: there, a
 * free mailbox is refused, because anybody can open one in anybody's name.
 * The list of free providers can never be complete, which is exactly why it is
 * the weaker of the two rules and not the primary one.
 *
 * **A code to the address.** Refusing gmail.com does nothing on its own --
 * `principal@meridian.edu` is an organisation address and it is not the
 * applicant's. The code is what ties the registration to somebody who can read
 * that mailbox.
 *
 * The order the two run in is load-bearing and is asserted below: the address
 * is judged BEFORE anything is mailed. A product that sends first and refuses
 * afterwards is a product that can be used to send mail to strangers.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { FakeDb } from './fake-db.ts';
import { FakeAuth } from './fake-auth.ts';
import { TenancyService } from '../src/onyx/tenancy.service.ts';
import type { OnyxDb } from '../src/onyx/db.ts';
import type { SupabaseClient } from '@supabase/supabase-js';
import { HttpError } from '../src/http/errors.ts';

/** Meridian issues addresses. Ashcroft does not, and takes anyone who asks. */
function seed() {
  return new FakeDb({
    onyx_tenants: [
      { id: 1, name: 'Meridian University', slug: 'meridian', status: 1,
        student_signup: true, signup_domains: 'meridian.edu', signup_mode: 'domain' },
      { id: 2, name: 'Ashcroft College', slug: 'ashcroft', status: 1,
        student_signup: true, signup_domains: '', signup_mode: 'open' },
      { id: 3, name: 'Closed Institute', slug: 'closed', status: 1,
        student_signup: false, signup_domains: 'closed.edu', signup_mode: 'domain' },
    ],
    onyx_users: [],
    onyx_memberships: [],
  }, { uniques: { onyx_users: [['email']] } });
}

function service(db: FakeDb, auth: FakeAuth) {
  return new TenancyService(
    db as unknown as OnyxDb,
    auth as unknown as SupabaseClient,
    auth as unknown as SupabaseClient);
}

const DETAILS = {
  name: 'Priya Raman', phone: '9876543210', roll_number: 'ME-2026-001',
  password: 'a-good-password',
};

// ------------------------------------------------------- organisation mail

test('gmail is refused, and no code is sent', async () => {
  const db = seed();
  const auth = new FakeAuth();
  await assert.rejects(
    service(db, auth).startSignUp({ email: 'priya@gmail.com', tenant_id: 2 }),
    (e: HttpError) => e.status === 422 && /institution gave you/i.test(e.message));

  // The half that matters as much as the refusal: nothing was mailed. Judging
  // the address after sending would make this form a way to send mail to any
  // address somebody types.
  assert.deepEqual(auth.sent, []);
});

test('the other free providers are refused too', async () => {
  // Not an exhaustive list and cannot be -- but gmail alone would be a rule
  // anybody sidesteps with the next mailbox down the page.
  const auth = new FakeAuth();
  const svc = service(seed(), auth);
  for (const email of [
    'a@yahoo.co.in', 'a@outlook.com', 'a@hotmail.com', 'a@rediffmail.com',
    'a@icloud.com', 'a@proton.me', 'a@mailinator.com',
  ]) {
    await assert.rejects(svc.startSignUp({ email, tenant_id: 2 }),
      (e: HttpError) => e.status === 422, email + ' was accepted');
  }
  assert.equal(auth.sent.length, 0);
});

test('a domain that merely ends with a free one is not a free one', () => {
  // The same `.`-anchored test the institution matching uses. Without it,
  // `notgmail.com` is refused and `mygmail.com.au` with it -- both of which
  // could be somebody's actual employer.
  assert.equal(TenancyService.isConsumerDomain('gmail.com'), true);
  assert.equal(TenancyService.isConsumerDomain('mail.gmail.com'), true);
  assert.equal(TenancyService.isConsumerDomain('notgmail.com'), false);
  assert.equal(TenancyService.isConsumerDomain('gmail.com.attacker.io'), false);
  assert.equal(TenancyService.isConsumerDomain('meridian.edu'), false);
  assert.equal(TenancyService.isConsumerDomain(''), false);
});

test('an institution that claims a domain outranks the free-provider list', async () => {
  // The rule that keeps this from being a guess about the world. If an
  // administrator has listed a domain, that is the answer -- even one this
  // file would otherwise call consumer mail. The blocklist is a fallback for
  // institutions that declare nothing, never an override of one that did.
  const db = new FakeDb({
    onyx_tenants: [{
      id: 1, name: 'Tutoring Co', slug: 'tutors', status: 1,
      student_signup: true, signup_domains: 'gmail.com', signup_mode: 'domain',
    }],
    onyx_users: [], onyx_memberships: [],
  }, { uniques: { onyx_users: [['email']] } });
  const auth = new FakeAuth();

  const started = await service(db, auth).startSignUp({ email: 'priya@gmail.com' });
  assert.equal(started.sent, true);
  assert.equal(auth.sent.length, 1);
});

test('an organisation address at an open institution is accepted', async () => {
  const auth = new FakeAuth();
  const started = await service(seed(), auth)
    .startSignUp({ email: 'priya@ashcroft-college.org', tenant_id: 2 });
  assert.equal(started.tenant.name, 'Ashcroft College');
  assert.deepEqual(auth.sent.map((s) => s.email), ['priya@ashcroft-college.org']);
});

test('an address is lower-cased before anything is done with it', async () => {
  // Otherwise "Priya@Meridian.Edu" and "priya@meridian.edu" are two accounts,
  // and the second one gets in past the already-registered check.
  const auth = new FakeAuth();
  const started = await service(seed(), auth).startSignUp({ email: '  Priya@Meridian.EDU ' });
  assert.equal(started.email, 'priya@meridian.edu');
  assert.equal(auth.sent[0]!.email, 'priya@meridian.edu');
});

// --------------------------------------------------------------- the refusals

test('an address nobody claims is refused before sending', async () => {
  const auth = new FakeAuth();
  await assert.rejects(
    service(seed(), auth).startSignUp({ email: 'priya@nowhere.edu' }),
    (e: HttpError) => e.status === 422 && /No institution/i.test(e.message));
  assert.equal(auth.sent.length, 0);
});

test('an institution that has not opened registrations cannot be picked', async () => {
  const auth = new FakeAuth();
  await assert.rejects(
    service(seed(), auth).startSignUp({ email: 'a@somewhere.org', tenant_id: 3 }),
    (e: HttpError) => e.status === 422 && /not accepting/i.test(e.message));
  assert.equal(auth.sent.length, 0);
});

test('an address that already has an account is refused before sending', async () => {
  // Both halves matter. Creating the membership anyway would attach a stranger
  // to somebody else's account; mailing a code anyway would tell whoever typed
  // it that the address is registered here.
  const db = seed();
  db.tables.onyx_users.push({ id: 'u-1', email: 'priya@meridian.edu', name: 'Priya', status: 1 });
  const auth = new FakeAuth();

  await assert.rejects(
    service(db, auth).startSignUp({ email: 'priya@meridian.edu' }),
    (e: HttpError) => e.status === 409);
  assert.equal(auth.sent.length, 0);
});

// ------------------------------------------------------------------ the code

test('the code turns into an account, a membership and nothing more', async () => {
  const db = seed();
  const auth = new FakeAuth();
  const svc = service(db, auth);

  await svc.startSignUp({ email: 'priya@meridian.edu' });

  // Nothing exists yet. This is the point of the two steps: an abandoned
  // registration leaves no profile row and no membership behind.
  assert.equal(db.tables.onyx_users.length, 0);
  assert.equal(db.tables.onyx_memberships.length, 0);

  const done = await svc.completeSignUp({
    ...DETAILS, email: 'priya@meridian.edu', code: FakeAuth.CODE,
  });

  assert.equal(done.tenant.name, 'Meridian University');
  assert.equal(done.membership.role, 'student');
  // A student, always. Every other role is authority, and authority is
  // granted rather than requested.
  assert.equal(db.tables.onyx_memberships.length, 1);
  assert.equal(db.tables.onyx_memberships[0]!.role, 'student');
  assert.equal(db.tables.onyx_memberships[0]!.status, 1);
  assert.equal(db.tables.onyx_memberships[0]!.roll_number, 'ME-2026-001');
  assert.equal(db.tables.onyx_users.length, 1);
});

test('the password set at the second step is the one that signs in', async () => {
  // signInWithOtp has nowhere to put a password, so it is set through the
  // Admin API afterwards. If that step were skipped the account would be
  // created and then be unable to sign in, which is a worse failure than
  // refusing outright because it looks like success.
  const db = seed();
  const auth = new FakeAuth();
  const svc = service(db, auth);

  await svc.startSignUp({ email: 'priya@meridian.edu' });
  await svc.completeSignUp({ ...DETAILS, email: 'priya@meridian.edu', code: FakeAuth.CODE });

  const session = await svc.signIn('priya@meridian.edu', DETAILS.password);
  assert.ok(session.session.access_token);
});

test('a wrong code creates nothing', async () => {
  const db = seed();
  const auth = new FakeAuth();
  const svc = service(db, auth);

  await svc.startSignUp({ email: 'priya@meridian.edu' });
  await assert.rejects(
    svc.completeSignUp({ ...DETAILS, email: 'priya@meridian.edu', code: '000000' }),
    (e: HttpError) => e.status === 422 && /not right, or it has expired/i.test(e.message));

  assert.equal(db.tables.onyx_users.length, 0);
  assert.equal(db.tables.onyx_memberships.length, 0);
});

test('a code cannot be used twice', async () => {
  // The second use would be a second membership, or -- once the address is
  // taken -- a 409. Either way the code is spent, and a one-time code that
  // works twice is not one.
  const db = seed();
  const auth = new FakeAuth();
  const svc = service(db, auth);

  await svc.startSignUp({ email: 'priya@meridian.edu' });
  await svc.completeSignUp({ ...DETAILS, email: 'priya@meridian.edu', code: FakeAuth.CODE });

  await assert.rejects(
    svc.completeSignUp({ ...DETAILS, email: 'priya@meridian.edu', code: FakeAuth.CODE }),
    (e: HttpError) => e.status === 409 || e.status === 422);
  assert.equal(db.tables.onyx_memberships.length, 1);
});

test('a code for one address does not register another', async () => {
  // Nothing carries the address across the two calls except what the caller
  // sends, so the verification has to be against the address being registered
  // and not merely against some code that exists.
  const db = seed();
  const auth = new FakeAuth();
  const svc = service(db, auth);

  await svc.startSignUp({ email: 'priya@meridian.edu' });
  await assert.rejects(
    svc.completeSignUp({ ...DETAILS, email: 'someone.else@meridian.edu', code: FakeAuth.CODE }),
    (e: HttpError) => e.status === 422);
  assert.equal(db.tables.onyx_memberships.length, 0);
});

test('something that cannot be a code is refused without asking Supabase', async () => {
  const db = seed();
  const auth = new FakeAuth();
  const svc = service(db, auth);
  await svc.startSignUp({ email: 'priya@meridian.edu' });

  // Not "the wrong number of digits" -- GoTrue's OTP length is configuration
  // and this project sends eight, so anything in the plausible range has to go
  // to Supabase to be judged. What is refused here is what cannot be a code at
  // all: empty, letters, or far too long to be one.
  for (const code of ['', '   ', 'abcdef', '12', '12345678901234']) {
    await assert.rejects(
      svc.completeSignUp({ ...DETAILS, email: 'priya@meridian.edu', code }),
      (e: HttpError) => e.status === 422 && /digits from your email/i.test(e.message),
      'accepted ' + JSON.stringify(code));
  }
});

test('the rules are checked again at the second step, not just the first', async () => {
  // The gap between the two calls is however long somebody spends in their
  // inbox, and an institution can close its registrations inside it. A code
  // proves control of a mailbox; it is not a ticket that survives the
  // institution changing its mind.
  const db = seed();
  const auth = new FakeAuth();
  const svc = service(db, auth);

  await svc.startSignUp({ email: 'priya@meridian.edu' });
  db.tables.onyx_tenants.find((t) => t.id === 1)!.student_signup = false;

  await assert.rejects(
    svc.completeSignUp({ ...DETAILS, email: 'priya@meridian.edu', code: FakeAuth.CODE }),
    (e: HttpError) => e.status === 422);
  assert.equal(db.tables.onyx_memberships.length, 0);
});

test('a code still works where GoTrue insists on the exact token type', async () => {
  // Real deployments differ on whether the generic 'email' type is accepted.
  // The service tries each kind rather than guessing, and this is that
  // fallback actually being exercised.
  const db = seed();
  const auth = new FakeAuth();
  auth.strictOtpType = true;
  const svc = service(db, auth);

  await svc.startSignUp({ email: 'priya@meridian.edu' });
  const done = await svc.completeSignUp({
    ...DETAILS, email: 'priya@meridian.edu', code: FakeAuth.CODE,
  });
  assert.equal(done.membership.role, 'student');
});

test('a retry after an abandoned attempt still gets in', async () => {
  // The first attempt left a passwordless auth.users row behind, so the second
  // code is a magiclink token rather than a signup one. Somebody who closed
  // the tab and came back should not be permanently unable to register.
  const db = seed();
  const auth = new FakeAuth();
  auth.strictOtpType = true;
  const svc = service(db, auth);

  await svc.startSignUp({ email: 'priya@meridian.edu' });   // abandoned
  await svc.startSignUp({ email: 'priya@meridian.edu' });   // and again
  assert.equal(auth.sent.length, 2);
  // Neither send created the address -- the Admin API did, before either. The
  // second attempt finding it already there must not be an error: this project
  // has public signups off, so `signInWithOtp` cannot create one, and a
  // registration somebody abandoned would otherwise be unrepeatable for ever.
  assert.deepEqual(auth.sent.map((s) => s.created), [false, false]);

  const done = await svc.completeSignUp({
    ...DETAILS, email: 'priya@meridian.edu', code: FakeAuth.CODE,
  });
  assert.equal(done.membership.role, 'student');
});

// -------------------------------------------------------- the project is busy

test('a rate limit is never reported as a wrong password', async () => {
  /*
   * The failure this exists for is not the rate limit itself -- that is
   * Supabase's, it is temporary, and waiting fixes it. It is what the person
   * gets told.
   *
   * Reported as "those details do not match", somebody whose password is
   * correct concludes it is not, and resets it. The reset is another email
   * through the same throttled service, so it does not arrive either, and now
   * they cannot get in with the password they had. On an exam morning -- a
   * hall signing in at once, which is precisely when the limit is reached --
   * that is how a two-minute wait becomes a support queue.
   */
  const db = seed();
  db.tables.onyx_users.push({ id: 'u-1', email: 'priya@meridian.edu', name: 'Priya', status: 1 });
  db.tables.onyx_memberships.push({
    id: 1, tenant_id: 1, user_id: 'u-1', role: 'student', status: 1 });

  const auth = new FakeAuth();
  auth.seed('priya@meridian.edu', 'a-good-password');
  auth.rateLimitFor = 1;

  await assert.rejects(
    service(db, auth).signIn('priya@meridian.edu', 'a-good-password'),
    (e: HttpError) => e.status === 429 && /password is fine/i.test(e.message));
});

test('a rate limit on the SECOND call is not a 500 either', async () => {
  // Signing in costs two GoTrue calls -- the password grant and the refresh
  // that scopes the session to one institution -- so a burst reaches the limit
  // at half the number of people it appears to. When it lands on the second,
  // the password was already accepted, and this used to surface as a 500 with
  // the raw provider message in it.
  const db = seed();
  db.tables.onyx_users.push({ id: 'u-1', email: 'priya@meridian.edu', name: 'Priya', status: 1 });
  db.tables.onyx_memberships.push({
    id: 1, tenant_id: 1, user_id: 'u-1', role: 'student', status: 1 });

  const auth = new FakeAuth();
  const id = auth.seed('priya@meridian.edu', 'a-good-password');
  db.tables.onyx_users[0]!.id = id;
  db.tables.onyx_memberships[0]!.user_id = id;

  const svc = service(db, auth);
  auth.rateLimitFor = 0;
  // Let the password grant through, refuse the refresh.
  const original = auth.auth.signInWithPassword;
  auth.auth.signInWithPassword = async (input: { email: string; password: string }) => {
    const out = await original(input);
    auth.rateLimitFor = 1;
    return out;
  };

  await assert.rejects(
    svc.signIn('priya@meridian.edu', 'a-good-password'),
    (e: HttpError) => e.status === 429 && /password is fine/i.test(e.message));
});

test('a genuinely wrong password still says so', async () => {
  // The refusal above must not swallow the one that matters.
  const db = seed();
  db.tables.onyx_users.push({ id: 'u-1', email: 'priya@meridian.edu', name: 'Priya', status: 1 });
  const auth = new FakeAuth();
  auth.seed('priya@meridian.edu', 'a-good-password');

  await assert.rejects(
    service(db, auth).signIn('priya@meridian.edu', 'the-wrong-one'),
    (e: HttpError) => e.status === 401 && /do not match/i.test(e.message));
});
