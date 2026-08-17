/**
 * S03 -- public catalog endpoints. All unauthenticated.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { validate, ok, parsePageQuery, perPageForLayout, MAX_COMPARE } from '@onyx/core';
import type { AppContext } from '../context.ts';

const ContactBody = z.object({
  name: z.string().min(1).max(255),
  email: z.string().email(),
  phone: z.string().max(255).optional(),
  address: z.string().optional(),
  message: z.string().min(1),
});

export function registerCatalogRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/categories', async () => ok(await ctx.categories.tree()));

  app.get('/api/categories/top', async (req) => {
    const limit = Number((req.query as Record<string, string>).limit ?? 8);
    return ok(await ctx.categories.top(Number.isFinite(limit) ? limit : 8));
  });

  app.get('/api/courses', async (req) => {
    const q = req.query as Record<string, string>;
    const layout = q.layout === 'list' ? 'list' : 'grid';
    const page = parsePageQuery(q, perPageForLayout(layout));

    const filters: Parameters<typeof ctx.courses.list>[0] = {};
    if (q.category) filters.categorySlug = q.category;
    if (q.search) filters.search = q.search;
    if (q.price === 'free' || q.price === 'paid' || q.price === 'discount') filters.price = q.price;
    if (q.level) filters.level = q.level;
    if (q.language) filters.language = q.language;

    return ok(await ctx.courses.list(filters, page, '/api/courses'));
  });

  app.get('/api/courses/facets', async () => ok(await ctx.courses.facets()));

  /**
   * E-07 -- side-by-side comparison. Registered before /api/courses/:slug so
   * "compare" is not read as a course slug.
   */
  app.get('/api/courses/compare', async (req) => {
    const q = req.query as { courses?: string | string[]; search?: string };
    const slugs = Array.isArray(q.courses)
      ? q.courses
      : String(q.courses ?? '').split(',').filter(Boolean);
    const [courses, suggestions] = await Promise.all([
      ctx.compare.bySlugs(slugs),
      ctx.compare.suggestions(slugs, q.search),
    ]);
    return ok({ courses, suggestions, max: MAX_COMPARE });
  });

  app.get('/api/courses/:slug', async (req) => {
    const { slug } = req.params as { slug: string };
    const course = await ctx.courses.detailBySlug(slug);
    const seo = await ctx.seo.resolve({
      route: 'course.details',
      entity: { kind: 'course', id: course.id },
      fallback: {
        title: course.title ?? '',
        description: course.short_description ?? '',
        keywords: course.meta_keywords ?? '',
        image: course.thumbnail ?? '',
      },
    });
    return ok({ course, seo });
  });

  app.get('/api/instructors', async (req) => {
    const q = req.query as Record<string, string>;
    return ok(await ctx.instructors.list(parsePageQuery(q, 12), '/api/instructors'));
  });

  app.get('/api/instructors/:id', async (req) => {
    const { id } = req.params as { id: string };
    return ok(await ctx.instructors.detail(Number(id)));
  });

  /** Metadata for any page. The web app calls this from generateMetadata. */
  app.get('/api/seo/:route', async (req) => {
    const { route } = req.params as { route: string };
    return ok(await ctx.seo.resolve({ route }));
  });

  app.post('/api/contact', async (req) => {
    await ctx.contact.submit(validate(ContactBody, req.body));
    return ok({}, 'Thanks for reaching out. We will be in touch.');
  });

  app.post('/api/newsletter/subscribe', async (req) => {
    const body = validate(z.object({ email: z.string().email() }), req.body);
    await ctx.newsletter.subscribe(body.email);
    // Identical response either way. Returning whether the row was new would
    // turn this endpoint into a membership oracle for any address.
    return ok({ subscribed: true }, 'You are subscribed.');
  });
}
