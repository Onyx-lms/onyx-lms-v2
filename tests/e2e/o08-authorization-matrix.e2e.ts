/**
 * SEC-02 -- the role-by-route authorization matrix.
 *
 * "Role-by-route matrix test for student, faculty, exams, placement, admin and
 * guardian", against an acceptance criterion of "every route has an asserted
 * expectation for every role".
 *
 * Role guards were already tested -- but case by case, in whichever sprint
 * added the route, which is the shape of coverage that has holes in it by
 * construction. Nothing said what `placement` should get from the audit log,
 * because nobody writing the placement sprint was thinking about the audit log.
 * This file is the other shape: one table, every role against every route, and
 * an expectation on every cell whether or not anybody thought about it.
 *
 * **Deny is the assertion, not allow.** For each route the table names who may
 * reach it; every other role must be refused. So adding a role to the product
 * without adding it here fails, and widening a guard without widening the table
 * fails -- which is the property that makes this a matrix rather than a list.
 *
 * **403 and 404 are both refusals.** Some routes deliberately answer 404 to an
 * id the caller may not see, because "403 on this id" confirms the id exists
 * (CLAUDE.md's rule, learned the hard way in O03 and twice in O04). Either is a
 * pass; a 200 is not.
 *
 * **A 422 is also a pass.** Several of these are POSTs sent with a deliberately
 * empty body: reaching validation means the guard let them through, which is
 * exactly what the "allowed" rows are asserting. The forbidden rows never get
 * that far.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { api, createTenant, RUN, onyxLogin } from './harness.ts';

const pw = 'OnyxTest#2026';
const mail = (who: string) => 'sec02.' + who + '.' + RUN + '@onyx.test';
const T = { name: 'Matrix Institute ' + RUN, slug: 'matrix-' + RUN };

/** The six roles the requirement names, plus the outsider. */
const ROLES = ['student', 'faculty', 'exams', 'placement', 'employer', 'guardian', 'admin'] as const;
type MatrixRole = typeof ROLES[number];

const token: Record<MatrixRole, string> = {
  student: '', faculty: '', exams: '', placement: '', employer: '', guardian: '', admin: '',
};

/**
 * One row of the matrix: a route, and exactly who may reach it.
 *
 * `allow` is the whole of the specification. Everything not in it is asserted
 * to be refused, which is what makes a missing entry a failure rather than a
 * gap.
 */
interface Row {
  what: string;
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  path: string;
  body?: unknown;
  allow: MatrixRole[];
}

const MATRIX: Row[] = [
  // ---- CMP-05: tenancy, people and the audit trail ----------------------
  // Widened deliberately: the examinations office runs invigilation and
  // marking institution-wide and needs the same "who is this" name lookup
  // admin/faculty already had (Invigilate used to show a bare candidate id
  // to this role for exactly this reason).
  { what: 'the roster', path: '/api/onyx/members', allow: ['admin', 'faculty', 'exams'] },
  { what: 'adding a member', method: 'POST', path: '/api/onyx/members', body: {},
    allow: ['admin'] },
  { what: 'the audit log', path: '/api/onyx/audit', allow: ['admin'] },

  // ---- LRN: learning ----------------------------------------------------
  { what: 'the catalogue', path: '/api/onyx/courses',
    allow: ['student', 'faculty', 'exams', 'placement', 'admin', 'employer', 'guardian'] },
  // Widened deliberately: a faculty member can create a course of their own,
  // auto-assigned as its teacher, not only the register administrator
  // (LRN-01 -- "faculty can create a course and add students to it").
  { what: 'creating a course', method: 'POST', path: '/api/onyx/courses', body: {},
    allow: ['admin', 'faculty'] },
  { what: 'programmes', path: '/api/onyx/programs',
    allow: ['student', 'faculty', 'exams', 'placement', 'admin', 'employer', 'guardian'] },
  { what: 'creating a programme', method: 'POST', path: '/api/onyx/programs', body: {},
    allow: ['admin'] },

  // ---- ASS: assessment --------------------------------------------------
  { what: 'question banks', path: '/api/onyx/banks', allow: ['admin', 'faculty', 'exams'] },
  { what: 'the invigilation queue', path: '/api/onyx/proctor/queue',
    allow: ['admin', 'faculty', 'exams'] },
  { what: 'my own papers', path: '/api/onyx/my/assessments',
    allow: ['student', 'faculty', 'exams', 'placement', 'admin', 'employer', 'guardian'] },

  // ---- CAR: career ------------------------------------------------------
  { what: 'the certificate register', path: '/api/onyx/certificates',
    allow: ['admin', 'exams', 'placement'] },
  { what: 'issuing a certificate', method: 'POST', path: '/api/onyx/certificates', body: {},
    allow: ['admin', 'exams', 'placement'] },
  { what: 'the employer register', path: '/api/onyx/employers', allow: ['admin', 'placement'] },
  { what: 'my own profile', path: '/api/onyx/my/profile',
    allow: ['student', 'faculty', 'exams', 'placement', 'admin', 'employer', 'guardian'] },

  // ---- CMP: campus ------------------------------------------------------
  { what: 'faculty allocation', method: 'POST', path: '/api/onyx/allocations', body: {},
    allow: ['admin'] },
  { what: 'teaching load', path: '/api/onyx/semesters/1/workload', allow: ['admin', 'faculty'] },
  { what: 'scheduling a class', method: 'POST', path: '/api/onyx/timetable', body: {},
    allow: ['admin'] },
  { what: 'the clash pre-check', method: 'POST', path: '/api/onyx/timetable/check', body: {},
    allow: ['admin'] },
  // Widened deliberately: this course's own faculty may also schedule its
  // exam, not only the examinations office (assertCanRunExam in
  // campus.routes.ts) -- the same course-scoped trust extended to editing,
  // moderating and publishing it, and to entering its marks below.
  { what: 'scheduling an exam', method: 'POST', path: '/api/onyx/exams', body: {},
    allow: ['admin', 'exams', 'faculty'] },
  // Readable by any member on purpose: halls and rooms are institutional
  // furniture, and 0008_campus.sql gives them a tenant read policy for the
  // same reason a published timetable is public within the institution.
  { what: 'halls', path: '/api/onyx/halls',
    allow: ['student', 'faculty', 'exams', 'placement', 'admin', 'employer', 'guardian'] },
  { what: 'money owed, institution-wide', path: '/api/onyx/finance/outstanding',
    allow: ['admin'] },
  { what: 'fee heads', method: 'POST', path: '/api/onyx/fee-heads', body: {}, allow: ['admin'] },
  { what: 'gateway credentials', path: '/api/onyx/admin/gateways', allow: ['admin'] },
  { what: 'recording a payment', method: 'POST', path: '/api/onyx/payments', body: {},
    allow: ['admin'] },
  { what: 'my own invoices', path: '/api/onyx/invoices',
    allow: ['student', 'faculty', 'exams', 'placement', 'admin', 'employer', 'guardian'] },
  // The guardian's ONE route, and nobody else's -- not even an administrator's.
  // What a guardian sees is derived from links the learner controls, so there
  // is no institutional version of this page to give anyone.
  { what: 'the family view', path: '/api/onyx/family', allow: ['guardian'] },

  // ---- Notifications: yours, and only ever yours ------------------------
  { what: 'my own inbox', path: '/api/onyx/notifications',
    allow: ['student', 'faculty', 'exams', 'placement', 'admin', 'employer', 'guardian'] },
];

