/**
 * Reads guarded as tightly as the writes beside them — QA F3–F6.
 *
 * Four endpoints were found returning real rows to roles the product's own
 * capability model says may never see them. They share one shape, and it is
 * the shape worth having a test for: **somebody guarded the write and left the
 * read alone.**
 *
 * That is an easy thing to do and a hard thing to notice. The POST next door
 * calls `assertCan`, the page in front is role-guarded, the screen looks
 * correct to every human who opens it — and the GET underneath hands the same
 * data to anyone with a session. Two of the four read empty in both demo
 * institutions, so no screen anywhere would have shown the problem; they were
 * found by reading source, and they are checked here so the next one is found
 * by a failing test.
 *
 * `fees.structures` and `fees.gateways` are declared with an EMPTY holders
 * list, which in this product means no institution may ever delegate them —
 * not "they are off by default". A role reading them at all contradicts the
 * matrix rather than merely being generous.
 *
 * Asserted against the demo institution, whose roles are seeded and stable.
 * What matters is the refusal, so the tests assert the status and not the
 * payload: an endpoint that returns `[]` to a student today because nothing is
 * scheduled is not an endpoint that refuses them.
 */
import { test, expect } from '@playwright/test';
import { api } from './helpers.ts';

const PASSWORD = 'Demo#2026!';

/** Every seeded role in the demo institution, by the door it comes in through. */
const ROLES = {
  admin: 'admin@demo.onyx',
  faculty: 'faculty@demo.onyx',
  exams: 'exams@demo.onyx',
  student: 'student@demo.onyx',
  placement: 'placement@demo.onyx',
  employer: 'employer@demo.onyx',
  guardian: 'guardian@demo.onyx',
} as const;

type RoleName = keyof typeof ROLES;

const tokens = new Map<RoleName, string>();

async function tokenFor(role: RoleName): Promise<string> {
  const held = tokens.get(role);
  if (held) return held;
  const res = await api<{ token: string }>('/api/onyx/auth/login',
    { body: { email: ROLES[role], password: PASSWORD } });
  if (!res.ok) throw new Error('could not sign in as ' + role + ': ' + res.message);
  tokens.set(role, res.data.token);
  return res.data.token;
}

/**
 * Every role gets exactly one answer: allowed, or refused.
 *
 * Written as a table rather than a test each, because the interesting property
 * is the WHOLE row -- "these may, and every other role may not". A test per
 * endpoint that only checked the one role somebody remembered is how three of
 * these four survived review in the first place.
 */
const CASES: { path: string; what: string; allowed: RoleName[] }[] = [
  {
    // F3. The POST beside it asserts `fees.structures`; the GET did not.
    path: '/api/onyx/fee-structures',
    what: 'fee structures',
    allowed: ['admin'],
  },
  {
    path: '/api/onyx/fee-structures/1',
    what: 'one fee structure',
    allowed: ['admin'],
  },
  {
    // F4. The route's own docstring said "Administrators only" and the guard
    // said faculty and exams as well. No credential VALUES are exposed, but
    // which provider an institution banks with is not their business.
    path: '/api/onyx/admin/gateways',
    what: 'merchant configuration',
    allowed: ['admin'],
  },
  {
    // F5. This had no role guard at all -- only a session. An institution that
    // schedules teaching load was publishing staff workload to its students,
    // its guardians and any employer with an account.
    path: '/api/onyx/allocations',
    what: 'teaching-load allocations',
    allowed: ['admin', 'exams', 'faculty'],
  },
  {
    // F6. `drives()` narrows its query for exactly one role -- employer, to
    // their own -- so every other role received the whole recruitment
    // calendar.
    path: '/api/onyx/drives',
    what: 'placement drives',
    allowed: ['admin', 'placement', 'employer'],
  },
];

test.describe.configure({ mode: 'serial' });

for (const c of CASES) {
  test(c.what + ': only ' + c.allowed.join(', ') + ' may read it', async () => {
    for (const role of Object.keys(ROLES) as RoleName[]) {
      const token = await tokenFor(role);
      const res = await api(c.path, { token });

      if (c.allowed.includes(role)) {
        // 404 counts as allowed here: `/fee-structures/1` may name a row this
        // institution does not have, and "no such structure" is a different
        // answer from "not for you". What must not happen is a refusal.
        expect([200, 404], role + ' was refused ' + c.what + ' and should not have been')
          .toContain(res.status);
        continue;
      }

      expect([401, 403], role + ' could read ' + c.what)
        .toContain(res.status);
    }
  });
}

test('the role guard answers first, and the capability check sits behind it', async () => {
  /*
   * Faculty get the flat "This action is unauthorized." rather than the named
   * capability message, and that is right rather than a rough edge: the role
   * guard is the OUTER gate and it refuses before `assertCan` is reached.
   *
   * The layering is the point of the fix. `assertCan` alone would make the
   * route only as strong as the institution's own settings; the role guard
   * alone is what these endpoints already had, and it was set to the wrong
   * list. Both, in that order, is the house rule -- see capability.ts.
   *
   * (The named message is unreachable for `fees.structures` in particular:
   * its holders list is empty, so no role below admin can ever be granted it,
   * and admin can never have it revoked. permissions.spec.ts covers the named
   * refusal on a capability that IS delegable.)
   */
  const faculty = await tokenFor('faculty');
  const res = await api('/api/onyx/fee-structures', { token: faculty });
  expect(res.status).toBe(403);
  expect(String(res.message)).toMatch(/unauthorized/i);
});

test('an administrator still reads all four, so the fix did not just break them', async () => {
  // The failure mode of tightening a guard is tightening it onto everybody.
  // Asserted last, because a suite where every case passes by refusing
  // everyone would otherwise look green.
  const admin = await tokenFor('admin');
  for (const path of [
    '/api/onyx/fee-structures', '/api/onyx/admin/gateways',
    '/api/onyx/allocations', '/api/onyx/drives',
  ]) {
    const res = await api(path, { token: admin });
    expect(res.status, 'an administrator was refused ' + path).toBe(200);
  }
});
