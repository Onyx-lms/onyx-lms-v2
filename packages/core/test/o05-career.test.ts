/**
 * Onyx O05 unit tests -- Onyx Career.
 *
 * The claims worth checking without a database: that a public credential leaks
 * nothing, that a skill always carries its evidence, that the readiness formula
 * adds up, that eligibility is computed rather than asserted, and that a
 * leaderboard is the same board however the rows arrive.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeDb } from './fake-db.ts';
import { AcademicsService } from '../src/onyx/academics.service.ts';
import { AttendanceService } from '../src/onyx/attendance.service.ts';
import {
  CareerService, READINESS_WEIGHTS, newCredentialId,
} from '../src/onyx/career.service.ts';
import { PlacementService } from '../src/onyx/placement.service.ts';
import { ContestService } from '../src/onyx/contest.service.ts';
import { HttpError } from '../src/http/errors.ts';

const T = 1;
const OTHER = 2;
const START = 1_800_000_000_000;

function clock(at = START) {
  let t = at;
  return { now: () => t, advance: (ms: number) => { t += ms; } };
}

function world(c = clock()) {
  const db = new FakeDb({
    onyx_tenants: [
      { id: T, name: 'Career University', slug: 'career', status: 1 },
      { id: OTHER, name: 'Rival', slug: 'rival', status: 1 },
    ],
    onyx_users: [
      { id: 'user-10', name: 'Ada Lovelace', email: 'ada@onyx.test' },
      { id: 'user-11', name: 'Grace Hopper', email: 'grace@onyx.test' },
      { id: 'user-20', name: 'Placement', email: 'placement@onyx.test' },
      { id: 'user-30', name: 'Employer Rep', email: 'rep@acme.test' },
    ],
    onyx_courses: [
      { id: 1, tenant_id: T, code: 'CS101', title: 'Programming', slug: 'p', status: 1 },
    ],
    onyx_enrollments: [{ id: 1, tenant_id: T, course_id: 1, user_id: 'user-10', status: 1 }],
    // A profile is only computed for somebody who is actually at the
    // institution, so the memberships have to be here too.
    onyx_memberships: [
      { id: 1, tenant_id: T, user_id: 'user-10', role: 'student', status: 1 },
      { id: 2, tenant_id: T, user_id: 'user-11', role: 'student', status: 1 },
      { id: 3, tenant_id: T, user_id: 'user-20', role: 'placement', status: 1 },
      { id: 4, tenant_id: T, user_id: 'user-30', role: 'employer', status: 1 },
    ],
    onyx_attendance_sessions: [],
    onyx_attendance_records: [],
    onyx_certificates: [],
    onyx_skills: [],
    onyx_learner_skills: [],
    onyx_readiness_scores: [],
    onyx_employers: [],
    onyx_jobs_posted: [],
    onyx_job_applications: [],
    onyx_drives: [],
    onyx_drive_rounds: [],
    onyx_drive_results: [],
    onyx_contests: [],
    onyx_contest_teams: [],
    onyx_contest_members: [],
    onyx_contest_submissions: [],
    onyx_mock_interviews: [],
    onyx_assessment_attempts: [],
    onyx_code_submissions: [],
    onyx_workspaces: [],
    onyx_workspace_snapshots: [],
    onyx_batch_members: [],
    onyx_problems: [],
  });
  const academics = new AcademicsService(db as never);
  const attendance = new AttendanceService(db as never, academics, c.now);
  const career = new CareerService(db as never, academics, attendance, c.now);
  return {
    db, clock: c, career,
    placement: new PlacementService(db as never, career, attendance, c.now),
    contests: new ContestService(db as never, c.now),
  };
}

// ---------------------------------------------------------------------------
// CAR-03 -- certificates
// ---------------------------------------------------------------------------

test('a credential id is long, random and not a serial number', () => {
  const a = newCredentialId();
  const b = newCredentialId();
  assert.match(a, /^[0-9A-F]{32}$/);
  // A sequential id would let anyone enumerate an institution's graduates.
  assert.notEqual(a, b);
});

test('CAR-03a: a public verification exposes no personal data beyond the name', async () => {
  const w = world();
  const cert = await w.career.issueCertificate(T, 'user-20', {
    user_id: 'user-10', title: 'Programming Fundamentals',
    detail: {
      score: 88, grade: 'A',
      // Things a caller might pass in that must never reach a public page.
      email: 'ada@onyx.test', phone: '0123', internal_note: 'borderline',
    },
  });

  const result = await w.career.verify(String(cert.credential_id));
  assert.equal(result.valid, true);
  assert.equal(result.holder, 'Ada Lovelace');
  assert.equal(result.issuer, 'Career University');

  const wire = JSON.stringify(result);
  assert.equal(wire.includes('ada@onyx.test'), false, 'an email reached the public page');
  assert.equal(wire.includes('0123'), false, 'a phone number reached the public page');
  assert.equal(wire.includes('borderline'), false, 'an internal note reached the public page');
  // What the issuer chose to state does appear -- that is the point of it.
  assert.equal((result.detail as Record<string, unknown>).score, 88);
  assert.equal((result.detail as Record<string, unknown>).grade, 'A');
  // And nothing identifying beyond the name.
  assert.equal((result as Record<string, unknown>).user_id, undefined);
  assert.equal((result as Record<string, unknown>).tenant_id, undefined);
});

test('an unknown credential and a revoked one answer differently, on purpose', async () => {
  const w = world();
  const missing = await w.career.verify('F'.repeat(32));
  assert.equal(missing.valid, false);
  assert.equal(missing.reason, 'not_found');

  const cert = await w.career.issueCertificate(T, 'user-20', { user_id: 'user-10', title: 'Course' });
  await w.career.revokeCertificate(T, Number(cert.id), 'issued in error');
  const revoked = await w.career.verify(String(cert.credential_id));
  // A verifier holding a revoked credential is entitled to know it was revoked
  // rather than being told it never existed.
  assert.equal(revoked.valid, false);
  assert.equal(revoked.reason, 'revoked');
  assert.equal(revoked.holder, 'Ada Lovelace');

  await assert.rejects(w.career.revokeCertificate(T, Number(cert.id), 'again'),
    (e: HttpError) => e.status === 422);
});

test('an expired certificate is invalid but still verifiable', async () => {
  const c = clock();
  const w = world(c);
  const cert = await w.career.issueCertificate(T, 'user-20', {
    user_id: 'user-10', title: 'Time-limited',
    expires_at: new Date(START + 86_400_000).toISOString(),
  });
  assert.equal((await w.career.verify(String(cert.credential_id))).valid, true);

  c.advance(2 * 86_400_000);
  const later = await w.career.verify(String(cert.credential_id));
  assert.equal(later.valid, false);
  assert.equal(later.reason, 'expired');
});

test('verification is not tenant-scoped, because a verifier is a stranger', async () => {
  const w = world();
  const cert = await w.career.issueCertificate(T, 'user-20', { user_id: 'user-10', title: 'Course' });
  // No tenant is passed at all: somebody holding a credential has no idea which
  // institution issued it, and requiring them to know would make it useless.
  const result = await w.career.verify(String(cert.credential_id));
  assert.equal(result.valid, true);
  assert.equal(result.issuer, 'Career University');
});

// ---------------------------------------------------------------------------
// CAR-05 -- skills and readiness
// ---------------------------------------------------------------------------

test('CAR-05a: every skill on a profile links to the evidence that produced it', async () => {
  const w = world();
  const skill = await w.career.createSkill(T, { name: 'Python', category: 'Language' });
  await w.career.awardSkill(T, {
    user_id: 'user-10', skill_id: Number(skill.id), source_type: 'certificate',
    source_id: 7, strength: 80, evidence: { title: 'Data Structures' },
  });
  await w.career.awardSkill(T, {
    user_id: 'user-10', skill_id: Number(skill.id), source_type: 'problem',
    source_id: 3, strength: 60,
  });

  const [entry] = await w.career.passport(T, 'user-10');
  assert.equal(entry!.name, 'Python');
  // The mean, not the best: one excellent piece of work does not make somebody
  // good at something.
  assert.equal(entry!.level, 70);
  assert.equal(entry!.evidence_count, 2);
  assert.deepEqual(entry!.evidence.map((e) => e.source_type).sort(),
    ['certificate', 'problem']);
  for (const e of entry!.evidence) {
    assert.ok(e.source_type, 'a skill entry had no evidence type');
    assert.equal(typeof e.strength, 'number');
  }
});

test('the same evidence cannot count twice for the same skill', async () => {
  const w = world();
  const skill = await w.career.createSkill(T, { name: 'SQL' });
  const award = () => w.career.awardSkill(T, {
    user_id: 'user-10', skill_id: Number(skill.id), source_type: 'course', source_id: 1, strength: 70,
  });
  await award();
  await award();
  // Re-running the derivation has to be safe: it runs whenever a profile opens.
  assert.equal((await w.career.passport(T, 'user-10'))[0]!.evidence_count, 1);
});

test('a duplicate skill name is refused, and a nonsense one too', async () => {
  const w = world();
  await w.career.createSkill(T, { name: 'Python' });
  await assert.rejects(w.career.createSkill(T, { name: 'Python' }),
    (e: HttpError) => e.status === 422);
  await assert.rejects(w.career.createSkill(T, { name: '!!!' }),
    (e: HttpError) => e.status === 422);
});

test('CAR-05b: the readiness formula is published, weighted and adds up', async () => {
  const w = world();
  const score = await w.career.computeReadiness(T, 'user-10');

  // Published rather than tuned in secret.
  assert.equal(Object.values(READINESS_WEIGHTS).reduce((a, b) => a + b, 0), 100);
  assert.deepEqual(score.formula, READINESS_WEIGHTS);
  assert.deepEqual(score.breakdown.map((b) => b.key),
    ['attendance', 'assessment', 'practice', 'projects', 'interview']);

  // Nothing done yet, so nothing earned -- a missing component contributes
  // zero rather than a flattering default.
  assert.equal(score.score, 0);
  for (const c of score.breakdown) {
    assert.equal(c.raw, 0);
    assert.equal(c.points, 0);
    assert.ok(c.detail, 'a component showed no working');
    assert.equal(c.weight, READINESS_WEIGHTS[c.key]);
  }
});

test('CAR-05b: the learner can see exactly why their score is what it is', async () => {
  const w = world();
  // Four problems solved out of the ten that count, and one project with a
  // snapshot out of the three that count.
  w.db.tables.onyx_code_submissions = [1, 2, 3, 4].map((problem_id, i) => ({
    id: i + 1, tenant_id: T, user_id: 'user-10', problem_id,
    score: 10, max_score: 10, status: 'done', mode: 'submit',
  }));
  w.db.tables.onyx_workspaces = [{ id: 1, tenant_id: T, user_id: 'user-10' }];
  w.db.tables.onyx_workspace_snapshots = [{ id: 1, tenant_id: T, workspace_id: 1 }];
  // One published assessment at 80%.
  w.db.tables.onyx_assessment_attempts = [
    { id: 1, tenant_id: T, user_id: 'user-10', score: 8, max_score: 10, status: 'published' },
  ];

  const score = await w.career.computeReadiness(T, 'user-10');
  const by = Object.fromEntries(score.breakdown.map((b) => [b.key, b]));

  // 4 of 10 -> 0.4 * 20 = 8.
  assert.equal(by.practice!.raw, 0.4);
  assert.equal(by.practice!.points, 8);
  assert.deepEqual(by.practice!.detail, { problems_solved: 4, counts_up_to: 10 });

  // 1 of 3 -> 0.333 * 15 = 5.
  assert.equal(by.projects!.raw, 0.333);
  assert.equal(by.projects!.points, 5);

  // 80% -> 0.8 * 30 = 24.
  assert.equal(by.assessment!.raw, 0.8);
  assert.equal(by.assessment!.points, 24);

  // 8 + 5 + 24 = 37, with attendance and interview at zero.
  assert.equal(score.score, 37);
  assert.equal(
    Math.round(score.breakdown.reduce((t, c) => t + c.points, 0) * 100) / 100,
    score.score, 'the components do not add up to the score');
});

test('an unpublished assessment result does not count toward readiness', async () => {
  const w = world();
  w.db.tables.onyx_assessment_attempts = [
    // Marked but not released: scoring somebody on it would be scoring them on
    // a secret.
    { id: 1, tenant_id: T, user_id: 'user-10', score: 10, max_score: 10, status: 'graded' },
  ];
  const score = await w.career.computeReadiness(T, 'user-10');
  assert.equal(score.breakdown.find((b) => b.key === 'assessment')!.raw, 0);
});

test('a profile is the learner\'s own or the placement office\'s', async () => {
  const w = world();
  assert.ok(await w.career.profile(T, 'user-10', { role: 'student', userId: 'user-10' }));
  assert.ok(await w.career.profile(T, 'user-10', { role: 'placement', userId: 'user-20' }));
  assert.ok(await w.career.profile(T, 'user-10', { role: 'admin', userId: 'user-20' }));
  await assert.rejects(w.career.profile(T, 'user-10', { role: 'student', userId: 'user-11' }),
    (e: HttpError) => e.status === 403);
  // Faculty teach; a skills passport is not theirs to browse.
  await assert.rejects(w.career.profile(T, 'user-10', { role: 'faculty', userId: 'user-20' }),
    (e: HttpError) => e.status === 403);
  await assert.rejects(w.career.profile(T, 'user-10', { role: 'employer', userId: 'user-30' }),
    (e: HttpError) => e.status === 403);

  // User ids are global. Somebody who has never been near this institution has
  // no profile here, and computing one would also store a score for them.
  await assert.rejects(w.career.profile(T, 'user-999', { role: 'admin', userId: 'user-20' }),
    (e: HttpError) => e.status === 404);
  await assert.rejects(w.career.profile(OTHER, 'user-10', { role: 'admin', userId: 'user-20' }),
    (e: HttpError) => e.status === 404);
});

test('a revoked certificate leaves the profile', async () => {
  const w = world();
  const cert = await w.career.issueCertificate(T, 'user-20', { user_id: 'user-10', title: 'Course' });
  assert.equal((await w.career.profile(T, 'user-10', { role: 'student', userId: 'user-10' }))
    .certificates.length, 1);
  await w.career.revokeCertificate(T, Number(cert.id), 'error');
  assert.equal((await w.career.profile(T, 'user-10', { role: 'student', userId: 'user-10' }))
    .certificates.length, 0);
});

// ---------------------------------------------------------------------------
// CAR-04 -- placement
// ---------------------------------------------------------------------------

async function withJob(w: ReturnType<typeof world>, over: Record<string, unknown> = {}) {
  const employer = await w.placement.createEmployer(T, 'user-20', { name: 'Acme Ltd', user_id: 'user-30' });
  const job = await w.placement.createJob(T, 'user-20', { role: 'placement', userId: 'user-20' }, {
    employer_id: Number(employer.id), title: 'Graduate Engineer', ...over,
  });
  await w.placement.publishJob(T, Number(job.id), { role: 'placement', userId: 'user-20' });
  return { employer: Number(employer.id), job: Number(job.id) };
}

test('CAR-04a: an employer sees only their own company', async () => {
  const w = world();
  const mine = await w.placement.createEmployer(T, 'user-20', { name: 'Acme Ltd', user_id: 'user-30' });
  const theirs = await w.placement.createEmployer(T, 'user-20', { name: 'Rival Ltd' });
  const viewer = { role: 'employer' as const, userId: 'user-30' };

  assert.ok(await w.placement.assertEmployerOwns(T, Number(mine.id), viewer));
  await assert.rejects(w.placement.assertEmployerOwns(T, Number(theirs.id), viewer),
    (e: HttpError) => e.status === 403);
  // Placement staff may act on any employer in their institution.
  assert.ok(await w.placement.assertEmployerOwns(T, Number(theirs.id),
    { role: 'placement', userId: 'user-20' }));
  // A learner is not an employer at all.
  await assert.rejects(w.placement.assertEmployerOwns(T, Number(mine.id),
    { role: 'student', userId: 'user-10' }), (e: HttpError) => e.status === 403);
});

test('an employer\'s job list is their own and nobody else\'s', async () => {
  const w = world();
  const { employer } = await withJob(w);
  const rival = await w.placement.createEmployer(T, 'user-20', { name: 'Rival Ltd' });
  await w.placement.createJob(T, 'user-20', { role: 'placement', userId: 'user-20' }, {
    employer_id: Number(rival.id), title: 'Rival Role',
  });

  const asEmployer = await w.placement.jobs(T, { role: 'employer', userId: 'user-30' });
  assert.equal(asEmployer.length, 1);
  assert.equal(Number(asEmployer[0]!.employer_id), employer);

  // A learner sees the open board; staff see everything.
  assert.equal((await w.placement.jobs(T, { role: 'student', userId: 'user-10' })).length, 1);
  assert.equal((await w.placement.jobs(T, { role: 'placement', userId: 'user-20' })).length, 2);
  // An employer contact with no company sees nothing rather than everything.
  assert.deepEqual(await w.placement.jobs(T, { role: 'employer', userId: 'user-99' }), []);
});

test('publishing a post is the institution\'s act, not the employer\'s', async () => {
  const w = world();
  const employer = await w.placement.createEmployer(T, 'user-20', { name: 'Acme', user_id: 'user-30' });
  const job = await w.placement.createJob(T, 'user-20', { role: 'employer', userId: 'user-30' }, {
    employer_id: Number(employer.id), title: 'Role',
  });
  assert.equal(job.status, 'draft');
  await assert.rejects(
    w.placement.publishJob(T, Number(job.id), { role: 'employer', userId: 'user-30' }),
    (e: HttpError) => e.status === 403);
  assert.equal((await w.placement.publishJob(T, Number(job.id),
    { role: 'placement', userId: 'user-20' })).status, 'open');
});

test('CAR-04b: eligibility is computed, and every rule reports its numbers', async () => {
  const w = world();
  const skill = await w.career.createSkill(T, { name: 'Python' });
  const { job } = await withJob(w, {
    min_readiness: 10, required_skills: [Number(skill.id)],
  });

  const before = await w.placement.eligibility(T, job, 'user-10');
  assert.equal(before.eligible, false);
  assert.equal(before.checks.length, 2);
  // A learner who cannot apply is told exactly what is missing rather than
  // shown a greyed-out button.
  const skills = before.checks.find((c) => c.rule === 'Skills')!;
  assert.equal(skills.met, false);
  assert.equal(skills.actual, '0 held');
  const readiness = before.checks.find((c) => c.rule === 'Readiness score')!;
  assert.equal(readiness.required, 'at least 10');
  assert.equal(readiness.actual, '0');

  // Give them the skill and something to score on.
  await w.career.awardSkill(T, {
    user_id: 'user-10', skill_id: Number(skill.id), source_type: 'course', source_id: 1, strength: 80,
  });
  w.db.tables.onyx_assessment_attempts = [
    { id: 1, tenant_id: T, user_id: 'user-10', score: 10, max_score: 10, status: 'published' },
  ];

  const after = await w.placement.eligibility(T, job, 'user-10');
  assert.equal(after.eligible, true, JSON.stringify(after.checks));
  assert.equal(after.checks.every((c) => c.met), true);
});

test('an ineligible learner cannot apply, and the refusal names the reason', async () => {
  const w = world();
  const skill = await w.career.createSkill(T, { name: 'Python' });
  const { job } = await withJob(w, { required_skills: [Number(skill.id)] });

  await assert.rejects(w.placement.apply(T, job, 'user-10'), (e: HttpError) =>
    e.status === 422 && /Skills/.test(e.message));

  await w.career.awardSkill(T, {
    user_id: 'user-10', skill_id: Number(skill.id), source_type: 'course', source_id: 1,
  });
  const applied = await w.placement.apply(T, job, 'user-10', 'Keen.');
  assert.equal(applied.status, 'applied');
  // Kept, so a later change to their record cannot rewrite whether they were
  // eligible at the time.
  assert.notEqual(applied.readiness_at_apply, undefined);

  await assert.rejects(w.placement.apply(T, job, 'user-10'), (e: HttpError) => e.status === 422);
});

test('a closed or unpublished post takes no applications', async () => {
  const c = clock();
  const w = world(c);
  const employer = await w.placement.createEmployer(T, 'user-20', { name: 'Acme' });
  const draft = await w.placement.createJob(T, 'user-20', { role: 'placement', userId: 'user-20' }, {
    employer_id: Number(employer.id), title: 'Draft',
  });
  await assert.rejects(w.placement.apply(T, Number(draft.id), 'user-10'),
    (e: HttpError) => e.status === 422);

  const { job } = await withJob(w, { closes_at: new Date(START + 1000).toISOString() });
  c.advance(60_000);
  await assert.rejects(w.placement.apply(T, job, 'user-10'), (e: HttpError) => e.status === 422);
});

test('only the candidate withdraws, and only the employer decides', async () => {
  const w = world();
  const { job } = await withJob(w);
  const applied = await w.placement.apply(T, job, 'user-10');
  const id = Number(applied.id);

  await assert.rejects(w.placement.decide(T, id, { role: 'employer', userId: 'user-30' },
    { status: 'withdrawn' }), (e: HttpError) => e.status === 422);
  await assert.rejects(w.placement.withdraw(T, id, 'user-11'), (e: HttpError) => e.status === 403);

  assert.equal((await w.placement.decide(T, id, { role: 'employer', userId: 'user-30' },
    { status: 'shortlisted' })).status, 'shortlisted');
  assert.equal((await w.placement.withdraw(T, id, 'user-10')).status, 'withdrawn');
});

test('an employer cannot read another employer\'s applicants', async () => {
  const w = world();
  const rival = await w.placement.createEmployer(T, 'user-20', { name: 'Rival Ltd' });
  const rivalJob = await w.placement.createJob(T, 'user-20', { role: 'placement', userId: 'user-20' }, {
    employer_id: Number(rival.id), title: 'Rival Role',
  });
  await w.placement.createEmployer(T, 'user-20', { name: 'Acme', user_id: 'user-30' });
  await assert.rejects(
    w.placement.applicants(T, Number(rivalJob.id), { role: 'employer', userId: 'user-30' }),
    (e: HttpError) => e.status === 403);
});

test('CAR-04c: a drive reconciles its rounds with the offers recorded', async () => {
  const w = world();
  const { employer, job } = await withJob(w);
  const drive = await w.placement.createDrive(T, 'user-20', {
    employer_id: employer, job_id: job, title: 'Campus drive',
    rounds: [{ name: 'Aptitude' }, { name: 'Technical' }],
  });
  const driveId = Number(drive.id);

  const rounds = (await w.placement.driveSummary(T, driveId)).rounds;
  assert.deepEqual(rounds.map((r) => r.name), ['Aptitude', 'Technical']);

  await w.placement.recordRound(T, rounds[0]!.round_id, 'user-20', [
    { user_id: 'user-10', outcome: 'passed' }, { user_id: 'user-11', outcome: 'failed' },
  ]);
  await w.placement.recordRound(T, rounds[1]!.round_id, 'user-20', [
    { user_id: 'user-10', outcome: 'passed' },
  ]);

  const before = await w.placement.driveSummary(T, driveId);
  assert.equal(before.rounds[0]!.passed, 1);
  assert.equal(before.rounds[0]!.failed, 1);
  assert.equal(before.cleared_final_round, 1);
  assert.equal(before.offers, 0);
  assert.equal(before.reconciles, false);
  // Named rather than merely counted.
  assert.deepEqual(before.cleared_without_offer, ['user-10']);

  const applied = await w.placement.apply(T, job, 'user-10');
  await w.placement.decide(T, Number(applied.id), { role: 'placement', userId: 'user-20' },
    { status: 'offered' });

  const after = await w.placement.driveSummary(T, driveId);
  assert.equal(after.offers, 1);
  assert.equal(after.reconciles, true);
  assert.deepEqual(after.cleared_without_offer, []);
  assert.deepEqual(after.offered_without_clearing, []);
});

test('recording a round twice amends rather than duplicating', async () => {
  const w = world();
  const { employer } = await withJob(w);
  const drive = await w.placement.createDrive(T, 'user-20', {
    employer_id: employer, title: 'Drive', rounds: [{ name: 'Only round' }],
  });
  const [round] = (await w.placement.driveSummary(T, Number(drive.id))).rounds;

  assert.deepEqual(await w.placement.recordRound(T, round!.round_id, 'user-20',
    [{ user_id: 'user-10', outcome: 'attended' }]), { created: 1, amended: 0 });
  assert.deepEqual(await w.placement.recordRound(T, round!.round_id, 'user-20',
    [{ user_id: 'user-10', outcome: 'passed' }]), { created: 0, amended: 1 });
  assert.equal((await w.placement.driveSummary(T, Number(drive.id))).rounds[0]!.passed, 1);

  await assert.rejects(w.placement.recordRound(T, round!.round_id, 'user-20',
    [{ user_id: 'user-10', outcome: 'maybe' as never }]), (e: HttpError) => e.status === 422);
});

// ---------------------------------------------------------------------------
// CAR-01 -- contests
// ---------------------------------------------------------------------------

async function withContest(w: ReturnType<typeof world>, over: Record<string, unknown> = {}) {
  w.db.tables.onyx_problems = [
    { id: 1, tenant_id: T, title: 'A', slug: 'a', status: 'published' },
    { id: 2, tenant_id: T, title: 'B', slug: 'b', status: 'published' },
  ];
  const contest = await w.contests.create(T, 'user-20', {
    title: 'Spring Hack',
    starts_at: new Date(START).toISOString(),
    ends_at: new Date(START + 3 * 3_600_000).toISOString(),
    problems: [{ problem_id: 1, points: 100 }, { problem_id: 2, points: 100 }],
    team_size: 2,
    penalty_minutes: 20,
    ...over,
  });
  await w.contests.publish(T, Number(contest.id));
  return Number(contest.id);
}

/** Writes a graded Code Lab submission and records it against the contest. */
async function attempt(
  w: ReturnType<typeof world>, contestId: number, userId: string,
  problemId: number, solved: boolean,
) {
  const rows = w.db.tables.onyx_code_submissions as Record<string, unknown>[];
  const id = rows.length + 1;
  rows.push({
    id, tenant_id: T, user_id: userId, problem_id: problemId,
    score: solved ? 10 : 0, max_score: 10, status: 'done', mode: 'submit',
  });
  return w.contests.recordSubmission(T, contestId, userId, {
    problem_id: problemId, submission_id: id,
  });
}

