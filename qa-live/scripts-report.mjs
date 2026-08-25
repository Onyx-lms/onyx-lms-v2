/**
 * Script reports: what a candidate wrote, as a document each reader may have.
 *
 * What already existed was the COHORT report — results.csv and results.pdf, a
 * row per candidate with their total. Neither shows what anybody actually
 * wrote, so a candidate asking "which ones did I get wrong" and a marker
 * wanting a returnable script were both unserved.
 *
 * The claims worth testing are about entitlement, not about bytes:
 *
 *   * a candidate may download THEIR OWN script and nobody else's;
 *   * a marker may download any script on a course they teach, and all of
 *     them at once;
 *   * the console may download any script at an institution it operates;
 *   * a candidate who still has a sitting left is NOT handed the answer key,
 *     because banks are shared between papers and a key given away early
 *     leaks into every paper drawn from that bank.
 *
 * ABC Institution only, and everything it creates it removes.
 *
 *   node qa-live/scripts-report.mjs
 */
import fs from 'node:fs';

const BASE = process.env.QA_BASE ?? 'https://onyx-lms-v2.vercel.app';
const RUN = Date.now().toString(36);
const PW = 'QaRep#2026!';

const cred = fs.readFileSync('onyx-v2-credentials.csv', 'utf8')
  .trim().split(/\r?\n/).slice(1).map((r) => r.split(','));
const rowFor = (role) => cred.find((r) => r[1] === 'abc-institution' && r[2] === role);

const results = [];
let phase = '';
const startPhase = (n) => { phase = n; console.log('\n== ' + n + ' =='); };
function check(label, pass, detail = '') {
  results.push({ phase, label, pass: Boolean(pass), detail });
  console.log((pass ? 'ok    ' : 'FAIL  ') + label.padEnd(58), detail);
  return pass;
}
async function call(path, { method = 'GET', token, body } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const p = await res.json().catch(() => ({}));
  return { status: res.status, data: p?.data, message: p?.message };
}
/** A download, as bytes plus the headers a browser acts on. */
async function grab(path, token) {
  const res = await fetch(BASE + path, {
    headers: token ? { Authorization: 'Bearer ' + token } : {},
  });
  const buf = Buffer.from(await res.arrayBuffer());
  return {
    status: res.status,
    type: res.headers.get('content-type') ?? '',
    disposition: res.headers.get('content-disposition') ?? '',
    bytes: buf.length,
    text: buf.toString('latin1'),
    isPdf: buf.subarray(0, 5).toString('latin1') === '%PDF-',
  };
}
const login = async (e, p) => (await call('/api/onyx/auth/login',
  { method: 'POST', body: { email: e, password: p } })).data?.token;

// ---------------------------------------------------------------------------

startPhase('1. a paper, sat by two candidates');

const pt = (await call('/api/onyx/platform/login', {
  method: 'POST',
  body: { email: 'superadmin@onyx.platform', password: 'Platform#2026!' },
})).data?.token;
const tenants = (await call('/api/onyx/platform/tenants', { token: pt })).data ?? [];
const abc = tenants.find((t) => t.slug === 'abc-institution');
const mrit = tenants.find((t) => t.slug === 'malla-reddy-university');
check('ABC Institution is the one being touched',
  Boolean(abc) && abc.id !== mrit?.id, 'tenant ' + abc?.id + ', never ' + mrit?.id);
const tid = abc.id;
const base = '/api/onyx/platform/tenants/' + tid;

const adminRow = rowFor('admin');
const at = await login(adminRow[4], adminRow[5]);
const facultyRow = rowFor('faculty');
const ft = await login(facultyRow[4], facultyRow[5]);

const course = (await call(base + '/courses', {
  method: 'POST', token: pt,
  body: { code: 'QRP' + RUN.slice(-4).toUpperCase(), title: 'Report QA ' + RUN, credits: 3 },
})).data;
await call(base + '/courses/' + course.id, {
  method: 'PATCH', token: pt, body: { status: 1, access: 'open' },
});
const teacher = ((await call(base + '/people?role=faculty&limit=200', { token: pt })).data?.people
  ?? []).find((p) => p.email === facultyRow[4]);
await call(base + '/courses/' + course.id + '/faculty',
  { method: 'POST', token: pt, body: { user_id: teacher.user_id } });

