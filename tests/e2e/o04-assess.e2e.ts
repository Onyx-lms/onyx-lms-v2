/**
 * Onyx O04 -- Onyx Assess, end to end.
 *
 * Four acceptance criteria are proven here and cannot be proven anywhere else:
 *
 *   * **Editing a question does not change a sat paper** (ASS-01a), against a
 *     real question-version table rather than an in-memory one.
 *   * **A client clock change cannot extend an attempt** (ASS-01b), by sitting
 *     a one-minute paper and letting the server end it.
 *   * **The grader cannot see the candidate's name when anonymised** (ASS-03a),
 *     checked against the wire.
 *   * **Results are invisible to learners until published, and publication is
 *     audited** (ASS-03b).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { api, createTenant, withDb, RUN, onyxLogin } from './harness.ts';

const pw = 'OnyxTest#2026';
const mail = (who: string) => 'ex.' + who + '.' + RUN + '@onyx.test';
const A = { name: 'Exam Board ' + RUN, slug: 'exam-a-' + RUN };
const B = { name: 'Rival Board ' + RUN, slug: 'exam-b-' + RUN };

const SECRET_ANSWER = 'SECRET-KEY-' + RUN;

const w = {
  alpha: { id: 0, admin: '', exams: '', s1: '', s2: '' },
  beta: { id: 0, admin: '' },
  ids: {} as Record<string, string>,
  course: 0, bank: 0, assessment: 0, attempt1: 0, attempt2: 0,
  q: {} as Record<string, number>,
};

test('two boards, a course and two candidates', async () => {
  for (const [key, t] of [['alpha', A], ['beta', B]] as const) {
    const res = await createTenant({
      name: t.name, slug: t.slug,
      admin: { name: t.name, email: mail(key + '.admin'), password: pw },
    });
    assert.equal(res.ok, true, res.message);
    w[key].id = Number(res.data.tenant.id);
  }
  w.alpha.admin = await onyxLogin(mail('alpha.admin'), pw);
  w.beta.admin = await onyxLogin(mail('beta.admin'), pw);

  for (const [who, role] of [['exams', 'exams'], ['s1', 'student'], ['s2', 'student']] as const) {
    const r = await api<{ user: { id: string } }>('/api/onyx/members', {
      token: w.alpha.admin, body: { name: who, email: mail(who), role, password: pw },
    });
    assert.equal(r.ok, true, r.message);
    w.ids[who] = r.data.user.id;
  }
  w.alpha.exams = await onyxLogin(mail('exams'), pw);
  w.alpha.s1 = await onyxLogin(mail('s1'), pw);
  w.alpha.s2 = await onyxLogin(mail('s2'), pw);

  const course = await api<{ id: number }>('/api/onyx/courses', {
    token: w.alpha.admin, body: { code: 'EX101', title: 'Examined Course' },
  });
  w.course = Number(course.data.id);
  await api('/api/onyx/courses/' + w.course,
    { token: w.alpha.admin, method: 'PATCH', body: { status: 1 } });
  for (const who of ['s1', 's2'] as const) {
    await api('/api/onyx/courses/' + w.course + '/enroll',
      { token: w.alpha.admin, body: { user_id: w.ids[who] } });
  }
});

// ---------------------------------------------------------------------------
// ASS-01a
// ---------------------------------------------------------------------------

test('ASS-01a a bank is authored, and a candidate never sees the key', async () => {
  const bank = await api<{ id: number }>('/api/onyx/banks',
    { token: w.alpha.exams, body: { name: 'Exam bank', course_id: w.course } });
  assert.equal(bank.ok, true, bank.message);
  w.bank = Number(bank.data.id);

  const mk = async (body: unknown) => {
    const r = await api<{ id: number }>('/api/onyx/banks/' + w.bank + '/questions',
      { token: w.alpha.exams, body });
    assert.equal(r.ok, true, JSON.stringify(body).slice(0, 60) + ': ' + r.message);
    return Number(r.data.id);
  };
  w.q.single = await mk({
    type: 'single', prompt: 'Two plus two?', points: 2,
    options: [{ id: 'a', text: 'Three' }, { id: 'b', text: 'Four' }], answer: 'b',
  });
  w.q.multiple = await mk({
    type: 'multiple', prompt: 'Which are prime?', points: 2,
    options: [{ id: 'a', text: '2' }, { id: 'b', text: '4' }, { id: 'c', text: '3' }],
    answer: ['a', 'c'],
  });
  w.q.short = await mk({
    type: 'short', prompt: 'Say the secret word.', answer: [SECRET_ANSWER], points: 1,
  });
  w.q.essay = await mk({ type: 'essay', prompt: 'Explain your reasoning.', points: 5 });

  // A key that is not one of the options makes the question unanswerable.
  const bad = await api('/api/onyx/banks/' + w.bank + '/questions', {
    token: w.alpha.exams,
    body: {
      type: 'single', prompt: 'Broken',
      options: [{ id: 'a', text: 'x' }, { id: 'b', text: 'y' }], answer: 'z',
    },
  });
  assert.equal(bad.status, 422, bad.message);

  // The bank is staff-only: it is the key to every paper drawn from it.
  assert.equal((await api('/api/onyx/banks/' + w.bank + '/questions',
    { token: w.alpha.s1 })).status, 403);
  assert.equal((await api('/api/onyx/banks', { token: w.alpha.s1 })).status, 403);
});

test('ASS-01b an assessment is scheduled and published', async () => {
  const created = await api<{ id: number; status: string }>('/api/onyx/assessments', {
    token: w.alpha.exams,
    body: {
      title: 'Final', course_id: w.course, duration_minutes: 60, pass_mark: 6,
      proctoring: true, anonymous_marking: true, moderation_required: true,
      sections: [{ id: 's1', title: 'All', bank_id: w.bank, take: 4 }],
    },
  });
  assert.equal(created.ok, true, created.message);
  assert.equal(created.data.status, 'draft');
  w.assessment = Number(created.data.id);

  // A draft is not a thing a candidate has been asked to sit.
  assert.equal((await api('/api/onyx/assessments/' + w.assessment,
    { token: w.alpha.s1 })).status, 404);

  const published = await api('/api/onyx/assessments/' + w.assessment + '/publish',
    { token: w.alpha.exams, method: 'POST' });
  assert.equal(published.ok, true, published.message);

  const seen = await api('/api/onyx/assessments/' + w.assessment, { token: w.alpha.s1 });
  assert.equal(seen.ok, true, seen.message);
  // Knowing which banks it draws from is a map of the bank.
  assert.equal(seen.data.sections, undefined, 'a candidate was told which banks it uses');
});

// ---------------------------------------------------------------------------
// ASS-01b/c + ASS-02
// ---------------------------------------------------------------------------

test('ASS-02 a proctored paper needs consent, and records what the browser sees', async () => {
  const refused = await api('/api/onyx/assessments/' + w.assessment + '/start',
    { token: w.alpha.s1, body: {} });
  assert.equal(refused.status, 422, refused.message);

  const started = await api<{ id: number; seconds_remaining: number; questions: unknown[] }>(
    '/api/onyx/assessments/' + w.assessment + '/start',
    { token: w.alpha.s1, body: { consent: true } });
  assert.equal(started.ok, true, started.message);
  w.attempt1 = Number(started.data.id);
  assert.equal(started.data.questions.length, 4);
  assert.ok(started.data.seconds_remaining > 3500);

  // The acceptance criterion for ASS-01a's sibling: no key on the wire.
  assert.equal(JSON.stringify(started.data).includes(SECRET_ANSWER), false,
    'the answer key reached the candidate');

  for (const kind of ['tab_blur', 'paste', 'multiple_faces']) {
    const ev = await api('/api/onyx/attempts/' + w.attempt1 + '/proctor',
      { token: w.alpha.s1, body: { kind, client_at: new Date().toISOString() } });
    assert.equal(ev.ok, true, kind + ': ' + ev.message);
  }
  assert.equal((await api('/api/onyx/attempts/' + w.attempt1 + '/proctor',
    { token: w.alpha.s2, body: { kind: 'paste' } })).status, 403,
  'events could be posted onto another candidate\'s paper');
  // A candidate reading their own proctor log would know exactly what to avoid.
  assert.equal((await api('/api/onyx/attempts/' + w.attempt1 + '/proctor',
    { token: w.alpha.s1 })).status, 403);
});

test('ASS-01c answers autosave and the attempt resumes exactly', async () => {
  const attempt = await api<{ questions: { question_id: number; type: string }[] }>(
    '/api/onyx/attempts/' + w.attempt1, { token: w.alpha.s1 });
  const answer = (questionId: number, response: unknown) =>
    api('/api/onyx/attempts/' + w.attempt1 + '/answer',
      { token: w.alpha.s1, body: { question_id: questionId, response } });

  const saved = await answer(w.q.single, 'b');
  assert.equal(saved.ok, true, saved.message);
  await answer(w.q.multiple, ['a', 'c']);
  await answer(w.q.short, '  ' + SECRET_ANSWER.toLowerCase() + ' ');
  await answer(w.q.essay, 'Because the argument follows from the premises.');

  // Starting again is the same button, and gives back the same paper.
  const resumed = await api<{ id: number; questions: { question_id: number; response: unknown }[] }>(
    '/api/onyx/assessments/' + w.assessment + '/start',
    { token: w.alpha.s1, body: { consent: true } });
  assert.equal(resumed.data.id, w.attempt1, 'resuming created a second attempt');
  assert.deepEqual(
    resumed.data.questions.map((q) => q.question_id),
    attempt.data.questions.map((q) => q.question_id),
    'a resumed attempt was dealt a different paper');
  assert.equal(resumed.data.questions.find((q) => q.question_id === w.q.single)!.response, 'b');

  // Not on this paper, and not this candidate.
  assert.equal((await answer(999_999, 'x')).status, 422);
  assert.equal((await api('/api/onyx/attempts/' + w.attempt1 + '/answer',
    { token: w.alpha.s2, body: { question_id: w.q.single, response: 'a' } })).status, 403);
  assert.equal((await api('/api/onyx/attempts/' + w.attempt1, { token: w.alpha.s2 })).status, 403);
});

/**
 * ASS-01b's acceptance criterion, against the real clock.
 *
 * A one-minute paper is started and left. Nothing the client could say matters,
 * because every check below is the server reading its own `expires_at`.
 */