test('a contest refuses an unpublished problem and a backwards window', async () => {
  const w = world();
  w.db.tables.onyx_problems = [{ id: 1, tenant_id: T, title: 'Draft', status: 'draft' }];
  await assert.rejects(w.contests.create(T, 'user-20', {
    title: 'x', starts_at: new Date(START).toISOString(),
    ends_at: new Date(START + 3_600_000).toISOString(),
    problems: [{ problem_id: 1, points: 100 }],
  }), (e: HttpError) => e.status === 422);

  await assert.rejects(w.contests.create(T, 'user-20', {
    title: 'x', starts_at: new Date(START + 3_600_000).toISOString(),
    ends_at: new Date(START).toISOString(),
  }), (e: HttpError) => e.status === 422);
});

test('a person is in one team per contest, and a full team takes nobody else', async () => {
  const w = world();
  const id = await withContest(w, { team_size: 1 });
  const team = await w.contests.createTeam(T, id, 'user-10', 'Team One');

  // Two teams would make the leaderboard a lie.
  await assert.rejects(w.contests.createTeam(T, id, 'user-10', 'Team Two'),
    (e: HttpError) => e.status === 422);
  await assert.rejects(w.contests.joinTeam(T, Number(team.id), 'user-11'),
    (e: HttpError) => e.status === 422);
});

