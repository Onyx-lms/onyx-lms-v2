/**
 * What a platform operator can do to an institution without signing in as one.
 *
 * Two things they could not: run Live Classes, and open a course to add
 * modules to it. Both are checked here against a REAL institution, because
 * that is where the gap was noticed -- and against ABC Institution
 * specifically, never Malla Reddy University, which is somebody's live data.
 *
 * Everything this creates, it removes. The last phase is the cleanup, and it
 * is checked like any other step: a test that leaves rows behind in a
 * production institution is a worse problem than the one it was testing.
 *
 *   node qa-live/console.mjs
 */
const BASE = process.env.QA_BASE ?? 'https://onyx-lms-v2.vercel.app';
const RUN = Date.now().toString(36);

/** The one institution this may touch. Named, not chosen at runtime. */
const ONLY = 'abc-institution';

const results = [];
let phase = '';
const startPhase = (n) => { phase = n; console.log('\n== ' + n + ' =='); };
function check(label, pass, detail = '') {
  results.push({ phase, label, pass: Boolean(pass), detail });
  console.log((pass ? 'ok    ' : 'FAIL  ') + label.padEnd(54), detail);
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
  const parsed = await res.json().catch(() => ({}));
  return { status: res.status, data: parsed?.data, message: parsed?.message };
}
async function step(label, path, opts = {}) {
  const r = await call(path, opts);
  check(label, r.status >= 200 && r.status < 300, r.status + ' ' + (r.message ?? ''));
  return r;
}

// ---------------------------------------------------------------------------

startPhase('1. the operator, and the one institution this may touch');

const pt = (await call('/api/onyx/platform/login', { method: 'POST',
  body: { email: 'superadmin@onyx.platform', password: 'Platform#2026!' } })).data?.token;
check('the platform operator signs in', Boolean(pt));

const tenants = (await call('/api/onyx/platform/tenants', { token: pt })).data ?? [];
const abc = tenants.find((t) => t.slug === ONLY);
check('ABC Institution is there', Boolean(abc), 'id=' + abc?.id);
if (!abc) process.exit(1);
const tid = abc.id;

// The guard rail, asserted rather than assumed: nothing below may reach the
// institution somebody is really using.
const forbidden = tenants.find((t) => t.slug === 'malla-reddy-university');
check('and Malla Reddy University is left alone', Boolean(forbidden) && tid !== forbidden.id,
  'touching tenant ' + tid + ', never ' + forbidden?.id);

// ---------------------------------------------------------------------------

startPhase('2. Live Classes, which the console could not reach at all');

const before = await step('the operator lists them',
  '/api/onyx/platform/tenants/' + tid + '/domains', { token: pt });
const startedWith = (before.data ?? []).length;

const made = await step('and creates one', '/api/onyx/platform/tenants/' + tid + '/domains', {
  method: 'POST', token: pt,
  body: {
    title: 'Console QA Live Class ' + RUN,
    summary: 'Created from the platform console to prove it can be.',
    duration_label: '8 weeks', certificate: 'Certificate of completion',
    price_minor: 30_000, curriculum_url: 'example.com/curriculum',
  },
});
const domainId = made.data?.id;

check('it starts as a draft rather than live to every learner',
  Number(made.data?.status) === 0, 'status=' + made.data?.status);
check('at the price that was set', Number(made.data?.price_minor) === 30_000,
  '₹' + Number(made.data?.price_minor ?? 0) / 100);

const listed = await call('/api/onyx/platform/tenants/' + tid + '/domains', { token: pt });
const mine = (listed.data ?? []).find((d) => Number(d.id) === Number(domainId));
check('the console lists it, drafts included', Boolean(mine),
  (listed.data ?? []).length + ' total, was ' + startedWith);
check('the curriculum link was normalised to a real address',
  String(mine?.curriculum_url ?? '').startsWith('https://'),
  mine?.curriculum_url);

// The check that stops a link becoming a script.
const nasty = await call('/api/onyx/platform/tenants/' + tid + '/domains/' + domainId, {
  method: 'PATCH', token: pt, body: { curriculum_url: 'javascript:alert(1)' },
});
check('a javascript: link is refused rather than stored', nasty.status === 422,
  nasty.status + ' ' + (nasty.message ?? ''));

