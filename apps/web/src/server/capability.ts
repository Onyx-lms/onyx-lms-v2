import { HttpError, can, capability, type CapabilityKey, type PermissionOverrides } from '@onyx/core';
import type { Role } from '@/lib/onyx-session';
import type { AppContext } from '@/server/app-context';

/**
 * The route-side half of the permission matrix.
 *
 * `requireOnyxRole(req, secret, 'admin', 'faculty')` answers "is this role on
 * the list I wrote when I built this route". `assertCan` answers "is this role
 * on the list THIS INSTITUTION keeps for this capability" -- the same question
 * with the answer moved out of the code and into the tenant's own settings.
 *
 * Two deliberate properties:
 *
 *   * It is checked AFTER the role guard, never instead of it. The guard still
 *     rules out roles that could never hold the capability (a student posting
 *     to /api/onyx/exams), so a matrix that somehow said otherwise could not
 *     widen the API past what the route was built for. Defence in depth, and
 *     the same reason `holders` exists in the catalogue.
 *   * It is checked BEFORE the record-scoped rules. `assertCanTeach` still runs
 *     underneath: holding `courses.author` says a lecturer may author courses,
 *     not that they may author yours.
 *
 * One read of the tenant row per call, which is the same read
 * assertCanScheduleExam already does for the flag it replaces.
 */
export async function assertCan(
  ctx: AppContext, tenantId: number, role: Role, key: CapabilityKey,
): Promise<void> {
  const tenant = await ctx.onyxTenancy.tenant(tenantId);
  const overrides = (tenant?.permissions ?? {}) as PermissionOverrides;
  if (can(role, key, overrides)) return;

  // Named, not "Forbidden": an administrator who has just switched something
  // off should be able to tell from the message what to switch back on, and a
  // lecturer who has lost an action should learn it was a decision rather than
  // a bug.
  const what = capability(key);
  throw new HttpError(403, what
    ? '“' + what.label + '” is not something your institution allows your role to do.'
    : 'Your institution does not allow your role to do that.');
}