test('teams cannot be formed once the contest is over', async () => {
  const c = clock();
  const w = world(c);
  const id = await withContest(w);
  c.advance(4 * 3_600_000);
  await assert.rejects(w.contests.createTeam(T, id, 'user-10', 'Latecomers'),
    (e: HttpError) => e.status === 422);
});

test('a submission has to be the caller\'s, graded, and for a contest problem', async () => {
  const c = clock();
  const w = world(c);
  const id = await withContest(w);
  await w.contests.createTeam(T, id, 'user-10', 'Team One');

  (w.db.tables.onyx_code_submissions as Record<string, unknown>[]).push(
    { id: 1, tenant_id: T, user_id: 'user-11', problem_id: 1, score: 10, max_score: 10, status: 'done' },
    { id: 2, tenant_id: T, user_id: 'user-10', problem_id: 1, score: 0, max_score: 10, status: 'queued' },
    { id: 3, tenant_id: T, user_id: 'user-10', problem_id: 9, score: 10, max_score: 10, status: 'done' },
  );

  await assert.rejects(w.contests.recordSubmission(T, id, 'user-10',
    { problem_id: 1, submission_id: 1 }), (e: HttpError) => e.status === 403);
  await assert.rejects(w.contests.recordSubmission(T, id, 'user-10',
    { problem_id: 1, submission_id: 2 }), (e: HttpError) => e.status === 422);
  await assert.rejects(w.contests.recordSubmission(T, id, 'user-10',
    { problem_id: 9, submission_id: 3 }), (e: HttpError) => e.status === 422);
  // Not in a team at all.
  await assert.rejects(w.contests.recordSubmission(T, id, 'user-11',
    { problem_id: 1, submission_id: 1 }), (e: HttpError) => e.status === 403);
});