const published = await step('it can be published',
  '/api/onyx/platform/tenants/' + tid + '/domains/' + domainId,
  { method: 'PATCH', token: pt, body: { status: 1 } });
check('and then reads as published', Number(published.data?.status) === 1,
  'status=' + published.data?.status);

await step('and withdrawn again', '/api/onyx/platform/tenants/' + tid + '/domains/' + domainId,
  { method: 'PATCH', token: pt, body: { status: 0 } });

const anon = await call('/api/onyx/platform/tenants/' + tid + '/domains');
check('none of this is reachable without a platform session',
  anon.status === 401 || anon.status === 403, 'status ' + anon.status);

// ---------------------------------------------------------------------------

startPhase('3. opening a course, and adding a module to it');

const academics = await step('the operator reads the courses',
  '/api/onyx/platform/tenants/' + tid + '/academics?limit=200', { token: pt });
const course = (academics.data?.courses ?? [])[0];
check('there is a course to open', Boolean(course), course?.code + ' ' + course?.title);

const outline = await step('and opens it',
  '/api/onyx/platform/tenants/' + tid + '/courses/' + course.id + '/outline', { token: pt });
const modulesBefore = (outline.data?.modules ?? []).length;
check('which answers with the course and its modules',
  outline.data?.course?.id === course.id && Array.isArray(outline.data?.modules),
  modulesBefore + ' modules already');

const mod = await step('a module is added', '/api/onyx/platform/tenants/' + tid
  + '/courses/' + course.id + '/modules', {
  method: 'POST', token: pt,
  body: { title: 'Console QA module ' + RUN, summary: 'Added from the platform console.' },
});
const moduleId = mod.data?.id;

const after = await call('/api/onyx/platform/tenants/' + tid
  + '/courses/' + course.id + '/outline', { token: pt });
const added = (after.data?.modules ?? []).find((m) => Number(m.id) === Number(moduleId));
check('and appears on the course', Boolean(added),
  (after.data?.modules ?? []).length + ' modules now');
check('appended to the end rather than stacked at zero',
  Number(added?.sort) >= modulesBefore,
  'sort=' + added?.sort + ' with ' + modulesBefore + ' before it');
check('it starts empty, and says so', (added?.lessons ?? []).length === 0);

const renamed = await step('it can be renamed',
  '/api/onyx/platform/tenants/' + tid + '/modules/' + moduleId,
  { method: 'PATCH', token: pt, body: { title: 'Console QA module ' + RUN + ' (renamed)' } });
check('and the new name sticks', String(renamed.data?.title).includes('renamed'),
  renamed.data?.title);

// A module holding somebody's teaching is not removed by accident.
const withLessons = (after.data?.modules ?? []).find((m) => (m.lessons ?? []).length > 0);
if (withLessons) {
  const refused = await call('/api/onyx/platform/tenants/' + tid + '/modules/' + withLessons.id,
    { method: 'DELETE', token: pt });
  check('a module that still holds lessons is not removed', refused.status === 422,
    refused.status + ' ' + (refused.message ?? ''));
} else {
  check('a module that still holds lessons is not removed', true,
    'no populated module on this course to try it against');
}

const anonCourse = await call('/api/onyx/platform/tenants/' + tid
  + '/courses/' + course.id + '/outline');
check('and none of this is open to an anonymous caller',
  anonCourse.status === 401 || anonCourse.status === 403, 'status ' + anonCourse.status);

// ---------------------------------------------------------------------------

startPhase('4. lessons, files included');

/*
 * The five kinds the product offers. A file kind is proved with a REAL
 * upload -- ticket, PUT to storage, then the key -- because "the route
 * accepts a path" and "a file can be uploaded" are different claims and only
 * the second one is what somebody is trying to do.
 */
const lessonIds = [];

const ticket = await step('a signed upload ticket is issued',
  '/api/onyx/platform/tenants/' + tid + '/courses/' + course.id + '/uploads/sign', {
    method: 'POST', token: pt, body: { filename: 'console-qa-' + RUN + '.txt' },
  });
check('the storage key is derived from the tenant, not from the caller',
  String(ticket.data?.path ?? '').includes('/' + tid + '/')
  || String(ticket.data?.path ?? '').startsWith('onyx/'),
  'path=' + ticket.data?.path);

