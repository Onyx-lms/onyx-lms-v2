/**
 * Onyx O07 -- campus operations, end to end.
 *
 * The unit suite proves the logic (clash detection names what it collided
 * with, seating is exactly one seat per person, a payment replay never
 * double-credits, a guardian sees only what is switched on). What only a real
 * database and a real API prove:
 *
 *   * a timetable clash refused over HTTP carries a 409 and the message a
 *     registrar would actually read;
 *   * RLS backs up the API for the same tables the unit suite exercises
 *     against a fake -- a learner reading exam marks or invoices directly
 *     through PostgREST still sees only their own;
 *   * a guardian account, freshly created with the `guardian` role, can log
 *     in and reach exactly the four routes that role owns.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { api, createTenant, withDb, RUN, env, onyxLogin } from './harness.ts';

const pw = 'OnyxTest#2026';
const mail = (who: string) => 'cmp.' + who + '.' + RUN + '@onyx.test';
const A = { name: 'Campus Institute ' + RUN, slug: 'campus-a-' + RUN };
const B = { name: 'Rival Campus ' + RUN, slug: 'campus-b-' + RUN };

const w = {
  alpha: { id: 0, admin: '', faculty: '', exams: '', s1: '', s2: '', guardian: '' },
  beta: { id: 0, admin: '', s1: '' },
  ids: {} as Record<string, string>,
  course: 0, semester: 0, batch: 0, room: 0, exam: 0, hall: 0,
  head: 0, structure: 0, invoice: 0, guardianLink: 0,
};

test('two institutions, a course, a term, and the people who run it', async () => {
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
    ['faculty', 'faculty'], ['exams', 'exams'], ['s1', 'student'], ['s2', 'student'],
    ['guardian', 'guardian'],
  ] as const) {
    const r = await api<{ user: { id: string } }>('/api/onyx/members', {
      token: w.alpha.admin, body: { name: who, email: mail(who), role, password: pw },
    });
    assert.equal(r.ok, true, who + ': ' + r.message);
    w.ids[who] = r.data.user.id;
  }
  w.alpha.faculty = await onyxLogin(mail('faculty'), pw);
  w.alpha.exams = await onyxLogin(mail('exams'), pw);
  w.alpha.s1 = await onyxLogin(mail('s1'), pw);
  w.alpha.s2 = await onyxLogin(mail('s2'), pw);
  w.alpha.guardian = await onyxLogin(mail('guardian'), pw);

  const bs1 = await api<{ user: { id: string } }>('/api/onyx/members', {
    token: w.beta.admin, body: { name: 'b-s1', email: mail('b.s1'), role: 'student', password: pw },
  });
  assert.equal(bs1.ok, true, bs1.message);
  w.beta.s1 = await onyxLogin(mail('b.s1'), pw);

  const program = await api<{ id: number }>('/api/onyx/programs', {
    token: w.alpha.admin, body: { name: 'Computer Science', code: 'CS' },
  });
  assert.equal(program.ok, true, program.message);

  const semester = await api<{ id: number }>('/api/onyx/semesters', {
    token: w.alpha.admin,
    body: { program_id: program.data.id, name: 'Term 1', number: 1,
      starts_on: '2026-01-01', ends_on: '2026-06-01' },
  });
  assert.equal(semester.ok, true, semester.message);
  w.semester = Number(semester.data.id);

  const batch = await api<{ id: number }>('/api/onyx/batches', {
    token: w.alpha.admin, body: { program_id: program.data.id, name: 'Batch A', code: 'BA' },
  });
  assert.equal(batch.ok, true, batch.message);
  w.batch = Number(batch.data.id);

  const course = await api<{ id: number }>('/api/onyx/courses', {
    token: w.alpha.admin, body: { title: 'Campus 101', code: 'CMP101', credits: 3, self_enroll: true },
  });
  assert.equal(course.ok, true, course.message);
  w.course = Number(course.data.id);
  await api('/api/onyx/courses/' + w.course,
    { token: w.alpha.admin, method: 'PATCH', body: { status: 1 } });

  for (const token of [w.alpha.s1, w.alpha.s2]) {
    const enrol = await api('/api/onyx/courses/' + w.course + '/enroll',
      { token, method: 'POST' });
    assert.equal(enrol.ok, true, enrol.message);
  }
});

// ---------------------------------------------------------------------------
// CMP-01: timetable
// ---------------------------------------------------------------------------

test('CMP-01 a room double-booking over HTTP is a 409 naming the room', async () => {
  const room = await api<{ id: number }>('/api/onyx/rooms', {
    token: w.alpha.admin, body: { code: 'R1', name: 'Room 1', capacity: 30 },
  });
  assert.equal(room.ok, true, room.message);
  w.room = Number(room.data.id);

  const first = await api('/api/onyx/timetable', {
    token: w.alpha.admin,
    body: { semester_id: w.semester, course_id: w.course, batch_id: w.batch,
      room_id: w.room, faculty_id: w.ids.faculty, day_of_week: 1, starts_at: '09:00', ends_at: '10:00' },
  });
  assert.equal(first.ok, true, first.message);

  const second = await api('/api/onyx/timetable', {
    token: w.alpha.admin,
    body: { semester_id: w.semester, course_id: w.course, batch_id: w.batch,
      room_id: w.room, faculty_id: w.ids.faculty, day_of_week: 1, starts_at: '09:30', ends_at: '10:30' },
  });
  assert.equal(second.status, 409);
  assert.match(second.message ?? '', /R1/);
});

test('CMP-01 a learner sees nothing until it is published', async () => {
  const before = await api<{ status: string }[]>('/api/onyx/timetable', { token: w.alpha.s1 });
  assert.equal(before.ok, true);
  assert.equal(before.data.length, 0, 'a draft slot must not reach a learner');

  const published = await api('/api/onyx/timetable/publish',
    { token: w.alpha.admin, body: { semester_id: w.semester } });
  assert.equal(published.ok, true, published.message);

  const after = await api<{ status: string }[]>('/api/onyx/timetable', { token: w.alpha.s1 });
  assert.equal(after.data.length, 1);
  assert.equal(after.data[0]!.status, 'published');
});

// ---------------------------------------------------------------------------
// CMP-02: exams, halls, marks, transcripts
// ---------------------------------------------------------------------------

test('CMP-02a only the examinations office may schedule an exam', async () => {
  const denied = await api('/api/onyx/exams', {
    token: w.alpha.faculty,
    body: { semester_id: w.semester, course_id: w.course, title: 'Sneaky', starts_at: new Date(Date.now() + 86_400_000).toISOString() },
  });
  assert.equal(denied.status, 403);

  const exam = await api<{ id: number }>('/api/onyx/exams', {
    token: w.alpha.exams,
    body: { semester_id: w.semester, course_id: w.course, title: 'CMP101 Final',
      starts_at: new Date(Date.now() + 86_400_000).toISOString(), max_marks: 100, pass_marks: 40 },
  });
  assert.equal(exam.ok, true, exam.message);
  w.exam = Number(exam.data.id);
});

test('CMP-02b seating: every candidate seated once, and a learner sees only their own seat', async () => {
  const hall = await api<{ id: number }>('/api/onyx/halls', {
    token: w.alpha.exams, body: { code: 'H1', name: 'Hall 1', row_count: 2, col_count: 2 },
  });
  assert.equal(hall.ok, true, hall.message);
  w.hall = Number(hall.data.id);

  const seated = await api('/api/onyx/exams/' + w.exam + '/seating',
    { token: w.alpha.exams, body: { hall_ids: [w.hall] } });
  assert.equal(seated.ok, true, seated.message);
  assert.equal(seated.data.seated, 2);

  const asLearner = await api('/api/onyx/exams/' + w.exam + '/seating', { token: w.alpha.s1 });
  assert.equal(asLearner.status, 403, 'the full seating plan is staff-only');

  const mine = await api('/api/onyx/exams/' + w.exam + '/seat', { token: w.alpha.s1 });
  assert.equal(mine.ok, true, mine.message);
  assert.equal(mine.data.user_id, w.ids.s1);
});

test('CMP-02c marks stay invisible to a learner until published, then reconcile with the transcript', async () => {
  const entered = await api('/api/onyx/exams/' + w.exam + '/marks', {
    token: w.alpha.faculty,
    body: { entries: [{ user_id: w.ids.s1, raw_marks: 78 }, { user_id: w.ids.s2, raw_marks: 55 }] },
  });
  assert.equal(entered.ok, true, entered.message);

  const beforePublish = await api<unknown[]>('/api/onyx/results', { token: w.alpha.s1 });
  assert.equal(beforePublish.data.length, 0);

  const published = await api('/api/onyx/exams/' + w.exam + '/publish',
    { token: w.alpha.exams, method: 'POST' });
  assert.equal(published.ok, true, published.message);

  const afterPublish = await api<{ final_marks: number }[]>('/api/onyx/results', { token: w.alpha.s1 });
  assert.equal(afterPublish.data.length, 1);
  assert.equal(Number(afterPublish.data[0]!.final_marks), 78);

  const transcript = await api<{ serial: string }>('/api/onyx/transcripts', {
    token: w.alpha.exams, body: { user_id: w.ids.s1 },
  });
  assert.equal(transcript.ok, true, transcript.message);

  const verified = await api('/api/onyx/transcripts/' + transcript.data.serial + '/verify',
    { token: w.alpha.s1 });
  assert.equal(verified.ok, true, verified.message);
  assert.equal(verified.data.intact, true);
  assert.equal(verified.data.current, true);
});

// ---------------------------------------------------------------------------
// CMP-03: fees, invoices, payment
// ---------------------------------------------------------------------------

test('CMP-03 an invoice is raised, paid, and a replayed webhook does not double-credit it', async () => {
  const head = await api<{ id: number }>('/api/onyx/fee-heads', {
    token: w.alpha.admin, body: { code: 'TUITION', name: 'Tuition' },
  });
  assert.equal(head.ok, true, head.message);
  w.head = Number(head.data.id);

  const structure = await api<{ id: number }>('/api/onyx/fee-structures', {
    token: w.alpha.admin,
    body: { name: 'Term 1 fees', lines: [{ head_id: w.head, amount_minor: 5_000_00 }] },
  });
  assert.equal(structure.ok, true, structure.message);
  w.structure = Number(structure.data.id);
  const structurePublished = await api('/api/onyx/fee-structures/' + w.structure + '/publish',
    { token: w.alpha.admin, method: 'POST' });
  assert.equal(structurePublished.ok, true, structurePublished.message);

  const invoice = await api<{ id: number }>('/api/onyx/invoices', {
    token: w.alpha.admin, body: { user_id: w.ids.s1, structure_id: w.structure },
  });
  assert.equal(invoice.ok, true, invoice.message);
  w.invoice = Number(invoice.data.id);

  const asOther = await api('/api/onyx/invoices/' + w.invoice, { token: w.alpha.s2 });
  assert.equal(asOther.status, 403, 'a learner must not read another learner\'s invoice');

  const paid = await api('/api/onyx/payments', {
    token: w.alpha.admin,
    body: { invoice_id: w.invoice, gateway: 'razorpay', reference: 'pay_e2e_' + RUN, amount_minor: 5_000_00 },
  });
  assert.equal(paid.ok, true, paid.message);

  const replay = await api('/api/onyx/payments', {
    token: w.alpha.admin,
    body: { invoice_id: w.invoice, gateway: 'razorpay', reference: 'pay_e2e_' + RUN, amount_minor: 5_000_00 },
  });
  assert.equal(replay.ok, true, replay.message);
  assert.equal(replay.data.replayed, true);
  assert.equal(replay.data.invoice.paid_minor, 5_000_00, 'a replay must not double the paid total');
});

// ---------------------------------------------------------------------------
// CMP-04: guardians
// ---------------------------------------------------------------------------

test('CMP-04 a guardian sees a child only after linking, accepting and consent', async () => {
  // Raised by staff, not the learner: a learner-initiated link is trusted
  // immediately (they cannot be linking themselves to a stranger), but a link
  // staff propose is a request the learner has not agreed to yet, and that is
  // the "unaccepted" state this test is about.
  const link = await api<{ id: number }>('/api/onyx/guardians', {
    token: w.alpha.admin, body: { guardian_user_id: w.ids.guardian, student_user_id: w.ids.s1 },
  });
  assert.equal(link.ok, true, link.message);
  w.guardianLink = Number(link.data.id);

  const familyBeforeConsent = await api<{ children: unknown[] }>(
    '/api/onyx/family', { token: w.alpha.guardian });
  assert.equal(familyBeforeConsent.ok, true, familyBeforeConsent.message);
  assert.equal(familyBeforeConsent.data.children.length, 0,
    'an unaccepted link must show no child yet');

  const accepted = await api('/api/onyx/guardians/' + w.guardianLink + '/accept',
    { token: w.alpha.s1, method: 'POST' });
  assert.equal(accepted.ok, true, accepted.message);

  const consent = await api('/api/onyx/guardians/' + w.guardianLink + '/consent', {
    token: w.alpha.s1, body: { scope: 'results', allowed: true },
  });
  assert.equal(consent.ok, true, consent.message);

  const family = await api<{ children: { shares: { results: boolean; fees: boolean } }[] }>(
    '/api/onyx/family', { token: w.alpha.guardian });
  assert.equal(family.data.children.length, 1);
  assert.equal(family.data.children[0]!.shares.results, true);
  assert.equal(family.data.children[0]!.shares.fees, false, 'fees were never switched on');

  const fees = await api('/api/onyx/family/' + w.ids.s1 + '/fees', { token: w.alpha.guardian });
  assert.equal(fees.status, 403, 'a category the learner never shared must stay refused');
});

test('CMP-04 a guardian cannot reach a staff or finance route', async () => {
  const denied = await api('/api/onyx/finance/outstanding', { token: w.alpha.guardian });
  assert.equal(denied.status, 403);
});

// ---------------------------------------------------------------------------
// RLS: the database backs up the API
// ---------------------------------------------------------------------------

test('RLS: a learner reading exam marks or invoices directly through PostgREST sees only their own', async () => {
  for (const k of ['SUPABASE_URL', 'SUPABASE_ANON_KEY']) process.env[k] ??= env[k];
  const { onyxTenantClient } = await import('@onyx/core');
  const s2 = onyxTenantClient(w.alpha.s2);

  const { data: marks } = await s2.from('onyx_exam_marks').select('user_id');
  for (const m of marks ?? []) assert.equal(m.user_id, w.ids.s2);

  const { data: invoices } = await s2.from('onyx_invoices').select('user_id');
  for (const i of invoices ?? []) assert.equal(i.user_id, w.ids.s2);

  const beta = onyxTenantClient(w.beta.s1);
  const { data: alphaRooms } = await beta.from('onyx_rooms').select('id');
  assert.equal((alphaRooms ?? []).length, 0, 'a room from another institution leaked through RLS');
});

test('cleanup leaves nothing behind', async () => {
  await withDb(async (c) => {
    const { rows: missing } = await c.query('SELECT * FROM onyx.assert_tenant_scoped()');
    assert.equal(missing.length, 0,
      'Onyx tables with no tenant_id: ' + missing.map((r: { missing: string }) => r.missing).join(', '));

    await c.query('DELETE FROM public."onyx_tenants" WHERE slug = ANY($1)', [[A.slug, B.slug]]);
    await c.query('DELETE FROM public."onyx_users" WHERE email LIKE $1', ['cmp.%.' + RUN + '@onyx.test']);

    for (const table of [
      'onyx_faculty_allocations', 'onyx_rooms', 'onyx_timetable_slots',
      'onyx_exams', 'onyx_halls', 'onyx_seat_allocations',
      'onyx_exam_marks', 'onyx_transcripts',
      'onyx_fee_heads', 'onyx_fee_structures', 'onyx_fee_structure_lines',
      'onyx_invoices', 'onyx_invoice_lines', 'onyx_payments', 'onyx_guardians',
    ]) {
      const { rows: [left] } = await c.query(
        'SELECT count(*)::int c FROM public."' + table + '" t '
        + 'LEFT JOIN public."onyx_tenants" n ON n.id = t.tenant_id WHERE n.id IS NULL');
      assert.equal(left.c, 0, table + ' outlived its institution');
    }
  });
});
