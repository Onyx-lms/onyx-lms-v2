/**
 * The code a candidate wrote, and whether anybody can read it back.
 *
 * A web question is answered by editing three files; a coding one by writing a
 * program. Both are marked by a person, so "was it saved" is not the whole
 * question -- the person doing the marking has to be able to SEE what was
 * written, character for character, and so does an administrator asked about
 * it afterwards and an operator asked about it after that.
 *
 * So this writes code nobody else would write, hands it in, and then looks for
 * that exact text on every screen that claims to show it.
 *
 *   node --env-file=.env qa-live/code-is-kept.mjs
 */
const BASE = process.env.QA_BASE ?? 'https://onyx-lms-v2.vercel.app';
const TENANT = 798;

const results = [];
const check = (label, pass, detail = '') => {
  results.push({ label, pass, detail });
  console.log((pass ? 'ok    ' : 'FAIL  ') + label.padEnd(58), detail);
};
const login = async (email, password, path = '/api/onyx/auth/login') =>
  (await (await fetch(BASE + path, { method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }) })).json())?.data?.token;
const call = async (path, tok, body, method = 'GET') => {
  const r = await fetch(BASE + path, { method,
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok },
    body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) };
};

/*
 * A fingerprint nothing else in the product would produce.
 *
 * Asserting "the files came back" is weaker than it looks -- the STARTER files
 * come back too, and they are what a screen shows when the candidate's own
 * answer was never stored. Text only this run could have written is what tells
 * those two apart.
 */
const tag = 'MARK-' + Math.random().toString(36).slice(2, 8).toUpperCase();
const HTML = '<h1 id="t">' + tag + '</h1><button id="go">Count</button><p id="out">0</p>';
const CSS = '#t{color:#0a7}/* ' + tag + ' */';
const JS = 'document.getElementById("go").onclick=()=>{/* ' + tag + ' */};';
const SOURCE = '# ' + tag + '\nprint(sum(int(x) for x in input().split()))';

const student = await login('alpha-cse.003@mrdemo.test', 'Student#2026!');
const faculty = await login('faculty1@mrdemo.test', 'MrDemo#2026!');
const admin = await login('admin@mrdemo.test', 'MrDemo#2026!');
const ops = await login('superadmin@onyx.platform', 'Platform#2026!', '/api/onyx/platform/login');
check('everyone signs in', !!student && !!faculty && !!admin && !!ops);

/*
 * Enrolled first, because a paper refuses a candidate who is not.
 *
 * The web-development papers sit on WD101 and this learner reads PY122, so
 * every `start` came back "You are not enrolled in this course" -- a correct
 * refusal that reads, from a suite, as "no such paper exists". Enrolled here
 * and withdrawn at the end, so the demo's counts are as they were found.
 */
const me = (await call('/api/onyx/me', student)).body?.data;
const catalogue = (await call('/api/onyx/courses?all=1', faculty)).body?.data ?? [];
const wd = catalogue.find((c) => c.code === 'WD101');
const joined = await call('/api/onyx/courses/' + wd.id + '/enroll', admin,
  { user_id: me.user_id }, 'POST');
/*
 * Already enrolled is success, not failure. An earlier run that fell over
 * before its withdraw step leaves the candidate on the roster, and a suite
 * that then refuses to start is a suite that stays broken until somebody
 * unpicks the demo by hand. Only withdraw at the end if THIS run enrolled.
 */
const alreadyOn = joined.status === 409 || joined.status === 422;
check('the candidate is enrolled where the paper lives',
  joined.status === 200 || alreadyOn,
  wd.code + ' — HTTP ' + joined.status + (alreadyOn ? ' (already on the roster)' : ''));

// --- find a published paper carrying both kinds of question ----------------
const papers = (await call('/api/onyx/assessments', faculty)).body?.data ?? [];
let paper = null; let dealt = null; let attemptId = null;
/*
 * Every published paper, not the first twelve.
 *
 * Each run of this suite spends one of the candidate's attempts, and the demo
 * gains a fresh "Web development test" paper from the web-demo suite every
 * time it runs. Eventually all twelve papers in the window were exhausted for
 * this candidate and the suite reported "none found" -- which reads as "the
 * product cannot do this" when it means "this account has sat them all".
 */
