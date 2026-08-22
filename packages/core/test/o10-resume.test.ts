/**
 * Onyx O10 unit tests -- the assembled resume.
 *
 * The design's whole claim is that a resume is DERIVED and never stored, so the
 * tests that matter are the ones about time: something issued after the person
 * last touched their resume has to appear on it anyway, and something they
 * chose to leave out has to stay out. Migration 0029's header calls `hidden` a
 * subtraction rather than a selection for exactly this reason, and these are
 * the tests that make that word mean something.
 *
 * The other claim worth proving is that a resume is its author's. It carries a
 * phone number the holder opted into showing to employers, so "admins can see
 * anything" is the wrong default here and there is deliberately no route that
 * offers it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeDb } from './fake-db.ts';
import { ResumeService, orderedSections, RESUME_SECTIONS } from '../src/onyx/resume.service.ts';
import { AcademicsService } from '../src/onyx/academics.service.ts';
import { CareerService } from '../src/onyx/career.service.ts';
import { TenancyService } from '../src/onyx/tenancy.service.ts';
import type { WorkspaceService } from '../src/onyx/workspace.service.ts';
import type { AttendanceService } from '../src/onyx/attendance.service.ts';
import type { OnyxDb } from '../src/onyx/db.ts';
import { HttpError } from '../src/http/errors.ts';

const T = 1;
const ME = 'u-me';
const SOMEBODY_ELSE = 'u-else';
const VIEWER = { role: 'student' as const, userId: ME };

function seed() {
  return new FakeDb({
    onyx_tenants: [{ id: T, name: 'Demo University', slug: 'demo', status: 1 }],
    onyx_users: [
      { id: ME, email: 'me@demo.onyx', name: 'Priya Raman', phone: '+91 90000 00000',
        photo: null, status: 1, created_at: 'now', username: 'priya',
        headline: 'Final-year computer science student', bio: '',
        skills_text: 'Python, Public speaking, Databases', interests: '',
        experience: 'Two summers building internal tools at a logistics firm.',
        website: 'priya.example.com', profile_public: true },
    ],
    onyx_memberships: [
      { id: 1, tenant_id: T, user_id: ME, role: 'student', status: 1,
        roll_number: 'CS-01', created_at: 'now' },
    ],
    onyx_programs: [
      { id: 5, tenant_id: T, name: 'BSc Computer Science', code: 'BSCCS',
        description: '', duration_semesters: 6, status: 1, created_at: 'now' },
    ],
    onyx_batches: [
      { id: 9, tenant_id: T, program_id: 5, name: 'Batch of 2026', code: 'CS-26',
        year: 2026, status: 1 },
    ],
    onyx_batch_members: [
      { id: 1, tenant_id: T, batch_id: 9, user_id: ME, created_at: '2023-07-01T00:00:00Z' },
    ],
    onyx_courses: [
      { id: 12, tenant_id: T, program_id: 5, semester_id: null, code: 'CS101',
        title: 'Data Structures', slug: 'ds', description: '', credits: 4,
        self_enroll: 1, access: 'open', price_minor: 0, currency: 'INR', status: 1,
        created_by: 'u-admin', created_at: 'now' },
    ],
    onyx_enrollments: [
      { id: 1, tenant_id: T, course_id: 12, user_id: ME, batch_id: 9, status: 1,
        enrolled_by: 'u-admin', created_at: 'now' },
    ],
    onyx_skills: [
      { id: 3, tenant_id: T, name: 'Data structures', category: 'Technical',
        description: '', status: 1, created_at: 'now' },
    ],
    onyx_learner_skills: [
      { id: 1, tenant_id: T, user_id: ME, skill_id: 3, source_type: 'assessment',
        source_id: 1, strength: 4, evidence: 'Scored 88 on the CS101 paper',
        earned_at: '2025-11-02T00:00:00Z' },
    ],
    onyx_certificates: [],
    onyx_readiness_scores: [],
    onyx_resumes: [],
  }, { onyx_resumes: [['tenant_id', 'user_id']] });
}

/** Workspaces are the only collaborator with nothing else to do here. */
const workspaces = {
  list: async () => [
    { id: 4, tenant_id: T, course_id: 12, user_id: ME, title: 'Route planner',
      language: 'python', entry_path: 'main.py',
      created_at: '2025-01-01T00:00:00Z', updated_at: '2025-09-14T00:00:00Z' },
  ],
} as unknown as WorkspaceService;

