/**
 * The second half of the seed: everything that needs the academic structure
 * from the first half to already exist.
 *
 * Split from seed-full.mjs because the two halves fail differently. The first
 * builds the skeleton and almost cannot fail once the tenant exists; this one
 * walks long dependency chains -- bank before question before paper before
 * attempt before mark before published result -- where a single 422 halfway
 * along leaves a half-built object that the next run has to recognise. Keeping
 * them apart means a failure here does not re-run the first half's few hundred
 * calls.
 *
 * Every step is skipped if its natural key already exists. Where a chain has
 * no natural key (an attempt, a payment), the step checks whether the *result*
 * is already there instead.
 */

export async function secondPass(ctx) {
  const { call, post, get, step, done, at, dateOnly, PW, emailFor } = ctx;

  const tokenFor = async (email) => {
    const r = await call('/api/onyx/auth/login', { body: { email, password: PW } });
    return r.ok ? r.data.token : null;
  };

  for (const s of ctx.summary) {
    const { admin, program, semester, batch, courses, studentIds, facultyIds,
      employerUserId, guardianUserId, inst, domain } = s.context;
    const live = courses.filter((c) => c.spec.publish);
    const studentEmails = inst.students.map((n) => emailFor(n, domain));

    console.log('-'.repeat(64));
    console.log(s.institution + ' — assessments, exams, careers, campus');
    console.log('-'.repeat(64));

    // Tokens for the roles that own particular acts. The blueprint splits are
    // deliberate in the product -- exams creates a hall, faculty enters marks,
    // exams publishes them -- so the seed uses the right one for each rather
    // than doing everything as admin and proving nothing.
    const examsEmail = (inst.staff.find((x) => x.role === 'exams') ?? {}).email;
    const placementEmail = (inst.staff.find((x) => x.role === 'placement') ?? {}).email;
    const employerEmail = (inst.staff.find((x) => x.role === 'employer') ?? {}).email;
    const guardianEmail = (inst.staff.find((x) => x.role === 'guardian') ?? {}).email;
    const exams = examsEmail ? await tokenFor(examsEmail) : null;
    const placement = placementEmail ? await tokenFor(placementEmail) : null;
    const employer = employerEmail ? await tokenFor(employerEmail) : null;

    // ---- practice problems ------------------------------------------------
    step('code lab problems');
    const PROBLEMS = [
      { slug: 'sum-two-numbers', title: 'Sum two numbers', difficulty: 'easy', topic: 'basics',
        statement: 'Read two integers on one line and print their sum.',
        tests: [{ name: 'small', stdin: '2 3\n', expected_stdout: '5', is_hidden: false, weight: 1 },
          { name: 'large', stdin: '1000 2500\n', expected_stdout: '3500', is_hidden: true, weight: 1 }] },
      { slug: 'reverse-a-string', title: 'Reverse a string', difficulty: 'easy', topic: 'strings',
        statement: 'Read one line and print it reversed.',
        tests: [{ name: 'word', stdin: 'onyx\n', expected_stdout: 'xyno', is_hidden: false, weight: 1 }] },
      { slug: 'count-vowels', title: 'Count the vowels', difficulty: 'medium', topic: 'strings',
        statement: 'Read one line and print how many vowels it contains.',
        tests: [{ name: 'phrase', stdin: 'data structures\n', expected_stdout: '5', is_hidden: false, weight: 1 }] },
      { slug: 'binary-search', title: 'Binary search', difficulty: 'hard', topic: 'algorithms',
        statement: 'Given a sorted list and a target, print the index or -1.',
        tests: [{ name: 'found', stdin: '1 3 5 7\n5\n', expected_stdout: '2', is_hidden: false, weight: 2 }] },
    ];
    const existingProblems = await get('/api/onyx/problems?all=1', admin);
    const problemIds = [];
    let newProblems = 0;
    for (const [pi, spec] of PROBLEMS.entries()) {
      let p = (existingProblems ?? []).find((x) => x.slug === spec.slug);
      if (!p) {
        // Alternate the author so the faculty practice view has more than one
        // name in its "set by" column -- with a single author that column
        // proves nothing about whether the lookup works.
        //
        // The faculty-authored ones are deliberately course-less. A problem may
        // sit in the bank unattached, and attaching it to an arbitrary course
        // would fail `assertCanTeach` for any author who does not teach that
        // course -- which is the product being right, not an obstacle to work
        // around by seeding everything as admin.
        const byAdmin = pi % 2 === 0;
        const authorToken = byAdmin ? admin : (await tokenFor(
          (inst.staff.find((x) => x.role === 'faculty') ?? {}).email) ?? admin);
        p = await post('problem ' + spec.slug, '/api/onyx/problems', {
          title: spec.title, slug: spec.slug, statement: spec.statement,
          difficulty: spec.difficulty, topic: spec.topic, languages: ['python'],
          ...(byAdmin ? { course_id: Number(live[pi % live.length].id) } : {}),
        }, authorToken);
        await call('/api/onyx/problems/' + p.id + '/tests',
          { method: 'PUT', token: admin, body: { tests: spec.tests } });
        await call('/api/onyx/problems/' + p.id + '/hints', {
          method: 'PUT', token: admin,
          body: { hints: [{ body: 'Start from the smallest case.', penalty_percent: 10 }] },
        });
        await call('/api/onyx/problems/' + p.id + '/publish', { method: 'POST', token: admin });
        newProblems += 1;
      }
      problemIds.push(Number(p.id));
    }
    done(problemIds.length + ' (' + newProblems + ' new)');

    // ---- practice submissions --------------------------------------------
    // Real rows so the practice-results screens have something to show. The
    // sandbox may be absent (503) -- that is survivable and the rows still
    // exist as queued, which is itself a state worth being able to look at.
    step('practice submissions');
    let submissions = 0;
    for (const [si, email] of studentEmails.slice(0, 6).entries()) {
      const token = await tokenFor(email);
      if (!token) continue;
      const mine = await get('/api/onyx/practice/results', token);
      if ((mine ?? []).length) continue;
      for (const pid of problemIds.slice(0, 2 + (si % 3))) {
        const r = await call('/api/onyx/problems/' + pid + '/submit', {
          token,
          body: { language: 'python', mode: 'submit',
            source: 'import sys\nprint(sum(int(x) for x in sys.stdin.read().split()))\n' },
        });
        if (r.ok) submissions += 1;
      }
    }
    await call('/api/onyx/queue/drain', { body: { concurrency: 4 }, token: admin });
    done(submissions);

    // ---- assessments ------------------------------------------------------
    step('question banks and papers');
    const banks = await get('/api/onyx/banks', admin);
    let papers = 0;
    for (const course of live.slice(0, 2)) {
      const bankName = course.title + ' question bank';
      let bank = (banks ?? []).find((b) => b.name === bankName);
      if (!bank) {
        bank = await post('bank', '/api/onyx/banks',
          { name: bankName, course_id: Number(course.id),
            description: 'Questions for ' + course.title + '.' }, admin);
        // One of every type, plus a keyless objective. The keyless one is the
        // reason the marking queue ever has objective questions in it: a
        // question with no answer key is hand-marked, not wrong by default.
        const questions = [
          { type: 'single', prompt: 'Which structure gives O(1) average lookup?', points: 2,
            options: [{ id: 'a', text: 'Linked list' }, { id: 'b', text: 'Hash table' },
              { id: 'c', text: 'Binary tree' }], answer: 'b', difficulty: 'easy',
            tags: ['structures'], explanation: 'Hashing gives constant-time average lookup.' },
          { type: 'multiple', prompt: 'Which of these are stable sorts?', points: 3,
            options: [{ id: 'a', text: 'Merge sort' }, { id: 'b', text: 'Quick sort' },
              { id: 'c', text: 'Insertion sort' }], answer: ['a', 'c'], difficulty: 'medium',
            tags: ['algorithms'] },
          { type: 'truefalse', prompt: 'A stack is first-in, first-out.', points: 1,
            answer: 'false', difficulty: 'easy', tags: ['structures'] },
          { type: 'short', prompt: 'Name the traversal that visits root, left, right.', points: 2,
            answer: ['preorder', 'pre-order'], difficulty: 'medium', tags: ['trees'] },
          { type: 'essay', prompt: 'Explain when you would choose a heap over a sorted array.',
            points: 6, difficulty: 'hard', tags: ['structures'] },
          // Keyless on purpose -- shaped like an MCQ, marked by a person.
          { type: 'single', prompt: 'Which approach would you take here, and why?', points: 4,
            options: [{ id: 'a', text: 'Iterative' }, { id: 'b', text: 'Recursive' }],
            difficulty: 'hard', tags: ['judgement'] },
        ];
        for (const q of questions) {
          await post('question', '/api/onyx/banks/' + bank.id + '/questions', q, admin);
        }
      }

      const already = await get('/api/onyx/assessments?course_id=' + course.id, admin);
      if ((already ?? []).length) { papers += already.length; continue; }
      const paper = await post('assessment', '/api/onyx/assessments', {
        title: course.title + ' — class test',
        course_id: Number(course.id),
        instructions: 'Answer every question. Marks are shown beside each one.',
        opens_at: at(-1, 9), closes_at: at(14, 23),
        duration_minutes: 45, attempts_allowed: 2, pass_mark: 8,
        sections: [{ id: 's1', title: 'Objective', bank_id: Number(bank.id), take: 4 },
          { id: 's2', title: 'Written', bank_id: Number(bank.id), take: 1 }],
        shuffle_questions: true, shuffle_options: true,
        anonymous_marking: true, moderation_required: false,
      }, admin);
      await call('/api/onyx/assessments/' + paper.id + '/publish', { method: 'POST', token: admin });
      papers += 1;

      // Sit it, so the marking queue and the results screens are not empty.
      for (const email of studentEmails.slice(0, 4)) {
        const token = await tokenFor(email);
        if (!token) continue;
        const started = await call('/api/onyx/assessments/' + paper.id + '/start',
          { body: {}, token });
        if (!started.ok) continue;
        const attempt = started.data;
        for (const entry of attempt.paper ?? []) {
          await call('/api/onyx/attempts/' + attempt.id + '/answer', {
            token,
            body: { question_id: entry.question_id,
              response: entry.type === 'multiple' ? ['a']
                : entry.type === 'truefalse' ? 'false'
                  : entry.type === 'short' ? 'preorder'
                    : entry.type === 'essay' ? 'A heap keeps the smallest item cheap to reach.'
                      : 'b' },
          });
        }
        await call('/api/onyx/attempts/' + attempt.id + '/submit', { method: 'POST', token });
      }

      // Mark the written answers and release, so a learner has a real result.
      const queue = await get('/api/onyx/assessments/' + paper.id + '/marking', admin);
      for (const row of (queue ?? []).slice(0, 2)) {
        const sat = await get('/api/onyx/attempts/' + row.id + '/paper', admin);
        const marks = (sat?.answers ?? sat?.paper ?? [])
          .filter((a) => a.type === 'essay' || a.manual_points === null)
          .map((a) => ({ question_id: a.question_id, points: Math.ceil((a.points ?? 2) * 0.7),
            comment: 'Reasonable, but be specific about the cost.' }));
        if (marks.length) {
          await call('/api/onyx/attempts/' + row.id + '/mark', { token: admin, body: { marks } });
        }
      }
      await call('/api/onyx/assessments/' + paper.id + '/results/publish',
        { method: 'POST', token: admin });
    }
    done(papers + ' papers');

    // ---- examinations -----------------------------------------------------
    step('halls, exams, seating, marks');
    const examToken = exams ?? admin;
    const halls = await get('/api/onyx/halls', examToken);
    let hall = (halls ?? []).find((h) => h.code === 'H1');
    if (!hall) {
      hall = await post('hall', '/api/onyx/halls',
        { code: 'H1', name: 'Main Examination Hall', row_count: 10, col_count: 6 }, examToken);
    }
    const existingExams = await get('/api/onyx/exams', examToken);
    let examCount = 0;
    for (const [ci, course] of live.entries()) {
      const title = course.title + ' end-of-term';
      let exam = (existingExams ?? []).find((e) => e.title === title);
      if (!exam) {
        exam = await post('exam', '/api/onyx/exams', {
          semester_id: Number(semester.id), course_id: Number(course.id), title,
          // Spread across days so the clash check has nothing to trip on, and
          // in the past so marks can legitimately exist.
          starts_at: at(-20 + ci * 2, 9 + ci), duration_minutes: 120,
          max_marks: 100, pass_marks: 40,
        }, examToken);
        await call('/api/onyx/exams/' + exam.id + '/seating',
          { body: { hall_ids: [Number(hall.id)] }, token: examToken });
        const entries = studentIds.map((id, i) => ({ user_id: id, raw_marks: 38 + ((i * 11) % 55) }));
        await call('/api/onyx/exams/' + exam.id + '/marks', { body: { entries }, token: admin });
        await call('/api/onyx/exams/' + exam.id + '/publish', { method: 'POST', token: examToken });
      }
      examCount += 1;
    }
    // One scheduled ahead and unmarked, so "upcoming" is not empty either.
    const upcoming = live[0].title + ' resit';
    if (!(existingExams ?? []).some((e) => e.title === upcoming)) {
      await call('/api/onyx/exams', {
        token: examToken,
        body: { semester_id: Number(semester.id), course_id: Number(live[0].id),
          title: upcoming, starts_at: at(21, 9), duration_minutes: 120, max_marks: 100 },
      });
      examCount += 1;
    }
    done(examCount + ' exams');

    // ---- fees -------------------------------------------------------------
    step('fee heads, structure, invoices');
    const heads = await get('/api/onyx/fee-heads', admin);
    const headIds = [];
    for (const h of [{ code: 'TUI', name: 'Tuition', category: 'tuition' },
      { code: 'EXM', name: 'Examination', category: 'exam' },
      { code: 'LIB', name: 'Library', category: 'library' }]) {
      let head = (heads ?? []).find((x) => x.code === h.code);
      if (!head) head = await post('fee head', '/api/onyx/fee-heads', h, admin);
      headIds.push(Number(head.id));
    }
    const structures = await get('/api/onyx/fee-structures', admin);
    const structName = semester.name + ' fees';
    let structure = (structures ?? []).find((x) => x.name === structName);
    if (!structure) {
      structure = await post('fee structure', '/api/onyx/fee-structures', {
        name: structName, program_id: Number(program.id), semester_id: Number(semester.id),
        instalments: 2, currency: 'INR',
        lines: [{ head_id: headIds[0], amount_minor: 4_500_00 },
          { head_id: headIds[1], amount_minor: 250_00 },
          { head_id: headIds[2], amount_minor: 120_00 }],
      }, admin);
      await call('/api/onyx/fee-structures/' + structure.id + '/publish',
        { method: 'POST', token: admin });
    }
    let invoices = 0;
    for (const [i, sid] of studentIds.entries()) {
      const r = await call('/api/onyx/invoices', {
        token: admin,
        body: { user_id: sid, structure_id: Number(structure.id), instalment_no: 1,
          due_at: at(-5 + i, 23) },
      });
      if (!r.ok) continue;
      invoices += 1;
      // Two thirds have paid, so both settled and outstanding exist.
      if (i % 3 !== 0) {
        await call('/api/onyx/payments', {
          token: admin,
          body: { invoice_id: Number(r.data.id), gateway: 'offline',
            reference: 'SEED-' + s.tenant + '-' + i, amount_minor: r.data.total_minor ?? 4_870_00,
            method: 'bank_transfer', status: 'captured' },
        });
      }
    }
    done(invoices + ' invoices');

    // ---- rooms and timetable ---------------------------------------------
    step('rooms and timetable');
    const rooms = await get('/api/onyx/rooms', admin);
    const roomIds = [];
    for (const r of [{ code: 'R101', name: 'Lecture Room 101', capacity: 60, kind: 'lecture' },
      { code: 'L201', name: 'Computing Lab 201', capacity: 40, kind: 'lab' }]) {
      let room = (rooms ?? []).find((x) => x.code === r.code);
      if (!room) room = await post('room', '/api/onyx/rooms', r, admin);
      roomIds.push(Number(room.id));
    }
    let slots = 0;
    for (const [ci, course] of live.entries()) {
      const r = await call('/api/onyx/timetable', {
        token: admin,
        body: { semester_id: Number(semester.id), course_id: Number(course.id),
          batch_id: Number(batch.id), room_id: roomIds[ci % roomIds.length],
          faculty_id: course.facultyId ?? facultyIds[0],
          day_of_week: (ci % 5) + 1,
          starts_at: String(9 + ci).padStart(2, '0') + ':00',
          ends_at: String(10 + ci).padStart(2, '0') + ':00' },
      });
      if (r.ok) slots += 1;
    }
    await call('/api/onyx/timetable/publish',
      { body: { semester_id: Number(semester.id) }, token: admin });
    done(slots + ' slots');

    // ---- guardians --------------------------------------------------------
    if (guardianUserId) {
      step('guardian link and consent');
      const firstStudent = studentIds[0];
      const studentToken = await tokenFor(studentEmails[0]);
      let linked = 0;
      const mine = studentToken ? await get('/api/onyx/family/links', studentToken) : [];
      if (!(mine ?? []).length && studentToken) {
        // Created by the learner, so it is verified immediately -- the path a
        // real family link takes.
        const link = await call('/api/onyx/guardians', {
          token: studentToken,
          body: { guardian_user_id: guardianUserId, student_user_id: firstStudent,
            relationship: 'parent' },
        });
        if (link.ok) {
          linked = 1;
          for (const scope of ['attendance', 'results', 'fees']) {
            await call('/api/onyx/guardians/' + link.data.id + '/consent', {
              token: studentToken,
              // Fees withheld, so the "consented to some things and not others"
              // state is visible rather than only all-or-nothing.
              body: { scope, allowed: scope !== 'fees' },
            });
          }
        }
      }
      done(linked ? 'linked, 2 of 3 scopes consented' : 'already linked');
    }

    // ---- careers ----------------------------------------------------------
    step('employers, jobs, applications');
    const placementToken = placement ?? admin;
    const employers = await get('/api/onyx/employers', placementToken);
    let firm = (employers ?? []).find((e) => e.name === 'Northwind Systems');
    if (!firm) {
      firm = await post('employer', '/api/onyx/employers', {
        name: 'Northwind Systems', website: 'https://northwind.example',
        about: 'Builds data platforms for logistics.',
        contact_name: 'Deepak Shah', contact_email: employerEmail,
        ...(employerUserId ? { user_id: employerUserId } : {}),
      }, placementToken);
    }
    const jobs = await get('/api/onyx/jobs?all=1', placementToken);
    let job = (jobs ?? []).find((j) => j.title === 'Graduate Software Engineer');
    if (!job) {
      // Created by the employer and published by placement -- the split the
      // product enforces, and worth exercising rather than shortcutting.
      job = await post('job', '/api/onyx/jobs', {
        employer_id: Number(firm.id), title: 'Graduate Software Engineer',
        description: 'Join the platform team. We train on the job.',
        location: 'Bengaluru', compensation: '₹9,00,000', openings: 4,
      }, employer ?? placementToken);
      await call('/api/onyx/jobs/' + job.id + '/publish',
        { method: 'POST', token: placementToken });
    }
    let applied = 0;
    for (const email of studentEmails.slice(0, 5)) {
      const token = await tokenFor(email);
      if (!token) continue;
      const r = await call('/api/onyx/jobs/' + job.id + '/apply',
        { token, body: { note: 'I have built two projects on this stack.' } });
      if (r.ok) applied += 1;
    }
    done(applied + ' applications');

    // ---- skills, certificates, readiness ----------------------------------
    step('skills, certificates, readiness');
    const skills = await get('/api/onyx/skills', placementToken);
    const skillIds = [];
    for (const name of ['Python', 'SQL', 'Data structures']) {
      let sk = (skills ?? []).find((x) => x.name === name);
      if (!sk) sk = await post('skill', '/api/onyx/skills', { name, category: 'technical' },
        placementToken);
      skillIds.push(Number(sk.id));
    }
    for (const [i, sid] of studentIds.slice(0, 8).entries()) {
      await call('/api/onyx/skills/award', {
        token: placementToken,
        body: { user_id: sid, skill_id: skillIds[i % skillIds.length],
          source_type: 'course', source_id: Number(live[0].id), strength: 55 + ((i * 7) % 40) },
      });
    }
    for (const sid of studentIds.slice(0, 4)) {
      await call('/api/onyx/certificates', {
        token: admin,
        body: { user_id: sid, title: live[0].title + ' — completion', kind: 'course',
          course_id: Number(live[0].id), detail: { percent: 82, grade: 'A' } },
      });
    }
    // Readiness has no create endpoint -- it is materialised as a side effect
    // of reading a profile, so read one per learner to populate the table.
    let scored = 0;
    for (const email of studentEmails) {
      const token = await tokenFor(email);
      if (!token) continue;
      const r = await call('/api/onyx/my/profile', { token });
      if (r.ok) scored += 1;
    }
    done(scored + ' profiles scored');

    // ---- discussions and tickets -----------------------------------------
    step('discussions and support');
    let threads = 0;
    for (const [ci, course] of live.slice(0, 2).entries()) {
      const email = studentEmails[ci % studentEmails.length];
      const token = await tokenFor(email);
      if (!token) continue;
      const had = await get('/api/onyx/courses/' + course.id + '/discussions', token);
      if ((had ?? []).length) { threads += had.length; continue; }
      const thread = await call('/api/onyx/courses/' + course.id + '/discussions', {
        token,
        body: { title: 'Why does the second example use a queue?',
          body: 'I followed the first one but the second switches structure and I cannot see why.' },
      });
      if (!thread.ok) continue;
      threads += 1;
      await call('/api/onyx/discussions/' + thread.data.id + '/replies', {
        token: admin,
        body: { body: 'Because order of arrival matters there. Work through the trace by hand.' },
      });
      // One escalated, so the mentor queue has something real in it.
      if (ci === 0) {
        await call('/api/onyx/discussions/' + thread.data.id + '/escalate',
          { token, body: { note: 'Still stuck after the reply.', priority: 'normal' } });
      }
    }
    const firstToken = await tokenFor(studentEmails[0]);
    if (firstToken) {
      const tickets = await get('/api/onyx/tickets', firstToken);
      if (!(tickets ?? []).length) {
        await call('/api/onyx/tickets', {
          token: firstToken,
          body: { subject: 'Cannot open the lab from home', priority: 'high',
            body: 'The workspace loads but Run does nothing on my machine.' },
        });
      }
    }
    done(threads + ' threads');

    console.log('');
  }
}