test('CAR-01a: the leaderboard is correct -- points, penalty and first solve', async () => {
  const c = clock();
  const w = world(c);
  const id = await withContest(w);
  await w.contests.createTeam(T, id, 'user-10', 'Alpha');
  await w.contests.createTeam(T, id, 'user-11', 'Beta');

  // Alpha: two wrong attempts at problem 1, then a solve at minute 30.
  await attempt(w, id, 'user-10', 1, false);
  await attempt(w, id, 'user-10', 1, false);
  c.advance(30 * 60_000);
  await attempt(w, id, 'user-10', 1, true);
  // A later submission on a solved problem changes nothing.
  c.advance(10 * 60_000);
  await attempt(w, id, 'user-10', 1, true);
  // ...and a wrong attempt at a problem never solved costs nothing.
  await attempt(w, id, 'user-10', 2, false);

  // Beta: solves problem 1 at minute 40, first time.
  await attempt(w, id, 'user-11', 1, true);

  const board = await w.contests.leaderboard(T, id, { role: 'student' });
  const alpha = board.rows.find((r) => r.name === 'Alpha')!;
  const beta = board.rows.find((r) => r.name === 'Beta')!;

  assert.equal(alpha.points, 100);
  // 30 minutes to the solve + two wrong attempts at 20 minutes each.
  assert.equal(alpha.penalty, 70);
  assert.equal(alpha.problems.find((p) => p.problem_id === 1)!.attempts, 3);
  assert.equal(alpha.problems.find((p) => p.problem_id === 2)!.solved, false);

  assert.equal(beta.points, 100);
  // 40 minutes, no wrong attempts.
  assert.equal(beta.penalty, 40);

  // Level on points, so the lower penalty wins.
  assert.equal(board.rows[0]!.name, 'Beta');
  assert.equal(board.rows[0]!.rank, 1);
  assert.equal(board.rows[1]!.rank, 2);
});