function service(db: FakeDb) {
  const academics = new AcademicsService(db as unknown as OnyxDb);
  const attendance = { } as unknown as AttendanceService;
  const career = new CareerService(db as unknown as OnyxDb, academics, attendance);
  const tenancy = new TenancyService(db as unknown as OnyxDb);
  return new ResumeService(db as unknown as OnyxDb, {
    academics, career, tenancy, workspaces,
  });
}

const sectionOf = (doc: { sections: { key: string; items: { key: string }[] }[] }, key: string) =>
  doc.sections.find((s) => s.key === key);

// ------------------------------------------------------------------ assembly

test('a resume assembles from records nobody typed into it', async () => {
  const db = seed();
  const doc = await service(db).build(T, ME, VIEWER);

  assert.equal(doc.name, 'Priya Raman');
  assert.equal(doc.institution, 'Demo University');

  // Education is DERIVED from batch -> programme. It is the reason there is no
  // table for learners to type their education into: the registrar already
  // knows, and a second copy would disagree within a term.
  const education = sectionOf(doc, 'education');
  assert.equal(education?.items[0]?.title, 'BSc Computer Science');
  assert.equal(education?.items[0]?.when, '2026');

  assert.equal(sectionOf(doc, 'courses')?.items[0]?.title, 'Data Structures');
  assert.equal(sectionOf(doc, 'projects')?.items[0]?.title, 'Route planner');
  assert.ok(sectionOf(doc, 'experience')?.items[0]?.detail.includes('logistics'));
});

test('an assessed skill outranks a stated one, and is never listed twice', async () => {
  const db = seed();
  const doc = await service(db).build(T, ME, VIEWER);
  const skills = sectionOf(doc, 'skills')!.items;

  // The evidence-backed one first: `level` and an assessment count are the only
  // part of a skills list an employer cannot get from a self-description.
  assert.equal(skills[0]?.title, 'Data structures');
  assert.match(skills[0]!.detail, /Level 4/);

  // "Databases" is stated and stays; "Data structures" is stated in
  // `skills_text` too and must not appear a second time without its evidence.
  const titles = skills.map((s) => s.title.toLowerCase());
  assert.equal(titles.filter((t) => t === 'data structures').length, 1);
  assert.ok(titles.includes('databases'));
});

test('a phone number is absent until its owner says otherwise', async () => {
  const db = seed();
  const resume = service(db);

  assert.equal((await resume.build(T, ME, VIEWER)).phone, '',
    'a phone number appeared on a document sent to strangers by default');

  await resume.save(T, ME, { include_phone: true });
  assert.equal((await resume.build(T, ME, VIEWER)).phone, '+91 90000 00000');
});

// ------------------------------------------------------------------ overrides

test('hiding one item hides only that item', async () => {
  const db = seed();
  const resume = service(db);
  await resume.save(T, ME, { hidden: ['course:12'] });

  const doc = await resume.build(T, ME, VIEWER);
  assert.equal(sectionOf(doc, 'courses'), undefined, 'the hidden course is still listed');
  // Everything else survives -- hiding a course is not "start a fresh resume".
  assert.ok(sectionOf(doc, 'education'));
  assert.ok(sectionOf(doc, 'projects'));
  // And the editor is still told the item exists, so it can offer to bring it
  // back. A hidden item that vanishes from the editor cannot be un-hidden.
  assert.ok(doc.available.some((a) => a.key === 'course:12'));
  assert.deepEqual(doc.hidden, ['course:12']);
});

test('a certificate issued AFTER the overrides were saved still appears', async () => {
  // The claim the whole design rests on. Storing a rendered resume would fail
  // this, and would fail it silently -- the holder would find out from an
  // employer, or not at all.
  const db = seed();
  const resume = service(db);
  await resume.save(T, ME, { objective: 'A graduate role in backend engineering.' });

  db.tables.onyx_certificates.push({
    id: 8, tenant_id: T, user_id: ME, credential_id: 'abc123',
    title: 'Certificate in Data Structures', kind: 'course', source_id: 12,
    detail: {}, issued_at: '2026-03-01T00:00:00Z', expires_at: null,
    revoked_at: null, issued_by: 'u-admin', created_at: 'now',
  });

  const doc = await resume.build(T, ME, VIEWER);
  assert.equal(sectionOf(doc, 'certificates')?.items[0]?.title,
    'Certificate in Data Structures');
  assert.equal(doc.objective, 'A graduate role in backend engineering.');
});

