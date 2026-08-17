/**
 * S04 -- course authoring. Instructors act on their own courses; admins on any.
 */
import type { Router, ReqLike } from '../router.ts';
import { z } from 'zod';
import { validate, ok, requireRole, parsePageQuery, type AppRole } from '@onyx/core';
import type { AppContext } from '../app-context.ts';

const asReq = (req: ReqLike) => ({
  headers: req.headers as Record<string, string | string[] | undefined>,
  cookies: (req as unknown as { cookies?: Record<string, string> }).cookies,
});

const DripSettings = z.object({
  lesson_completion_role: z.enum(['duration', 'percentage']),
  minimum_duration: z.number().optional(),
  minimum_percentage: z.number().optional(),
});

const CourseBody = z.object({
  title: z.string().min(1).max(255),
  short_description: z.string().nullish(),
  description: z.string().nullish(),
  category_id: z.number().int().nullish(),
  level: z.string().max(255).nullish(),
  language: z.string().max(255).nullish(),
  course_type: z.string().max(255).nullish(),
  is_paid: z.number().int().min(0).max(1).optional(),
  price: z.number().nullish(),
  discount_flag: z.number().int().min(0).max(1).optional(),
  discounted_price: z.number().nullish(),
  thumbnail: z.string().nullish(),
  banner: z.string().nullish(),
  preview: z.string().nullish(),
  meta_keywords: z.string().nullish(),
  meta_description: z.string().nullish(),
  requirements: z.array(z.string()).optional(),
  outcomes: z.array(z.string()).optional(),
  faqs: z.array(z.unknown()).optional(),
  expiry_period: z.number().int().nullish(),
  enable_drip_content: z.number().int().min(0).max(1).optional(),
  drip_content_settings: DripSettings.nullish(),
});

const LessonBody = z.object({
  title: z.string().min(1).max(255),
  lesson_type: z.string().min(1),
  section_id: z.number().int().positive(),
  lesson_src: z.string().nullish(),
  video_type: z.string().nullish(),
  duration: z.string().nullish(),
  summary: z.string().nullish(),
  description: z.string().nullish(),
  attachment: z.string().nullish(),
  attachment_type: z.string().nullish(),
  thumbnail: z.string().nullish(),
  is_free: z.number().int().min(0).max(1).optional(),
  total_mark: z.number().int().nullish(),
  pass_mark: z.number().int().nullish(),
  retake: z.number().int().nullish(),
});

const SortBody = z.object({ ids: z.array(z.number().int().positive()).min(1) });
const AUTHORS: AppRole[] = ['instructor', 'admin'];

