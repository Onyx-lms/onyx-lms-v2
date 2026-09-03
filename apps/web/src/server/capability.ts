import {
  HttpError, can, capability,
  type CapabilityKey, type PermissionOverrides, type PersonalPermissions,
  type PlatformDenials,
} from '@onyx/core';
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
/**
 * The same question, answered rather than thrown.
 *
 * `assertCan` is right where a route is refusing an action. It is the wrong
 * shape where the answer decides what somebody is SHOWN -- a support queue
 * that throws at an administrator and returns a learner's own tickets to
 * everyone else needs the boolean, not the exception.
 *
 * Deliberately the same three-step resolution as `assertCan`, by calling into
 * it, so the two can never disagree about who holds what.
 */
export async function holds(
  ctx: AppContext, tenantId: number, role: Role, key: CapabilityKey, userId?: string,
): Promise<boolean> {
  try {
    await assertCan(ctx, tenantId, role, key, userId);
    return true;
  } catch {
    return false;
  }
}

export async function assertCan(
  ctx: AppContext, tenantId: number, role: Role, key: CapabilityKey,
  /**
   * Who is asking, so a decision made about THIS PERSON is honoured.
   *
   * Optional only so that the two internal helpers which have a role but no
   * caller to hand still compile; every route passes it. Without it a personal
   * grant would exist in the settings screen and nowhere else, which is worse
   * than not having the feature.
   */
  userId?: string,
): Promise<void> {
  const tenant = await ctx.onyxTenancy.tenant(tenantId);
  const overrides = (tenant?.permissions ?? {}) as PermissionOverrides;
  // What the platform has withheld from this institution. Checked inside
  // `can` before anything else, so no grant underneath can reach past it.
  const denied = (tenant?.platform_denied ?? []) as PlatformDenials;

  // One extra read, and only for a guarded route. The membership is where a
  // person's own grants live (0036) -- see permissions.ts's `can` for the
  // order: the person beats the role, the role beats the default, and no
  // personal grant reaches past what the capability itself allows.
  const personal = userId
    ? ((await ctx.onyxTenancy.membership(tenantId, userId))?.permissions ?? {})
    : {};

  if (can(role, key, overrides, personal as PersonalPermissions, denied)) return;

  // Named, not "Forbidden": an administrator who has just switched something
  // off should be able to tell from the message what to switch back on, and a
  // lecturer who has lost an action should learn it was a decision rather than
  // a bug.
  const what = capability(key);
  if (denied.includes(key)) {
    // Not "your institution does not allow this": nobody inside the
    // institution can switch it back on, and saying so sends an administrator
    // hunting through a matrix where the toggle does not exist.
    throw new HttpError(403, what
      ? '“' + what.label + '” is not enabled for this institution. '
        + 'Contact the platform team to have it turned on.'
      : 'That is not enabled for this institution.');
  }
  throw new HttpError(403, what
    ? '“' + what.label + '” is not something your institution allows you to do.'
    : 'Your institution does not allow you to do that.');
}
