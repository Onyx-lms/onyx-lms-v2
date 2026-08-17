/**
 * Onyx O06 -- LRN-05 and LRN-06.
 *
 * Progress and nudges, course discussion, and escalation to a mentor.
 *
 * The one thing worth noticing in this file: no route takes a `user_id` for
 * the progress summary. Whose progress is being asked about comes from the
 * token, never the path -- a dashboard endpoint that accepts an id is a roster
 * with extra steps, and the person who finds that out is not the one who wrote
 * it.
 */
import type { Router, ReqLike } from '../../router.ts';
import { z } from 'zod';
import { validate, ok, requireOnyx, requireOnyxRole, TICKET_PRIORITIES } from '@onyx/core';
import type { TicketPriority, TicketStatus, DiscussionStatus } from '@onyx/types';
import type { AppContext } from '../../app-context.ts';

const asReq = (req: ReqLike) => ({
  headers: req.headers as Record<string, string | string[] | undefined>,
  cookies: (req as unknown as { cookies?: Record<string, string> }).cookies,
});

const idOf = (req: ReqLike, key = 'id') =>
  Number((req.params as Record<string, string>)[key]);

/** Who runs the mentor queue. */
const MENTORS = ['admin', 'faculty'] as const;

const PrioritySchema = z.enum(
  TICKET_PRIORITIES as unknown as [TicketPriority, ...TicketPriority[]]);