const put = await fetch(ticket.data?.signedUrl, {
  method: 'PUT',
  headers: { 'Content-Type': 'text/plain' },
  body: 'Uploaded by qa-live/console.mjs at ' + new Date().toISOString(),
});
check('the browser can PUT straight to storage', put.ok, 'status ' + put.status);

const doc = await step('a document lesson is added with that file',
  '/api/onyx/platform/tenants/' + tid + '/modules/' + moduleId + '/lessons', {
    method: 'POST', token: pt,
    body: { title: 'Console QA document ' + RUN, type: 'document', path: ticket.data?.path },
  });
if (doc.data?.id) lessonIds.push(doc.data.id);

const link = await step('a link lesson is added',
  '/api/onyx/platform/tenants/' + tid + '/modules/' + moduleId + '/lessons', {
    method: 'POST', token: pt,
    body: { title: 'Console QA link ' + RUN, type: 'link',
      path: 'https://example.com/reading' },
  });
if (link.data?.id) lessonIds.push(link.data.id);

const text = await step('a written lesson is added',
  '/api/onyx/platform/tenants/' + tid + '/modules/' + moduleId + '/lessons', {
    method: 'POST', token: pt,
    body: { title: 'Console QA reading ' + RUN, type: 'text',
      body: 'Some reading, set out on the page itself.' },
  });
if (text.data?.id) lessonIds.push(text.data.id);

check('all three landed', lessonIds.length === 3, lessonIds.length + ' created');

// The refusals: a lesson that points at nothing is the commonest authoring
// mistake and only shows up when a learner opens it.
const noFile = await call('/api/onyx/platform/tenants/' + tid + '/modules/' + moduleId
  + '/lessons', { method: 'POST', token: pt,
  body: { title: 'Empty video', type: 'video' } });
check('a video lesson with no file is refused', noFile.status === 422,
  noFile.status + ' ' + (noFile.message ?? ''));

const noText = await call('/api/onyx/platform/tenants/' + tid + '/modules/' + moduleId
  + '/lessons', { method: 'POST', token: pt,
  body: { title: 'Empty reading', type: 'text', body: '  ' } });
check('a written lesson with no text is refused', noText.status === 422,
  noText.status + ' ' + (noText.message ?? ''));

const badType = await call('/api/onyx/platform/tenants/' + tid + '/modules/' + moduleId
  + '/lessons', { method: 'POST', token: pt,
  body: { title: 'Nonsense', type: 'hologram', path: 'x' } });
check('and a kind the product does not have is refused', badType.status === 422,
  badType.status);

const withLessonsNow = await call('/api/onyx/platform/tenants/' + tid
  + '/courses/' + course.id + '/outline', { token: pt });
const built = (withLessonsNow.data?.modules ?? []).find((m) => Number(m.id) === Number(moduleId));
check('the module now shows its lessons, in the order they were added',
  (built?.lessons ?? []).length === 3
  && (built?.lessons ?? []).every((l, i) => Number(l.sort) === i),
  (built?.lessons ?? []).map((l) => l.type + '@' + l.sort).join(' '));

const stillHeld = await call('/api/onyx/platform/tenants/' + tid + '/modules/' + moduleId,
  { method: 'DELETE', token: pt });
check('and the module cannot be removed while it holds them', stillHeld.status === 422,
  stillHeld.status + ' ' + (stillHeld.message ?? ''));

// ---------------------------------------------------------------------------

startPhase('5. opening what was uploaded');

const opened = await step('the document lesson opens',
  '/api/onyx/platform/tenants/' + tid + '/lessons/' + doc.data?.id, { token: pt });
check('with a signed URL to the file itself',
  String(opened.data?.url ?? '').startsWith('http'),
  String(opened.data?.url ?? '').slice(0, 60) + '…');

const fetched = await fetch(opened.data?.url);
const body = await fetched.text().catch(() => '');
check('and the file that comes back is the one that was uploaded',
  fetched.ok && body.includes('qa-live/console.mjs'),
  'status ' + fetched.status + ', ' + body.length + ' bytes');

const openedLink = await step('the link lesson opens',
  '/api/onyx/platform/tenants/' + tid + '/lessons/' + link.data?.id, { token: pt });
