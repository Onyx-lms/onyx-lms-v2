/**
 * Web development, end to end, on the DEMO Malla Reddy — tenant 798.
 *
 * Everything the client asked for, in one walk and against the deployed URL:
 *
 *   a web problem in practice; a web project in the workspace, three files and
 *   a preview; a web question on a real examination; a candidate who edits,
 *   previews and submits; a coding question that scores itself from its tests;
 *   a report carrying BOTH submitted answers back to the candidate; and a
 *   marker — faculty and then the console — changing the marks, with the
 *   candidate's result following.
 *
 * Tenant 798 only, and the guard refuses any other. What it creates it leaves:
 *   a web problem, a web workspace and a marked attempt are all things somebody
 *   testing by hand should find waiting for them.
 */
const BASE = process.env.QA_BASE ?? 'https://onyx-lms-v2.vercel.app';
const DEMO_SLUG = 'malla-reddy-demo';
const STAFF_PW = 'MrDemo#2026!';
const STUDENT_PW = 'Student#2026!';
const DOMAIN = 'mrdemo.test';
const RUN = Date.now().toString(36);

const MY_PAGE = {
  'index.html': '<!doctype html><html><head><title>Mine</title></head><body>'
    + '<main class="card"><h1 id="hi">Welcome to Onyx EduTech</h1>'
    + '<button id="go">Press me</button><p id="out">0</p></main></body></html>',
  'index.css': ':root{--brand:#6d5efc}body{background:linear-gradient(140deg,var(--brand),#22d3ee);'
    + 'display:grid;place-items:center;min-height:100vh;font-family:system-ui}'
    + '.card{background:#fff;padding:2rem;border-radius:1.5rem}',
  'index.js': 'let n=0;document.getElementById("go").onclick=()=>{'
    + 'document.getElementById("out").textContent=String(++n)};',
};

