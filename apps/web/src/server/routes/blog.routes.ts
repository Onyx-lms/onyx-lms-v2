/**
 * S11 -- blog (R-04 / R-05 / R-06 / R-07).
 */
import type { Router, ReqLike } from '../router.ts';
import { z } from 'zod';
import { validate, ok, requireAuth, requireRole, parsePageQuery, type AppRole } from '@onyx/core';
import type { AppContext } from '../app-context.ts';

const asReq = (req: ReqLike) => ({
  headers: req.headers as Record<string, string | string[] | undefined>,
  cookies: (req as unknown as { cookies?: Record<string, string> }).cookies,
});

const AUTHORS: AppRole[] = ['admin', 'instructor'];

const BlogBody = z.object({
  title: z.string().min(1).max(255),
  description: z.string().max(200000).nullish(),
  keywords: z.string().max(5000).nullish(),
  category_id: z.number().int().positive().nullish(),
  thumbnail: z.string().max(255).nullish(),
  banner: z.string().max(255).nullish(),
  is_popular: z.number().int().min(0).max(1).default(0),
});

const CategoryBody = z.object({
  title: z.string().min(1).max(255),
  subtitle: z.string().max(255).nullish(),
});

const CommentBody = z.object({
  comment: z.string().min(1).max(5000),
  parent_id: z.number().int().min(0).default(0),
});

/** The reader's id when a valid token is present, undefined otherwise. */
function optionalUserId(req: ReqLike, ctx: AppContext): number | undefined {
  try {
    return requireAuth(asReq(req), ctx.jwtSecret).user_id;
  } catch {
    return undefined;
  }
}