for (const p of papers.filter((x) => x.status === 'published')) {
  const started = await call('/api/onyx/assessments/' + p.id + '/start', student, {}, 'POST');
  if (started.status !== 200) continue;
  const qs = started.body?.data?.questions ?? [];
  if (qs.some((q) => q.type === 'web') && qs.some((q) => q.type === 'code')) {
    paper = p; dealt = qs; attemptId = started.body?.data?.id; break;
  }
}
check('a paper with both a web and a coding question', !!paper,
  paper ? paper.title + ' (attempt ' + attemptId + ')'
    : 'none of the ' + papers.filter((x) => x.status === 'published').length
      + ' published papers would start for this candidate');
if (!paper) process.exit(1);

// --- the candidate writes, and hands in ------------------------------------
const web = dealt.find((q) => q.type === 'web');
const code = dealt.find((q) => q.type === 'code');
const a1 = await call('/api/onyx/attempts/' + attemptId + '/answer', student, {
  question_id: web.question_id ?? web.id,
  response: { files: { 'index.html': HTML, 'index.css': CSS, 'index.js': JS } },
}, 'POST');
const a2 = await call('/api/onyx/attempts/' + attemptId + '/answer', student, {
  question_id: code.question_id ?? code.id,
  response: { source: SOURCE, language: 'python' },
}, 'POST');
check('they write into all three files, and a program', a1.status === 200 && a2.status === 200,
  'HTTP ' + a1.status + ' / ' + a2.status);

const handed = await call('/api/onyx/attempts/' + attemptId + '/submit', student, {}, 'POST');
check('and hand in', handed.status === 200, 'HTTP ' + handed.status);

/** Is every distinctive string in this blob? */
const holds = (blob) => {
  const t = JSON.stringify(blob ?? '');
  return {
    html: t.includes(tag) && t.includes('Count'),
    css: t.includes('#t{color:#0a7}'),
    js: t.includes('onclick'),
    source: t.includes('sum(int(x)'),
  };
};

/*
 * --- the candidate's own report -------------------------------------------
 *
 * `/attempts/:id`, not `/review`. There is no review route -- an earlier
 * version of this file invented one, got a truthful 404, and reported it as
 * "the candidate cannot read their own answers back", which would have been a
 * serious defect if it had been true. The 404 was the harness.
 */
const own = await call('/api/onyx/attempts/' + attemptId, student);
const o = holds(own.body?.data);
check('the candidate reads their own three files back', o.html && o.css && o.js,
  JSON.stringify(o));
check('  and their program', o.source);

// --- the lecturer -----------------------------------------------------------
const facPaper = await call('/api/onyx/attempts/' + attemptId + '/paper', faculty);
const f = holds(facPaper.body?.data);
check('the lecturer sees the three files as written', f.html && f.css && f.js,
  'HTTP ' + facPaper.status + ' ' + JSON.stringify(f));
check('  and the program as written', f.source);

// --- the administrator ------------------------------------------------------
const admPaper = await call('/api/onyx/attempts/' + attemptId + '/paper', admin);
const ad = holds(admPaper.body?.data);
check('the administrator sees the same', ad.html && ad.css && ad.js && ad.source,
  'HTTP ' + admPaper.status + ' ' + JSON.stringify(ad));

// --- the operator -----------------------------------------------------------
const opsPaper = await call(
  '/api/onyx/platform/tenants/' + TENANT + '/attempts/' + attemptId, ops);
const op = holds(opsPaper.body?.data);
check('the operator sees the same from the console',
  op.html && op.css && op.js && op.source,
  'HTTP ' + opsPaper.status + ' ' + JSON.stringify(op));

// --- and the printed script -------------------------------------------------
const pdf = await fetch(BASE + '/api/onyx/attempts/' + attemptId + '/marker-script.pdf',
  { headers: { Authorization: 'Bearer ' + faculty } });
const bytes = Number((await pdf.arrayBuffer().catch(() => new ArrayBuffer(0))).byteLength);
check('the script prints as a real PDF',
  pdf.status === 200 && (pdf.headers.get('content-type') ?? '').includes('pdf') && bytes > 2000,
  pdf.status + ' · ' + (pdf.headers.get('content-type') ?? '?') + ' · ' + bytes + ' bytes');

// --- and the course is left as it was found --------------------------------
if (joined.status === 200) {
  const off = await call('/api/onyx/courses/' + wd.id + '/enroll/' + me.user_id,
    admin, undefined, 'DELETE');
  check('the enrolment it made is withdrawn again', off.status === 200, 'HTTP ' + off.status);
}

const failed = results.filter((r) => !r.pass);
console.log('\n' + '='.repeat(78));
console.log(results.filter((r) => r.pass).length + ' pass, ' + failed.length + ' fail');
for (const f2 of failed) console.log('  FAIL ' + f2.label + ' -- ' + f2.detail);
process.exit(failed.length ? 1 : 0);