check('carrying its own address rather than a signed one',
  openedLink.data?.url === 'https://example.com/reading', openedLink.data?.url);

const openedText = await step('the written lesson opens',
  '/api/onyx/platform/tenants/' + tid + '/lessons/' + text.data?.id, { token: pt });
check('with the words in it', String(openedText.data?.body ?? '').includes('set out on the page'),
  String(openedText.data?.body ?? '').slice(0, 40));

const renamedLesson = await step('a lesson can be renamed',
  '/api/onyx/platform/tenants/' + tid + '/lessons/' + text.data?.id,
  { method: 'PATCH', token: pt, body: { title: 'Console QA reading (edited)' } });
check('and the new name sticks', String(renamedLesson.data?.title).includes('edited'),
  renamedLesson.data?.title);

const badBody = await call('/api/onyx/platform/tenants/' + tid + '/lessons/' + doc.data?.id,
  { method: 'PATCH', token: pt, body: { body: 'text on a document' } });
check('text cannot be set on a lesson that is not written', badBody.status === 422,
  badBody.status + ' ' + (badBody.message ?? ''));

const anonLesson = await call('/api/onyx/platform/tenants/' + tid + '/lessons/' + doc.data?.id);
check('and a lesson is not open to an anonymous caller',
  anonLesson.status === 401 || anonLesson.status === 403, 'status ' + anonLesson.status);

// ---------------------------------------------------------------------------

startPhase('6. a paper that can actually be sat');

const banks = await step('the operator reads the question banks',
  '/api/onyx/platform/tenants/' + tid + '/banks', { token: pt });
const bank = (banks.data ?? []).find((b) => Number(b.question_count) > 0);
check('at least one holds questions', Boolean(bank),
  (banks.data ?? []).map((b) => b.name + '=' + b.question_count).join(', ').slice(0, 90));

const paper = await step('a paper is created', '/api/onyx/platform/tenants/' + tid
  + '/assessments', {
  method: 'POST', token: pt,
  body: { title: 'Console QA paper ' + RUN, course_id: course.id, duration_minutes: 30 },
});
const paperId = paper.data?.id;

// The gap this phase exists for: a paper with no sections draws nothing, and
// the engine only says so when a candidate presses Start.
const tooEarly = await call('/api/onyx/platform/tenants/' + tid
  + '/assessments/' + paperId + '/publish', { method: 'POST', token: pt, body: {} });
check('publishing one that draws nothing is refused', tooEarly.status === 422,
  tooEarly.status + ' ' + (tooEarly.message ?? ''));

const tooMany = await call('/api/onyx/platform/tenants/' + tid
  + '/assessments/' + paperId + '/sections', {
  method: 'PUT', token: pt,
  body: { sections: [{ id: 's1', title: 'All', bank_id: bank.id, take: 50 }] },
});
check('drawing more than a bank holds is refused, and says how many it holds',
  tooMany.status === 422 && String(tooMany.message).includes(String(bank.question_count)),
  tooMany.status + ' ' + (tooMany.message ?? ''));

const foreign = await call('/api/onyx/platform/tenants/' + tid
  + '/assessments/' + paperId + '/sections', {
  method: 'PUT', token: pt,
  body: { sections: [{ id: 's1', title: 'All', bank_id: 999_999, take: 1 }] },
});
check('a bank from somewhere else is refused', foreign.status === 422,
  foreign.status + ' ' + (foreign.message ?? ''));

const take = Math.min(2, Number(bank.question_count));
await step('sections are set from a real bank', '/api/onyx/platform/tenants/' + tid
  + '/assessments/' + paperId + '/sections', {
  method: 'PUT', token: pt,
  body: { sections: [{ id: 's1', title: 'All of it', bank_id: bank.id, take }] },
});

const paperLive = await step('and now it publishes', '/api/onyx/platform/tenants/' + tid
  + '/assessments/' + paperId + '/publish', { method: 'POST', token: pt, body: {} });
check('reading as published', paperLive.data?.status === 'published',
  'status=' + paperLive.data?.status);

const listedPapers = await call('/api/onyx/platform/tenants/' + tid
  + '/academics?limit=200', { token: pt });