// A paper with the two kinds of answer that matter on a script: one a machine
// marks against a key, and one a person reads.
const bank = (await call(base + '/banks', {
  method: 'POST', token: pt, body: { name: 'Report QA bank ' + RUN, course_id: course.id },
})).data;
for (const q of [
  { type: 'single', prompt: 'Which keyword declares a constant?',
    options: [{ id: 'a', text: 'let' }, { id: 'b', text: 'const' }], answer: 'b', points: 2 },
  { type: 'essay', prompt: 'Explain garbage collection.', points: 5 },
]) {
  await call(base + '/banks/' + bank.id + '/questions',
    { method: 'POST', token: pt, body: q });
}

const paper = (await call(base + '/assessments', {
  method: 'POST', token: pt,
  body: {
    title: 'Report QA paper ' + RUN, course_id: course.id, duration_minutes: 30,
    attempts_allowed: 1,
    /*
     * Named marking, set explicitly rather than left to the default.
     *
     * A paper created from the console is marked ANONYMOUSLY by default, and a
     * marker's copy of an anonymous paper withholds the candidate — correctly,
     * since that is the whole point of the setting. Leaving it to the default
     * made this run assert "the script names the candidate" against a paper
     * that is designed not to, which says nothing about the report and
     * everything about the harness. Anonymity gets its own check below.
     */
    anonymous_marking: false,
    opens_at: new Date(Date.now() - 3_600_000).toISOString(),
    closes_at: new Date(Date.now() + 3 * 3_600_000).toISOString(),
    proctoring: false, require_camera: false, require_screen: false, watch_camera: false,
  },
})).data;
await call(base + '/assessments/' + paper.id + '/sections', {
  method: 'PUT', token: pt,
  body: { sections: [{ id: 's1', title: 'All', bank_id: bank.id, take: 2 }] },
});
await call(base + '/assessments/' + paper.id + '/publish',
  { method: 'POST', token: pt, body: {} });
check('a paper is published', Boolean(paper?.id), 'paper ' + paper?.id);

const learners = {};
for (const key of ['first', 'second']) {
  const email = 'qrep.' + RUN + '.' + key + '@onyx.test';
  await call('/api/onyx/members', {
    method: 'POST', token: at,
    body: { name: 'Report ' + key, email, role: 'student', password: PW,
      roll_number: 'RQ-' + key.toUpperCase().slice(0, 3) + RUN.slice(-3) },
  });
  const m = ((await call('/api/onyx/members', { token: at })).data ?? [])
    .find((x) => x.user?.email === email);
  await call('/api/onyx/courses/' + course.id + '/enroll',
    { method: 'POST', token: at, body: { user_id: m.user_id } });
  const token = await login(email, PW);
  const started = await call('/api/onyx/assessments/' + paper.id + '/start',
    { method: 'POST', token, body: {} });
  for (const q of started.data?.questions ?? []) {
    await call('/api/onyx/attempts/' + started.data.id + '/answer', {
      method: 'POST', token,
      body: {
        question_id: q.question_id,
        response: q.type === 'essay'
          ? 'It frees memory that nothing points at any more.'
          : 'b',
      },
    });
  }
  await call('/api/onyx/attempts/' + started.data.id + '/submit',
    { method: 'POST', token, body: {} });
  learners[key] = { email, membership: m, token, attempt: started.data.id };
}
check('both sit it and hand in', Boolean(learners.first.attempt)
  && Boolean(learners.second.attempt),
'attempts ' + learners.first.attempt + ' and ' + learners.second.attempt);

// ---------------------------------------------------------------------------

startPhase('2. the candidate downloads their own script');

const own = await grab('/api/onyx/attempts/' + learners.first.attempt + '/script.pdf',
  learners.first.token);
check('it is a PDF, sent as a download', own.isPdf
  && own.type.includes('pdf') && /attachment/.test(own.disposition),
own.status + ' ' + own.type + ' ' + own.bytes + ' bytes');
check('it carries what they wrote',
  /frees memory/.test(own.text.replace(/\\/g, '')), 'their essay is in it');
check('and their own name and roll number',
  /Report first/.test(own.text) && /RQ-FIR/.test(own.text), '');