test('ASS-01b a client clock change cannot extend an attempt', async () => {
  const quick = await api<{ id: number }>('/api/onyx/assessments', {
    token: w.alpha.exams,
    body: {
      title: 'One minute', course_id: w.course, duration_minutes: 1,
      sections: [{ id: 's1', title: 'All', bank_id: w.bank, take: 2 }],
    },
  });
  await api('/api/onyx/assessments/' + quick.data.id + '/publish',
    { token: w.alpha.exams, method: 'POST' });

  const attempt = await api<{ id: number; seconds_remaining: number }>(
    '/api/onyx/assessments/' + quick.data.id + '/start', { token: w.alpha.s2, body: {} });
  assert.ok(attempt.data.seconds_remaining <= 60);

  await new Promise((r) => { setTimeout(r, 62_000); });

  const late = await api('/api/onyx/attempts/' + attempt.data.id + '/answer',
    { token: w.alpha.s2, body: { question_id: w.q.single, response: 'b' } });
  assert.equal(late.status, 422, 'an answer was accepted after time ran out');

  const after = await api<{ status: string; seconds_remaining: number }>(
    '/api/onyx/attempts/' + attempt.data.id, { token: w.alpha.s2 });
  assert.equal(after.data.status, 'expired', 'an overdue attempt stayed in progress');
  assert.equal(after.data.seconds_remaining, 0);

  // And it cannot be restarted to get a fresh hour.
  const restart = await api('/api/onyx/assessments/' + quick.data.id + '/start',
    { token: w.alpha.s2, body: {} });
  assert.equal(restart.status, 422, restart.message);
});