export function registerBlogRoutes(app: Router, ctx: AppContext): void {
  // ---- public (R-05) ----

  app.get('/api/blogs', async (req) => {
    await ctx.blog.assertEnabled();
    const q = req.query as { category?: string; search?: string };
    const page = parsePageQuery(req.query as Record<string, string>);
    return ok(await ctx.blog.published(
      { categorySlug: q.category, search: q.search }, page, '/api/blogs'));
  });

  app.get('/api/blogs/categories', async () => {
    await ctx.blog.assertEnabled();
    const [categories, counts] = await Promise.all([
      ctx.blog.categories(), ctx.blog.postCountsByCategory(),
    ]);
    return ok(categories.map((c) => ({ ...c, post_count: counts.get(c.id) ?? 0 })));
  });

  app.get('/api/blogs/popular', async () => {
    await ctx.blog.assertEnabled();
    return ok(await ctx.blog.popular(3));
  });

  app.get('/api/blogs/:slug', async (req) => {
    await ctx.blog.assertEnabled();
    const slug = (req.params as { slug: string }).slug;
    const post = await ctx.blog.bySlug(slug) as unknown as { id: number };
    // A signed-in reader sees their own like state; anonymous readers get counts.
    const viewer = optionalUserId(req, ctx);
    const p = post as unknown as Record<string, string | null>;
    const [comments, likes, related, seo] = await Promise.all([
      ctx.blogEngagement.comments(post.id, viewer),
      ctx.blogEngagement.likeState(post.id, viewer),
      ctx.blog.popular(3),
      // R-05: seo_fields wins, then the post's own fields, then site defaults.
      ctx.seo.resolve({
        route: 'blog',
        entity: { kind: 'blog', id: post.id },
        fallback: {
          title: p['title'] ?? undefined,
          keywords: p['keywords'] ?? undefined,
          image: p['thumbnail'] ?? undefined,
        },
      }),
    ]);
    return ok({ post, comments, likes, related, seo });
  });

  // ---- engagement (R-06) ----

  app.post('/api/blogs/:id/comments', async (req) => {
    await ctx.blog.assertEnabled();
    const c = requireAuth(asReq(req), ctx.jwtSecret);
    const body = validate(CommentBody, req.body);
    const id = Number((req.params as { id: string }).id);
    return ok(await ctx.blogEngagement.comment(id, c.user_id, body.comment, body.parent_id),
      'Your comment has been posted.');
  });

  app.patch('/api/blog-comments/:id', async (req) => {
    const c = requireAuth(asReq(req), ctx.jwtSecret);
    const body = validate(z.object({ comment: z.string().min(1).max(5000) }), req.body);
    await ctx.blogEngagement.updateComment(
      Number((req.params as { id: string }).id), c.user_id, body.comment);
    return ok({}, 'Comment updated.');
  });

  app.delete('/api/blog-comments/:id', async (req) => {
    const c = requireAuth(asReq(req), ctx.jwtSecret);
    await ctx.blogEngagement.removeComment(
      Number((req.params as { id: string }).id), c.user_id, c.app_role === 'admin');
    return ok({}, 'Comment removed.');
  });

  app.post('/api/blogs/:id/like', async (req) => {
    await ctx.blog.assertEnabled();
    const c = requireAuth(asReq(req), ctx.jwtSecret);
    const id = Number((req.params as { id: string }).id);
    const liked = await ctx.blogEngagement.toggleLike(id, c.user_id);
    return ok({ ...(await ctx.blogEngagement.likeState(id, c.user_id)), liked });
  });

  // ---- authoring (R-04) ----

  app.get('/api/manage/blogs', async (req) => {
    const c = requireRole(asReq(req), ctx.jwtSecret, ...AUTHORS);
    if (c.app_role !== 'admin') await ctx.blog.assertInstructorsAllowed();
    const q = req.query as { search?: string; status?: string };
    return ok(await ctx.blog.listFor({
      userId: c.app_role === 'admin' ? undefined : c.user_id,
      status: q.status === undefined ? undefined : Number(q.status),
      search: q.search,
    }, parsePageQuery(req.query as Record<string, string>), '/api/manage/blogs'));
  });

  app.get('/api/manage/blogs/:id', async (req) => {
    const c = requireRole(asReq(req), ctx.jwtSecret, ...AUTHORS);
    return ok(await ctx.blog.find(Number((req.params as { id: string }).id),
      c.app_role === 'admin' ? undefined : c.user_id));
  });

  app.post('/api/manage/blogs', async (req) => {
    const c = requireRole(asReq(req), ctx.jwtSecret, ...AUTHORS);
    if (c.app_role !== 'admin') await ctx.blog.assertInstructorsAllowed();
    const body = validate(BlogBody, req.body);
    // Admin posts go live; instructor posts wait for approval.
    return ok(await ctx.blog.create(c.user_id, body, c.app_role === 'admin'),
      c.app_role === 'admin' ? 'Post published.' : 'Post submitted for approval.');
  });

  app.patch('/api/manage/blogs/:id', async (req) => {
    const c = requireRole(asReq(req), ctx.jwtSecret, ...AUTHORS);
    const body = validate(BlogBody, req.body);
    return ok(await ctx.blog.update(Number((req.params as { id: string }).id), body,
      c.app_role === 'admin' ? undefined : c.user_id), 'Post updated.');
  });

  app.delete('/api/manage/blogs/:id', async (req) => {
    const c = requireRole(asReq(req), ctx.jwtSecret, ...AUTHORS);
    await ctx.blog.remove(Number((req.params as { id: string }).id),
      c.app_role === 'admin' ? undefined : c.user_id);
    return ok({}, 'Post deleted.');
  });

  // ---- moderation + categories: admin only (R-07) ----

  app.get('/api/admin/blogs/pending', async (req) => {
    requireRole(asReq(req), ctx.jwtSecret, 'admin');
    return ok(await ctx.blog.pending(parsePageQuery(req.query as Record<string, string>), '/api/admin/blogs/pending'));
  });

  app.post('/api/admin/blogs/:id/status', async (req) => {
    requireRole(asReq(req), ctx.jwtSecret, 'admin');
    const body = validate(z.object({ status: z.union([z.literal(0), z.literal(1)]) }), req.body);
    return ok(await ctx.blog.setStatus(
      Number((req.params as { id: string }).id), body.status), 'Status updated.');
  });

  app.post('/api/admin/blog-categories', async (req) => {
    requireRole(asReq(req), ctx.jwtSecret, 'admin');
    const body = validate(CategoryBody, req.body);
    return ok(await ctx.blog.createCategory(body.title, body.subtitle ?? null), 'Category added.');
  });

  app.patch('/api/admin/blog-categories/:id', async (req) => {
    requireRole(asReq(req), ctx.jwtSecret, 'admin');
    const body = validate(CategoryBody, req.body);
    await ctx.blog.updateCategory(Number((req.params as { id: string }).id),
      body.title, body.subtitle ?? null);
    return ok({}, 'Category updated.');
  });

  app.delete('/api/admin/blog-categories/:id', async (req) => {
    requireRole(asReq(req), ctx.jwtSecret, 'admin');
    await ctx.blog.removeCategory(Number((req.params as { id: string }).id));
    return ok({}, 'Category deleted.');
  });
}
