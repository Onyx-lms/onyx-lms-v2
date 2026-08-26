/**
 * Contests and mock interviews, actually run rather than merely built.
 *
 * The quality report scored both of these low and said why: "the surface is
 * built and states it is judged by the same evaluator as Code Lab, but nothing
 * is scheduled on any tenant, so it could not be exercised", and "no interview
 * exists anywhere to run one through". That is not a verdict on the code -- it
 * is a verdict on an empty database, and the honest way to lift it is to put
 * something real through the feature and watch what happens.
 *
 * So this seeds the demo institution with one contest and one mock interview,
 * then walks them: a team enters, solves a problem against the real evaluator,
 * appears on the leaderboard; an interview is scheduled, marked against
 * criteria, released, and read by the candidate it was about.
 *
 * Idempotent. Both are found by title and re-used, because neither a contest
 * nor an interview can be deleted through the API.
 *
 *   node --env-file=.env qa-live/careers-have-something-to-show.mjs
 */
const BASE = process.env.QA_BASE ?? 'https://onyx-lms-v2.vercel.app';
const DOMAIN = 'mrdemo.test';
const STAFF_PW = 'MrDemo#2026!';
const STUDENT_PW = 'Student#2026!';
const CONTEST = 'Autumn Programming Contest';
const INTERVIEW = 'Mock technical interview';

const results = [];
const check = (label, pass, detail = '') => {
  results.push({ label, pass, detail });
  console.log((pass ? 'ok    ' : 'FAIL  ') + label.padEnd(56) + ' ' + detail);
};

