/**
 * Onyx O05 -- Onyx Career, end to end.
 *
 * Four acceptance criteria are proven here and nowhere else:
 *
 *   * **A credential verifies publicly and exposes no personal data beyond the
 *     holder's name** (CAR-03a), against the real unauthenticated route.
 *   * **Every skill on a profile links to the evidence that produced it**
 *     (CAR-05a).
 *   * **An ineligible learner cannot apply; eligibility is computed, not typed**
 *     (CAR-04b).
 *   * **A drive's rounds and outcomes reconcile with the offers recorded**
 *     (CAR-04c).
 *
 * Plus the two P1 criteria: a leaderboard that is correct and stable, and a
 * learner who cannot see another learner's interview feedback.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { api, createTenant, withDb, RUN, API, onyxLogin } from './harness.ts';

const pw = 'OnyxTest#2026';
const mail = (who: string) => 'ca.' + who + '.' + RUN + '@onyx.test';
const A = { name: 'Career Institute ' + RUN, slug: 'career-a-' + RUN };
const B = { name: 'Rival Career ' + RUN, slug: 'career-b-' + RUN };

const w = {
  alpha: { id: 0, admin: '', placement: '', employer: '', s1: '', s2: '' },
  beta: { id: 0, admin: '' },
  ids: {} as Record<string, string>,
  course: 0, skill: 0, employerId: 0, rivalId: 0, job: 0, application: 0,
  drive: 0, rounds: [] as number[], contest: 0, team: 0, interview: 0,
  credential: '', certificate: 0, problem: 0,
};

test('two institutions, a placement office and an employer', async () => {
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

  for (const [who, role] of [
    ['placement', 'placement'], ['employer', 'employer'],
    ['s1', 'student'], ['s2', 'student'],
  ] as const) {
    const r = await api<{ user: { id: string } }>('/api/onyx/members', {
      token: w.alpha.admin, body: { name: who, email: mail(who), role, password: pw },
    });
    assert.equal(r.ok, true, who + ': ' + r.message);
    w.ids[who] = r.data.user.id;
  }
  w.alpha.placement = await onyxLogin(mail('placement'), pw);
  w.alpha.employer = await onyxLogin(mail('employer'), pw);
  w.alpha.s1 = await onyxLogin(mail('s1'), pw);
  w.alpha.s2 = await onyxLogin(mail('s2'), pw);

  const course = await api<{ id: number }>('/api/onyx/courses', {
    token: w.alpha.admin, body: { code: 'CA101', title: 'Career Course' },
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
// CAR-03
// ---------------------------------------------------------------------------

test('CAR-03a a credential verifies publicly and exposes nothing but the name', async () => {
  const issued = await api<{ id: number; credential_id: string }>('/api/onyx/certificates', {
    token: w.alpha.placement,
    body: {
      user_id: w.ids.s1, title: 'Career Course', kind: 'course',
      // Things a caller might pass that must never reach a public page.
      detail: { score: 88, grade: 'A', email: mail('s1'), internal_note: 'borderline' },
    },
  });
  assert.equal(issued.ok, true, issued.message);
  w.certificate = Number(issued.data.id);
  w.credential = issued.data.credential_id;
  assert.match(w.credential, /^[0-9A-F]{32}$/, 'a guessable credential id');

  // No Authorization header at all -- the person checking has no account here.
  const res = await fetch(API + '/api/onyx/verify/' + w.credential);
  assert.equal(res.status, 200);
  const body = await res.json() as { ok: boolean; data: Record<string, unknown> };
  assert.equal(body.ok, true);
  assert.equal(body.data.valid, true);
  assert.equal(body.data.holder, 's1');
  assert.equal(String(body.data.issuer).startsWith('Career Institute'), true);

  const wire = JSON.stringify(body.data);
  assert.equal(wire.includes(mail('s1')), false, 'an email reached the public page');
  assert.equal(wire.includes('borderline'), false, 'an internal note reached the public page');
  assert.equal(wire.includes(String(w.ids.s1)), false, 'a user id reached the public page');
  // What the issuer chose to state does appear.
  assert.equal((body.data.detail as Record<string, unknown>).score, 88);

  const unknown = await api('/api/onyx/verify/' + 'A'.repeat(32));
  assert.equal(unknown.data.valid, false);
  assert.equal(unknown.data.reason, 'not_found');
});

test('CAR-03 revoking is honest about itself, and audited', async () => {
  const revoked = await api('/api/onyx/certificates/' + w.certificate + '/revoke',
    { token: w.alpha.placement, body: { reason: 'issued in error' } });
  assert.equal(revoked.ok, true, revoked.message);

  const after = await api('/api/onyx/verify/' + w.credential);
  // Revoked, not "never existed": the holder is entitled to know which.
  assert.equal(after.data.valid, false);
  assert.equal(after.data.reason, 'revoked');
  assert.equal(after.data.holder, 's1');

  const audit = await api<{ action: string }[]>('/api/onyx/audit?limit=200',
    { token: w.alpha.admin });
  const actions = audit.data.map((a) => a.action);
  assert.ok(actions.includes('certificate.issued'));
  assert.ok(actions.includes('certificate.revoked'));
});

// ---------------------------------------------------------------------------
// CAR-05
// ---------------------------------------------------------------------------

test('CAR-05a every skill on a profile links to the evidence that produced it', async () => {
  const skill = await api<{ id: number }>('/api/onyx/skills',
    { token: w.alpha.placement, body: { name: 'Python ' + RUN, category: 'Language' } });
  assert.equal(skill.ok, true, skill.message);
  w.skill = Number(skill.data.id);

  const fresh = await api<{ id: number }>('/api/onyx/certificates', {
    token: w.alpha.placement, body: { user_id: w.ids.s1, title: 'Advanced Python' },
  });
  for (const [source, id, strength] of [
    ['certificate', Number(fresh.data.id), 80], ['course', w.course, 60],
  ] as const) {
    const r = await api('/api/onyx/skills/award', {
      token: w.alpha.placement,
      body: {
        user_id: w.ids.s1, skill_id: w.skill, source_type: source,
        source_id: id, strength, evidence: { note: 'from ' + source },
      },
    });
    assert.equal(r.ok, true, r.message);
  }

  const profile = await api<{
    skills: { name: string; level: number; evidence_count: number;
      evidence: { source_type: string; source_id: number }[] }[];
    readiness: { score: number; breakdown: { key: string; weight: number; points: number;
      detail: Record<string, number> }[]; formula: Record<string, number> };
    certificates: { credential_id: string }[];
  }>('/api/onyx/my/profile', { token: w.alpha.s1 });
  assert.equal(profile.ok, true, profile.message);

  const python = profile.data.skills.find((s) => s.name.startsWith('Python'))!;
  // The mean of the evidence, not the best of it.
  assert.equal(python.level, 70);
  assert.equal(python.evidence_count, 2);
  assert.deepEqual(python.evidence.map((e) => e.source_type).sort(), ['certificate', 'course']);

  // The revoked credential is off the profile.
  assert.equal(profile.data.certificates.some((c) => c.credential_id === w.credential), false,
    'a revoked certificate stayed on the profile');
});

test('CAR-05b the learner can see exactly why their score is what it is', async () => {
  const profile = await api<{ readiness: {
    score: number;
    breakdown: { key: string; label: string; weight: number; raw: number; points: number;
      detail: Record<string, number> }[];
    formula: Record<string, number>;
  } }>('/api/onyx/my/profile', { token: w.alpha.s1 });

  const r = profile.data.readiness;
  assert.deepEqual(r.breakdown.map((b) => b.key),
    ['attendance', 'assessment', 'practice', 'projects', 'interview']);
  // Published rather than tuned in secret.
  assert.equal(Object.values(r.formula).reduce((a, b) => a + b, 0), 100);
  for (const c of r.breakdown) {
    assert.equal(c.weight, r.formula[c.key], c.key + ' was weighted differently to the formula');
    assert.ok(c.detail, c.key + ' showed no working');
    assert.equal(typeof c.points, 'number');
  }
  // The components add up to the score.
  assert.equal(Math.round(r.breakdown.reduce((t, c) => t + c.points, 0) * 100) / 100, r.score);

  // One learner cannot read another's.
  assert.equal((await api('/api/onyx/profiles/' + w.ids.s1, { token: w.alpha.s2 })).status, 403);
  assert.equal((await api('/api/onyx/profiles/' + w.ids.s1,
    { token: w.alpha.placement })).status, 200);
});

// ---------------------------------------------------------------------------
// CAR-04
// ---------------------------------------------------------------------------

test('CAR-04a an employer sees only what the institution has shared with them', async () => {
  const mine = await api<{ id: number }>('/api/onyx/employers', {
    token: w.alpha.placement,
    body: {
      name: 'Acme ' + RUN, contact_name: 'Rep', contact_email: 'rep@acme.test',
      user_id: w.ids.employer,
    },
  });
  assert.equal(mine.ok, true, mine.message);
  w.employerId = Number(mine.data.id);

  const rival = await api<{ id: number }>('/api/onyx/employers',
    { token: w.alpha.placement, body: { name: 'Rival ' + RUN } });
  w.rivalId = Number(rival.data.id);

  // An employer contact must have the employer role, or an employer record
  // would hand somebody else's account to a company.
  const wrongRole = await api('/api/onyx/employers', {
    token: w.alpha.placement, body: { name: 'Wrong', user_id: w.ids.s1 },
  });
  assert.equal(wrongRole.status, 422, wrongRole.message);

  // The list of every employer is the institution's, not one company's.
  assert.equal((await api('/api/onyx/employers', { token: w.alpha.employer })).status, 403);

  const ownJob = await api<{ id: number; status: string }>('/api/onyx/jobs', {
    token: w.alpha.employer,
    body: {
      employer_id: w.employerId, title: 'Graduate Engineer', location: 'Remote',
      min_readiness: 0, required_skills: [w.skill],
    },
  });
  assert.equal(ownJob.ok, true, ownJob.message);
  assert.equal(ownJob.data.status, 'draft');
  w.job = Number(ownJob.data.id);

  const otherJob = await api('/api/onyx/jobs', {
    token: w.alpha.employer, body: { employer_id: w.rivalId, title: 'Sneaky' },
  });
  assert.equal(otherJob.status, 403, 'an employer posted for another company');

  // Publishing is the institution vouching for the post.
  assert.equal((await api('/api/onyx/jobs/' + w.job + '/publish',
    { token: w.alpha.employer, method: 'POST' })).status, 403);
  const published = await api('/api/onyx/jobs/' + w.job + '/publish',
    { token: w.alpha.placement, method: 'POST' });
  assert.equal(published.ok, true, published.message);

  const board = await api<{ employer_id: number }[]>('/api/onyx/jobs',
    { token: w.alpha.employer });
  assert.equal(board.data.every((j) => Number(j.employer_id) === w.employerId), true,
    'an employer saw another company\'s posts');
});

test('CAR-04b an ineligible learner cannot apply; eligibility is computed', async () => {
  const theirs = await api<{ eligible: boolean; checks: {
    rule: string; required: string; actual: string; met: boolean;
  }[] }>('/api/onyx/jobs/' + w.job + '/eligibility', { token: w.alpha.s1 });
  assert.equal(theirs.ok, true, theirs.message);
  // Computed with its working, not a checkbox somebody ticked.
  assert.equal(theirs.data.checks.length, 2);
  assert.equal(theirs.data.eligible, true, JSON.stringify(theirs.data.checks));

  const other = await api<{ eligible: boolean; checks: { rule: string; met: boolean }[] }>(
    '/api/onyx/jobs/' + w.job + '/eligibility', { token: w.alpha.s2 });
  assert.equal(other.data.eligible, false);
  assert.equal(other.data.checks.find((c) => c.rule === 'Skills')!.met, false);

  const refused = await api('/api/onyx/jobs/' + w.job + '/apply',
    { token: w.alpha.s2, body: {} });
  assert.equal(refused.status, 422, 'an ineligible learner applied');
  assert.match(refused.message ?? '', /Skills/, refused.message);

  const applied = await api<{ id: number; readiness_at_apply: number | null }>(
    '/api/onyx/jobs/' + w.job + '/apply', { token: w.alpha.s1, body: { note: 'Keen.' } });
  assert.equal(applied.ok, true, applied.message);
  w.application = Number(applied.data.id);
  // Kept, so a later change to their record cannot rewrite the decision.
  assert.notEqual(applied.data.readiness_at_apply, undefined);

  assert.equal((await api('/api/onyx/jobs/' + w.job + '/apply',
    { token: w.alpha.s1, body: {} })).status, 422, 'applying twice was allowed');

  const applicants = await api<unknown[]>('/api/onyx/jobs/' + w.job + '/applicants',
    { token: w.alpha.employer });
  assert.equal(applicants.data.length, 1);

  // Another employer's pipeline is not theirs.
  const rivalJob = await api<{ id: number }>('/api/onyx/jobs', {
    token: w.alpha.placement, body: { employer_id: w.rivalId, title: 'Rival Role' },
  });
  assert.equal((await api('/api/onyx/jobs/' + rivalJob.data.id + '/applicants',
    { token: w.alpha.employer })).status, 403);

  // Withdrawing is the candidate's word.
  assert.equal((await api('/api/onyx/applications/' + w.application, {
    token: w.alpha.employer, method: 'PATCH', body: { status: 'withdrawn' },
  })).status, 422);
});

test('CAR-04c a drive\'s rounds and outcomes reconcile with the offers recorded', async () => {
  const drive = await api<{ id: number }>('/api/onyx/drives', {
    token: w.alpha.placement,
    body: {
      employer_id: w.employerId, job_id: w.job, title: 'Campus drive',
      rounds: [{ name: 'Aptitude' }, { name: 'Technical' }],
    },
  });
  assert.equal(drive.ok, true, drive.message);
  w.drive = Number(drive.data.id);

  const before = await api<{ rounds: { round_id: number; name: string }[] }>(
    '/api/onyx/drives/' + w.drive + '/summary', { token: w.alpha.placement });
  assert.deepEqual(before.data.rounds.map((r) => r.name), ['Aptitude', 'Technical']);
  w.rounds = before.data.rounds.map((r) => r.round_id);

  await api('/api/onyx/rounds/' + w.rounds[0] + '/results', {
    token: w.alpha.placement,
    body: { entries: [
      { user_id: w.ids.s1, outcome: 'passed' }, { user_id: w.ids.s2, outcome: 'failed' },
    ] },
  });
  await api('/api/onyx/rounds/' + w.rounds[1] + '/results', {
    token: w.alpha.placement, body: { entries: [{ user_id: w.ids.s1, outcome: 'passed' }] },
  });

  const unreconciled = await api<{
    cleared_final_round: number; offers: number; reconciles: boolean;
    cleared_without_offer: number[];
  }>('/api/onyx/drives/' + w.drive + '/summary', { token: w.alpha.placement });
  assert.equal(unreconciled.data.cleared_final_round, 1);
  assert.equal(unreconciled.data.offers, 0);
  assert.equal(unreconciled.data.reconciles, false);
  // Named rather than merely counted.
  assert.deepEqual(unreconciled.data.cleared_without_offer, [w.ids.s1]);

  const offered = await api('/api/onyx/applications/' + w.application, {
    token: w.alpha.employer, method: 'PATCH', body: { status: 'offered' },
  });
  assert.equal(offered.ok, true, offered.message);

  const reconciled = await api<{ reconciles: boolean; offers: number }>(
    '/api/onyx/drives/' + w.drive + '/summary', { token: w.alpha.placement });
  assert.equal(reconciled.data.offers, 1);
  assert.equal(reconciled.data.reconciles, true);
});

// ---------------------------------------------------------------------------
// CAR-01
// ---------------------------------------------------------------------------

test('CAR-01a a leaderboard is correct and stable', async () => {
  const problem = await api<{ id: number }>('/api/onyx/problems', {
    token: w.alpha.admin,
    body: { title: 'Contest Echo ' + RUN, statement: 'Echo.', languages: ['python'] },
  });
  w.problem = Number(problem.data.id);
  await api('/api/onyx/problems/' + w.problem + '/tests', {
    token: w.alpha.admin, method: 'PUT',
    body: { tests: [{ stdin: 'x', expected_stdout: 'x', is_hidden: false }] },
  });

  // A contest cannot draw on a problem nobody can attempt.
  const early = await api('/api/onyx/contests', {
    token: w.alpha.admin,
    body: {
      title: 'Too early', starts_at: new Date(Date.now() - 60_000).toISOString(),
      ends_at: new Date(Date.now() + 3_600_000).toISOString(),
      problems: [{ problem_id: w.problem, points: 100 }],
    },
  });
  assert.equal(early.status, 422, early.message);

  await api('/api/onyx/problems/' + w.problem + '/publish',
    { token: w.alpha.admin, method: 'POST' });

  const contest = await api<{ id: number }>('/api/onyx/contests', {
    token: w.alpha.admin,
    body: {
      title: 'Spring Hack ' + RUN,
      starts_at: new Date(Date.now() - 60_000).toISOString(),
      ends_at: new Date(Date.now() + 3_600_000).toISOString(),
      problems: [{ problem_id: w.problem, points: 100 }],
      team_size: 2, penalty_minutes: 20,
    },
  });
  assert.equal(contest.ok, true, contest.message);
  w.contest = Number(contest.data.id);

  assert.equal((await api('/api/onyx/contests/' + w.contest,
    { token: w.alpha.s1 })).status, 404, 'a draft contest was visible');
  await api('/api/onyx/contests/' + w.contest + '/publish',
    { token: w.alpha.admin, method: 'POST' });

  const team = await api<{ id: number }>('/api/onyx/contests/' + w.contest + '/teams',
    { token: w.alpha.s1, body: { name: 'Alpha ' + RUN } });
  assert.equal(team.ok, true, team.message);
  w.team = Number(team.data.id);

  assert.equal((await api('/api/onyx/contests/' + w.contest + '/teams',
    { token: w.alpha.s1, body: { name: 'Second' } })).status, 422,
  'somebody was in two teams');

  const joined = await api('/api/onyx/teams/' + w.team + '/join',
    { token: w.alpha.s2, method: 'POST' });
  assert.equal(joined.ok, true, joined.message);

  const board = await api<{ frozen: boolean; rows: {
    rank: number; name: string; points: number; penalty: number;
  }[] }>('/api/onyx/contests/' + w.contest + '/leaderboard', { token: w.alpha.s1 });
  assert.equal(board.ok, true, board.message);
  assert.equal(board.data.rows.length, 1);
  assert.equal(board.data.rows[0]!.points, 0, 'an unsolved problem scored');
  assert.equal(board.data.rows[0]!.rank, 1);

  // Two reads of the same data give the same board.
  const again = await api<{ rows: { name: string; rank: number }[] }>(
    '/api/onyx/contests/' + w.contest + '/leaderboard', { token: w.alpha.s1 });
  assert.deepEqual(again.data.rows.map((r) => [r.name, r.rank]),
    board.data.rows.map((r) => [r.name, r.rank]));

  // A submission from somebody in no team is refused.
  assert.equal((await api('/api/onyx/contests/' + w.contest + '/submit', {
    token: w.alpha.placement, body: { problem_id: w.problem, submission_id: 1 },
  })).status, 403);
});

// ---------------------------------------------------------------------------
// CAR-02
// ---------------------------------------------------------------------------

test('CAR-02a a learner cannot see another learner\'s feedback', async () => {
  const interview = await api<{ id: number }>('/api/onyx/interviews', {
    token: w.alpha.placement,
    body: {
      user_id: w.ids.s1, interviewer_id: w.ids.placement, title: 'Technical practice',
      scheduled_at: new Date(Date.now() + 86_400_000).toISOString(),
    },
  });
  assert.equal(interview.ok, true, interview.message);
  w.interview = Number(interview.data.id);

  const recorded = await api('/api/onyx/interviews/' + w.interview + '/feedback', {
    token: w.alpha.placement,
    body: {
      feedback: [{ criterion: 'Communication', score: 4, of: 5, comment: 'Clear.' }],
      overall: 4, notes: 'Private note for the office.',
    },
  });
  assert.equal(recorded.ok, true, recorded.message);

  const before = await api<{ feedback: unknown; overall: number | null; notes: string | null }>(
    '/api/onyx/interviews/' + w.interview, { token: w.alpha.s1 });
  // A half-written note read as a verdict is worse than no note.
  assert.equal(before.data.feedback, null);
  assert.equal(before.data.overall, null);
  assert.equal(before.data.notes, null);

  // The acceptance criterion.
  assert.equal((await api('/api/onyx/interviews/' + w.interview,
    { token: w.alpha.s2 })).status, 403, 'a learner read another learner\'s interview');

  await api('/api/onyx/interviews/' + w.interview + '/release',
    { token: w.alpha.placement, method: 'POST' });

  const after = await api<{ overall: number; feedback: unknown[]; notes: string | null }>(
    '/api/onyx/interviews/' + w.interview, { token: w.alpha.s1 });
  assert.equal(after.data.overall, 4);
  assert.equal(Array.isArray(after.data.feedback), true);
  // The interviewer's private notes are never the learner's.
  assert.equal(after.data.notes, null);
  assert.equal(JSON.stringify(after.data).includes('Private note'), false);

  // A recording without consent is not one anybody should keep.
  const recording = await api('/api/onyx/interviews/' + w.interview + '/feedback', {
    token: w.alpha.placement,
    body: {
      feedback: [{ criterion: 'Communication', score: 4, of: 5 }],
      overall: 4, recording_path: 'onyx/1/interviews/x.webm',
    },
  });
  assert.equal(recording.status, 422, recording.message);

  // A released interview feeds the readiness score.
  const profile = await api<{ readiness: { breakdown: { key: string; raw: number }[] } }>(
    '/api/onyx/my/profile', { token: w.alpha.s1 });
  assert.ok(profile.data.readiness.breakdown.find((b) => b.key === 'interview')!.raw > 0,
    'a released interview did not count toward readiness');
});

// ---------------------------------------------------------------------------
// Isolation
// ---------------------------------------------------------------------------

test('nothing added in O05 crosses between institutions', async () => {
  // Collection endpoints are tenant-scoped, so an empty list is the right
  // answer for an institution with none of their own -- what must not happen is
  // reaching a specific id that belongs to somebody else.
  const emptyForBeta = await api<unknown[]>('/api/onyx/employers', { token: w.beta.admin });
  assert.equal(emptyForBeta.ok, true);
  assert.deepEqual(emptyForBeta.data, [], "beta saw another institution's employers");

  const reads = [
    '/api/onyx/jobs/' + w.job,
    '/api/onyx/jobs/' + w.job + '/applicants',
    '/api/onyx/jobs/' + w.job + '/eligibility',
    '/api/onyx/drives/' + w.drive + '/summary',
    '/api/onyx/contests/' + w.contest,
    '/api/onyx/contests/' + w.contest + '/leaderboard',
    '/api/onyx/interviews/' + w.interview,
    '/api/onyx/profiles/' + w.ids.s1,
  ];
  for (const path of reads) {
    const res = await api(path, { token: w.beta.admin });
    assert.ok(res.status === 404 || res.status === 403,
      'beta reached ' + path + ' (' + res.status + ')');
  }

  const writes: [string, unknown][] = [
    ['/api/onyx/jobs/' + w.job + '/apply', {}],
    ['/api/onyx/jobs/' + w.job + '/publish', {}],
    ['/api/onyx/contests/' + w.contest + '/teams', { name: 'Interlopers' }],
    ['/api/onyx/teams/' + w.team + '/join', {}],
    ['/api/onyx/interviews/' + w.interview + '/release', {}],
    ['/api/onyx/certificates/' + w.certificate + '/revoke', { reason: 'theirs' }],
    ['/api/onyx/rounds/' + w.rounds[0] + '/results',
      { entries: [{ user_id: w.ids.s1, outcome: 'passed' }] }],
  ];
  for (const [path, body] of writes) {
    const res = await api(path, { token: w.beta.admin, body });
    assert.ok(res.status === 404 || res.status === 403 || res.status === 422,
      'beta wrote to ' + path + ' (' + res.status + ')');
  }

  // The one route that IS public is public on purpose -- and carries nothing
  // that identifies the institution's people beyond the holder's name.
  const verify = await api('/api/onyx/verify/' + w.credential);
  assert.equal(verify.status, 200, 'the verification page stopped being public');
  assert.equal(JSON.stringify(verify.data).includes(mail('s1')), false);
});

test('RLS confines the O05 tables at the database', async () => {
  for (const k of ['SUPABASE_URL', 'SUPABASE_ANON_KEY']) {
    const { env } = await import('./harness.ts');
    process.env[k] ??= env[k];
  }
  const { onyxTenantClient } = await import('@onyx/core');
  const learner = onyxTenantClient(w.alpha.s1);
  const other = onyxTenantClient(w.alpha.s2);
  const rival = onyxTenantClient(w.beta.admin);

  // Own certificates, own skills, own score.
  const { data: certs } = await learner.from('onyx_certificates').select('user_id, tenant_id');
  for (const c of certs!) {
    assert.equal(c.user_id, w.ids.s1);
    assert.equal(Number(c.tenant_id), w.alpha.id);
  }
  assert.equal((await other.from('onyx_certificates').select('id')).data?.length ?? 0, 0,
    'one learner read another\'s certificates');
  // s2 legitimately has their own score -- computing eligibility created it.
  // What matters is that it is theirs.
  const { data: scores } = await other.from('onyx_readiness_scores').select('user_id');
  for (const row of scores!) {
    assert.equal(row.user_id, w.ids.s2, "a learner read another's readiness score");
  }
  assert.equal((await rival.from('onyx_skills').select('id')).data?.length ?? 0, 0);

  // An employer record carries a named contact and their email; that is the
  // placement office's, not everyone-with-a-login's.
  assert.equal((await learner.from('onyx_employers').select('id')).data?.length ?? 0, 0,
    'employer contacts are readable through PostgREST');

  // A live leaderboard is served through the API, which knows about the freeze.
  assert.equal((await learner.from('onyx_contest_submissions').select('id')).data?.length ?? 0, 0,
    'contest submissions are readable through PostgREST');

  // An open post is meant to be seen -- that is what a job board is.
  const { data: jobs } = await learner.from('onyx_jobs_posted').select('id, status');
  assert.ok(jobs!.every((j) => j.status === 'open'), 'a draft post was readable');

  const { error } = await learner.from('onyx_job_applications')
    .insert({ tenant_id: w.alpha.id, job_id: w.job, user_id: w.ids.s2, status: 'hired' });
  assert.ok(error, 'a learner wrote their own application row directly');
});

test('every O05 table is tenant-scoped, and cleanup leaves nothing behind', async () => {
  await withDb(async (c) => {
    const { rows: missing } = await c.query('SELECT * FROM onyx.assert_tenant_scoped()');
    assert.equal(missing.length, 0,
      'Onyx tables with no tenant_id: ' + missing.map((r) => r.missing).join(', '));

    await c.query('DELETE FROM public."onyx_tenants" WHERE slug = ANY($1)', [[A.slug, B.slug]]);
    await c.query('DELETE FROM public."onyx_users" WHERE email LIKE $1', ['ca.%.' + RUN + '@onyx.test']);

    for (const table of [
      'onyx_certificates', 'onyx_skills', 'onyx_learner_skills', 'onyx_readiness_scores',
      'onyx_employers', 'onyx_jobs_posted', 'onyx_job_applications',
      'onyx_drives', 'onyx_drive_rounds', 'onyx_drive_results',
      'onyx_contests', 'onyx_contest_teams', 'onyx_contest_members',
      'onyx_contest_submissions', 'onyx_mock_interviews',
    ]) {
      const { rows: [left] } = await c.query(
        'SELECT count(*)::int c FROM public."' + table + '" t '
        + 'LEFT JOIN public."onyx_tenants" n ON n.id = t.tenant_id WHERE n.id IS NULL');
      assert.equal(left.c, 0, table + ' outlived its institution');
    }
  });

  // And the credential stops verifying once the institution is gone.
  const gone = await api('/api/onyx/verify/' + w.credential);
  assert.equal(gone.data.reason, 'not_found');
});