test('handing in auto-marks the objective questions and withholds the total', async () => {
  const submitted = await api<{ score: number | null }>(
    '/api/onyx/attempts/' + w.attempt1 + '/submit', { token: w.alpha.s1, method: 'POST' });
  assert.equal(submitted.ok, true, submitted.message);
  assert.equal(submitted.data.score, null, 'a score appeared before results were published');

  // A second candidate sits the same paper, getting the single one wrong.
  const started = await api<{ id: number }>('/api/onyx/assessments/' + w.assessment + '/start',
    { token: w.alpha.s2, body: { consent: true } });
  w.attempt2 = Number(started.data.id);
  const answer = (questionId: number, response: unknown) =>
    api('/api/onyx/attempts/' + w.attempt2 + '/answer',
      { token: w.alpha.s2, body: { question_id: questionId, response } });
  await answer(w.q.single, 'a');
  await answer(w.q.multiple, ['a', 'c']);
  await answer(w.q.short, SECRET_ANSWER);
  await api('/api/onyx/attempts/' + w.attempt2 + '/submit',
    { token: w.alpha.s2, method: 'POST' });
});

// ---------------------------------------------------------------------------
// ASS-01a's acceptance criterion
// ---------------------------------------------------------------------------

test('ASS-01a editing a question after an attempt does not change that attempt', async () => {
  const edited = await api<{ version: number }>('/api/onyx/questions/' + w.q.single, {
    token: w.alpha.exams, method: 'PATCH',
    body: { prompt: 'Completely different question', answer: 'a' },
  });
  assert.equal(edited.ok, true, edited.message);
  assert.equal(edited.data.version, 2);

  const paper = await api<{ questions: {
    question_id: number; prompt: string; expected: unknown; auto_points: number | null;
  }[] }>('/api/onyx/attempts/' + w.attempt1 + '/paper', { token: w.alpha.exams });
  const sat = paper.data.questions.find((q) => q.question_id === w.q.single)!;

  assert.equal(sat.prompt, 'Two plus two?', 'the paper changed under the candidate');
  assert.equal(sat.expected, 'b', 'the answer key changed after the fact');
  assert.equal(Number(sat.auto_points), 2, 'a correct answer became wrong');
});

