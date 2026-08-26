/**
 * Can a lecturer build a course the way the console can?
 *
 * "Add a module" existed on both and everything after it did not: renaming a
 * module, removing one, and taking a lesson down were reachable only from the
 * platform console. So an operator two levels away from whoever wrote a course
 * could reshape it, and the lecturer running it could add things and never
 * take one back. Authoring is not half a power.
 *
 * Walks the whole shape as faculty1, on a course they actually teach, and
 * leaves the course as it found it.
 *
 *   node --env-file=.env qa-live/faculty-authoring-parity.mjs
 */
const BASE = process.env.QA_BASE ?? 'https://onyx-lms-v2.vercel.app';

const results = [];
const check = (label, pass, detail = '') => {
  results.push({ label, pass, detail });
  console.log((pass ? 'ok    ' : 'FAIL  ') + label.padEnd(54), detail);
};
const tok = (await (await fetch(BASE + '/api/onyx/auth/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'faculty1@mrdemo.test', password: 'MrDemo#2026!' }),
})).json())?.data?.token;
const call = async (path, body, method = 'GET') => {
  const r = await fetch(BASE + path, { method,
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok },
    body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) };
};
check('the lecturer signs in', !!tok, 'faculty1@mrdemo.test');

// A course they teach. WD101 is theirs.
const courses = (await call('/api/onyx/courses')).body?.data ?? [];
const course = courses.find((c) => c.code === 'WD101') ?? courses[0];
const tag = Math.random().toString(36).slice(2, 7);

// --- the module ------------------------------------------------------------
const made = await call('/api/onyx/courses/' + course.id + '/modules',
  { title: 'Parity probe ' + tag, summary: 'Added by the parity check.' }, 'POST');
check('adds a module', made.status === 200, 'HTTP ' + made.status);
const moduleId = made.body?.data?.id;

const renamed = await call('/api/onyx/modules/' + moduleId,
  { title: 'Parity probe ' + tag + ' (renamed)' }, 'PATCH');
check('renames it', renamed.status === 200 && /renamed/.test(renamed.body?.data?.title ?? ''),
  renamed.body?.data?.title ?? ('HTTP ' + renamed.status));

// --- a lesson of every kind the API takes ----------------------------------
const KINDS = [
  ['text', { type: 'text', title: 'Notes ' + tag, body: 'Written straight into the lesson.' }],
  ['link', { type: 'link', title: 'Reading ' + tag, path: 'https://developer.mozilla.org/' }],
  ['video', { type: 'video', title: 'Recording ' + tag, path: 'onyx/798/courses/x/clip.mp4' }],
  ['document', { type: 'document', title: 'Slides ' + tag, path: 'onyx/798/courses/x/deck.pdf' }],
  ['image', { type: 'image', title: 'Diagram ' + tag, path: 'onyx/798/courses/x/plan.png' }],
];
const lessons = [];
for (const [kind, payload] of KINDS) {
  const r = await call('/api/onyx/modules/' + moduleId + '/lessons', payload, 'POST');
  check('adds a ' + kind + ' lesson', r.status === 200,
    'HTTP ' + r.status + ' ' + String(r.body?.message ?? '').slice(0, 44));
  if (r.body?.data?.id) lessons.push(r.body.data.id);
}

const outline = (await call('/api/onyx/courses/' + course.id + '/outline')).body?.data;
const mine = (outline?.modules ?? []).find((m) => Number(m.id) === Number(moduleId));
check('all five are on the course', (mine?.lessons ?? []).length === KINDS.length,
  (mine?.lessons ?? []).map((l) => l.type).join(', '));

// --- and a module holding lessons is not deleted by accident ---------------
const refused = await call('/api/onyx/modules/' + moduleId, undefined, 'DELETE');
check('refuses to remove a module that still holds lessons', refused.status === 422,
  String(refused.body?.message ?? '').slice(0, 56));

// --- taking it all back out ------------------------------------------------
let removed = 0;
for (const id of lessons) {
  const r = await call('/api/onyx/lessons/' + id, undefined, 'DELETE');
  if (r.status === 200) removed += 1;
}
check('removes every lesson', removed === lessons.length, removed + ' of ' + lessons.length);

const gone = await call('/api/onyx/modules/' + moduleId, undefined, 'DELETE');
check('and then the module', gone.status === 200, 'HTTP ' + gone.status);

const after = (await call('/api/onyx/courses/' + course.id + '/outline')).body?.data;
check('the course is as it was found',
  !(after?.modules ?? []).some((m) => Number(m.id) === Number(moduleId)),
  (after?.modules ?? []).length + ' modules');

const failed = results.filter((r) => !r.pass);
console.log('\n' + '='.repeat(74));
console.log(results.filter((r) => r.pass).length + ' pass, ' + failed.length + ' fail');
for (const f of failed) console.log('  FAIL ' + f.label + ' -- ' + f.detail);
process.exit(failed.length ? 1 : 0);
