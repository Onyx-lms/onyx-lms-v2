/**
 * The practice bank a learner actually opens.
 *
 * Two findings from the quality report meet here.
 *
 * "All 29 Code Lab problems are tagged Easy with no topic, so the difficulty
 * and topic filters both sit over an undifferentiated list." True, and the
 * fix is to say what the problems are: a filter is only as useful as the
 * classification underneath it.
 *
 * "Automated-test debris is sitting in the live demonstration tenant ...
 * practice problems titled 'Build a welcome card mt90pw7r'. A prospect
 * clicking through will see them." Also true, and worse than it looked: by the
 * time this was written, forty of the fifty problems on the demo institution
 * were machine-generated litter -- welcome cards, faculty probes, permission
 * probes -- left behind by the quality suites themselves, one or two per run,
 * for weeks. The bank a prospect opened was four-fifths noise.
 *
 * A problem has no DELETE, deliberately: submissions reference it, and
 * destroying a problem somebody has answered destroys their answer too.
 * Unpublishing is the product's own remedy and is what this uses -- the row
 * survives with its history, and it leaves the list nobody wanted it on.
 *
 * Idempotent, and safe to run whenever: it only ever touches rows whose titles
 * match the machine's own naming, and only ever tags problems it can name.
 *
 *   node --env-file=.env qa-live/practice-bank-is-usable.mjs
 */
const BASE = process.env.QA_BASE ?? 'https://onyx-lms-v2.vercel.app';
const DOMAIN = 'mrdemo.test';

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

/**
 * The machine's own handwriting.
 *
 * Every pattern here is a title THIS repository's suites generate, each ending
 * in a base-36 run tag. Nothing a person would type matches, which is what
 * makes an automatic sweep safe to leave running.
 */
const DEBRIS = [
  /^Build a welcome card [a-z0-9]{6,}$/i,
  /^Faculty web problem fac-[a-z0-9]{5,}$/i,
  /^Permission probe perm-[a-z0-9]{4,}$/i,
  /^Faculty examination fac-[a-z0-9]{5,}$/i,
];

/**
 * What the curated problems actually are.
 *
 * Written out rather than guessed from the title at runtime: a classification
 * a script infers is a classification nobody has checked, and this is the data
 * the filters exist to sort by.
 */
const CATALOGUE = {
  'Sum of two numbers': ['easy', 'Input and output'],
  'Largest of three': ['easy', 'Conditionals'],
  'Reverse a string': ['easy', 'Strings'],
  'Count the vowels': ['easy', 'Strings'],
  Factorial: ['easy', 'Recursion'],
  'Fizz or Buzz': ['easy', 'Loops'],
  'Is it a palindrome': ['medium', 'Strings'],
  'Sum to n': ['easy', 'Loops'],
  'Second largest': ['medium', 'Arrays'],
  'Count the words': ['medium', 'Strings'],
  'two sum': ['medium', 'Arrays'],
  'substring-demo': ['hard', 'Strings'],
};

const at = await login('admin@' + DOMAIN, 'MrDemo#2026!');
const st = await login('alpha-cse.005@' + DOMAIN, 'Student#2026!');
if (!at || !st) { console.error('could not sign in'); process.exit(1); }

const all = (await call('/api/onyx/problems', { token: at })).data ?? [];
console.log('\n== clearing the machine’s litter out of the learner’s way ==\n');

const litter = all.filter((p) => DEBRIS.some((re) => re.test(String(p.title))));
let unpublished = 0;
let stubborn = 0;
for (const p of litter) {
  if (p.status === 'draft' || p.status === 0) continue;
  const r = await call('/api/onyx/problems/' + p.id + '/unpublish', { method: 'POST', token: at });
  if (r.status < 300) unpublished += 1; else stubborn += 1;
}
check('generated problems are taken off the practice list',
  stubborn === 0,
  litter.length + ' machine-titled problem(s) found · ' + unpublished
  + ' unpublished this run' + (stubborn ? ' · ' + stubborn + ' REFUSED' : ''));

console.log('\n== the bank says what its problems are ==\n');

let tagged = 0;
let missing = [];
for (const [title, [difficulty, topic]] of Object.entries(CATALOGUE)) {
  const problem = all.find((p) => String(p.title) === title);
  if (!problem) { missing.push(title); continue; }
  const r = await call('/api/onyx/problems/' + problem.id,
    { method: 'PATCH', token: at, body: { difficulty, topic } });
  if (r.status < 300) tagged += 1;
}
check('every curated problem carries a difficulty and a topic',
  tagged > 0 && missing.length === 0,
  tagged + ' of ' + Object.keys(CATALOGUE).length + ' tagged'
  + (missing.length ? ' · not found: ' + missing.join(', ') : ''));

console.log('\n== and the filters over it actually filter ==\n');

const visible = (await call('/api/onyx/problems', { token: st })).data ?? [];
const stillLitter = visible.filter((p) => DEBRIS.some((re) => re.test(String(p.title))));
check('a learner sees the bank, not the litter', stillLitter.length === 0,
  visible.length + ' problem(s) visible'
  + (stillLitter.length ? ' · ' + stillLitter.length + ' STILL SHOWING' : ''));

const difficulties = new Set(visible.map((p) => p.difficulty));
check('the difficulty filter has more than one thing to choose',
  difficulties.size > 1, [...difficulties].sort().join(', '));

const topics = new Set(visible.map((p) => p.topic).filter(Boolean));
check('and the topic filter has topics', topics.size > 1,
  topics.size + ': ' + [...topics].sort().join(', '));

const untagged = visible.filter((p) => !p.topic);
check('  with nothing left unclassified', untagged.length === 0,
  untagged.length ? untagged.length + ' untagged: '
    + untagged.slice(0, 3).map((p) => p.title).join(', ') : 'none');

/*
 * A filter that returns everything is a filter that does nothing. Narrowing has
 * to actually narrow, and the narrowed set has to be the right one.
 */
const medium = (await call('/api/onyx/problems?difficulty=medium', { token: st })).data ?? [];
check('filtering by difficulty narrows the list',
  medium.length > 0 && medium.length < visible.length
  && medium.every((p) => p.difficulty === 'medium'),
  medium.length + ' of ' + visible.length + ' are medium');

const oneTopic = [...topics][0];
const byTopic = (await call('/api/onyx/problems?topic=' + encodeURIComponent(oneTopic),
  { token: st })).data ?? [];
check('filtering by topic narrows the list',
  byTopic.length > 0 && byTopic.every((p) => p.topic === oneTopic),
  byTopic.length + ' in ' + oneTopic);

const failed = results.filter((r) => !r.pass);
console.log('\n' + '='.repeat(78));
console.log(results.length - failed.length + ' pass, ' + failed.length + ' fail');
for (const f of failed) console.log('  FAIL ' + f.label + ' -- ' + f.detail);
process.exit(failed.length ? 1 : 0);