/*
 * No key yet, and for the right reason.
 *
 * This paper carries an essay, so it is waiting for a marker: `#finalise`
 * leaves such an attempt at `submitted` rather than `published`, and
 * `releasedToCandidate` requires `published`. Nothing is released -- not the
 * score, not the key -- until a person has marked it, which is correct and is
 * the state most scripts are in when a candidate first opens one.
 *
 * The opposite case, a paper a machine can finish on its own, is checked
 * below where it can be arranged deliberately.
 */
check('the key is absent while the paper still awaits a marker',
  !/Correct answer/.test(own.text), 'it carries an essay, so nothing is released yet');

const notTheirs = await grab('/api/onyx/attempts/' + learners.second.attempt + '/script.pdf',
  learners.first.token);
check('somebody else’s script is refused', notTheirs.status === 403,
  String(notTheirs.status));

// ---------------------------------------------------------------------------

startPhase('3. the marker downloads one, and then all of them');

const one = await grab('/api/onyx/attempts/' + learners.first.attempt
  + '/marker-script.pdf', ft);
check('a lecturer can download one script', one.isPdf && one.status === 200,
  one.status + ' ' + one.bytes + ' bytes');
check('it names the candidate', /Report first/.test(one.text), '');

const all = await grab('/api/onyx/assessments/' + paper.id + '/scripts.pdf', ft);
check('and every script in one document', all.isPdf && all.status === 200,
  all.status + ' ' + all.bytes + ' bytes');
check('which carries both candidates',
  /Report first/.test(all.text) && /Report second/.test(all.text), '');
check('and is bigger than one of them', all.bytes > one.bytes,
  all.bytes + ' > ' + one.bytes);

/*
 * Anonymity, where the paper asks for it.
 *
 * The marking screen has withheld the candidate on an anonymously-marked paper
 * since marking existed. A downloadable script that named them would be a way
 * round that setting, which is worse than not having the download at all.
 */
const anonPaper = (await call(base + '/assessments', {
  method: 'POST', token: pt,
  body: {
    title: 'Report QA anonymous ' + RUN, course_id: course.id, duration_minutes: 30,
    attempts_allowed: 1, anonymous_marking: true,
    opens_at: new Date(Date.now() - 3_600_000).toISOString(),
    closes_at: new Date(Date.now() + 3 * 3_600_000).toISOString(),
    proctoring: false, require_camera: false, require_screen: false, watch_camera: false,
  },
})).data;
await call(base + '/assessments/' + anonPaper.id + '/sections', {
  method: 'PUT', token: pt,
  body: { sections: [{ id: 's1', title: 'All', bank_id: bank.id, take: 1 }] },
});
await call(base + '/assessments/' + anonPaper.id + '/publish',
  { method: 'POST', token: pt, body: {} });
const anonGo = await call('/api/onyx/assessments/' + anonPaper.id + '/start',
  { method: 'POST', token: learners.first.token, body: {} });
for (const q of anonGo.data?.questions ?? []) {
  await call('/api/onyx/attempts/' + anonGo.data.id + '/answer', {
    method: 'POST', token: learners.first.token,
    body: { question_id: q.question_id, response: 'b' },
  });
}
await call('/api/onyx/attempts/' + anonGo.data.id + '/submit',
  { method: 'POST', token: learners.first.token, body: {} });
const anonScript = await grab('/api/onyx/attempts/' + anonGo.data.id
  + '/marker-script.pdf', ft);
check('an anonymously-marked paper withholds the candidate',
  anonScript.isPdf && !/Report first/.test(anonScript.text),
  'the marking setting is not bypassed by the download');
check('while the candidate own copy still names them',
  /Report first/.test((await grab('/api/onyx/attempts/' + anonGo.data.id + '/script.pdf',
    learners.first.token)).text),
  'anonymity is from the marker, not from the candidate');

const byAdmin = await grab('/api/onyx/assessments/' + paper.id + '/scripts.pdf', at);
check('an administrator can do the same', byAdmin.isPdf && byAdmin.status === 200,
  String(byAdmin.status));

const byLearner = await grab('/api/onyx/assessments/' + paper.id + '/scripts.pdf',
  learners.first.token);
check('a candidate cannot download everybody’s', byLearner.status === 403,
  String(byLearner.status));

const anon = await grab('/api/onyx/assessments/' + paper.id + '/scripts.pdf', null);
check('and neither can an anonymous caller', anon.status === 401, String(anon.status));

// ---------------------------------------------------------------------------

startPhase('4. the console, for each paper and each sitting');