test('CAR-01a: the leaderboard is stable whatever order the rows arrive in', async () => {
  const c = clock();
  const w = world(c);
  const id = await withContest(w);
  await w.contests.createTeam(T, id, 'user-10', 'Alpha');
  await w.contests.createTeam(T, id, 'user-11', 'Beta');
  await attempt(w, id, 'user-10', 1, true);
  await attempt(w, id, 'user-11', 1, true);

  const first = await w.contests.leaderboard(T, id, { role: 'student' });

  // The same submissions, returned in the opposite order -- which is what a
  // database is entitled to do without an ORDER BY.
  const rows = w.db.tables.onyx_contest_submissions as Record<string, unknown>[];
  w.db.tables.onyx_contest_submissions = [...rows].reverse();
  const second = await w.contests.leaderboard(T, id, { role: 'student' });

  assert.deepEqual(
    second.rows.map((r) => [r.name, r.points, r.penalty, r.rank]),
    first.rows.map((r) => [r.name, r.points, r.penalty, r.rank]),
    'the board changed when the rows came back in a different order');

  // Teams level on every tie-break share a rank.
  assert.equal(first.rows[0]!.rank, 1);
  assert.equal(first.rows[1]!.rank, 1);
});

test('a frozen board hides the closing minutes from everyone but staff', async () => {
  const c = clock();
  const w = world(c);
  // Three hours long, frozen for the last thirty minutes.
  const id = await withContest(w, { freeze_minutes: 30 });
  await w.contests.createTeam(T, id, 'user-10', 'Alpha');

  c.advance(170 * 60_000);
  await attempt(w, id, 'user-10', 1, true);

  const learner = await w.contests.leaderboard(T, id, { role: 'student' });
  assert.equal(learner.frozen, true);
  assert.equal(learner.frozen_after_minute, 150);
  assert.equal(learner.rows[0]!.points, 0, 'a frozen board showed a late solve');

  // Somebody has to be able to see the real board.
  const staff = await w.contests.leaderboard(T, id, { role: 'admin' });
  assert.equal(staff.frozen, false);
  assert.equal(staff.rows[0]!.points, 100);

  // Once the contest is over there is nothing left to be surprised by.
  c.advance(60 * 60_000);
  const afterwards = await w.contests.leaderboard(T, id, { role: 'student' });
  assert.equal(afterwards.frozen, false);
  assert.equal(afterwards.rows[0]!.points, 100);
});

