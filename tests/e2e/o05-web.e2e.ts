/**
 * Onyx O05 web layer -- the Career pages.
 *
 * The page that matters most here is the one with no session at all: a
 * credential verification is opened by an employer who has no account and never
 * will. It has to work without a token, and it has to carry nothing about the
 * holder but their name.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { api, createTenant, webPage, withDb, WEB, RUN, onyxWebLogin } from './harness.ts';

/** The rendered document, without the RSC payload. See o01-web.e2e.ts. */
const dom = (html: string) => html.replace(/<script[\s\S]*?<\/script>/g, '');
/** React splits interpolated text with comment markers; prose needs them gone. */
const text = (html: string) => dom(html).replace(/<!--.*?-->/g, '');

const pw = 'OnyxTest#2026';
const mail = (who: string) => 'cwx.' + who + '.' + RUN + '@onyx.test';
const T = { name: 'Career Web College ' + RUN, slug: 'career-web-' + RUN };

const w = {
  cookies: {} as Record<string, string>,
  ids: {} as Record<string, string>,
  course: 0, skill: 0, employerId: 0, job: 0, credential: '', contest: 0, interview: 0,
};

async function viaWeb<T = any>(path: string, cookie: string, init: {
  method?: string; body?: unknown;
} = {}) {
  const res = await fetch(WEB + '/api/proxy/onyx/' + path, {
    method: init.method ?? (init.body !== undefined ? 'POST' : 'GET'),
    headers: {
      cookie,
      ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, ok: Boolean(json.ok), data: json.data as T, message: json.message };
}

test('a college with a placement office, an employer and a graduate', async () => {
  const created = await createTenant({
    name: T.name, slug: T.slug,
    admin: { name: 'Admin', email: mail('admin'), password: pw },
  });
  assert.equal(created.ok, true, created.message);
  w.cookies.admin = await onyxWebLogin(mail('admin'), pw);

  for (const [who, role] of [
    ['placement', 'placement'], ['employer', 'employer'], ['student', 'student'],
  ] as const) {
    const r = await viaWeb<{ user: { id: string } }>('members', w.cookies.admin,
      { body: { name: who, email: mail(who), role, password: pw } });
    assert.equal(r.ok, true, r.message);
    w.ids[who] = r.data.user.id;
    w.cookies[who] = await onyxWebLogin(mail(who), pw);
  }

  const course = await viaWeb<{ id: number }>('courses', w.cookies.admin,
    { body: { code: 'CW101', title: 'Career Web Course' } });
  w.course = Number(course.data.id);
  await viaWeb('courses/' + w.course, w.cookies.admin,
    { method: 'PATCH', body: { status: 1 } });
  await viaWeb('courses/' + w.course + '/enroll', w.cookies.admin,
    { body: { user_id: w.ids.student } });

  const cert = await viaWeb<{ credential_id: string }>('certificates', w.cookies.placement, {
    body: {
      user_id: w.ids.student, title: 'Career Web Course',
      detail: { score: 92, grade: 'A', email: mail('student') },
    },
  });
  assert.equal(cert.ok, true, cert.message);
  w.credential = cert.data.credential_id;

  const skill = await viaWeb<{ id: number }>('skills', w.cookies.placement,
    { body: { name: 'Web Python ' + RUN } });
  w.skill = Number(skill.data.id);
  await viaWeb('skills/award', w.cookies.placement, {
    body: {
      user_id: w.ids.student, skill_id: w.skill,
      source_type: 'certificate', source_id: 1, strength: 90,
    },
  });

  const employer = await viaWeb<{ id: number }>('employers', w.cookies.placement, {
    body: { name: 'Acme Web ' + RUN, contact_email: 'rep@acme.test', user_id: w.ids.employer },
  });
  w.employerId = Number(employer.data.id);
  const job = await viaWeb<{ id: number }>('jobs', w.cookies.employer, {
    body: {
      employer_id: w.employerId, title: 'Graduate Engineer',
      location: 'Remote', min_readiness: 0, required_skills: [w.skill],
    },
  });
  w.job = Number(job.data.id);
  await viaWeb('jobs/' + w.job + '/publish', w.cookies.placement, { method: 'POST' });
});

/**
 * CAR-03a's acceptance criterion, on the page an employer actually opens.
 *
 * Fetched with no cookie at all -- if this needed a session it would be useless
 * to the people it exists for.
 */
test('CAR-03a the verification page works with no session and names only the holder', async () => {
  const res = await fetch(WEB + '/onyx/verify/' + w.credential, { redirect: 'manual' });
  assert.equal(res.status, 200, 'the verification page required a session');
  const html = await res.text();

  const visible = dom(html);
  assert.match(visible, /This credential is valid/);
  assert.match(visible, /Career Web Course/);
  assert.match(visible, new RegExp(T.name));
  assert.match(visible, /student/);

  // Neither in the DOM nor in the RSC payload -- the payload matters as much
  // as the markup, so this looks at the whole document rather than the
  // rendered part. Asset URLs are the exception: they carry content hashes
  // that change every build, and a four-digit id turns up inside one often
  // enough that a bare substring test fails at random. So drop the URLs and
  // match the id as a number rather than as a run of digits inside a hash --
  // an id that genuinely reaches the page still fails this.
  const payload = html.replace(/(?:src|href)="[^"]*"/g, '');
  assert.equal(html.includes(mail('student')), false, 'an email reached the public page');
  assert.ok(!new RegExp(`\\b${w.ids.student}\\b`).test(payload),
    'a user id reached the public page');
  // What the issuer chose to publish does appear.
  assert.match(visible, /92/);

  const unknown = await fetch(WEB + '/onyx/verify/' + 'B'.repeat(32), { redirect: 'manual' });
  assert.equal(unknown.status, 200);
  assert.match(dom(await unknown.text()), /No such credential/);
});

test('the profile shows the passport, the evidence and the working', async () => {
  const page = await webPage('/onyx/profile', w.cookies.student);
  assert.equal(page.status, 200);
  const html = dom(page.html);

  assert.match(html, /Readiness/);
  assert.match(html, /Skills passport/);
  assert.match(html, new RegExp('Web Python ' + RUN));
  // Every component of the score, with its weight and its counts.
  for (const label of ['Attendance', 'Assessment results', 'Code Lab practice',
    'Project work', 'Mock interviews']) {
    assert.match(html, new RegExp(label), label + ' was missing from the breakdown');
  }
  assert.match(text(page.html), /problems solved: 0/);
  assert.match(html, /Credentials/);
  // The share link is the whole feature.
  assert.match(html, new RegExp('/onyx/verify/' + w.credential));
});

test('CAR-04b the job page says why a learner can or cannot apply', async () => {
  const page = await webPage('/onyx/jobs/' + w.job, w.cookies.student);
  assert.equal(page.status, 200);
  const html = dom(page.html);

  assert.match(html, /Can you apply\?/);
  // Every rule, with what was required and what they have -- not a greyed-out
  // button.
  assert.match(html, /Readiness score/);
  assert.match(html, /Skills/);
  assert.match(html, />Apply</);
  // This learner meets both rules, so each is shown as met. The "worked out
  // from your record" note is deliberately only for somebody who cannot apply.
  assert.match(text(page.html), /✓ Readiness score/);
  assert.match(text(page.html), /✓ Skills/);

  const applied = await viaWeb('jobs/' + w.job + '/apply', w.cookies.student, { body: {} });
  assert.equal(applied.ok, true, applied.message);
  const after = dom((await webPage('/onyx/jobs/' + w.job, w.cookies.student)).html);
  assert.match(after, /You have applied for this/);
});

test('an employer sees their own pipeline and nothing institutional', async () => {
  const board = await webPage('/onyx/jobs', w.cookies.employer);
  assert.equal(board.status, 200);
  assert.match(dom(board.html), /Graduate Engineer/);
  assert.match(dom(board.html), /Your posts at/);

  const job = await webPage('/onyx/jobs/' + w.job, w.cookies.employer);
  assert.equal(job.status, 200);
  assert.match(dom(job.html), /Applicants/);
  // The candidate is named to the employer they applied to -- that is the
  // point of applying.
  assert.match(dom(job.html), /student/);

  // But the institution's own screens are not theirs.
  assert.equal((await webPage('/onyx/placement', w.cookies.employer)).status, 307);
  assert.equal((await webPage('/onyx/people', w.cookies.employer)).status, 307);
  assert.equal((await webPage('/onyx/courses', w.cookies.employer)).status, 200,
    'the courses page should still render; the API scopes what it shows');
});

test('the placement office sees employers, posts and drives', async () => {
  const page = await webPage('/onyx/placement', w.cookies.placement);
  assert.equal(page.status, 200);
  const html = dom(page.html);
  assert.match(html, /Employers/);
  assert.match(html, new RegExp('Acme Web ' + RUN));
  assert.match(html, /Has a login/);
  assert.match(html, /Graduate Engineer/);

  // A learner has no business in the placement office's screens.
  assert.equal((await webPage('/onyx/placement', w.cookies.student)).status, 307);
});

test('CAR-04c the drive page reports whether rounds and offers agree', async () => {
  const drive = await viaWeb<{ id: number }>('drives', w.cookies.placement, {
    body: {
      employer_id: w.employerId, job_id: w.job, title: 'Web drive',
      rounds: [{ name: 'Aptitude' }],
    },
  });
  assert.equal(drive.ok, true, drive.message);

  const summary = await viaWeb<{ rounds: { round_id: number }[] }>(
    'drives/' + drive.data.id + '/summary', w.cookies.placement);
  await viaWeb('rounds/' + summary.data.rounds[0]!.round_id + '/results', w.cookies.placement, {
    body: { entries: [{ user_id: w.ids.student, outcome: 'passed' }] },
  });

  const before = dom((await webPage('/onyx/drives/' + drive.data.id, w.cookies.placement)).html);
  assert.match(before, /Rounds against offers/);
  assert.match(before, /Cleared but no offer/);
  // Said out loud, because neither side is necessarily the wrong one.
  assert.match(before, /a decision rather than a surprise/);

  const applications = await viaWeb<{ id: number }[]>(
    'jobs/' + w.job + '/applicants', w.cookies.employer);
  await viaWeb('applications/' + applications.data[0]!.id, w.cookies.employer,
    { method: 'PATCH', body: { status: 'offered' } });

  const after = dom((await webPage('/onyx/drives/' + drive.data.id, w.cookies.placement)).html);
  assert.match(after, /These agree/);
});

test('CAR-01 the contest page shows the board and the team controls', async () => {
  const problem = await viaWeb<{ id: number }>('problems', w.cookies.admin, {
    body: { title: 'Web Contest Echo ' + RUN, statement: 'Echo.', languages: ['python'] },
  });
  await viaWeb('problems/' + problem.data.id + '/tests', w.cookies.admin, {
    method: 'PUT',
    body: { tests: [{ stdin: 'x', expected_stdout: 'x', is_hidden: false }] },
  });
  await viaWeb('problems/' + problem.data.id + '/publish', w.cookies.admin, { method: 'POST' });

  const contest = await viaWeb<{ id: number }>('contests', w.cookies.admin, {
    body: {
      title: 'Web Hack ' + RUN,
      starts_at: new Date(Date.now() - 60_000).toISOString(),
      ends_at: new Date(Date.now() + 3_600_000).toISOString(),
      problems: [{ problem_id: problem.data.id, points: 100 }],
      team_size: 2,
    },
  });
  assert.equal(contest.ok, true, contest.message);
  w.contest = Number(contest.data.id);
  await viaWeb('contests/' + w.contest + '/publish', w.cookies.admin, { method: 'POST' });

  const page = await webPage('/onyx/contests/' + w.contest, w.cookies.student);
  assert.equal(page.status, 200);
  const html = dom(page.html);
  assert.match(html, /Leaderboard/);
  assert.match(html, /Start a team/);
  assert.match(html, /No teams yet/);
  assert.match(text(page.html), /adds 20 minutes/);

  await viaWeb('contests/' + w.contest + '/teams', w.cookies.student,
    { body: { name: 'Web Team' } });
  const after = dom((await webPage('/onyx/contests/' + w.contest, w.cookies.student)).html);
  assert.match(after, /Web Team/);
  assert.match(after, /You are in a team/);
});

test('CAR-02 an interview shows feedback to the learner only once released', async () => {
  const interview = await viaWeb<{ id: number }>('interviews', w.cookies.placement, {
    body: {
      user_id: w.ids.student, interviewer_id: w.ids.placement,
      title: 'Web practice', scheduled_at: new Date(Date.now() + 86_400_000).toISOString(),
    },
  });
  assert.equal(interview.ok, true, interview.message);
  w.interview = Number(interview.data.id);

  await viaWeb('interviews/' + w.interview + '/feedback', w.cookies.placement, {
    body: {
      feedback: [{ criterion: 'Communication', score: 4, of: 5, comment: 'Clear.' }],
      overall: 4, notes: 'Private note for the office.',
    },
  });

  const before = await webPage('/onyx/interviews/' + w.interview, w.cookies.student);
  assert.equal(before.status, 200);
  assert.ok(!before.html.includes('Private note'), 'a private note reached the learner');
  assert.ok(!before.html.includes('Clear.'), 'unreleased feedback reached the learner');
  assert.match(dom(before.html), /will appear once it is released/);

  // The interviewer sees their own form, and is told what is private.
  const interviewer = dom((await webPage('/onyx/interviews/' + w.interview,
    w.cookies.placement)).html);
  assert.match(interviewer, /Never shown to the learner/);
  assert.match(interviewer, /Save without releasing/);

  await viaWeb('interviews/' + w.interview + '/release', w.cookies.placement, { method: 'POST' });
  const after = await webPage('/onyx/interviews/' + w.interview, w.cookies.student);
  assert.match(dom(after.html), /Your feedback/);
  assert.match(dom(after.html), /Clear\./);
  // Still never the private notes.
  assert.ok(!after.html.includes('Private note'), 'a private note reached the learner after release');
});

test('navigation matches the role, and an employer gets almost nothing', async () => {
  const learner = dom((await webPage('/onyx/dashboard', w.cookies.student)).html);
  for (const label of ['Contests', 'Jobs', 'Interviews', 'Your profile']) {
    assert.match(learner, new RegExp(label), 'a learner was not offered ' + label);
  }
  assert.ok(!learner.includes('Placement'), 'a learner was offered the placement office');

  const office = dom((await webPage('/onyx/dashboard', w.cookies.placement)).html);
  assert.match(office, /Placement/);

  // An employer is an outsider: their own posts and their interviews, nothing
  // that belongs to the institution.
  const employer = dom((await webPage('/onyx/jobs', w.cookies.employer)).html);
  assert.match(employer, /Your posts/);
  assert.match(employer, /Interviews/);
  assert.ok(!employer.includes('Placement'), 'an employer was offered the placement office');
  assert.ok(!employer.includes('Audit log'), 'an employer was offered the audit log');
  assert.ok(!employer.includes('People'), 'an employer was offered the roster');
});

test('cleanup leaves nothing behind', async () => {
  await withDb(async (c) => {
    await c.query('DELETE FROM public."onyx_tenants" WHERE slug = $1', [T.slug]);
    await c.query('DELETE FROM public."onyx_users" WHERE email LIKE $1',
      ['cwx.%.' + RUN + '@onyx.test']);
  });
  // 403, not 401: credentials live in Supabase Auth now (ADR-011), separate
  // from the onyx_users profile row this deletes, so signInWithPassword
  // still succeeds and the rejection comes from the missing profile, one
  // step later. Access is equally denied either way.
  const gone = await api('/api/onyx/auth/login', { body: { email: mail('admin'), password: pw } });
  assert.equal(gone.status, 403);

  // And the credential stops verifying, publicly.
  const page = await fetch(WEB + '/onyx/verify/' + w.credential, { redirect: 'manual' });
  assert.match(dom(await page.text()), /No such credential/);
});