test('a revoked certificate is not on the resume', async () => {
  const db = seed();
  db.tables.onyx_certificates.push({
    id: 9, tenant_id: T, user_id: ME, credential_id: 'def456',
    title: 'Withdrawn credential', kind: 'course', source_id: 12,
    detail: {}, issued_at: '2026-03-01T00:00:00Z', expires_at: null,
    revoked_at: '2026-04-01T00:00:00Z', issued_by: 'u-admin', created_at: 'now',
  });
  const doc = await service(db).build(T, ME, VIEWER);
  assert.equal(sectionOf(doc, 'certificates'), undefined);
});

test('a patch leaves the fields it does not name alone', async () => {
  // The editor saves one section at a time. A whole-object write would mean
  // hiding a course silently discarded an objective typed a minute earlier.
  const db = seed();
  const resume = service(db);
  await resume.save(T, ME, { objective: 'Backend engineering.', include_phone: true });
  await resume.save(T, ME, { hidden: ['course:12'] });

  const doc = await resume.build(T, ME, VIEWER);
  assert.equal(doc.objective, 'Backend engineering.');
  assert.equal(doc.phone, '+91 90000 00000');
});

test('an extra entry lands in the section it names, and an unknown one is not lost', async () => {
  const db = seed();
  const resume = service(db);
  await resume.save(T, ME, { extras: [
    { section: 'experience', title: 'Volunteer tutor', detail: 'Weekend maths.', when: '2024' },
    { section: 'nonsense', title: 'Published a paper', detail: '', when: '2025' },
  ] });

  const doc = await resume.build(T, ME, VIEWER);
  assert.ok(sectionOf(doc, 'experience')?.items.some((i) => i.title === 'Volunteer tutor'));
  // Filed under "Also" rather than dropped: a person typed it, and silently
  // discarding what somebody typed is the worst of the available answers.
  assert.ok(sectionOf(doc, 'extras')?.items.some((i) => i.title === 'Published a paper'));
});

test('an empty headline override is different from no override at all', async () => {
  const db = seed();
  const resume = service(db);
  assert.equal((await resume.build(T, ME, VIEWER)).headline,
    'Final-year computer science student');

  // Tailoring for one employer by removing the headline entirely.
  await resume.save(T, ME, { headline_override: '' });
  assert.equal((await resume.build(T, ME, VIEWER)).headline, '');

  // And back to the profile's.
  await resume.save(T, ME, { headline_override: null });
  assert.equal((await resume.build(T, ME, VIEWER)).headline,
    'Final-year computer science student');
});

// -------------------------------------------------------------------- order

test('a section this build does not know is not stored as an order', async () => {
  const db = seed();
  const resume = service(db);
  await resume.save(T, ME, { section_order: ['skills', 'made-up', 'education'] });
  const stored = await resume.overrides(T, ME) as { section_order: string[] };
  assert.deepEqual(stored.section_order, ['skills', 'education']);
});

test('sections a person never ordered keep their default place', () => {
  // The tail is the point. A section added in a later release would otherwise
  // vanish for every learner who had ever reordered theirs -- silently, and
  // only for the people who used the feature.
  const ordered = orderedSections(['certificates', 'skills']);
  assert.equal(ordered[0], 'certificates');
  assert.equal(ordered[1], 'skills');
  assert.equal(ordered.length, RESUME_SECTIONS.length);
  for (const section of RESUME_SECTIONS) assert.ok(ordered.includes(section));
});

// --------------------------------------------------------------- it is theirs

test('a resume is its own author\'s, and an administrator is not an exception', async () => {
  const db = seed();
  const resume = service(db);
  await assert.rejects(
    resume.build(T, SOMEBODY_ELSE, { role: 'admin', userId: ME }),
    (e: HttpError) => e.status === 403);
  await assert.rejects(
    resume.build(T, ME, { role: 'admin', userId: SOMEBODY_ELSE }),
    (e: HttpError) => e.status === 403);
});

test('two institutions hold two separate sets of decisions', async () => {
  const db = seed();
  db.tables.onyx_tenants.push({ id: 2, name: 'Other College', slug: 'other', status: 1 });
  db.tables.onyx_memberships.push({ id: 2, tenant_id: 2, user_id: ME, role: 'student',
    status: 1, roll_number: 'X-1', created_at: 'now' });

  const resume = service(db);
  await resume.save(T, ME, { objective: 'Backend engineering.' });
  await resume.save(2, ME, { objective: 'Something else entirely.' });

  assert.equal((await resume.build(T, ME, VIEWER)).objective, 'Backend engineering.');
  assert.equal((await resume.build(2, ME, VIEWER)).objective, 'Something else entirely.');
  assert.equal(db.tables.onyx_resumes.length, 2);
});