async function call(path, { method = 'GET', token, body } = {}) {
  const r = await fetch(BASE + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const j = await r.json().catch(() => null);
  return { status: r.status, data: j?.data ?? null, message: j?.message ?? null };
}
const login = async (email, password) =>
  (await call('/api/onyx/auth/login', { method: 'POST', body: { email, password } })).data?.token;

const at = await login('admin@' + DOMAIN, STAFF_PW);
const st = await login('alpha-cse.003@' + DOMAIN, STUDENT_PW);
if (!at || !st) { console.error('could not sign in'); process.exit(1); }

const me = (await call('/api/onyx/me', { token: st })).data;
const studentId = me?.user_id ?? me?.user?.id;

// ===========================================================================
console.log('\n== a contest that is actually held ==\n');

const problems = (await call('/api/onyx/problems', { token: at })).data ?? [];
const easy = problems.filter((p) => p.kind === 'code').slice(0, 3);
check('there are problems to set', easy.length >= 2, easy.length + ' code problems available');

let contest = ((await call('/api/onyx/contests', { token: at })).data ?? [])
  .find((c) => String(c.title) === CONTEST);

if (!contest) {
  /*
   * A window that is open NOW and stays open. A contest seeded with yesterday's
   * dates is a contest nobody can enter, which is the state this suite exists
   * to get the demo out of.
   */
  const opens = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const closes = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
  const made = await call('/api/onyx/contests', {
    method: 'POST', token: at,
    body: {
      title: CONTEST,
      description: 'An open programming contest for the demo institution. '
        + 'Judged by the same evaluator as Code Lab.',
      starts_at: opens, ends_at: closes,
      problems: easy.map((p, i) => ({ problem_id: p.id, points: 100 * (i + 1) })),
      team_size: 3, penalty_minutes: 20, freeze_minutes: 30,
    },
  });
  check('a contest can be scheduled', made.status < 300,
    'HTTP ' + made.status + ' ' + (made.message ?? ''));
  contest = made.data;
  const pub = await call('/api/onyx/contests/' + contest.id + '/publish',
    { method: 'POST', token: at });
  check('and opened to the institution', pub.status < 300,
    'HTTP ' + pub.status + ' ' + (pub.message ?? ''));
} else {
  check('a contest can be scheduled', true, 're-using #' + contest.id);
  check('and opened to the institution', contest.status !== 'draft',
    'status: ' + contest.status);
}

const seen = (await call('/api/onyx/contests', { token: st })).data ?? [];
check('a learner can see it on the board',
  seen.some((c) => Number(c.id) === Number(contest.id)),
  seen.length + ' contest(s) visible to the learner');

const detail = (await call('/api/onyx/contests/' + contest.id, { token: st })).data;
check('  with its problems and its rules',
  (detail?.problems ?? []).length >= 2,
  (detail?.problems ?? []).length + ' problems · teams of '
  + (detail?.team_size ?? '?') + ' · ' + (detail?.penalty_minutes ?? '?') + ' min penalty');

const TEAM = 'Team Alpha-CSE';
let team = (detail?.teams ?? []).find((t) => String(t.name) === TEAM);
if (!team) {
  const made = await call('/api/onyx/contests/' + contest.id + '/teams',
    { method: 'POST', token: st, body: { name: TEAM } });
  check('a learner enters a team', made.status < 300,
    'HTTP ' + made.status + ' ' + (made.message ?? ''));
  team = made.data;
} else {
  check('a learner enters a team', true, 're-using ' + TEAM);
}

/*
 * The claim the report could not test: a contest is judged by the SAME
 * evaluator Code Lab uses. So the answer is really run, and the contest is
 * given the resulting submission rather than a number somebody typed.
 */
const problem = (detail?.problems ?? [])[0];
const problemId = problem?.problem_id ?? problem?.id ?? easy[0]?.id;
const full = (await call('/api/onyx/problems/' + problemId, { token: st })).data;
const solution = String(full?.starter_code?.python ?? '').includes('input')
  ? full.starter_code.python
  : 'a, b = map(int, input().split())\nprint(a + b)\n';

const run = await call('/api/onyx/problems/' + problemId + '/submit', {
  method: 'POST', token: st, body: { language: 'python', source: solution },
});
check('the answer is judged by the real evaluator', run.status < 300,
  'HTTP ' + run.status + ' · ' + (run.data?.status ?? run.message ?? ''));

/*
 * Judging is asynchronous -- the submission comes back `queued` and a worker
 * runs it in the sandbox. A contest refuses an ungraded submission, correctly,
 * so wait for the verdict rather than recording a result nobody has reached.
 */
const PENDING = ['queued', 'running', 'pending'];
let graded = run.data;
for (let i = 0; i < 30 && graded && PENDING.includes(String(graded.status)); i += 1) {
  await new Promise((r) => { setTimeout(r, 1500); });
  const mineNow = (await call('/api/onyx/problems/' + problemId + '/submissions',
    { token: st })).data ?? [];
  graded = mineNow.find((x) => Number(x.id) === Number(run.data.id)) ?? graded;
}
check('  and the verdict comes back',
  Boolean(graded) && !PENDING.includes(String(graded.status)),
  'status: ' + (graded?.status ?? 'never left the queue'));

if (run.data?.id) {
  const recorded = await call('/api/onyx/contests/' + contest.id + '/submit', {
    method: 'POST', token: st,
    body: { problem_id: Number(problemId), submission_id: Number(run.data.id) },
  });
  check('and the contest records it', recorded.status < 300,
    'HTTP ' + recorded.status + ' ' + (recorded.message ?? ''));
} else {
  check('and the contest records it', false, 'no submission id came back');
}

const board = (await call('/api/onyx/contests/' + contest.id + '/leaderboard',
  { token: st })).data;
const rows = Array.isArray(board) ? board : (board?.rows ?? board?.teams ?? []);
check('the leaderboard has somebody on it', rows.length > 0,
  rows.length + ' team(s) ranked');

// ===========================================================================
console.log('\n== a mock interview that actually happened ==\n');

/*
 * Found from the CANDIDATE's record, not the staff listing. `/interviews/mine`
 * answers "which interviews do I conduct", which for an administrator who
 * scheduled but did not sit in on one is a different and usually empty answer
 * -- and a lookup that always misses is a lookup that schedules a second
 * interview every run.
 */
let interview = ((await call('/api/onyx/my/interviews', { token: st })).data ?? [])
  .find((i) => String(i.title) === INTERVIEW);

if (!interview) {
  const made = await call('/api/onyx/interviews', {
    method: 'POST', token: at,
    body: {
      user_id: studentId,
      title: INTERVIEW,
      scheduled_at: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
      duration_minutes: 45,
    },
  });
  check('an interview can be scheduled', made.status < 300,
    'HTTP ' + made.status + ' ' + (made.message ?? ''));
  interview = made.data;
} else {
  check('an interview can be scheduled', true, 're-using #' + interview.id);
}

const FEEDBACK = [
  { criterion: 'Problem solving', score: 4, of: 5,
    comment: 'Reasoned aloud and reached a working answer without prompting.' },
  { criterion: 'Communication', score: 3, of: 5,
    comment: 'Clear, though the first explanation assumed knowledge the room did not have.' },
  { criterion: 'Code quality', score: 4, of: 5, comment: 'Readable, well named, tested.' },
];
const marked = await call('/api/onyx/interviews/' + interview.id + '/feedback', {
  method: 'POST', token: at,
  body: {
    feedback: FEEDBACK, overall: 4,
    notes: 'Ready for a first-round technical screen. Practise explaining before coding.',
    release: true,
  },
});
check('it can be marked against criteria and released', marked.status < 300,
  'HTTP ' + marked.status + ' ' + (marked.message ?? ''));

/*
 * The half that matters. Feedback the candidate cannot read is a form the
 * institution filled in for itself.
 */
const theirs = (await call('/api/onyx/my/interviews', { token: st })).data ?? [];
const ours = theirs.find((i) => Number(i.id) === Number(interview.id));
check('THE CANDIDATE CAN READ THEIR OWN FEEDBACK', Boolean(ours),
  theirs.length + ' interview(s) on their record');

const read = (await call('/api/onyx/interviews/' + interview.id, { token: st })).data;
const criteria = read?.feedback ?? [];
check('  broken down by criterion, not one number',
  criteria.length === FEEDBACK.length,
  criteria.length + ' criteria: ' + criteria.map((c) => c.criterion).join(', '));
check('  with the overall rating', Number(read?.overall) === 4,
  'overall ' + (read?.overall ?? '?') + ' of 5, marked as released: '
  + Boolean(read?.feedback_released));

/*
 * And NOT the interviewer's private notes. Released feedback and the note an
 * interviewer writes for the placement office are two different documents, and
 * the service keeps them apart -- worth asserting, because a screen that
 * shows both is the kind of leak nobody notices until it matters.
 */
check('  but not the interviewer’s private notes', read?.notes === null,
  read?.notes === null ? 'withheld, as designed' : 'LEAKED to the candidate');

const failed = results.filter((r) => !r.pass);
console.log('\n' + '='.repeat(78));
console.log(results.length - failed.length + ' pass, ' + failed.length + ' fail');
for (const f of failed) console.log('  FAIL ' + f.label + ' -- ' + f.detail);
console.log('\nLeft on the demo institution on purpose: the contest, its team and its '
  + 'leaderboard, and one completed mock interview with released feedback. Both are '
  + 're-used on the next run rather than duplicated.');
process.exit(failed.length ? 1 : 0);