// ---------------------------------------------------------------------------
// ASS-03
// ---------------------------------------------------------------------------

test('ASS-03a the grader cannot see the candidate when marking is anonymous', async () => {
  const queue = await api<{ id: number; user_id: string | null; candidate: string | null }[]>(
    '/api/onyx/assessments/' + w.assessment + '/marking', { token: w.alpha.exams });
  assert.equal(queue.ok, true, queue.message);
  assert.equal(queue.data.length, 2);

  // The acceptance criterion, checked against the wire: not hidden by CSS,
  // absent from the payload.
  for (const row of queue.data) {
    assert.equal(row.user_id, null, 'the marking queue named the candidate');
    assert.match(String(row.candidate), /^Candidate \d+$/);
  }
  const wire = JSON.stringify(queue.data);
  assert.equal(wire.includes(mail('s1')), false);
  assert.equal(wire.includes(String(w.ids.s1)), false, 'a candidate id reached the marker');

  const paper = await api<{ user_id: string | null; anonymous: boolean }>(
    '/api/onyx/attempts/' + w.attempt1 + '/paper', { token: w.alpha.exams });
  assert.equal(paper.data.user_id, null);
  assert.equal(paper.data.anonymous, true);

  // A candidate cannot reach the marker's view of their own paper -- it carries
  // the key.
  assert.equal((await api('/api/onyx/attempts/' + w.attempt1 + '/paper',
    { token: w.alpha.s1 })).status, 403);
});

test('ASS-03 marking is checked, and moderation overrides', async () => {
  const over = await api('/api/onyx/attempts/' + w.attempt1 + '/mark', {
    token: w.alpha.exams, body: { marks: [{ question_id: w.q.essay, points: 99 }] },
  });
  assert.equal(over.status, 422, over.message);

  // A marker can now override an objective question too -- the real UI always
  // submits the whole paper per role, so re-affirming single at its own
  // auto-graded value alongside the essay must leave the total untouched:
  // that is the "no double-counting" guarantee, proven live, not just in
  // isolation.
  const first = await api<{ auto_score: number; score: number;
    questions: { question_id: number; manual_points: number | null }[] }>(
    '/api/onyx/attempts/' + w.attempt1 + '/mark', {
      token: w.alpha.exams,
      body: {
        role: 'first',
        marks: [
          { question_id: w.q.single, points: 2 },
          { question_id: w.q.essay, points: 2 },
        ],
      },
    });
  assert.equal(first.ok, true, first.message);
  const single = first.data.questions.find((q) => q.question_id === w.q.single)!;
  assert.equal(single.manual_points, 2, 'the objective override was recorded');
  assert.equal(Number(first.data.auto_score), 3, 'multiple 2 + short 1, single now overridden');
  assert.equal(Number(first.data.score), 7, 'same total as before the override -- no double-count');

  const moderated = await api<{ score: number }>('/api/onyx/attempts/' + w.attempt1 + '/mark', {
    token: w.alpha.exams,
    body: {
      role: 'moderation',
      marks: [
        { question_id: w.q.single, points: 2 },
        { question_id: w.q.essay, points: 5 },
      ],
    },
  });
  assert.equal(Number(moderated.data.score), 10, 'moderation did not override the first mark');

  // And a genuine override -- not just re-affirming the auto value -- really
  // does change the total. The second candidate got "single" wrong (auto 0);
  // a marker gives partial credit for working shown, on a paper untouched by
  // the above.
  const upgraded = await api<{ auto_score: number; score: number }>(
    '/api/onyx/attempts/' + w.attempt2 + '/mark', {
      token: w.alpha.exams,
      body: { role: 'first', marks: [{ question_id: w.q.single, points: 1 }] },
    });
  assert.equal(upgraded.ok, true, upgraded.message);
  assert.equal(Number(upgraded.data.auto_score), 3, 'multiple 2 + short 1, single excluded');
  assert.equal(Number(upgraded.data.score), 4, 'single was given partial credit, 0 to 1');
});