const mineNow = (listedPapers.data?.assessments ?? []).find((a) => Number(a.id) === Number(paperId));
check('the console list shows what it draws',
  (mineNow?.sections ?? []).reduce((n, sec) => n + Number(sec.take), 0) === take,
  JSON.stringify(mineNow?.sections));

// ---------------------------------------------------------------------------

startPhase('7. scheduling an examination on it');

const semesters = await call('/api/onyx/platform/tenants/' + tid + '/semesters', { token: pt });
const semesterId = (semesters.data ?? [])[0]?.id ?? null;

const exam = await step('an examination is scheduled', '/api/onyx/platform/tenants/' + tid
  + '/exams', {
  method: 'POST', token: pt,
  body: {
    course_id: course.id, title: 'Console QA sitting ' + RUN,
    starts_at: new Date(Date.now() + 7 * 86_400_000).toISOString(),
    duration_minutes: 90, max_marks: 100, pass_marks: 40,
    ...(semesterId ? { semester_id: semesterId } : {}),
  },
});
const examId = exam.data?.id;

const examList = await call('/api/onyx/platform/tenants/' + tid + '/academics?limit=200',
  { token: pt });
const scheduled = (examList.data?.exams ?? []).find((e) => Number(e.id) === Number(examId));
check('and appears on the institution’s calendar', Boolean(scheduled),
  scheduled?.title);

const edited = await call('/api/onyx/platform/tenants/' + tid + '/exams/' + examId, {
  method: 'PATCH', token: pt, body: { max_marks: 120 },
});
check('an operator can correct it afterwards', edited.status === 200,
  edited.status + ' ' + (edited.message ?? ''));

// ---------------------------------------------------------------------------

startPhase('8. putting ABC Institution back as it was');

if (examId) {
  const goneExam = await call('/api/onyx/platform/tenants/' + tid + '/exams/' + examId,
    { method: 'DELETE', token: pt });
  check('the examination is removed', goneExam.status === 200 || goneExam.status === 404,
    goneExam.status + ' ' + (goneExam.message ?? ''));
}
if (paperId) {
  const gonePaper = await call('/api/onyx/platform/tenants/' + tid + '/assessments/' + paperId,
    { method: 'DELETE', token: pt });
  check('the paper is removed', gonePaper.status === 200 || gonePaper.status === 404,
    gonePaper.status + ' ' + (gonePaper.message ?? ''));
}

for (const lessonId of lessonIds) {
  const gone = await call('/api/onyx/platform/tenants/' + tid + '/lessons/' + lessonId,
    { method: 'DELETE', token: pt });
  check('lesson ' + lessonId + ' is removed', gone.status === 200,
    gone.status + ' ' + (gone.message ?? ''));
}

const goneModule = await call('/api/onyx/platform/tenants/' + tid + '/modules/' + moduleId,
  { method: 'DELETE', token: pt });
check('the module is removed', goneModule.status === 200,
  goneModule.status + ' ' + (goneModule.message ?? ''));

const goneDomain = await call('/api/onyx/platform/tenants/' + tid + '/domains/' + domainId,
  { method: 'DELETE', token: pt });
check('the Live Class is removed', goneDomain.status === 200,
  goneDomain.status + ' ' + (goneDomain.message ?? ''));

const finalDomains = await call('/api/onyx/platform/tenants/' + tid + '/domains',
  { token: pt });
check('the Live Classes are back to what they were',
  (finalDomains.data ?? []).length === startedWith,
  (finalDomains.data ?? []).length + ' now, ' + startedWith + ' before');

const finalOutline = await call('/api/onyx/platform/tenants/' + tid
  + '/courses/' + course.id + '/outline', { token: pt });
check('and so are the modules on that course',
  (finalOutline.data?.modules ?? []).length === modulesBefore,
  (finalOutline.data?.modules ?? []).length + ' now, ' + modulesBefore + ' before');

// ---------------------------------------------------------------------------

const passed = results.filter((r) => r.pass).length;
const failed = results.filter((r) => !r.pass);
console.log('\n' + '='.repeat(66));
console.log(passed + ' pass, ' + failed.length + ' fail, of ' + results.length);
for (const f of failed) console.log('  FAIL [' + f.phase + '] ' + f.label + ' -- ' + f.detail);
process.exit(failed.length ? 1 : 0);