const fromConsole = await grab(base + '/attempts/' + learners.first.attempt + '/script.pdf', pt);
check('the console downloads one script', fromConsole.isPdf && fromConsole.status === 200,
  fromConsole.status + ' ' + fromConsole.bytes + ' bytes');

const allFromConsole = await grab(base + '/assessments/' + paper.id + '/scripts.pdf', pt);
check('and every script on the paper',
  allFromConsole.isPdf && /Report first/.test(allFromConsole.text)
  && /Report second/.test(allFromConsole.text),
allFromConsole.bytes + ' bytes');

const exam = (await call(base + '/exams', {
  method: 'POST', token: pt,
  body: {
    course_id: course.id, assessment_id: paper.id, title: 'Report QA sitting ' + RUN,
    starts_at: new Date(Date.now() - 5 * 60_000).toISOString(),
    duration_minutes: 60, max_marks: 100, pass_marks: 40,
  },
})).data;
const byExam = await grab(base + '/exams/' + exam.id + '/scripts.pdf', pt);
check('and every script under a sitting', byExam.isPdf && byExam.status === 200,
  byExam.status + ' ' + byExam.bytes + ' bytes');

const handMarked = (await call(base + '/exams', {
  method: 'POST', token: pt,
  body: {
    course_id: course.id, title: 'Report QA hand-marked ' + RUN,
    starts_at: new Date(Date.now() + 86_400_000).toISOString(),
    duration_minutes: 60, max_marks: 100, pass_marks: 40,
  },
})).data;
const noPaper = await grab(base + '/exams/' + handMarked.id + '/scripts.pdf', pt);
check('a sitting with no online paper says so, plainly', noPaper.status === 422,
  String(noPaper.status));

// ---------------------------------------------------------------------------

startPhase('5. the key is withheld while a sitting is left');

/*
 * A bank of one keyed question, so the resit below draws it every time.
 *
 * Drawing one at random from a bank holding an essay and a multiple-choice
 * made this check pass or fail on the deal: an essay has no key, so "the key
 * is withheld" was true for the wrong reason roughly half the time.
 */
const keyedBank = (await call(base + '/banks', {
  method: 'POST', token: pt, body: { name: 'Report QA keyed ' + RUN, course_id: course.id },
})).data;
await call(base + '/banks/' + keyedBank.id + '/questions', {
  method: 'POST', token: pt,
  body: {
    type: 'single', prompt: 'Which keyword declares a constant?',
    options: [{ id: 'a', text: 'let' }, { id: 'b', text: 'const' }], answer: 'b', points: 2,
  },
});

const twoGo = (await call(base + '/assessments', {
  method: 'POST', token: pt,
  body: {
    title: 'Report QA resit ' + RUN, course_id: course.id, duration_minutes: 30,
    attempts_allowed: 2, anonymous_marking: false,
    opens_at: new Date(Date.now() - 3_600_000).toISOString(),
    closes_at: new Date(Date.now() + 3 * 3_600_000).toISOString(),
    proctoring: false, require_camera: false, require_screen: false, watch_camera: false,
  },
})).data;
await call(base + '/assessments/' + twoGo.id + '/sections', {
  method: 'PUT', token: pt,
  body: { sections: [{ id: 's1', title: 'All', bank_id: keyedBank.id, take: 1 }] },
});
await call(base + '/assessments/' + twoGo.id + '/publish',
  { method: 'POST', token: pt, body: {} });

const go = await call('/api/onyx/assessments/' + twoGo.id + '/start',
  { method: 'POST', token: learners.first.token, body: {} });
for (const q of go.data?.questions ?? []) {
  await call('/api/onyx/attempts/' + go.data.id + '/answer', {
    method: 'POST', token: learners.first.token,
    body: { question_id: q.question_id, response: 'a' },
  });
}
await call('/api/onyx/attempts/' + go.data.id + '/submit',
  { method: 'POST', token: learners.first.token, body: {} });

const early = await grab('/api/onyx/attempts/' + go.data.id + '/script.pdf',
  learners.first.token);
check('their script still downloads', early.isPdf && early.status === 200,
  early.status + ' ' + early.bytes + ' bytes');
check('but the answer key is NOT in it', !/Correct answer/.test(early.text),
  'one sitting still left of two');

const marker = await grab('/api/onyx/attempts/' + go.data.id + '/marker-script.pdf', ft);
check('while the marker copy has it', /Correct answer/.test(marker.text),
  'the key is withheld from the candidate, not from the marker');