test('ASS-03b results are invisible until published, and publication is audited', async () => {
  const before = await api<{ score: number | null }[]>('/api/onyx/my/assessments',
    { token: w.alpha.s1 });
  assert.equal(before.data.every((a) => a.score === null), true,
    'a score leaked before results were published');

  // Moderation is required on this assessment, and attempt 2 has none yet.
  const early = await api('/api/onyx/assessments/' + w.assessment + '/results/publish',
    { token: w.alpha.admin, method: 'POST' });
  assert.equal(early.status, 422, 'results published with moderation outstanding');

  await api('/api/onyx/attempts/' + w.attempt2 + '/mark', {
    token: w.alpha.exams,
    body: { role: 'moderation', marks: [{ question_id: w.q.essay, points: 0 }] },
  });

  const published = await api<{ published: number }>(
    '/api/onyx/assessments/' + w.assessment + '/results/publish',
    { token: w.alpha.admin, method: 'POST' });
  assert.equal(published.ok, true, published.message);
  assert.equal(published.data.published, 2);

  const after = await api<{
    attempt_id: number; score: number; passed: boolean | null; results_published: boolean;
  }[]>('/api/onyx/my/assessments', { token: w.alpha.s1 });
  const mine = after.data.find((a) => a.attempt_id === w.attempt1)!;
  assert.equal(Number(mine.score), 10);
  assert.equal(mine.passed, true);
  assert.equal(mine.results_published, true);

  // Re-marking a published paper is an appeal, not an edit.
  assert.equal((await api('/api/onyx/attempts/' + w.attempt1 + '/mark', {
    token: w.alpha.exams, body: { marks: [{ question_id: w.q.essay, points: 0 }] },
  })).status, 422);

  const audit = await api<{ action: string }[]>('/api/onyx/audit?limit=200',
    { token: w.alpha.admin });
  const actions = audit.data.map((a) => a.action);
  assert.ok(actions.includes('result.published'), 'publication was not audited');
  assert.ok(actions.includes('assessment.grade_changed'), 'marking was not audited');
});

// ---------------------------------------------------------------------------
// ASS-02b and ASS-04
// ---------------------------------------------------------------------------

test('ASS-02b an invigilator reviews each flag, and the decision is audited', async () => {
  const queue = await api<{ attempt_id: number; integrity_flags: number }[]>(
    '/api/onyx/proctor/queue', { token: w.alpha.exams });
  const flagged = queue.data.find((r) => r.attempt_id === w.attempt1)!;
  // tab_blur 1 + paste 2 + multiple_faces 3.
  assert.equal(flagged.integrity_flags, 6, JSON.stringify(flagged));

  const timeline = await api<{ events: { id: number; kind: string; review: string;
    offset_seconds: number }[] }>('/api/onyx/attempts/' + w.attempt1 + '/proctor',
  { token: w.alpha.exams });
  assert.equal(timeline.data.events.length >= 3, true);
  // ASS-02a's acceptance criterion: each is reviewable with a timestamp.
  for (const e of timeline.data.events) {
    assert.equal(typeof e.offset_seconds, 'number');
  }

  const open = timeline.data.events.find((e) => e.review === 'open')!;
  const reviewed = await api('/api/onyx/proctor/events/' + open.id + '/review',
    { token: w.alpha.exams, body: { decision: 'dismissed', note: 'a notification popup' } });
  assert.equal(reviewed.ok, true, reviewed.message);

  const after = await api<{ attempt_id: number; integrity_flags: number }[]>(
    '/api/onyx/proctor/queue', { token: w.alpha.exams });
  assert.ok(after.data.find((r) => r.attempt_id === w.attempt1)!.integrity_flags < 6,
    'dismissing a flag did not lower the score');

  const settled = await api('/api/onyx/attempts/' + w.attempt1 + '/integrity',
    { token: w.alpha.exams, body: { decision: 'cleared', note: 'nothing in it' } });
  assert.equal(settled.ok, true, settled.message);

  const audit = await api<{ action: string }[]>('/api/onyx/audit?limit=200',
    { token: w.alpha.admin });
  assert.ok(audit.data.some((a) => a.action === 'assessment.flag_reviewed'),
    'the review decision was not audited');
});