// ---------------------------------------------------------------------------
// CAR-02 -- mock interviews
// ---------------------------------------------------------------------------

test('CAR-02a: a learner cannot see another learner\'s feedback', async () => {
  const w = world();
  const interview = await w.contests.scheduleInterview(T, {
    user_id: 'user-10', interviewer_id: 'user-20', title: 'Practice',
    scheduled_at: new Date(START + 86_400_000).toISOString(),
  });
  const id = Number(interview.id);
  await w.contests.recordFeedback(T, id, { role: 'placement', userId: 'user-20' }, {
    feedback: [{ criterion: 'Communication', score: 4, of: 5 }],
    overall: 4, notes: 'Private note.', release: true,
  });

  const own = await w.contests.interview(T, id, { role: 'student', userId: 'user-10' });
  assert.equal(own.overall, 4);
  // The interviewer's private notes are never the learner's.
  assert.equal(own.notes, null);

  await assert.rejects(w.contests.interview(T, id, { role: 'student', userId: 'user-11' }),
    (e: HttpError) => e.status === 403);
});

test('feedback is written before it is released, and released deliberately', async () => {
  const w = world();
  const interview = await w.contests.scheduleInterview(T, {
    user_id: 'user-10', interviewer_id: 'user-20', title: 'Practice',
    scheduled_at: new Date(START).toISOString(),
  });
  const id = Number(interview.id);

  await w.contests.recordFeedback(T, id, { role: 'placement', userId: 'user-20' }, {
    feedback: [{ criterion: 'Depth', score: 3, of: 5 }], overall: 3,
  });

  // A half-written note read as a verdict is worse than no note.
  const before = await w.contests.interview(T, id, { role: 'student', userId: 'user-10' });
  assert.equal(before.feedback, null);
  assert.equal(before.overall, null);
  assert.equal(before.feedback_released, false);
  // The interviewer sees their own work in progress.
  assert.ok((await w.contests.interview(T, id, { role: 'placement', userId: 'user-20' })).feedback);

  await w.contests.releaseFeedback(T, id, { role: 'placement', userId: 'user-20' });
  const after = await w.contests.interview(T, id, { role: 'student', userId: 'user-10' });
  assert.equal(after.overall, 3);
  assert.equal(after.feedback_released, true);
});