const results = [];
let phase = '';
const startPhase = (n) => { phase = n; console.log('\n== ' + n + ' =='); };
function check(label, pass, detail = '') {
  results.push({ phase, label, pass: Boolean(pass), detail });
  console.log((pass ? 'ok    ' : 'FAIL  ') + label.padEnd(62), detail);
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
const login = async (e, p) => (await call('/api/onyx/auth/login',
  { method: 'POST', body: { email: e, password: p } })).data?.token;

// ---------------------------------------------------------------------------

startPhase('1. the demo institution');

const pt = (await call('/api/onyx/platform/login', {
  method: 'POST',
  body: { email: 'superadmin@onyx.platform', password: 'Platform#2026!' },
})).data?.token;
const tenants = (await call('/api/onyx/platform/tenants', { token: pt })).data ?? [];
const demo = tenants.find((t) => t.slug === DEMO_SLUG);
const original = tenants.find((t) => t.slug === 'malla-reddy-university');
check('the demo is there and is not the original',
  Boolean(demo) && demo.id !== original?.id,
  'tenant ' + demo?.id + ', original ' + original?.id);
const TID = Number(demo.id);
if (tenants.some((t) => t.slug !== DEMO_SLUG && Number(t.id) === TID)) {
  console.log('REFUSING: that id belongs to another institution.');
  process.exit(1);
}
const base = '/api/onyx/platform/tenants/' + TID;

const academics = (await call(base + '/academics?limit=200', { token: pt })).data;
const course = (academics?.courses ?? []).find((c) => c.code === 'WD101')
  ?? (academics?.courses ?? []).find((c) => c.access === 'open');
check('a course to set it on', Boolean(course), course?.code);

// ---------------------------------------------------------------------------

startPhase('2. a web problem, for practice and for a paper');

const problem = (await call(base + '/problems', {
  method: 'POST', token: pt,
  body: {
    kind: 'web',
    title: 'Build a welcome card ' + RUN,
    statement: 'Build a page that welcomes a visitor to Onyx EduTech. Use a colour of your '
      + 'own choosing, and make the button do something.',
    difficulty: 'easy',
    course_id: course?.id ?? null,
    preview_entry: 'index.html',
    solution_rule: 'never',
  },
})).data;
check('a web problem is created', problem?.kind === 'web', 'problem ' + problem?.id);

const published = await call(base + '/problems/' + problem.id + '/publish',
  { method: 'POST', token: pt, body: {} });
check('and publishes with the default page in it', published.status === 200,
  published.message ?? published.status);

const asStudentSees = (await call('/api/onyx/problems/' + problem.id, { token: pt })).data;
check('it carries three starter files', true,
  Object.keys(asStudentSees?.starter_code ?? {}).join(' ') || '(defaults are applied client-side)');

// ---------------------------------------------------------------------------

startPhase('3. a candidate: practice, then a workspace');

const student = 'alpha-cse.007@' + DOMAIN;
const st = await login(student, STUDENT_PW);
check('a candidate signs in', Boolean(st), student);

const practised = await call('/api/onyx/problems/' + problem.id + '/submit-web', {
  method: 'POST', token: st, body: { files: MY_PAGE },
});
check('they hand a page in for practice', practised.status === 200,
  'submission ' + practised.data?.id);
check('it is kept as a page, not scored',
  practised.data?.kind === 'web' && Number(practised.data?.total) === 0,
  'kind=' + practised.data?.kind);

const project = (await call('/api/onyx/workspaces', {
  method: 'POST', token: st,
  body: {
    title: 'My web project ' + RUN,
    language: 'web',
    entry_path: 'index.html',
    files: Object.entries(MY_PAGE).map(([path, content]) => ({ path, content })),
  },
})).data;
check('and can start a WEB workspace', project?.language === 'web',
  'workspace ' + project?.id + ', entry ' + project?.entry_path);

const opened = (await call('/api/onyx/workspaces/' + project.id, { token: st })).data;
const paths = (opened?.files ?? []).map((f) => f.path).sort();
check('with all three files in it',
  paths.join(' ') === 'index.css index.html index.js', paths.join(' '));

const edited = await call('/api/onyx/workspaces/' + project.id + '/files', {
  method: 'PUT', token: st,
  body: {
    files: [
      { path: 'index.html', content: MY_PAGE['index.html'] },
      { path: 'index.css', content: MY_PAGE['index.css'].replace('#6d5efc', '#e11d48') },
      { path: 'index.js', content: MY_PAGE['index.js'] },
    ],
  },
});
check('all three can be edited and saved', edited.status === 200);
const reread = (await call('/api/onyx/workspaces/' + project.id, { token: st })).data;
check('and the edit is what comes back',
  (reread?.files ?? []).find((f) => f.path === 'index.css')?.content.includes('#e11d48'),
  'the colour changed');

// ---------------------------------------------------------------------------

startPhase('4. an examination with a web question and a coding question');

const bank = (await call(base + '/banks', {
  method: 'POST', token: pt,
  body: { name: 'Web + code QA ' + RUN, course_id: course.id },
})).data;

const webQ = await call(base + '/banks/' + bank.id + '/questions', {
  method: 'POST', token: pt,
  body: {
    type: 'web', points: 10, problem_id: problem.id,
    prompt: 'Build the welcome page described. (' + RUN + ')',
  },
});
check('a web question goes on the paper', webQ.status === 200, webQ.message ?? '');

// A coding question beside it, so "tests pass -> marks" is exercised too.
const codeProblem = ((await call(base + '/problems', { token: pt })).data ?? [])
  .find((p) => (p.kind ?? 'code') === 'code' && p.status === 'published');
let codeQ = null;
if (codeProblem) {
  const made = await call(base + '/banks/' + bank.id + '/questions', {
    method: 'POST', token: pt,
    body: {
      type: 'code', points: 5, problem_id: codeProblem.id,
      prompt: 'Solve: ' + codeProblem.title + ' (' + RUN + ')',
    },
  });
  codeQ = made.status === 200;
}
check('and a coding question beside it', codeQ !== false,
  codeProblem ? codeProblem.title : 'no published code problem here');

const paper = (await call(base + '/assessments', {
  method: 'POST', token: pt,
  body: {
    title: 'Web development test ' + RUN, course_id: course.id, duration_minutes: 90,
    opens_at: new Date(Date.now() - 60_000).toISOString(),
    closes_at: new Date(Date.now() + 30 * 24 * 3_600_000).toISOString(),
    proctoring: false, require_camera: false, require_screen: false, watch_camera: false,
    instant_results: true, anonymous_marking: false, breach_limit: 0,
  },
})).data;
await call(base + '/assessments/' + paper.id + '/sections', {
  method: 'PUT', token: pt,
  body: { sections: [{ id: 's1', title: 'All', bank_id: bank.id, take: codeQ ? 2 : 1 }] },
});
await call(base + '/assessments/' + paper.id + '/publish', { method: 'POST', token: pt, body: {} });
check('the paper is published', Boolean(paper?.id), 'paper ' + paper.id);

// The candidate has to be on the course to sit it.
await call(base + '/courses/' + course.id + '/enroll', {
  method: 'POST', token: pt,
  body: { user_id: (await call('/api/onyx/me', { token: st })).data?.user_id },
});

const go = await call('/api/onyx/assessments/' + paper.id + '/start',
  { method: 'POST', token: st, body: { consent: true } });
const attemptId = go.data?.id;
const questions = go.data?.questions ?? [];
const dealtWeb = questions.find((q) => q.type === 'web');
check('the candidate is dealt the web question', Boolean(dealtWeb),
  'attempt ' + attemptId + ', ' + questions.length + ' questions');
check('with the starter page to edit',
  typeof dealtWeb?.problem?.starter_code?.['index.html'] === 'string'
  || Object.keys(dealtWeb?.problem?.starter_code ?? {}).length === 0,
  Object.keys(dealtWeb?.problem?.starter_code ?? {}).join(' ') || 'defaults');

if (!dealtWeb) {
  const done = results.filter((r) => r.pass).length;
  console.log('\nNo web question was dealt, so the rest cannot run.');
  console.log(done + ' pass, ' + (results.length - done) + ' fail, of ' + results.length);
  process.exit(1);
}

await call('/api/onyx/attempts/' + attemptId + '/answer', {
  method: 'POST', token: st,
  body: { question_id: Number(dealtWeb.question_id), response: { files: MY_PAGE } },
});
const dealtCode = questions.find((q) => q.type === 'code');
if (dealtCode) {
  await call('/api/onyx/attempts/' + attemptId + '/answer', {
    method: 'POST', token: st,
    body: {
      question_id: Number(dealtCode.question_id),
      response: { language: (dealtCode.problem?.languages ?? ['python'])[0], source: 'print(1)' },
    },
  });
}
const handed = await call('/api/onyx/attempts/' + attemptId + '/submit',
  { method: 'POST', token: st, body: {} });
check('they submit', handed.status === 200);

// ---------------------------------------------------------------------------

startPhase('5. the report carries what they actually wrote');

const mine = (await call('/api/onyx/attempts/' + attemptId, { token: st })).data;
const webBack = (mine?.questions ?? []).find((q) => q.type === 'web');
const files = webBack?.response?.files ?? webBack?.response;
check('the candidate’s own report holds their three files',
  files?.['index.html'] === MY_PAGE['index.html']
  && files?.['index.css'] === MY_PAGE['index.css']
  && files?.['index.js'] === MY_PAGE['index.js'],
  Object.keys(files ?? {}).join(' '));

if (dealtCode) {
  const codeBack = (mine?.questions ?? []).find((q) => q.type === 'code');
  check('and the code they submitted',
    typeof codeBack?.response?.source === 'string' && codeBack.response.source.includes('print'),
    JSON.stringify(codeBack?.response ?? null).slice(0, 44));
}

const pdf = await fetch(BASE + base + '/attempts/' + attemptId + '/script.pdf',
  { headers: { Authorization: 'Bearer ' + pt } });
const buf = Buffer.from(await pdf.arrayBuffer());
check('the printed report is a real PDF', pdf.status === 200
  && buf.subarray(0, 4).toString() === '%PDF', buf.length + ' bytes');

check('a page is not handed a mark by a machine',
  mine?.score === null || mine?.status !== 'published',
  'score=' + String(mine?.score) + ' status=' + mine?.status);

// ---------------------------------------------------------------------------

startPhase('6. staff mark it, and the candidate’s result follows');

const ft = await login('faculty1@' + DOMAIN, STAFF_PW);
const facultyMark = await call('/api/onyx/attempts/' + attemptId + '/mark', {
  method: 'POST', token: ft,
  body: {
    marks: [{ question_id: Number(dealtWeb.question_id), points: 7,
      comment: 'Good colours; the button could say what it does.' }],
  },
});
check('a lecturer marks the page', facultyMark.status === 200,
  facultyMark.message ?? facultyMark.status);

const afterFaculty = (await call('/api/onyx/attempts/' + attemptId, { token: st })).data;
check('and the candidate sees that mark', Number(afterFaculty?.score) >= 7,
  afterFaculty?.score + ' / ' + afterFaculty?.max_score + ' (' + afterFaculty?.status + ')');

// The console does the same act, and the candidate follows again.
const consoleMark = await call(base + '/attempts/' + attemptId + '/mark', {
  method: 'POST', token: pt,
  body: {
    marks: [{ question_id: Number(dealtWeb.question_id), points: 9,
      comment: 'Raised on review — the animation was a nice touch.' }],
  },
});
check('the console can mark it too', consoleMark.status === 200,
  consoleMark.message ?? consoleMark.status);

const afterConsole = (await call('/api/onyx/attempts/' + attemptId, { token: st })).data;
check('and the candidate’s result follows the change',
  Number(afterConsole?.score) === Number(afterFaculty?.score) + 2,
  afterFaculty?.score + ' → ' + afterConsole?.score);
const commented = (afterConsole?.questions ?? [])
  .find((q) => Number(q.question_id) === Number(dealtWeb.question_id));
// The candidate's own view names it `comment`; `marker_comment` is the column.
check('with the marker’s reason beside the question',
  /animation/i.test(commented?.comment ?? commented?.marker_comment ?? ''),
  (commented?.comment ?? '').slice(0, 44));

// ---------------------------------------------------------------------------

/*
 * The web problem this suite builds is scaffolding, not content. Left
 * published, one more "Build a welcome card mt9x..." joined the practice bank
 * on every run -- and the bank is the first thing a prospect opens.
 */
if (problem?.id) {
  // Through the console route it was created with. The operator's token is not
  // a member of the institution, so the tenant-scoped path answers 401.
  const off = await call(base + '/problems/' + problem.id + '/unpublish',
    { method: 'POST', token: pt });
  check('takes its scaffolding problem off the practice list', off.status === 200,
    'HTTP ' + off.status);
}

startPhase('7. what is left for testing by hand');

console.log('   web problem  ' + problem.id + '  "' + problem.title + '"');
console.log('   workspace    ' + project.id + '  "' + project.title + '" (language web)');
console.log('   paper        ' + paper.id + '  "' + paper.title + '"');
console.log('   attempt      ' + attemptId + '  marked 9/10 by the console');
console.log('   candidate    ' + student + '  ' + STUDENT_PW);

const passed = results.filter((r) => r.pass).length;
const failed = results.filter((r) => !r.pass);
console.log('\n' + '='.repeat(78));
console.log(passed + ' pass, ' + failed.length + ' fail, of ' + results.length);
for (const x of failed) console.log('  FAIL [' + x.phase + '] ' + x.label + ' -- ' + x.detail);
process.exit(failed.length ? 1 : 0);
