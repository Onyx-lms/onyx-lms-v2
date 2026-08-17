/**
 * S06 -- wishlist, cart, coupons and enrolment.
 */
import type { Router, ReqLike } from '../router.ts';
import { z } from 'zod';
import { validate, ok, requireAuth, requireRole, parsePageQuery } from '@onyx/core';
import type { AppContext } from '../app-context.ts';

const asReq = (req: ReqLike) => ({
  headers: req.headers as Record<string, string | string[] | undefined>,
  cookies: (req as unknown as { cookies?: Record<string, string> }).cookies,
});

const CourseIdBody = z.object({ course_id: z.number().int().positive() });

export function registerEnrollmentRoutes(app: Router, ctx: AppContext): void {
  // ---- E-01: wishlist ----
  app.get('/api/wishlist', async (req) => {
    const c = requireAuth(asReq(req), ctx.jwtSecret);
    return ok(await ctx.wishlist.list(c.user_id));
  });

  app.post('/api/wishlist/toggle', async (req) => {
    const c = requireAuth(asReq(req), ctx.jwtSecret);
    const body = validate(CourseIdBody, req.body);
    const added = await ctx.wishlist.toggle(c.user_id, body.course_id);
    return ok({ wishlisted: added },
      added ? 'Added to your wishlist.' : 'Removed from your wishlist.');
  });

  // ---- E-02: cart ----
  app.get('/api/cart', async (req) => {
    const c = requireAuth(asReq(req), ctx.jwtSecret);
    const coupon = (req.query as Record<string, string>).coupon;
    // An invalid coupon must not hide the cart; report it alongside the totals.
    try {
      return ok(await ctx.cart.summary(c.user_id, coupon));
    } catch (e) {
      const summary = await ctx.cart.summary(c.user_id);
      return ok({ ...summary, coupon_error: (e as Error).message });
    }
  });

  app.post('/api/cart', async (req) => {
    const c = requireAuth(asReq(req), ctx.jwtSecret);
    const body = validate(CourseIdBody, req.body);
    await ctx.cart.add(c.user_id, body.course_id);
    return ok(await ctx.cart.summary(c.user_id), 'Added to your cart.');
  });

  app.delete('/api/cart/:courseId', async (req) => {
    const c = requireAuth(asReq(req), ctx.jwtSecret);
    await ctx.cart.remove(c.user_id, Number((req.params as { courseId: string }).courseId));
    return ok(await ctx.cart.summary(c.user_id), 'Removed from your cart.');
  });

  // ---- E-05: free enrolment ----
  app.post('/api/enroll/free', async (req) => {
    const c = requireAuth(asReq(req), ctx.jwtSecret);
    const body = validate(CourseIdBody, req.body);
    const course = await ctx.enrollment.enrollFree(body.course_id, c.user_id);
    return ok({ course_id: course.id, slug: course.slug }, 'You are enrolled.');
  });

  app.get('/api/enroll/status/:courseId', async (req) => {
    const c = requireAuth(asReq(req), ctx.jwtSecret);
    const courseId = Number((req.params as { courseId: string }).courseId);
    return ok({ status: await ctx.enrollment.status(courseId, c.user_id) });
  });
}