test('only the interviewer records feedback, and the scores have to fit', async () => {
  const w = world();
  const interview = await w.contests.scheduleInterview(T, {
    user_id: 'user-10', interviewer_id: 'user-20', title: 'Practice',
    scheduled_at: new Date(START).toISOString(),
  });
  const id = Number(interview.id);

  await assert.rejects(w.contests.recordFeedback(T, id, { role: 'student', userId: 'user-10' }, {
    feedback: [{ criterion: 'Self', score: 5, of: 5 }], overall: 5,
  }), (e: HttpError) => e.status === 403);

  await assert.rejects(w.contests.recordFeedback(T, id, { role: 'placement', userId: 'user-20' }, {
    feedback: [{ criterion: 'Depth', score: 9, of: 5 }], overall: 3,
  }), (e: HttpError) => e.status === 422);

  await assert.rejects(w.contests.recordFeedback(T, id, { role: 'placement', userId: 'user-20' }, {
    feedback: [{ criterion: 'Depth', score: 3, of: 5 }], overall: 9,
  }), (e: HttpError) => e.status === 422);
});

test('a recording needs consent, and its location is never the learner\'s to know', async () => {
  const w = world();
  const interview = await w.contests.scheduleInterview(T, {
    user_id: 'user-10', interviewer_id: 'user-20', title: 'Practice',
    scheduled_at: new Date(START).toISOString(),
  });
  const id = Number(interview.id);

  await assert.rejects(w.contests.recordFeedback(T, id, { role: 'placement', userId: 'user-20' }, {
    feedback: [{ criterion: 'Depth', score: 3, of: 5 }], overall: 3,
    recording_path: 'onyx/1/interviews/x.webm',
  }), (e: HttpError) => e.status === 422);

  await w.contests.recordFeedback(T, id, { role: 'placement', userId: 'user-20' }, {
    feedback: [{ criterion: 'Depth', score: 3, of: 5 }], overall: 3,
    recording_path: 'onyx/1/interviews/x.webm', recording_consented: true, release: true,
  });
  const seen = await w.contests.interview(T, id, { role: 'student', userId: 'user-10' });
  assert.equal(seen.has_recording, true);
  assert.equal((seen as Record<string, unknown>).recording_path, undefined,
    'the recording path reached the learner');
});

test('the interview list never carries feedback, released or not', async () => {
  const w = world();
  const interview = await w.contests.scheduleInterview(T, {
    user_id: 'user-10', interviewer_id: 'user-20', title: 'Practice',
    scheduled_at: new Date(START).toISOString(),
  });
  await w.contests.recordFeedback(T, Number(interview.id), { role: 'placement', userId: 'user-20' }, {
    feedback: [{ criterion: 'Depth', score: 3, of: 5, comment: 'Go deeper.' }],
    overall: 3, notes: 'Private.', release: true,
  });

  const list = await w.contests.myInterviews(T, 'user-10');
  assert.equal(list.length, 1);
  assert.equal(list[0]!.overall, 3);
  // The detail view is the one place feedback is decided; a list that carried
  // it would be a second place to get it wrong.
  assert.equal(JSON.stringify(list).includes('Go deeper.'), false);
  assert.equal(JSON.stringify(list).includes('Private.'), false);
});