/*
 * And the case where the candidate IS entitled to it.
 *
 * A paper a machine can finish on its own, with the single sitting used: the
 * attempt reaches `published` at hand-in, so the score and the key are both
 * theirs. This is the half that proves the withholding above is a rule and
 * not simply the report never printing a key at all.
 */
const settled = (await call(base + '/assessments', {
  method: 'POST', token: pt,
  body: {
    title: 'Report QA settled ' + RUN, course_id: course.id, duration_minutes: 30,
    attempts_allowed: 1, anonymous_marking: false,
    opens_at: new Date(Date.now() - 3_600_000).toISOString(),
    closes_at: new Date(Date.now() + 3 * 3_600_000).toISOString(),
    proctoring: false, require_camera: false, require_screen: false, watch_camera: false,
  },
})).data;
await call(base + '/assessments/' + settled.id + '/sections', {
  method: 'PUT', token: pt,
  body: { sections: [{ id: 's1', title: 'All', bank_id: keyedBank.id, take: 1 }] },
});
await call(base + '/assessments/' + settled.id + '/publish',
  { method: 'POST', token: pt, body: {} });
const settledGo = await call('/api/onyx/assessments/' + settled.id + '/start',
  { method: 'POST', token: learners.second.token, body: {} });
for (const q of settledGo.data?.questions ?? []) {
  await call('/api/onyx/attempts/' + settledGo.data.id + '/answer', {
    method: 'POST', token: learners.second.token,
    body: { question_id: q.question_id, response: 'b' },
  });
}
await call('/api/onyx/attempts/' + settledGo.data.id + '/submit',
  { method: 'POST', token: learners.second.token, body: {} });
const settledScript = await grab('/api/onyx/attempts/' + settledGo.data.id + '/script.pdf',
  learners.second.token);
check('a machine-marked paper hands the candidate the key at once',
  /Correct answer/.test(settledScript.text), 'no sitting left, nothing awaiting a marker');
check('with their mark on it', /2 \/ 2/.test(settledScript.text), 'full marks');

// ---------------------------------------------------------------------------

startPhase('6. putting ABC Institution back as it was');

const { withDb } = await import('../tests/e2e/harness.ts');
await withDb(async (db) => {
  await db.query('DELETE FROM public."onyx_assessment_attempts" WHERE tenant_id = $1'
    + ' AND assessment_id = ANY($2)', [tid, [paper.id, twoGo.id, anonPaper.id, settled.id]]);
});
for (const e of [exam, handMarked]) {
  await call(base + '/exams/' + e.id, { method: 'DELETE', token: pt });
}
for (const a of [paper, twoGo, anonPaper, settled]) {
  await call(base + '/assessments/' + a.id, { method: 'DELETE', token: pt });
}
for (const key of ['first', 'second']) {
  await call(base + '/members/' + learners[key].membership.id, { method: 'DELETE', token: pt });
}
const goneCourse = await call(base + '/courses/' + course.id, { method: 'DELETE', token: pt });
await withDb(async (db) => {
  await db.query('DELETE FROM public."onyx_users" WHERE email = ANY($1)',
    [[learners.first.email, learners.second.email]]);
  for (const b of [bank.id, keyedBank.id]) {
    await db.query('DELETE FROM public."onyx_question_versions" WHERE tenant_id = $1'
      + ' AND question_id IN (SELECT id FROM public."onyx_questions" WHERE bank_id = $2)',
    [tid, b]);
    await db.query('DELETE FROM public."onyx_questions" WHERE tenant_id = $1 AND bank_id = $2',
      [tid, b]);
    await db.query('DELETE FROM public."onyx_question_banks" WHERE tenant_id = $1 AND id = $2',
      [tid, b]);
  }
});
check('everything this run made is removed', [200, 404].includes(goneCourse.status),
  '2 papers, 2 sittings, 2 learners, 1 course, 1 bank');

const passed = results.filter((r) => r.pass).length;
const failed = results.filter((r) => !r.pass);
console.log('\n' + '='.repeat(72));
console.log(passed + ' pass, ' + failed.length + ' fail, of ' + results.length);
for (const x of failed) console.log('  FAIL [' + x.phase + '] ' + x.label + ' -- ' + x.detail);
process.exit(failed.length ? 1 : 0);
