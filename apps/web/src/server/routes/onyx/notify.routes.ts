/**
 * The inbox.
 *
 * Three routes and none of them takes a recipient. Notifications are raised by
 * services as a consequence of work being done, so what this product can tell
 * you is a closed list in code -- there is no endpoint that lets one account
 * put something in another account's inbox, which is the property that stops a
 * notification system becoming a spam vector the moment it ships.
 */
import type { Router, ReqLike } from '../../router.ts';
import { z } from 'zod';
import { validate, ok, requireOnyx } from '@onyx/core';
import type { AppContext } from '../../app-context.ts';

const asReq = (req: ReqLike) => ({
  headers: req.headers as Record<string, string | string[] | undefined>,
  cookies: (req as unknown as { cookies?: Record<string, string> }).cookies,
});

export function registerOnyxNotifyRoutes(app: Router, ctx: AppContext): void {
  /** Your own inbox. The tenant and the person both come from the token. */
  app.get('/api/onyx/notifications', async (req) => {
    const claims = await requireOnyx(asReq(req), ctx.jwtSecret);
    const q = req.query as { limit?: string };
    const [items, unread] = await Promise.all([
      ctx.onyxNotify.inbox(claims.tenant_id, claims.user_id,
        { limit: q.limit ? Number(q.limit) : undefined }),
      ctx.onyxNotify.unreadCount(claims.tenant_id, claims.user_id),
    ]);
    return ok({ items, unread });
  });

  /**
   * The number on the badge.
   *
   * Separate from the inbox because every signed-in page asks for it and none
   * of them wants fifty rows to render one digit.
   */
  app.get('/api/onyx/notifications/unread', async (req) => {
    const claims = await requireOnyx(asReq(req), ctx.jwtSecret);
    return ok({ unread: await ctx.onyxNotify.unreadCount(claims.tenant_id, claims.user_id) });
  });

  /** Mark one as read, or all of them. Yours only -- there is no user id here. */
  app.post('/api/onyx/notifications/read', async (req) => {
    const claims = await requireOnyx(asReq(req), ctx.jwtSecret);
    const body = validate(z.object({
      id: z.number().int().positive().optional(),
    }), req.body ?? {});
    return ok(await ctx.onyxNotify.markRead(claims.tenant_id, claims.user_id, body.id));
  });
}
