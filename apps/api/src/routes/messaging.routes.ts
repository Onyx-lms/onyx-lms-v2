/**
 * S12 -- direct messages (M-01 / M-02 / M-04 / M-05).
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { validate, ok, requireAuth, requireRole, issueRealtimeToken } from '@onyx/core';
import type { AppContext } from '../context.ts';

const asReq = (req: FastifyRequest) => ({
  headers: req.headers as Record<string, string | string[] | undefined>,
  cookies: (req as unknown as { cookies?: Record<string, string> }).cookies,
});

const idOf = (req: FastifyRequest) => Number((req.params as { id: string }).id);

const SendBody = z.object({
  thread_id: z.number().int().positive(),
  message: z.string().min(1).max(20000),
});

export function registerMessagingRoutes(app: FastifyInstance, ctx: AppContext): void {
  /** M-03 -- the inbox, with unread counts and the latest line per thread. */
  app.get('/api/messages/threads', async (req) => {
    const c = requireAuth(asReq(req), ctx.jwtSecret);
    const search = (req.query as { search?: string }).search;
    return ok(await ctx.messaging.inbox(c.user_id, search));
  });

  app.get('/api/messages/unread', async (req) => {
    const c = requireAuth(asReq(req), ctx.jwtSecret);
    return ok({ count: await ctx.messaging.unreadTotal(c.user_id) });
  });

  /** M-04 -- who can I message? */
  app.get('/api/messages/contacts', async (req) => {
    const c = requireAuth(asReq(req), ctx.jwtSecret);
    const term = (req.query as { search?: string }).search ?? '';
    return ok(await ctx.messaging.searchContacts(c.user_id, term));
  });

  /** M-01 / M-05 -- open (or reuse) the conversation with someone. */
  app.post('/api/messages/threads', async (req) => {
    const c = requireAuth(asReq(req), ctx.jwtSecret);
    const body = validate(z.object({ user_id: z.number().int().positive() }), req.body);
    return ok(await ctx.messaging.openWith(c.user_id, body.user_id));
  });

  /** M-03 -- one conversation. Opening it marks the other side's messages read. */
  app.get('/api/messages/threads/:code', async (req) => {
    const c = requireAuth(asReq(req), ctx.jwtSecret);
    const code = (req.params as { code: string }).code;
    return ok(await ctx.messaging.conversation(code, c.user_id));
  });

  app.post('/api/messages', async (req) => {
    const c = requireAuth(asReq(req), ctx.jwtSecret);
    const body = validate(SendBody, req.body);
    // The sender is always the authenticated account -- never taken from the
    // request, unlike Admin\MessageController::store(). See ADR-004.
    return ok(await ctx.messaging.send(body.thread_id, c.user_id, body.message));
  });

  app.post('/api/messages/threads/:id/read', async (req) => {
    const c = requireAuth(asReq(req), ctx.jwtSecret);
    await ctx.messaging.markRead(idOf(req), c.user_id);
    return ok({});
  });

  app.delete('/api/messages/:id', async (req) => {
    const c = requireAuth(asReq(req), ctx.jwtSecret);
    await ctx.messaging.remove(idOf(req), c.user_id, c.app_role === 'admin');
    return ok({}, 'Message removed.');
  });

  /**
   * M-02 -- a token for the Supabase Realtime socket.
   *
   * Short-lived and scope-limited: the API refuses any token carrying a scope,
   * so this cannot be replayed against these routes even though it has to live
   * in browser JavaScript. RLS on `messages` then limits it to the holder's own
   * conversations (migration 0007).
   */
  app.post('/api/messages/realtime-token', async (req) => {
    const c = requireAuth(asReq(req), ctx.jwtSecret);
    const { token, expiresAt } = issueRealtimeToken({
      userId: c.user_id, email: c.email, appRole: c.app_role, secret: ctx.jwtSecret,
    });
    // The URL and anon key come back with it so the browser needs no Supabase
    // config of its own. The anon key is public by design -- on its own it
    // reads nothing, because every table denies by default.
    return ok({
      token,
      expires_at: expiresAt,
      user_id: c.user_id,
      supabase_url: process.env.SUPABASE_URL ?? '',
      supabase_anon_key: process.env.SUPABASE_ANON_KEY ?? '',
    });
  });

  // ---- M-06: the contact inbox ----

  app.get('/api/admin/contacts', async (req) => {
    requireRole(asReq(req), ctx.jwtSecret, 'admin');
    const q = req.query as { search?: string };
    return ok(await ctx.contact.list(q.search));
  });

  app.post('/api/admin/contacts/:id/reply', async (req) => {
    requireRole(asReq(req), ctx.jwtSecret, 'admin');
    const body = validate(z.object({
      subject: z.string().max(255).optional(),
      message: z.string().min(1).max(20000),
    }), req.body);
    return ok(await ctx.contact.reply(idOf(req), body.message, body.subject),
      'Email sent successfully');
  });

  app.delete('/api/admin/contacts/:id', async (req) => {
    requireRole(asReq(req), ctx.jwtSecret, 'admin');
    await ctx.contact.remove(idOf(req));
    return ok({}, 'Contact delete successfully');
  });
}