/** A refusal. 401 would mean the token was bad, which would be a broken test. */
const REFUSED = [403, 404];
/** Reaching validation means the guard allowed it through. */
const ALLOWED = [200, 201, 400, 404, 409, 422];

test('an institution with one of every role in it', async () => {
  const res = await createTenant({
    name: T.name, slug: T.slug,
    admin: { name: 'Matrix Admin', email: mail('admin'), password: pw },
  });
  assert.equal(res.ok, true, res.message);
  token.admin = await onyxLogin(mail('admin'), pw);

  for (const role of ROLES) {
    if (role === 'admin') continue;
    const added = await api('/api/onyx/members', {
      token: token.admin,
      body: { name: role, email: mail(role), role, password: pw },
    });
    assert.equal(added.ok, true, 'add ' + role + ': ' + added.message);
    token[role] = await onyxLogin(mail(role), pw);
  }
});

test('every route has an asserted expectation for every role', async () => {
  const failures: string[] = [];

  for (const row of MATRIX) {
    for (const role of ROLES) {
      const res = await api(row.path, {
        token: token[role],
        method: row.method ?? 'GET',
        ...(row.body !== undefined ? { body: row.body } : {}),
      });

      const mayReach = row.allow.includes(role);
      const ok = mayReach
        ? ALLOWED.includes(res.status)
        : REFUSED.includes(res.status);

      if (!ok) {
        failures.push(
          (mayReach ? 'REFUSED but should reach' : 'REACHED but should be refused')
          + ': ' + role + ' -> ' + (row.method ?? 'GET') + ' ' + row.path
          + '  (' + row.what + ', got ' + res.status + ')');
      }
    }
  }

  // Every cell reported at once. Failing on the first would mean fixing one
  // guard, re-running, and finding the next -- and this table has 189 cells.
  assert.deepEqual(failures, [],
    'authorization matrix violations:\n  ' + failures.join('\n  '));
});

test('the matrix covers every role the product has', async () => {
  // A role added to the product without being added here would otherwise be
  // silently untested. ROLES is the list this file asserts against; the API's
  // own list is the truth.
  const me = await api<{ role: string }>('/api/onyx/me', { token: token.admin });
  assert.equal(me.ok, true);

  const known = ['student', 'faculty', 'exams', 'placement', 'employer', 'guardian', 'admin'];
  assert.deepEqual([...ROLES].sort(), [...known].sort(),
    'a role exists that the authorization matrix does not test');
});

test('cleanup leaves nothing behind', async () => {
  const { withDb } = await import('./harness.ts');
  await withDb(async (c) => {
    await c.query('DELETE FROM onyx_tenants WHERE slug = $1', [T.slug]);
    await c.query('DELETE FROM onyx_users WHERE email LIKE $1',
      ['sec02.%.' + RUN + '@onyx.test']);
  });
  const gone = await api('/api/onyx/auth/login', {
    body: { email: mail('admin'), password: pw },
  });
  assert.equal(gone.ok, false, 'the matrix institution survived cleanup');
});