test('ASS-04 results, item analysis and a CSV export', async () => {
  const results = await api<{ cohort: { sat: number; mean: number; pass_rate: number | null } }>(
    '/api/onyx/assessments/' + w.assessment + '/results', { token: w.alpha.exams });
  assert.equal(results.ok, true, results.message);
  assert.equal(results.data.cohort.sat, 2);

  const items = await api<{ sat: number; items: {
    question_id: number; facility: number; correct: number; responses: number;
  }[] }>('/api/onyx/assessments/' + w.assessment + '/items', { token: w.alpha.exams });
  assert.equal(items.data.sat, 2);
  // One of two got the single-choice right.
  const single = items.data.items.find((i) => i.question_id === w.q.single)!;
  assert.equal(single.responses, 2);
  assert.equal(single.correct, 1);
  assert.equal(single.facility, 0.5, JSON.stringify(single));
  // Both got the multiple right.
  assert.equal(items.data.items.find((i) => i.question_id === w.q.multiple)!.facility, 1);
  // The essay is a marker's judgement, not a fact, so it is not an item.
  assert.equal(items.data.items.some((i) => i.question_id === w.q.essay), false,
    'a subjective question appeared in the item analysis');

  const csv = await fetch((await import('./harness.ts')).API
    + '/api/onyx/assessments/' + w.assessment + '/results.csv',
  { headers: { Authorization: 'Bearer ' + w.alpha.exams } });
  assert.equal(csv.status, 200);
  assert.match(csv.headers.get('content-type') ?? '', /text\/csv/);
  const text = await csv.text();
  const lines = text.split('\r\n').filter(Boolean);
  assert.equal(lines.length, 3, 'header plus two candidates');
  assert.match(lines[0]!, /^attempt_id,user_id,name,email/);
  assert.ok(text.includes(mail('s1')), 'the export did not name candidates');

  const benchmark = await api<{ assessment_id: number; mean_percent: number }[]>(
    '/api/onyx/courses/' + w.course + '/benchmark', { token: w.alpha.exams });
  assert.ok(benchmark.data.some((b) => b.assessment_id === w.assessment));

  // Candidates do not get the cohort's results.
  for (const path of ['/results', '/items', '/marking']) {
    assert.equal((await api('/api/onyx/assessments/' + w.assessment + path,
      { token: w.alpha.s1 })).status, 403, path + ' was readable by a candidate');
  }
});

// ---------------------------------------------------------------------------
// Isolation
// ---------------------------------------------------------------------------

test('nothing added in O04 crosses between institutions', async () => {
  const reads = [
    '/api/onyx/banks/' + w.bank + '/questions',
    '/api/onyx/assessments/' + w.assessment,
    '/api/onyx/assessments/' + w.assessment + '/marking',
    '/api/onyx/assessments/' + w.assessment + '/results',
    '/api/onyx/assessments/' + w.assessment + '/items',
    '/api/onyx/attempts/' + w.attempt1,
    '/api/onyx/attempts/' + w.attempt1 + '/paper',
    '/api/onyx/attempts/' + w.attempt1 + '/proctor',
    '/api/onyx/courses/' + w.course + '/benchmark',
  ];
  for (const path of reads) {
    const res = await api(path, { token: w.beta.admin });
    assert.ok(res.status === 404 || res.status === 403,
      'beta reached ' + path + ' (' + res.status + ')');
  }

  const writes: [string, unknown][] = [
    ['/api/onyx/banks/' + w.bank + '/questions', { prompt: 'theirs', type: 'essay' }],
    ['/api/onyx/assessments/' + w.assessment + '/publish', {}],
    ['/api/onyx/assessments/' + w.assessment + '/start', { consent: true }],
    ['/api/onyx/attempts/' + w.attempt1 + '/answer', { question_id: w.q.single, response: 'b' }],
    ['/api/onyx/attempts/' + w.attempt1 + '/mark', { marks: [{ question_id: w.q.essay, points: 5 }] }],
    ['/api/onyx/attempts/' + w.attempt1 + '/proctor', { kind: 'paste' }],
    ['/api/onyx/assessments/' + w.assessment + '/results/publish', {}],
  ];
  for (const [path, body] of writes) {
    const res = await api(path, { token: w.beta.admin, body });
    assert.ok(res.status === 404 || res.status === 403,
      'beta wrote to ' + path + ' (' + res.status + ')');
  }

  // And the CSV is not a way round any of it.
  const csv = await fetch((await import('./harness.ts')).API
    + '/api/onyx/assessments/' + w.assessment + '/results.csv',
  { headers: { Authorization: 'Bearer ' + w.beta.admin } });
  const body = await csv.text();
  assert.equal(body.includes(mail('s1')), false, 'the CSV leaked another institution');
});