export function registerAuthoringRoutes(app: Router, ctx: AppContext): void {
  /** Admins may act on any course; instructors are scoped to their own. */
  const scope = (role: AppRole, userId: number) => (role === 'admin' ? undefined : userId);

  app.get('/api/authoring/courses', async (req) => {
    const c = requireRole(asReq(req), ctx.jwtSecret, ...AUTHORS);
    const q = req.query as Record<string, string>;
    const opts: { userId?: number; status?: never; search?: string } = {};
    const owner = scope(c.app_role, c.user_id);
    if (owner != null) opts.userId = owner;
    if (q.search) opts.search = q.search;
    return ok(await ctx.builder.listFor(
      { ...opts, ...(q.status ? { status: q.status as never } : {}) },
      parsePageQuery(q), '/api/authoring/courses'));
  });

  app.get('/api/authoring/courses/:id', async (req) => {
    const c = requireRole(asReq(req), ctx.jwtSecret, ...AUTHORS);
    const id = Number((req.params as { id: string }).id);
    const [course, sections, lessons, duration] = await Promise.all([
      ctx.builder.find(id, scope(c.app_role, c.user_id)),
      ctx.sections.listForCourse(id),
      ctx.lessons.listForCourse(id),
      ctx.lessons.totalDuration(id),
    ]);
    const curriculum = sections.map((s) => ({
      ...s, lessons: lessons.filter((l) => l.section_id === s.id),
    }));
    return ok({ course, curriculum, total_duration: duration, total_lesson: lessons.length });
  });

  app.post('/api/authoring/courses', async (req) => {
    const c = requireRole(asReq(req), ctx.jwtSecret, ...AUTHORS);
    const body = validate(CourseBody, req.body);
    // Instructors can only publish directly when the setting allows it.
    const canPublish = c.app_role === 'admin'
      || (await ctx.settings.getBool('instructor_can_publish_course'));
    return ok(await ctx.builder.create(c.user_id, body, canPublish), 'Course created.');
  });

  app.patch('/api/authoring/courses/:id', async (req) => {
    const c = requireRole(asReq(req), ctx.jwtSecret, ...AUTHORS);
    const id = Number((req.params as { id: string }).id);
    return ok(await ctx.builder.update(id, validate(CourseBody, req.body),
      scope(c.app_role, c.user_id)), 'Course updated.');
  });

  app.post('/api/authoring/courses/:id/status', async (req) => {
    const c = requireRole(asReq(req), ctx.jwtSecret, ...AUTHORS);
    const id = Number((req.params as { id: string }).id);
    const body = validate(z.object({
      status: z.enum(['active', 'draft', 'pending', 'inactive']) }), req.body);
    // Only admins flip a course to active; instructors go through approval.
    if (body.status === 'active' && c.app_role !== 'admin'
        && !(await ctx.settings.getBool('instructor_can_publish_course'))) {
      await ctx.builder.requestApproval(id, c.user_id, 'Requesting publication.');
      return ok({ status: 'pending' }, 'Sent for admin approval.');
    }
    return ok(await ctx.builder.setStatus(id, body.status, scope(c.app_role, c.user_id)),
      'Status updated.');
  });

  app.post('/api/authoring/courses/:id/duplicate', async (req) => {
    const c = requireRole(asReq(req), ctx.jwtSecret, ...AUTHORS);
    const id = Number((req.params as { id: string }).id);
    return ok(await ctx.builder.duplicate(id, c.user_id, c.app_role === 'admin'),
      'Course duplicated.');
  });

  app.delete('/api/authoring/courses/:id', async (req) => {
    const c = requireRole(asReq(req), ctx.jwtSecret, ...AUTHORS);
    const id = Number((req.params as { id: string }).id);
    await ctx.builder.remove(id, scope(c.app_role, c.user_id));
    return ok({}, 'Course deleted.');
  });

  // ---- sections ----
  app.post('/api/authoring/courses/:id/sections', async (req) => {
    const c = requireRole(asReq(req), ctx.jwtSecret, ...AUTHORS);
    const id = Number((req.params as { id: string }).id);
    await ctx.builder.find(id, scope(c.app_role, c.user_id)); // ownership gate
    const body = validate(z.object({ title: z.string().min(1).max(255) }), req.body);
    return ok(await ctx.sections.create(id, c.user_id, body.title), 'Section added.');
  });

  app.patch('/api/authoring/sections/:sectionId', async (req) => {
    requireRole(asReq(req), ctx.jwtSecret, ...AUTHORS);
    const body = validate(z.object({ title: z.string().min(1).max(255) }), req.body);
    await ctx.sections.update(Number((req.params as { sectionId: string }).sectionId), body.title);
    return ok({}, 'Section updated.');
  });

  app.delete('/api/authoring/sections/:sectionId', async (req) => {
    requireRole(asReq(req), ctx.jwtSecret, ...AUTHORS);
    await ctx.sections.remove(Number((req.params as { sectionId: string }).sectionId));
    return ok({}, 'Section deleted.');
  });

  app.post('/api/authoring/sections/sort', async (req) => {
    requireRole(asReq(req), ctx.jwtSecret, ...AUTHORS);
    const body = validate(SortBody, req.body);
    await ctx.sections.sort(body.ids);
    return ok({}, 'Sections sorted successfully');
  });

  // ---- lessons ----
  app.post('/api/authoring/courses/:id/lessons', async (req) => {
    const c = requireRole(asReq(req), ctx.jwtSecret, ...AUTHORS);
    const id = Number((req.params as { id: string }).id);
    await ctx.builder.find(id, scope(c.app_role, c.user_id));
    const body = validate(LessonBody, req.body);
    return ok(await ctx.lessons.create(id, c.user_id, body), 'Lesson added.');
  });

  app.patch('/api/authoring/lessons/:lessonId', async (req) => {
    requireRole(asReq(req), ctx.jwtSecret, ...AUTHORS);
    const body = validate(LessonBody, req.body);
    await ctx.lessons.update(Number((req.params as { lessonId: string }).lessonId), body);
    return ok({}, 'Lesson updated.');
  });

  app.delete('/api/authoring/lessons/:lessonId', async (req) => {
    requireRole(asReq(req), ctx.jwtSecret, ...AUTHORS);
    await ctx.lessons.remove(Number((req.params as { lessonId: string }).lessonId));
    return ok({}, 'Lesson deleted.');
  });

  app.post('/api/authoring/lessons/sort', async (req) => {
    requireRole(asReq(req), ctx.jwtSecret, ...AUTHORS);
    const body = validate(SortBody, req.body);
    await ctx.lessons.sort(body.ids);
    return ok({}, 'Lessons sorted successfully');
  });

  // ---- B-08: approval queue (admin only) ----
  app.get('/api/admin/course-approvals', async (req) => {
    requireRole(asReq(req), ctx.jwtSecret, 'admin');
    return ok(await ctx.builder.pendingApprovals(
      parsePageQuery(req.query as Record<string, string>), '/api/admin/course-approvals'));
  });

  app.post('/api/admin/course-approvals/:id', async (req) => {
    requireRole(asReq(req), ctx.jwtSecret, 'admin');
    const body = validate(z.object({ approve: z.boolean() }), req.body);
    const courseId = Number((req.params as { id: string }).id);
    await ctx.builder.resolveApproval(courseId, body.approve);
    return ok({}, body.approve ? 'Course approved.' : 'Course rejected.');
  });
}
