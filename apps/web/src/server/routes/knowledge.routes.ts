/**
 * S11 -- knowledge base (R-08) and admin testimonials (R-03).
 */
import type { Router, ReqLike } from '../router.ts';
import { z } from 'zod';
import { validate, ok, requireRole } from '@onyx/core';
import type { AppContext } from '../app-context.ts';

const asReq = (req: ReqLike) => ({
  headers: req.headers as Record<string, string | string[] | undefined>,
  cookies: (req as unknown as { cookies?: Record<string, string> }).cookies,
});

const idOf = (req: ReqLike) => Number((req.params as { id: string }).id);

const TopicBody = z.object({ title: z.string().min(1).max(255) });
const ArticleBody = z.object({
  knowledge_base_id: z.number().int().positive(),
  topic_name: z.string().min(1).max(255),
  description: z.string().max(200000).default(''),
});
const TestimonialBody = z.object({
  user_id: z.number().int().positive(),
  rating: z.number().int().min(1).max(5),
  review: z.string().min(1).max(5000),
});

export function registerKnowledgeRoutes(app: Router, ctx: AppContext): void {
  // ---- public knowledge base ----

  app.get('/api/knowledge-base', async () => ok(await ctx.knowledgeBase.topics()));

  app.get('/api/knowledge-base/search', async (req) => {
    const q = (req.query as { q?: string }).q ?? '';
    return ok(await ctx.knowledgeBase.search(q));
  });

  app.get('/api/knowledge-base/topics/:id', async (req) =>
    ok(await ctx.knowledgeBase.topic(idOf(req))));

  app.get('/api/knowledge-base/articles/:id', async (req) =>
    ok(await ctx.knowledgeBase.article(idOf(req))));

  // ---- admin knowledge base ----

  app.post('/api/admin/knowledge-base/topics', async (req) => {
    requireRole(asReq(req), ctx.jwtSecret, 'admin');
    const body = validate(TopicBody, req.body);
    return ok(await ctx.knowledgeBase.createTopic(body.title), 'Topic created.');
  });

  app.patch('/api/admin/knowledge-base/topics/:id', async (req) => {
    requireRole(asReq(req), ctx.jwtSecret, 'admin');
    const body = validate(TopicBody, req.body);
    await ctx.knowledgeBase.updateTopic(idOf(req), body.title);
    return ok({}, 'Topic updated.');
  });

  app.delete('/api/admin/knowledge-base/topics/:id', async (req) => {
    requireRole(asReq(req), ctx.jwtSecret, 'admin');
    await ctx.knowledgeBase.removeTopic(idOf(req));
    return ok({}, 'Topic deleted.');
  });

  app.post('/api/admin/knowledge-base/articles', async (req) => {
    requireRole(asReq(req), ctx.jwtSecret, 'admin');
    const body = validate(ArticleBody, req.body);
    return ok(await ctx.knowledgeBase.createArticle(
      body.knowledge_base_id, body.topic_name, body.description), 'Article created.');
  });

  app.patch('/api/admin/knowledge-base/articles/:id', async (req) => {
    requireRole(asReq(req), ctx.jwtSecret, 'admin');
    const body = validate(ArticleBody.omit({ knowledge_base_id: true }), req.body);
    await ctx.knowledgeBase.updateArticle(idOf(req), body.topic_name, body.description);
    return ok({}, 'Article updated.');
  });

  app.delete('/api/admin/knowledge-base/articles/:id', async (req) => {
    requireRole(asReq(req), ctx.jwtSecret, 'admin');
    await ctx.knowledgeBase.removeArticle(idOf(req));
    return ok({}, 'Article deleted.');
  });

  // ---- testimonials (R-03) ----

  app.get('/api/testimonials', async () => ok(await ctx.testimonials.published(6)));

  app.get('/api/admin/testimonials', async (req) => {
    requireRole(asReq(req), ctx.jwtSecret, 'admin');
    return ok(await ctx.testimonials.all());
  });

  app.post('/api/admin/testimonials', async (req) => {
    requireRole(asReq(req), ctx.jwtSecret, 'admin');
    const body = validate(TestimonialBody, req.body);
    return ok(await ctx.testimonials.create(body), 'Review added successfull');
  });

  app.patch('/api/admin/testimonials/:id', async (req) => {
    requireRole(asReq(req), ctx.jwtSecret, 'admin');
    const body = validate(TestimonialBody.partial(), req.body);
    return ok(await ctx.testimonials.update(idOf(req), body), 'Review Update successfully');
  });

  app.delete('/api/admin/testimonials/:id', async (req) => {
    requireRole(asReq(req), ctx.jwtSecret, 'admin');
    await ctx.testimonials.remove(idOf(req));
    return ok({}, 'Review delete successfully');
  });
}
