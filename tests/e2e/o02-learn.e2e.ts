/**
 * Onyx O02 -- Onyx Learn, end to end.
 *
 * Two institutions again, because the point of O01 was that they cannot see
 * each other and every table added in O02 is a fresh chance to break that. The
 * flow through the middle is the one the proposal describes: enrol a cohort,
 * publish content, take attendance, set work, mark it, return it.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { api, createTenant, withDb, RUN, API, onyxLogin } from './harness.ts';

const pw = 'OnyxTest#2026';
const mail = (who: string) => 'l.' + who + '.' + RUN + '@onyx.test';
const A = { name: 'Learn University ' + RUN, slug: 'learn-a-' + RUN };
const B = { name: 'Rival Institute ' + RUN, slug: 'learn-b-' + RUN };

const w = {
  alpha: { id: 0, admin: '', faculty: '', s1: '', s2: '', outsider: '' },
  beta: { id: 0, admin: '', student: '' },
  ids: {} as Record<string, string>,
  course: 0, betaCourse: 0, batch: 0, module: 0, lesson: 0,
  session: 0, assignment: 0, submission: 0, resource: 0,
  rubric: [] as { id: number; points: number }[],
};

test('two institutions, each with a cohort', async () => {
  for (const [key, t] of [['alpha', A], ['beta', B]] as const) {
    const res = await createTenant({
      name: t.name, slug: t.slug,
      admin: { name: t.name, email: mail(key + '.admin'), password: pw },
    });
    assert.equal(res.ok, true, 'create ' + t.slug + ': ' + res.message);
    w[key].id = Number(res.data.tenant.id);
  }
  w.alpha.admin = await onyxLogin(mail('alpha.admin'), pw);
  w.beta.admin = await onyxLogin(mail('beta.admin'), pw);

  const invite = async (token: string, who: string, role: string) => {
    const r = await api<{ user: { id: string } }>('/api/onyx/members', {
      token, body: { name: who, email: mail(who), role, password: pw },
    });
    assert.equal(r.ok, true, 'invite ' + who + ': ' + r.message);
    w.ids[who] = r.data.user.id;
  };
  await invite(w.alpha.admin, 'faculty', 'faculty');
  await invite(w.alpha.admin, 's1', 'student');
  await invite(w.alpha.admin, 's2', 'student');
  await invite(w.alpha.admin, 'outsider', 'student');
  await invite(w.beta.admin, 'beta.student', 'student');

  w.alpha.faculty = await onyxLogin(mail('faculty'), pw);
  w.alpha.s1 = await onyxLogin(mail('s1'), pw);
  w.alpha.s2 = await onyxLogin(mail('s2'), pw);
  w.alpha.outsider = await onyxLogin(mail('outsider'), pw);
  w.beta.student = await onyxLogin(mail('beta.student'), pw);
});

// ---------------------------------------------------------------------------
// LRN-01 -- structure, catalog, enrolment
// ---------------------------------------------------------------------------

test('LRN-01a a course sits in a semester of a programme', async () => {
  const program = await api<{ id: number }>('/api/onyx/programs', {
    token: w.alpha.admin, body: { name: 'BSc Computing', code: 'BSCC', duration_semesters: 6 },
  });
  assert.equal(program.ok, true, program.message);

  const semester = await api<{ id: number }>('/api/onyx/semesters', {
    token: w.alpha.admin,
    body: { program_id: program.data.id, name: 'Semester 1', number: 1 },
  });
  assert.equal(semester.ok, true, semester.message);

  // A semester the programme does not have is a typo that would orphan every
  // course put into it.
  const beyond = await api('/api/onyx/semesters', {
    token: w.alpha.admin,
    body: { program_id: program.data.id, name: 'Semester 9', number: 9 },
  });
  assert.equal(beyond.status, 422, beyond.message);

  const batch = await api<{ id: number }>('/api/onyx/batches', {
    token: w.alpha.admin,
    body: { program_id: program.data.id, name: '2026 intake', code: 'B26', year: 2026 },
  });
  assert.equal(batch.ok, true, batch.message);
  w.batch = Number(batch.data.id);

  const added = await api<{ added: number }>('/api/onyx/batches/' + w.batch + '/members', {
    token: w.alpha.admin, body: { user_ids: [w.ids.s1, w.ids.s2] },
  });
  assert.equal(added.data.added, 2, added.message);

  // Someone from another institution cannot be put in this one's batch.
  const stranger = await api('/api/onyx/batches/' + w.batch + '/members', {
    token: w.alpha.admin, body: { user_ids: [w.ids['beta.student']] },
  });
  assert.equal(stranger.status, 422, 'a batch accepted an outsider');

  const course = await api<{ id: number; status: number }>('/api/onyx/courses', {
    token: w.alpha.admin,
    body: {
      code: 'CS101', title: 'Programming Fundamentals', credits: 4,
      program_id: program.data.id, semester_id: semester.data.id,
    },
  });
  assert.equal(course.ok, true, course.message);
  assert.equal(course.data.status, 0, 'a course should start unpublished');
  w.course = Number(course.data.id);

  const teach = await api('/api/onyx/courses/' + w.course + '/faculty', {
    token: w.alpha.admin, body: { user_id: w.ids.faculty },
  });
  assert.equal(teach.ok, true, teach.message);

  const publish = await api('/api/onyx/courses/' + w.course, {
    token: w.alpha.admin, method: 'PATCH', body: { status: 1 },
  });
  assert.equal(publish.ok, true, publish.message);
});

test('LRN-01b a whole batch is enrolled in one act', async () => {
  const bulk = await api<{ enrolled: number }>('/api/onyx/courses/' + w.course + '/enroll', {
    token: w.alpha.admin, body: { batch_id: w.batch },
  });
  assert.equal(bulk.data.enrolled, 2, bulk.message);

  // Running it again enrols nobody twice.
  const again = await api<{ enrolled: number; already: number }>(
    '/api/onyx/courses/' + w.course + '/enroll',
    { token: w.alpha.admin, body: { batch_id: w.batch } });
  assert.equal(again.data.enrolled, 0, 'a repeat bulk enrolment created duplicates');
  assert.equal(again.data.already, 2);

  const roster = await api<unknown[]>('/api/onyx/courses/' + w.course + '/roster',
    { token: w.alpha.faculty });
  assert.equal(roster.data.length, 2, roster.message);

  // A learner has no business reading who else is in the room.
  assert.equal((await api('/api/onyx/courses/' + w.course + '/roster',
    { token: w.alpha.s1 })).status, 403);
});

test('LRN-01b self-enrolment happens only where it is allowed', async () => {
  const closed = await api('/api/onyx/courses/' + w.course + '/enroll',
    { token: w.alpha.outsider, body: {} });
  assert.equal(closed.status, 403, closed.message);

  const open = await api<{ id: number }>('/api/onyx/courses', {
    token: w.alpha.admin,
    body: { code: 'CS102', title: 'Open Elective', self_enroll: true },
  });
  await api('/api/onyx/courses/' + open.data.id,
    { token: w.alpha.admin, method: 'PATCH', body: { status: 1 } });
  const joined = await api('/api/onyx/courses/' + open.data.id + '/enroll',
    { token: w.alpha.outsider, body: {} });
  assert.equal(joined.ok, true, joined.message);
});

// ---------------------------------------------------------------------------
// LRN-02 -- content
// ---------------------------------------------------------------------------

test('LRN-02a content is authored, and locked to everyone not in the course', async () => {
  const mod = await api<{ id: number }>('/api/onyx/courses/' + w.course + '/modules', {
    token: w.alpha.faculty, body: { title: 'Week 1', sort: 0 },
  });
  assert.equal(mod.ok, true, mod.message);
  w.module = Number(mod.data.id);

  const lesson = await api<{ id: number }>('/api/onyx/modules/' + w.module + '/lessons', {
    token: w.alpha.faculty,
    body: {
      title: 'Variables', type: 'video',
      path: 'onyx/demo/variables.mp4', duration_seconds: 600,
    },
  });
  assert.equal(lesson.ok, true, lesson.message);
  w.lesson = Number(lesson.data.id);

  await api('/api/onyx/modules/' + w.module + '/lessons', {
    token: w.alpha.faculty,
    body: { title: 'Taster', type: 'video', path: 'onyx/demo/taster.mp4', is_preview: true },
  });

  const enrolled = await api<{ modules: { lessons: { locked: boolean; path: string | null }[] }[] }>(
    '/api/onyx/courses/' + w.course + '/outline', { token: w.alpha.s1 });
  assert.equal(enrolled.data.modules[0]!.lessons.every((l) => !l.locked), true);

  const outsider = await api<{
    enrolled: boolean;
    modules: { lessons: { title: string; locked: boolean; path: string | null }[] }[];
  }>('/api/onyx/courses/' + w.course + '/outline', { token: w.alpha.outsider });
  assert.equal(outsider.data.enrolled, false);
  const [locked, preview] = outsider.data.modules[0]!.lessons;
  assert.equal(locked!.locked, true);
  assert.equal(locked!.path, null, 'a locked lesson leaked its source');
  assert.equal(locked!.title, 'Variables', 'the catalog needs the title');
  assert.equal(preview!.locked, false, 'a preview lesson should be open');

  // ...and the lesson endpoint agrees with the outline.
  assert.equal((await api('/api/onyx/lessons/' + w.lesson,
    { token: w.alpha.outsider })).status, 403);
  assert.equal((await api('/api/onyx/lessons/' + w.lesson, { token: w.alpha.s1 })).status, 200);
});

test('LRN-02a playback resumes where the learner left off', async () => {
  const at = await api('/api/onyx/lessons/' + w.lesson + '/progress',
    { token: w.alpha.s1, body: { position_seconds: 300 } });
  assert.equal(at.ok, true, at.message);

  // Scrubbing back to check something must not cost them the five minutes.
  const back = await api<{ position_seconds: number }>(
    '/api/onyx/lessons/' + w.lesson + '/progress',
    { token: w.alpha.s1, body: { position_seconds: 12 } });
  assert.equal(back.data.position_seconds, 300);

  const reopened = await api<{ position_seconds: number }>('/api/onyx/lessons/' + w.lesson,
    { token: w.alpha.s1 });
  assert.equal(reopened.data.position_seconds, 300, 'the lesson did not resume');

  // And progress is per learner, not per course.
  const other = await api<{ position_seconds: number }>('/api/onyx/lessons/' + w.lesson,
    { token: w.alpha.s2 });
  assert.equal(other.data.position_seconds, 0, 'one learner saw another\'s position');
});

test('LRN-02b a download link is signed, expiring, and refused to outsiders', async () => {
  const form = new FormData();
  form.set('file', new Blob([new TextEncoder().encode('week one notes')],
    { type: 'text/plain' }), 'notes.txt');
  const uploaded = await fetch(
    API + '/api/onyx/courses/' + w.course + '/resources/upload?title=Notes',
    { method: 'POST', headers: { Authorization: 'Bearer ' + w.alpha.faculty }, body: form });
  const resource = await uploaded.json() as { ok: boolean; data: { id: number; path: string }; message?: string };
  assert.equal(resource.ok, true, 'upload failed: ' + resource.message);
  w.resource = Number(resource.data.id);
  // The key comes from the tenant, not from anything the caller sent.
  assert.match(resource.data.path, new RegExp('^onyx/' + w.alpha.id + '/courses/' + w.course + '/'));

  const link = await api<{ url: string; expires_in: number }>(
    '/api/onyx/resources/' + w.resource + '/url', { token: w.alpha.s1 });
  assert.equal(link.ok, true, link.message);
  assert.match(link.data.url, /^https?:\/\//);
  assert.equal(link.data.expires_in, 300);

  // The acceptance criterion for LRN-02b.
  assert.equal((await api('/api/onyx/resources/' + w.resource + '/url',
    { token: w.alpha.outsider })).status, 403, 'a non-enrolled learner obtained a signed URL');

  // The link actually works, which a URL-shaped string would not prove.
  const fetched = await fetch(link.data.url);
  assert.equal(fetched.status, 200, 'the signed URL did not resolve');
  assert.equal((await fetched.text()).trim(), 'week one notes');
});

// ---------------------------------------------------------------------------
// LRN-03 -- attendance
// ---------------------------------------------------------------------------

test('LRN-03b the QR code rotates, and only the current one is accepted', async () => {
  const session = await api<{ id: number; qr_secret?: string }>(
    '/api/onyx/courses/' + w.course + '/attendance', {
      token: w.alpha.faculty,
      body: {
        title: 'Lecture 1', scheduled_at: new Date().toISOString(),
        duration_minutes: 60, qr_window_seconds: 10,
      },
    });
  assert.equal(session.ok, true, session.message);
  assert.equal(session.data.qr_secret, undefined, 'the session secret was returned');
  w.session = Number(session.data.id);

  // A learner who could read the code could mark themselves from anywhere.
  assert.equal((await api('/api/onyx/attendance/' + w.session + '/code',
    { token: w.alpha.s1 })).status, 403);

  const code = await api<{ code: string; expires_in_seconds: number }>(
    '/api/onyx/attendance/' + w.session + '/code', { token: w.alpha.faculty });
  assert.equal(code.ok, true, code.message);
  assert.match(code.data.code, /^[0-9A-F]{8}$/);

  assert.equal((await api('/api/onyx/attendance/' + w.session + '/check-in',
    { token: w.alpha.s1, body: { code: 'DEADBEEF' } })).status, 422, 'a wrong code was accepted');

  const marked = await api<{ status: string; method: string; marked_by: string }>(
    '/api/onyx/attendance/' + w.session + '/check-in',
    { token: w.alpha.s1, body: { code: code.data.code } });
  assert.equal(marked.ok, true, marked.message);
  assert.equal(marked.data.method, 'qr');
  // For QR the actor is the learner: that is what makes it a record.
  assert.equal(marked.data.marked_by, w.ids.s1);

  // A second scan is refused. There is no user_id parameter at all, so marking
  // somebody else is not something the endpoint can express.
  assert.equal((await api('/api/onyx/attendance/' + w.session + '/check-in',
    { token: w.alpha.s1, body: { code: code.data.code } })).status, 422);
  assert.equal((await api('/api/onyx/attendance/' + w.session + '/check-in',
    { token: w.alpha.outsider, body: { code: code.data.code } })).status, 403);

  // Wait out TWO windows, then confirm the old code is dead. Two, because a
  // code is good for its own window and the one after it -- the tolerance that
  // stops a learner who read the code a second before it rotated being told it
  // was never valid. Waiting one window would be asserting the old behaviour.
  await new Promise((r) => { setTimeout(r, 21_000); });
  const rotated = await api<{ code: string }>('/api/onyx/attendance/' + w.session + '/code',
    { token: w.alpha.faculty });
  assert.notEqual(rotated.data.code, code.data.code, 'the code did not rotate');
  const stale = await api('/api/onyx/attendance/' + w.session + '/check-in',
    { token: w.alpha.s2, body: { code: code.data.code } });
  assert.equal(stale.status, 422, 'an expired code was accepted');
  assert.equal((await api('/api/onyx/attendance/' + w.session + '/check-in',
    { token: w.alpha.s2, body: { code: rotated.data.code } })).ok, true);
});

test('LRN-03a/c the roster is marked and the percentages follow', async () => {
  // Amend s2 to absent, and add a second session nobody attends.
  const amended = await api<{ amended: number }>('/api/onyx/attendance/' + w.session + '/mark', {
    token: w.alpha.faculty, body: { entries: [{ user_id: w.ids.s2, status: 'absent' }] },
  });
  assert.equal(amended.data.amended, 1, amended.message);

  const stray = await api('/api/onyx/attendance/' + w.session + '/mark', {
    token: w.alpha.faculty, body: { entries: [{ user_id: w.ids.outsider, status: 'present' }] },
  });
  assert.equal(stray.status, 422, 'a learner who is not enrolled was marked');

  await api('/api/onyx/courses/' + w.course + '/attendance', {
    token: w.alpha.faculty,
    body: { title: 'Lecture 2', scheduled_at: new Date().toISOString() },
  });

  const analytics = await api<{
    sessions: number;
    learners: { user_id: string; attended: number; percent: number; below_threshold: boolean }[];
    cohort: { below: number };
  }>('/api/onyx/courses/' + w.course + '/attendance/analytics', { token: w.alpha.faculty });
  assert.equal(analytics.data.sessions, 2, analytics.message);

  // s1: present at one of two = 50%. s2: absent at one, unmarked at the other,
  // which counts as absent too = 0%.
  const s1 = analytics.data.learners.find((l) => l.user_id === w.ids.s1)!;
  const s2 = analytics.data.learners.find((l) => l.user_id === w.ids.s2)!;
  assert.equal(s1.percent, 50, JSON.stringify(s1));
  assert.equal(s2.percent, 0, JSON.stringify(s2));
  assert.equal(analytics.data.cohort.below, 2);

  const rows = await api<{ user_id: string; status: string }[]>(
    '/api/onyx/courses/' + w.course + '/attendance/export', { token: w.alpha.faculty });
  assert.equal(rows.data.length, 4, 'two learners, two sessions');
  assert.equal(rows.data.filter((r) => r.status === 'absent').length, 3);

  // A learner sees their own figure and nobody else's.
  const mine = await api<{ course_id: number; percent: number }[]>('/api/onyx/my/attendance',
    { token: w.alpha.s1 });
  assert.equal(mine.data.find((m) => m.course_id === w.course)?.percent, 50);
  assert.equal((await api('/api/onyx/courses/' + w.course + '/attendance/analytics',
    { token: w.alpha.s1 })).status, 403);
});

// ---------------------------------------------------------------------------
// LRN-04 -- assignments
// ---------------------------------------------------------------------------

test('LRN-04a a rubric has to add up before anything is published', async () => {
  const created = await api<{ id: number; status: string }>(
    '/api/onyx/courses/' + w.course + '/assignments', {
      token: w.alpha.faculty,
      body: {
        title: 'Essay 1', instructions: 'Write something.', total_points: 100,
        due_at: new Date(Date.now() + 3_600_000).toISOString(),
        late_policy: 'penalty', late_penalty_percent: 10,
      },
    });
  assert.equal(created.ok, true, created.message);
  assert.equal(created.data.status, 'draft');
  w.assignment = Number(created.data.id);

  const wrong = await api('/api/onyx/assignments/' + w.assignment + '/rubric', {
    token: w.alpha.faculty, method: 'PUT',
    body: { criteria: [{ title: 'Structure', points: 40 }, { title: 'Argument', points: 30 }] },
  });
  assert.equal(wrong.status, 422, 'a rubric that does not add up was accepted');

  const rubric = await api<{ id: number; points: number }[]>(
    '/api/onyx/assignments/' + w.assignment + '/rubric', {
      token: w.alpha.faculty, method: 'PUT',
      body: { criteria: [{ title: 'Structure', points: 40 }, { title: 'Argument', points: 60 }] },
    });
  assert.equal(rubric.ok, true, rubric.message);
  w.rubric = rubric.data;

  // A draft is not yet something a learner has been asked to do.
  assert.equal((await api('/api/onyx/assignments/' + w.assignment,
    { token: w.alpha.s1 })).status, 404);

  const published = await api('/api/onyx/assignments/' + w.assignment + '/publish',
    { token: w.alpha.faculty, method: 'POST' });
  assert.equal(published.ok, true, published.message);
});

test('LRN-04c a draft survives, and is not a submission', async () => {
  const saved = await api('/api/onyx/assignments/' + w.assignment + '/draft',
    { token: w.alpha.s1, body: { body: 'half an answer' } });
  assert.equal(saved.ok, true, saved.message);

  const reopened = await api<{ my_submission: { body: string; status: string } }>(
    '/api/onyx/assignments/' + w.assignment, { token: w.alpha.s1 });
  assert.equal(reopened.data.my_submission.body, 'half an answer',
    'the draft did not come back');
  assert.equal(reopened.data.my_submission.status, 'draft',
    'autosaving handed the work in');

  // It is not in the marking queue either.
  const queue = await api<{ submissions: unknown[] }>('/api/onyx/assignments/' + w.assignment,
    { token: w.alpha.faculty });
  assert.equal(queue.data.submissions.length, 0, 'a draft appeared in the marking queue');
});

test('LRN-04b work is submitted, graded by rubric, and returned', async () => {
  const submitted = await api<{ is_late: number; status: string }>(
    '/api/onyx/assignments/' + w.assignment + '/submit',
    { token: w.alpha.s1, body: { body: 'the whole answer' } });
  assert.equal(submitted.ok, true, submitted.message);
  assert.equal(submitted.data.is_late, 0);

  const queue = await api<{ submissions: { id: number; user_id: string }[] }>(
    '/api/onyx/assignments/' + w.assignment, { token: w.alpha.faculty });
  assert.equal(queue.data.submissions.length, 1, 'nothing reached the marking queue');
  w.submission = Number(queue.data.submissions[0]!.id);

  // Two numbers meant to agree eventually will not, so a bare score is refused.
  assert.equal((await api('/api/onyx/submissions/' + w.submission + '/grade',
    { token: w.alpha.faculty, body: { score: 90 } })).status, 422);
  assert.equal((await api('/api/onyx/submissions/' + w.submission + '/grade', {
    token: w.alpha.faculty,
    body: { scores: [{ criterion_id: w.rubric[0]!.id, points: 999 },
      { criterion_id: w.rubric[1]!.id, points: 10 }] },
  })).status, 422, 'a criterion was over-scored');

  const graded = await api<{ score: number }>('/api/onyx/submissions/' + w.submission + '/grade', {
    token: w.alpha.faculty,
    body: {
      feedback: 'Solid.',
      scores: [{ criterion_id: w.rubric[0]!.id, points: 35 },
        { criterion_id: w.rubric[1]!.id, points: 50 }],
    },
  });
  assert.equal(graded.ok, true, graded.message);
  assert.equal(Number(graded.data.score), 85);

  // Graded is not returned: a cohort is marked over a week and released at once.
  const before = await api<{ my_submission: { score: number | null; status: string } }>(
    '/api/onyx/assignments/' + w.assignment, { token: w.alpha.s1 });
  assert.equal(before.data.my_submission.score, null, 'a grade leaked before it was returned');
  assert.equal(before.data.my_submission.status, 'submitted',
    'the learner could tell it had been graded');

  const returned = await api('/api/onyx/submissions/' + w.submission + '/return',
    { token: w.alpha.faculty, method: 'POST' });
  assert.equal(returned.ok, true, returned.message);

  const after = await api<{
    my_submission: { score: number; feedback: string; rubric_scores: unknown[] };
  }>('/api/onyx/assignments/' + w.assignment, { token: w.alpha.s1 });
  assert.equal(Number(after.data.my_submission.score), 85);
  assert.equal(after.data.my_submission.feedback, 'Solid.');
  assert.equal(after.data.my_submission.rubric_scores.length, 2, 'no rubric breakdown');

  // One learner cannot read another's work.
  assert.equal((await api('/api/onyx/submissions/' + w.submission,
    { token: w.alpha.s2 })).status, 403);
});

test('LRN-04b a late submission is flagged and penalised by policy', async () => {
  const late = await api<{ id: number }>('/api/onyx/courses/' + w.course + '/assignments', {
    token: w.alpha.faculty,
    body: {
      title: 'Overdue', total_points: 100,
      due_at: new Date(Date.now() - 3_600_000).toISOString(),
      late_policy: 'penalty', late_penalty_percent: 10,
    },
  });
  await api('/api/onyx/assignments/' + late.data.id + '/publish',
    { token: w.alpha.faculty, method: 'POST' });

  const submitted = await api<{ is_late: number }>(
    '/api/onyx/assignments/' + late.data.id + '/submit',
    { token: w.alpha.s1, body: { body: 'sorry' } });
  assert.equal(submitted.data.is_late, 1, 'a late submission was not flagged');

  const queue = await api<{ submissions: { id: number }[] }>(
    '/api/onyx/assignments/' + late.data.id, { token: w.alpha.faculty });
  const graded = await api<{ score: number }>(
    '/api/onyx/submissions/' + queue.data.submissions[0]!.id + '/grade',
    { token: w.alpha.faculty, body: { score: 80 } });
  // 80 less the 10% the policy declares, applied once and stored.
  assert.equal(Number(graded.data.score), 72);

  // A rejecting policy refuses outright.
  const strict = await api<{ id: number }>('/api/onyx/courses/' + w.course + '/assignments', {
    token: w.alpha.faculty,
    body: {
      title: 'Closed', due_at: new Date(Date.now() - 3_600_000).toISOString(),
      late_policy: 'reject',
    },
  });
  await api('/api/onyx/assignments/' + strict.data.id + '/publish',
    { token: w.alpha.faculty, method: 'POST' });
  assert.equal((await api('/api/onyx/assignments/' + strict.data.id + '/submit',
    { token: w.alpha.s1, body: { body: 'late' } })).status, 422);
});

// ---------------------------------------------------------------------------
// The thing that matters most
// ---------------------------------------------------------------------------

test('nothing added in O02 crosses between institutions', async () => {
  // Beta builds its own course so there is something real on the other side.
  const betaCourse = await api<{ id: number }>('/api/onyx/courses', {
    token: w.beta.admin, body: { code: 'CS101', title: 'Rival Programming' },
  });
  assert.equal(betaCourse.ok, true,
    'the same course code should be free in another institution: ' + betaCourse.message);
  w.betaCourse = Number(betaCourse.data.id);

  // Alpha's catalog is Alpha's.
  const alphaCatalog = await api<{ id: number }[]>('/api/onyx/courses?all=1',
    { token: w.alpha.admin });
  assert.ok(!alphaCatalog.data.some((c) => Number(c.id) === w.betaCourse),
    'a catalog showed another institution\'s course');

  // Every id Alpha holds is unreachable from Beta, and vice versa. Each of
  // these is a real id -- the only thing in the way is the tenant.
  const fromBeta = [
    ['GET', '/api/onyx/courses/' + w.course],
    ['GET', '/api/onyx/courses/' + w.course + '/outline'],
    ['GET', '/api/onyx/courses/' + w.course + '/roster'],
    ['GET', '/api/onyx/lessons/' + w.lesson],
    ['GET', '/api/onyx/resources/' + w.resource + '/url'],
    ['GET', '/api/onyx/attendance/' + w.session + '/roster'],
    ['GET', '/api/onyx/attendance/' + w.session + '/code'],
    ['GET', '/api/onyx/assignments/' + w.assignment],
    ['GET', '/api/onyx/submissions/' + w.submission],
    ['GET', '/api/onyx/courses/' + w.course + '/attendance/analytics'],
  ] as const;
  for (const [method, path] of fromBeta) {
    const res = await api(path, { token: w.beta.admin, method });
    assert.ok(res.status === 404 || res.status === 403,
      'beta reached ' + path + ' (' + res.status + ')');
  }

  // Writes too, not only reads.
  const writes = [
    ['/api/onyx/courses/' + w.course + '/modules', { title: 'Injected' }],
    ['/api/onyx/courses/' + w.course + '/enroll', { user_id: w.ids['beta.student'] }],
    ['/api/onyx/attendance/' + w.session + '/mark',
      { entries: [{ user_id: w.ids['beta.student'], status: 'present' }] }],
    ['/api/onyx/courses/' + w.course + '/assignments', { title: 'Injected' }],
  ] as const;
  for (const [path, body] of writes) {
    const res = await api(path, { token: w.beta.admin, body });
    assert.ok(res.status === 404 || res.status === 403,
      'beta wrote to ' + path + ' (' + res.status + ')');
  }

  // And a learner at Beta cannot check in to a lecture at Alpha.
  const code = await api<{ code: string }>('/api/onyx/attendance/' + w.session + '/code',
    { token: w.alpha.faculty });
  const crossCheckIn = await api('/api/onyx/attendance/' + w.session + '/check-in',
    { token: w.beta.student, body: { code: code.data.code } });
  assert.ok(crossCheckIn.status === 404 || crossCheckIn.status === 403,
    'a learner checked in to another institution (' + crossCheckIn.status + ')');
});

test('RLS confines the O02 tables at the database, not just at the API', async () => {
  for (const k of ['SUPABASE_URL', 'SUPABASE_ANON_KEY']) {
    const { env } = await import('./harness.ts');
    process.env[k] ??= env[k];
  }
  const { onyxTenantClient } = await import('@onyx/core');
  const beta = onyxTenantClient(w.beta.admin);

  // Structure is readable within the tenant, and only within it.
  const { data: courses } = await beta.from('onyx_courses').select('id, tenant_id');
  assert.ok(courses!.length > 0, 'RLS hid the caller\'s own catalog');
  for (const c of courses!) assert.equal(Number(c.tenant_id), w.beta.id);

  const { data: lessons } = await beta.from('onyx_lessons').select('id');
  assert.equal(lessons?.length ?? 0, 0, 'a tenant token read another tenant\'s lessons');

  // Personal records are the caller's own, in the caller's own tenant.
  const alpha = onyxTenantClient(w.alpha.s1);
  const { data: progress } = await alpha.from('onyx_lesson_progress').select('user_id, tenant_id');
  for (const p of progress!) {
    assert.equal(Number(p.tenant_id), w.alpha.id);
    assert.equal(p.user_id, w.ids.s1);
  }
  const { data: others } = await onyxTenantClient(w.alpha.s2)
    .from('onyx_lesson_progress').select('id');
  assert.equal(others?.length ?? 0, 0, 'one learner read another\'s progress');

  const { data: submissions } = await onyxTenantClient(w.alpha.s2)
    .from('onyx_assignment_submissions').select('id');
  assert.equal(submissions?.length ?? 0, 0, 'one learner read another\'s submission');

  // Resources and rubric breakdowns have RLS and no select policy at all: they
  // are reached through the API, which checks enrolment first.
  const { data: resources } = await alpha.from('onyx_resources').select('id');
  assert.equal(resources?.length ?? 0, 0, 'resources are readable through PostgREST');
  const { data: scores } = await alpha.from('onyx_submission_scores').select('id');
  assert.equal(scores?.length ?? 0, 0, 'rubric scores are readable through PostgREST');

  // And a tenant token still cannot write anything.
  const { error } = await alpha.from('onyx_enrollments')
    .insert({ tenant_id: w.alpha.id, course_id: w.course, user_id: w.ids.outsider, status: 1 });
  assert.ok(error, 'a tenant token enrolled itself directly');
});

test('every O02 table is tenant-scoped, and cleanup leaves nothing behind', async () => {
  await withDb(async (c) => {
    const { rows: missing } = await c.query('SELECT * FROM onyx.assert_tenant_scoped()');
    assert.equal(missing.length, 0,
      'Onyx tables with no tenant_id: ' + missing.map((r) => r.missing).join(', '));

    await c.query('DELETE FROM public."onyx_tenants" WHERE slug = ANY($1)', [[A.slug, B.slug]]);
    await c.query('DELETE FROM public."onyx_users" WHERE email LIKE $1', ['l.%.' + RUN + '@onyx.test']);

    // Cascades reach every table O02 added, not only the ones O01 knew about.
    for (const table of [
      'onyx_courses', 'onyx_enrollments', 'onyx_modules', 'onyx_lessons',
      'onyx_lesson_progress', 'onyx_resources', 'onyx_attendance_sessions',
      'onyx_attendance_records', 'onyx_assignments', 'onyx_rubric_criteria',
      'onyx_assignment_submissions', 'onyx_submission_scores',
    ]) {
      const { rows: [left] } = await c.query(
        'SELECT count(*)::int c FROM public."' + table + '" t '
        + 'LEFT JOIN public."onyx_tenants" n ON n.id = t.tenant_id WHERE n.id IS NULL');
      assert.equal(left.c, 0, table + ' outlived its institution');
    }
  });
});
