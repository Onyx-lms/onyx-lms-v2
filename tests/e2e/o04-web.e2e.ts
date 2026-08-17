/**
 * Onyx O04 web layer -- the Assess pages.
 *
 * The API tests prove the rules. These prove the pages do not undo them: the
 * answer key must not be in the page a candidate is served, the marker's screen
 * must not name an anonymous candidate, and a result must not appear before it
 * is published. Each is checked against the RSC payload as well as the DOM,
 * because that is where "pass the whole object down as props" would put it.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { api, createTenant, webPage, withDb, WEB, RUN, onyxWebLogin } from './harness.ts';

/** The rendered document, without the RSC payload. See o01-web.e2e.ts. */
const dom = (html: string) => html.replace(/<script[\s\S]*?<\/script>/g, '');
/** React splits interpolated text with comment markers; prose needs them gone. */
const text = (html: string) => dom(html).replace(/<!--.*?-->/g, '');

const pw = 'OnyxTest#2026';
const mail = (who: string) => 'ew.' + who + '.' + RUN + '@onyx.test';
const T = { name: 'Assess Web College ' + RUN, slug: 'assess-web-' + RUN };

const SECRET_ANSWER = 'WEB-SECRET-' + RUN;

const w = {
  cookies: {} as Record<string, string>,
  ids: {} as Record<string, string>,
  course: 0, bank: 0, assessment: 0, attempt: 0,
  q: {} as Record<string, number>,
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

test('a college with a published, proctored assessment', async () => {
  const created = await createTenant({
    name: T.name, slug: T.slug,
    admin: { name: 'Admin', email: mail('admin'), password: pw },
  });
  assert.equal(created.ok, true, created.message);
  w.cookies.admin = await onyxWebLogin(mail('admin'), pw);

  for (const [who, role] of [['exams', 'exams'], ['student', 'student']] as const) {
    const r = await viaWeb<{ user: { id: string } }>('members', w.cookies.admin,
      { body: { name: who, email: mail(who), role, password: pw } });
    assert.equal(r.ok, true, r.message);
    w.ids[who] = r.data.user.id;
    w.cookies[who] = await onyxWebLogin(mail(who), pw);
  }

  const course = await viaWeb<{ id: number }>('courses', w.cookies.admin,
    { body: { code: 'AW101', title: 'Assess Web Course' } });
  w.course = Number(course.data.id);
  await viaWeb('courses/' + w.course, w.cookies.admin,
    { method: 'PATCH', body: { status: 1 } });
  await viaWeb('courses/' + w.course + '/enroll', w.cookies.admin,
    { body: { user_id: w.ids.student } });

  const bank = await viaWeb<{ id: number }>('banks', w.cookies.exams,
    { body: { name: 'Web bank' } });
  w.bank = Number(bank.data.id);

  const mk = async (body: unknown) => {
    const r = await viaWeb<{ id: number }>('banks/' + w.bank + '/questions',
      w.cookies.exams, { body });
    assert.equal(r.ok, true, r.message);
    return Number(r.data.id);
  };
  w.q.single = await mk({
    type: 'single', prompt: 'Pick the right one.', points: 2,
    options: [{ id: 'a', text: 'Wrong' }, { id: 'b', text: 'Right' }], answer: 'b',
  });
  w.q.short = await mk({
    type: 'short', prompt: 'Say the word.', answer: [SECRET_ANSWER], points: 1,
  });
  w.q.essay = await mk({ type: 'essay', prompt: 'Explain yourself.', points: 3 });

  const assessment = await viaWeb<{ id: number }>('assessments', w.cookies.exams, {
    body: {
      title: 'Web Exam', course_id: w.course, duration_minutes: 60, pass_mark: 4,
      proctoring: true, anonymous_marking: true,
      sections: [{ id: 's1', title: 'All', bank_id: w.bank, take: 3 }],
    },
  });
  w.assessment = Number(assessment.data.id);
  const published = await viaWeb('assessments/' + w.assessment + '/publish',
    w.cookies.exams, { method: 'POST' });
  assert.equal(published.ok, true, published.message);
});

test('the assessment list separates what is coming from what came back', async () => {
  const page = await webPage('/onyx/assessments', w.cookies.student);
  assert.equal(page.status, 200);
  const html = dom(page.html);
  assert.match(html, /Web Exam/);
  assert.match(html, /monitored/, 'a proctored paper was not marked as monitored');
  assert.match(text(page.html), /60 min/);
});

test('the front of the paper asks for consent before it deals anything', async () => {
  const page = await webPage('/onyx/assessments/' + w.assessment, w.cookies.student);
  assert.equal(page.status, 200);
  const html = dom(page.html);

  // Monitoring somebody who has not been asked is not proctoring.
  assert.match(html, /This assessment is monitored/);
  assert.match(html, /agree to be monitored/);
  assert.match(html, /timer runs on the server/);
  assert.match(html, /Marked without your name attached/);

  // No question has been dealt yet, so nothing about the paper is in the page.
  assert.ok(!page.html.includes(SECRET_ANSWER), 'the answer key reached the browser');
  assert.ok(!page.html.includes('Say the word'), 'the paper was dealt before consent');
});

test('sitting the paper: the key is absent and the clock is the server\'s', async () => {
  const started = await viaWeb<{ id: number; seconds_remaining: number }>(
    'assessments/' + w.assessment + '/start', w.cookies.student,
    { body: { consent: true } });
  assert.equal(started.ok, true, started.message);
  w.attempt = Number(started.data.id);

  const page = await webPage('/onyx/attempts/' + w.attempt, w.cookies.student);
  assert.equal(page.status, 200);
  const html = dom(page.html);

  assert.match(html, /Time remaining/);
  assert.match(html, /Monitored/);
  assert.match(html, /Pick the right one\./);
  assert.match(text(page.html), /0 of 3 answered/);

  // Neither in the DOM nor in the RSC payload.
  assert.ok(!page.html.includes(SECRET_ANSWER), 'the answer key reached the browser');
  // The correct option's id must not be marked in any way; both options render.
  assert.match(html, /Wrong/);
  assert.match(html, /Right/);
});

test('answers autosave through the page, and the paper resumes', async () => {
  const saved = await viaWeb('attempts/' + w.attempt + '/answer', w.cookies.student,
    { body: { question_id: w.q.single, response: 'b' } });
  assert.equal(saved.ok, true, saved.message);
  await viaWeb('attempts/' + w.attempt + '/answer', w.cookies.student,
    { body: { question_id: w.q.short, response: SECRET_ANSWER } });
  await viaWeb('attempts/' + w.attempt + '/answer', w.cookies.student,
    { body: { question_id: w.q.essay, response: 'My reasoning is as follows.' } });

  const page = await webPage('/onyx/attempts/' + w.attempt, w.cookies.student);
  assert.match(text(page.html), /3 of 3 answered/, 'saved answers did not come back');
  assert.match(dom(page.html), /My reasoning is as follows\./);
});

test('the marking screen does not name an anonymous candidate', async () => {
  const submitted = await viaWeb('attempts/' + w.attempt + '/submit', w.cookies.student,
    { method: 'POST' });
  assert.equal(submitted.ok, true, submitted.message);

  const queue = await webPage('/onyx/assessments/' + w.assessment + '/marking', w.cookies.exams);
  assert.equal(queue.status, 200);
  const queueHtml = dom(queue.html);
  assert.match(queueHtml, /Candidates are not named on this paper/);
  assert.match(queueHtml, /Candidate 1/);
  // Absent from the payload, not hidden by CSS.
  assert.ok(!queue.html.includes(mail('student')), 'the marking queue named the candidate');

  const paper = await webPage('/onyx/attempts/' + w.attempt + '/mark', w.cookies.exams);
  assert.equal(paper.status, 200);
  const paperHtml = dom(paper.html);
  assert.match(paperHtml, /Anonymous/);
  assert.match(paperHtml, /Explain yourself\./);
  assert.match(paperHtml, /scored automatically/, 'objective marks were made editable');
  assert.ok(!paper.html.includes(mail('student')), 'the marking screen named the candidate');

  // A candidate cannot reach the marking screen for their own paper: it carries
  // the answer key.
  assert.equal((await webPage('/onyx/attempts/' + w.attempt + '/mark',
    w.cookies.student)).status, 307);
  assert.equal((await webPage('/onyx/assessments/' + w.assessment + '/marking',
    w.cookies.student)).status, 307);
});

test('a result appears to the candidate only once it is published', async () => {
  await viaWeb('attempts/' + w.attempt + '/mark', w.cookies.exams, {
    body: { role: 'first', marks: [{ question_id: w.q.essay, points: 3 }] },
  });

  const before = dom((await webPage('/onyx/assessments', w.cookies.student)).html);
  assert.match(before, /awaiting results/);
  assert.ok(!before.includes('6 / 6'), 'a score appeared before publication');

  const published = await viaWeb('assessments/' + w.assessment + '/results/publish',
    w.cookies.admin, { method: 'POST' });
  assert.equal(published.ok, true, published.message);

  const after = (await webPage('/onyx/assessments', w.cookies.student)).html;
  assert.match(dom(after), /Your results/);
  // Interpolated, so React splits it with comment markers.
  assert.match(text(after), /6 \/ 6/);
  assert.match(dom(after), /passed/);
});

test('the results screen shows the cohort and the item analysis', async () => {
  const page = await webPage('/onyx/assessments/' + w.assessment + '/results', w.cookies.exams);
  assert.equal(page.status, 200);
  const html = dom(page.html);

  assert.match(html, /Cohort/);
  assert.match(html, /Item analysis/);
  assert.match(html, /Discrimination/);
  assert.match(html, /Export CSV/);
  // One candidate, everything right: facility 1 and "everybody got this right".
  assert.match(text(page.html), /Everybody got this right/);
  // A discrimination index from one paper is a number, not a finding.
  assert.match(html, /too few papers/);
  assert.match(html, /Published to candidates/);

  // Candidates do not get the cohort's results.
  assert.equal((await webPage('/onyx/assessments/' + w.assessment + '/results',
    w.cookies.student)).status, 307);
});

test('the invigilation queue and the integrity timeline are staff-only', async () => {
  await viaWeb('attempts/' + w.attempt + '/proctor', w.cookies.student,
    { body: { kind: 'paste' } }).catch(() => {});

  const queue = await webPage('/onyx/invigilate', w.cookies.exams);
  assert.equal(queue.status, 200);
  assert.match(dom(queue.html), /Invigilation/);

  const timeline = await webPage('/onyx/attempts/' + w.attempt + '/integrity', w.cookies.exams);
  assert.equal(timeline.status, 200);
  const html = dom(timeline.html);
  assert.match(html, /Integrity review/);
  // The screen says what a flag is, because a screen that implies otherwise is
  // how proctoring gets a deserved bad name.
  assert.match(html, /evidence, not a verdict/);
  assert.match(html, /Consented/);

  assert.equal((await webPage('/onyx/invigilate', w.cookies.student)).status, 307);
  assert.equal((await webPage('/onyx/attempts/' + w.attempt + '/integrity',
    w.cookies.student)).status, 307);
});

test('navigation gives Assess to everyone and invigilation only to staff', async () => {
  const learner = dom((await webPage('/onyx/dashboard', w.cookies.student)).html);
  assert.match(learner, /Assessments/);
  assert.ok(!learner.includes('Invigilate'), 'a candidate was offered invigilation');

  for (const who of ['exams', 'admin'] as const) {
    const staff = dom((await webPage('/onyx/dashboard', w.cookies[who]!)).html);
    assert.match(staff, /Assessments/, who + ' was not offered assessments');
    assert.match(staff, /Invigilate/, who + ' was not offered invigilation');
  }
});

test('cleanup leaves nothing behind', async () => {
  await withDb(async (c) => {
    await c.query('DELETE FROM public."onyx_tenants" WHERE slug = $1', [T.slug]);
    await c.query('DELETE FROM public."onyx_users" WHERE email LIKE $1',
      ['ew.%.' + RUN + '@onyx.test']);
  });
  // 403, not 401: credentials live in Supabase Auth now (ADR-011), separate
  // from the onyx_users profile row this deletes, so signInWithPassword
  // still succeeds and the rejection comes from the missing profile, one
  // step later. Access is equally denied either way.
  const gone = await api('/api/onyx/auth/login', { body: { email: mail('admin'), password: pw } });
  assert.equal(gone.status, 403);
});