test('RLS confines the O04 tables at the database', async () => {
  for (const k of ['SUPABASE_URL', 'SUPABASE_ANON_KEY']) {
    const { env } = await import('./harness.ts');
    process.env[k] ??= env[k];
  }
  const { onyxTenantClient } = await import('@onyx/core');
  const candidate = onyxTenantClient(w.alpha.s1);
  const rival = onyxTenantClient(w.beta.admin);

  // A published assessment is visible inside the institution, and nowhere else.
  const { data: mine } = await candidate.from('onyx_assessments').select('id, tenant_id');
  assert.ok(mine!.length > 0, 'RLS hid the caller\'s own assessments');
  for (const a of mine!) assert.equal(Number(a.tenant_id), w.alpha.id);
  assert.equal((await rival.from('onyx_assessments').select('id')).data?.length ?? 0, 0);

  // The answer key, the mark sheet, the proctor log and the grades have no read
  // policy at all.
  for (const table of ['onyx_questions', 'onyx_question_versions', 'onyx_question_banks',
    'onyx_assessment_answers', 'onyx_proctor_events', 'onyx_assessment_grades'] as const) {
    const { data } = await candidate.from(table).select('id');
    assert.equal(data?.length ?? 0, 0, table + ' is readable through PostgREST');
  }

  // An attempt is the candidate's own.
  const { data: attempts } = await candidate.from('onyx_assessment_attempts').select('user_id');
  for (const a of attempts!) assert.equal(a.user_id, w.ids.s1);
  assert.equal((await onyxTenantClient(w.alpha.s2)
    .from('onyx_assessment_attempts').select('id')).data
    ?.some((a) => Number(a.id) === w.attempt1) ?? false, false,
  'one candidate read another\'s attempt');

  // ...but the paper on it carries no key, so reading your own gives nothing away.
  const { data: own } = await candidate.from('onyx_assessment_attempts').select('paper');
  assert.equal(JSON.stringify(own).includes(SECRET_ANSWER), false,
    'the answer key is reachable through the attempt row');

  const { error } = await candidate.from('onyx_assessment_answers')
    .insert({ tenant_id: w.alpha.id, attempt_id: w.attempt1, question_id: w.q.single, version: 1 });
  assert.ok(error, 'a candidate wrote their own answer row directly');
});

test('every O04 table is tenant-scoped, and cleanup leaves nothing behind', async () => {
  await withDb(async (c) => {
    const { rows: missing } = await c.query('SELECT * FROM onyx.assert_tenant_scoped()');
    assert.equal(missing.length, 0,
      'Onyx tables with no tenant_id: ' + missing.map((r) => r.missing).join(', '));

    await c.query('DELETE FROM public."onyx_tenants" WHERE slug = ANY($1)', [[A.slug, B.slug]]);
    await c.query('DELETE FROM public."onyx_users" WHERE email LIKE $1', ['ex.%.' + RUN + '@onyx.test']);

    for (const table of [
      'onyx_question_banks', 'onyx_questions', 'onyx_question_versions',
      'onyx_assessments', 'onyx_assessment_attempts', 'onyx_assessment_answers',
      'onyx_proctor_events', 'onyx_assessment_grades',
    ]) {
      const { rows: [left] } = await c.query(
        'SELECT count(*)::int c FROM public."' + table + '" t '
        + 'LEFT JOIN public."onyx_tenants" n ON n.id = t.tenant_id WHERE n.id IS NULL');
      assert.equal(left.c, 0, table + ' outlived its institution');
    }
  });
});