export function registerOnyxEngageRoutes(app: Router, ctx: AppContext): void {
  const viewerOf = async (req: ReqLike) => {
    const claims = await requireOnyx(asReq(req), ctx.jwtSecret);
    return { claims, viewer: { role: claims.tenant_role, userId: claims.user_id } };
  };

  // -------------------------------------------------------------------------
  // LRN-05 -- progress, streaks, nudges
  // -------------------------------------------------------------------------

  /**
   * Your own progress. No id in the path, and none accepted in the body.
   *
   * Everything in the response is derived at read time, so calling this twice
   * after finishing a lesson returns two different answers -- which is the
   * acceptance criterion rather than an accident.
   */
  app.get('/api/onyx/progress', async (req) => {
    const { claims } = await viewerOf(req);
    return ok(await ctx.onyxEngage.summary(claims.tenant_id, claims.user_id));
  });

  app.get('/api/onyx/mentions', async (req) => {
    const { claims } = await viewerOf(req);
    return ok(await ctx.onyxEngage.mentions(claims.tenant_id, claims.user_id));
  });

  app.post('/api/onyx/mentions/read', async (req) => {
    const { claims } = await viewerOf(req);
    return ok(await ctx.onyxEngage.readMentions(claims.tenant_id, claims.user_id));
  });

  // -------------------------------------------------------------------------
  // LRN-06a -- discussion
  // -------------------------------------------------------------------------

  app.get('/api/onyx/courses/:id/discussions', async (req) => {
    const { claims, viewer } = await viewerOf(req);
    const query = req.query as { status?: string; q?: string };
    return ok(await ctx.onyxEngage.discussions(claims.tenant_id, idOf(req), viewer, {
      status: query.status as DiscussionStatus | undefined,
      q: query.q,
    }));
  });

  app.post('/api/onyx/courses/:id/discussions', async (req) => {
    const { claims, viewer } = await viewerOf(req);
    const body = validate(z.object({
      title: z.string().min(3).max(255),
      body: z.string().min(1),
      lesson_id: z.number().int().positive().nullish(),
      mentions: z.array(z.string().uuid()).max(20).optional(),
    }), req.body);
    return ok(await ctx.onyxEngage.ask(claims.tenant_id, idOf(req), viewer, body));
  });

  app.get('/api/onyx/discussions/:id', async (req) => {
    const { claims, viewer } = await viewerOf(req);
    return ok(await ctx.onyxEngage.discussion(claims.tenant_id, idOf(req), viewer));
  });

  app.post('/api/onyx/discussions/:id/replies', async (req) => {
    const { claims, viewer } = await viewerOf(req);
    const body = validate(z.object({
      body: z.string().min(1),
      parent_id: z.number().int().positive().nullish(),
      mentions: z.array(z.string().uuid()).max(20).optional(),
    }), req.body);
    return ok(await ctx.onyxEngage.reply(claims.tenant_id, idOf(req), viewer, body));
  });

  app.post('/api/onyx/posts/:id/vote', async (req) => {
    const { claims, viewer } = await viewerOf(req);
    return ok(await ctx.onyxEngage.vote(claims.tenant_id, idOf(req), viewer.userId, viewer.role));
  });

  app.post('/api/onyx/discussions/:id/resolve', async (req) => {
    const { claims, viewer } = await viewerOf(req);
    const body = validate(z.object({ post_id: z.number().int().positive() }), req.body);
    return ok(await ctx.onyxEngage.resolve(claims.tenant_id, idOf(req), body.post_id, viewer));
  });

  app.post('/api/onyx/discussions/:id/reopen', async (req) => {
    const { claims, viewer } = await viewerOf(req);
    return ok(await ctx.onyxEngage.reopen(claims.tenant_id, idOf(req), viewer));
  });

  // -------------------------------------------------------------------------
  // LRN-06b -- escalation and tickets
  // -------------------------------------------------------------------------

  app.post('/api/onyx/discussions/:id/escalate', async (req) => {
    const { claims } = await viewerOf(req);
    const body = validate(z.object({
      note: z.string().max(2000).optional(),
      priority: PrioritySchema.optional(),
    }), req.body ?? {});
    return ok(await ctx.onyxSupport.escalate(claims.tenant_id, idOf(req), claims.user_id, body));
  });

  app.post('/api/onyx/tickets', async (req) => {
    const { claims } = await viewerOf(req);
    const body = validate(z.object({
      subject: z.string().min(3).max(255),
      body: z.string().min(1),
      priority: PrioritySchema.optional(),
      course_id: z.number().int().positive().nullish(),
    }), req.body);
    return ok(await ctx.onyxSupport.raise(claims.tenant_id, claims.user_id, body));
  });

  /**
   * The queue. A learner asking gets only their own tickets -- the filter comes
   * from the token's role, not from a query parameter a learner could set.
   */
  app.get('/api/onyx/tickets', async (req) => {
    const { claims, viewer } = await viewerOf(req);
    const query = req.query as { status?: string; mine?: string; unowned?: string };
    return ok(await ctx.onyxSupport.queue(claims.tenant_id, viewer, {
      status: query.status as TicketStatus | undefined,
      mine: query.mine === '1' || query.mine === 'true',
      unowned: query.unowned === '1' || query.unowned === 'true',
    }));
  });

  app.get('/api/onyx/tickets/breaches', async (req) => {
    const { claims, viewer } = await viewerOf(req);
    return ok(await ctx.onyxSupport.breaches(claims.tenant_id, viewer));
  });

  app.get('/api/onyx/tickets/:id', async (req) => {
    const { claims, viewer } = await viewerOf(req);
    return ok(await ctx.onyxSupport.ticket(claims.tenant_id, idOf(req), viewer));
  });

  app.post('/api/onyx/tickets/:id/assign', async (req) => {
    const claims = await requireOnyxRole(asReq(req), ctx.jwtSecret, ...MENTORS);
    const viewer = { role: claims.tenant_role, userId: claims.user_id };
    const body = validate(z.object({
      owner_id: z.string().uuid().optional(),
    }), req.body ?? {});
    // No owner given means "I am taking this", which is what actually happens.
    const ticket = body.owner_id
      ? await ctx.onyxSupport.assign(claims.tenant_id, idOf(req), body.owner_id, viewer)
      : await ctx.onyxSupport.claim(claims.tenant_id, idOf(req), viewer);

    // LRN-06b: "an escalated question REACHES a named owner and its age is
    // visible". The owner was named in the database and never told, so the
    // acceptance criterion held only for whoever happened to open the queue.
    // Claiming it yourself raises nothing -- you already know.
    if (body.owner_id && body.owner_id !== claims.user_id) {
      await ctx.onyxNotify.notify(claims.tenant_id, {
        userId: body.owner_id,
        kind: 'ticket.assigned',
        title: 'A question has been assigned to you',
        body: ticket?.subject ?? 'A support ticket',
        link: '/onyx/support/' + idOf(req),
      });
    }
    return ok(ticket);
  });

  app.post('/api/onyx/tickets/:id/respond', async (req) => {
    const { claims, viewer } = await viewerOf(req);
    const body = validate(z.object({ note: z.string().min(1).max(5000) }), req.body);
    return ok(await ctx.onyxSupport.respond(claims.tenant_id, idOf(req), viewer, body.note));
  });

  app.post('/api/onyx/tickets/:id/resolve', async (req) => {
    const { claims, viewer } = await viewerOf(req);
    const body = validate(z.object({ note: z.string().max(5000).optional() }), req.body ?? {});
    return ok(await ctx.onyxSupport.resolve(claims.tenant_id, idOf(req), viewer, body.note));
  });

  app.post('/api/onyx/tickets/:id/reopen', async (req) => {
    const { claims, viewer } = await viewerOf(req);
    const body = validate(z.object({ note: z.string().max(5000).optional() }), req.body ?? {});
    return ok(await ctx.onyxSupport.reopen(claims.tenant_id, idOf(req), viewer, body.note));
  });
}
