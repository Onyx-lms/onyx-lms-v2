/**
 * The three learner surfaces that were reworked, as a learner sees them.
 *
 * Rendered HTML rather than JSON, because every claim here is about what is on
 * the screen: a rounded score, a named next step, a checklist of what is
 * missing. A JSON assertion would pass on all three while the page showed the
 * old copy.
 *
 *   node qa-live/learner-surfaces.mjs
 */
import fs from 'node:fs';

const BASE = process.env.QA_BASE ?? 'https://onyx-lms-v2.vercel.app';

const cred = fs.readFileSync('onyx-v2-credentials.csv', 'utf8')
  .trim().split(/\r?\n/).slice(1).map((r) => r.split(','));
const student = cred.find((r) => r[1] === 'abc-institution' && r[2] === 'student');

const results = [];
let phase = '';
const startPhase = (n) => { phase = n; console.log('\n== ' + n + ' =='); };
function check(label, pass, detail = '') {
  results.push({ phase, label, pass: Boolean(pass), detail });
  console.log((pass ? 'ok    ' : 'FAIL  ') + label.padEnd(56), detail);
  return pass;
}

/*
 * A session cookie, the way a browser gets one.
 *
 * Not the bare token: the cookie holds a JSON object -- token, refresh token,
 * expiry -- because the session carries the tenant and switching institutions
 * has to replace the whole thing. A cookie containing only the token reads as
 * unparseable and every page renders as signed-out, which looks exactly like
 * "the feature is missing" when the pages still return 200.
 */
const login = await fetch(BASE + '/api/onyx/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: student[4], password: student[5] }),
});
const auth = (await login.json()).data ?? {};
if (!auth.token) {
  console.error('Could not sign in as ' + student[4] + '. Nothing was checked.');
  process.exit(2);
}
const cookie = 'onyx_tenant_session=' + encodeURIComponent(JSON.stringify({
  token: auth.token,
  refresh_token: auth.refresh_token,
  expires_at: auth.expires_at,
}));

/*
 * The page, with React's text separators taken out.
 *
 * Server-rendered React writes `<!-- -->` between adjacent text nodes so it can
 * find the boundaries again when it hydrates. That splits a sentence written as
 * one line of JSX into "6<!-- --> sections<!-- --> ·" in the HTML, and any
 * assertion about the sentence fails while the sentence is on the screen and
 * perfectly correct. Stripping them compares what a reader sees.
 */
const page = async (path) => {
  const res = await fetch(BASE + path, { headers: { cookie } });
  const raw = await res.text();
  return { status: res.status, html: raw.replace(/<!-- -->/g, ''), raw };
};
const has = (html, text) => html.includes(text);
/** Text as it survives React's HTML escaping. */
const esc = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// ---------------------------------------------------------------------------

startPhase('1. the dashboard readiness card');

const dash = await page('/onyx/dashboard');
check('the dashboard renders for a learner', dash.status === 200, String(dash.status));
if (!check('and the session is really signed in',
  !dash.html.includes('name="password"'), 'not the sign-in page')) {
  console.error('\nThe session did not take. Everything below would fail for that reason.');
  process.exit(2);
}

check('the old copy is gone',
  !has(dash.html, 'readiness score') && !has(dash.html, 'Out of 100')
  && !has(dash.html, 'weighted') && !has(dash.html, 'See the breakdown'),
  'no "readiness score / Out of 100 / weighted / See the breakdown"');

const band = ['Strong', 'On track', 'Getting there', 'Early days']
  .find((w) => has(dash.html, '>' + w + '<'));
check('the score carries a word, not just a number', Boolean(band), band ?? 'none found');

check('there is no two-decimal score on the page',
  !/>\d+\.\d\d</.test(dash.html), 'nothing like 49.96');

check('it names what is worth the most right now',
  has(dash.html, 'Worth the most right now')
  || has(dash.html, 'Every part of your score'),
  has(dash.html, 'Worth the most right now') ? 'a gap is named' : 'nothing left to do');

check('and offers a way to work this out',
  has(dash.html, 'How this is worked out'), '');

check('the score sits on a track',
  has(dash.html, 'aria-label="Readiness ') && has(dash.html, 'role="progressbar"'), '');

// ---------------------------------------------------------------------------

startPhase('2. the profile');

const prof = await page('/onyx/profile');
check('the profile renders', prof.status === 200, String(prof.status));
check('it says how complete the profile is',
  has(prof.html, 'Finish your profile') || has(prof.html, 'Your profile is complete'),
  has(prof.html, 'Finish your profile') ? 'there is work left' : 'complete');
check('with a progress track of its own',
  /aria-label="Profile \d+ per cent complete"/.test(prof.html), '');
check('and names something specific to add',
  ['Write a headline', 'Write a short bio', 'Add a photo', 'List your skills',
    'Add a phone number', 'Link something of yours']
    .some((t) => has(prof.html, esc(t)))
  || has(prof.html, 'Nothing is missing'), '');
check('the editors can be jumped to',
  has(prof.html, 'id="profile-identity"') && has(prof.html, 'id="profile-details"'), '');

// ---------------------------------------------------------------------------

startPhase('3. the resume');

const res = await page('/onyx/resume');
check('the resume renders', res.status === 200, String(res.status));
check('the document is drawn as a sheet',
  has(res.html, 'aria-label="Your resume"'), '');
check('it says how ready it is to send',
  has(res.html, 'Ready to send') && /aria-label="Resume \d+ per cent ready"/.test(res.html), '');
check('and what to do next',
  has(res.html, 'Do this next') || has(res.html, 'Nothing obvious is missing'),
  has(res.html, 'Do this next') ? 'a next step is named' : 'nothing missing');
check('the download is still one press away',
  has(res.html, '/api/proxy/onyx/my/resume/document.pdf'), '');
check('the controls are collapsible groups now',
  (res.raw.match(/<details/g) ?? []).length >= 4,
  (res.raw.match(/<details/g) ?? []).length + ' groups');
check('each group says its own state without being opened',
  has(res.html, esc('Not written yet')) || / of \d+ shown/.test(res.html)
  || has(res.html, 'Nothing added'), '');
check('it still counts what the document holds',
  /\d+ (section|sections) ·/.test(res.html), '');

const pdf = await fetch(BASE + '/api/proxy/onyx/my/resume/document.pdf', { headers: { cookie } });
check('and the PDF still downloads',
  pdf.status === 200 && String(pdf.headers.get('content-type')).includes('pdf'),
  pdf.status + ' ' + pdf.headers.get('content-type'));

// ---------------------------------------------------------------------------

const passed = results.filter((r) => r.pass).length;
const failed = results.filter((r) => !r.pass);
console.log('\n' + '='.repeat(72));
console.log(passed + ' pass, ' + failed.length + ' fail, of ' + results.length);
for (const x of failed) console.log('  FAIL [' + x.phase + '] ' + x.label + ' -- ' + x.detail);
process.exit(failed.length ? 1 : 0);
