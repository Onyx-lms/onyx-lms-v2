/**
 * S13 -- live classes (LC-01 / LC-03 / LC-04 / LC-05 / LC-06).
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  validate, ok, requireAuth, requireRole, forbidden, HttpError, joinWindow,
  LiveClassService, jitsiOptions, roomName, newRoomCode, externalApiUrl, JITSI_DOMAIN,
} from '@onyx/core';
import type { AppContext } from '../context.ts';

const asReq = (req: FastifyRequest) => ({
  headers: req.headers as Record<string, string | string[] | undefined>,
  cookies: (req as unknown as { cookies?: Record<string, string> }).cookies,
});

const idOf = (req: FastifyRequest) => Number((req.params as { id: string }).id);

const ClassBody = z.object({
  class_topic: z.string().min(1).max(255),
  provider: z.enum(['zoom', 'jitsi']),
  class_date_and_time: z.string().min(1),
  note: z.string().max(5000).nullish(),
  duration: z.number().int().min(5).max(1440).default(60),
});

export function registerLiveClassRoutes(app: FastifyInstance, ctx: AppContext): void {
  /** LC-01 -- the schedule, for anyone who may attend the course. */
  app.get('/api/courses/:courseId/live-classes', async (req) => {
    const c = requireAuth(asReq(req), ctx.jwtSecret);
    const courseId = Number((req.params as { courseId: string }).courseId);
    if (!(await ctx.liveClasses.canAttend(courseId, c.user_id, c.app_role))) {
      throw forbidden();
    }
    const classes = await ctx.liveClasses.forCourse(courseId);
    // additional_info holds start_url, which is a host credential.
    return ok(classes.map(({ additional_info, ...rest }) => rest));
  });

  /** LC-01 / LC-03 -- scheduling creates the provider meeting first. */
  app.post('/api/manage/courses/:courseId/live-classes', async (req) => {
    const c = requireRole(asReq(req), ctx.jwtSecret, 'admin', 'instructor');
    const courseId = Number((req.params as { courseId: string }).courseId);
    if (!(await ctx.liveClasses.isHost(courseId, c.user_id, c.app_role))) {
      throw forbidden();
    }
    const body = validate(ClassBody, req.body);

    // If Zoom refuses, nothing is written -- Laravel created the row anyway on
    // some paths, leaving a class with no meeting behind it.
    const meeting = body.provider === 'zoom'
      ? await ctx.zoom.createMeeting(body.class_topic, body.class_date_and_time, body.duration)
      : { room_code: newRoomCode() };

    const created = await ctx.liveClasses.create({
      course_id: courseId,
      user_id: c.user_id,
      class_topic: body.class_topic,
      provider: body.provider,
      class_date_and_time: body.class_date_and_time,
      note: body.note ?? null,
    }, meeting);
    const { additional_info, ...safe } = created;
    return ok(safe, 'Live class added successfully');
  });

  app.patch('/api/manage/live-classes/:id', async (req) => {
    const c = requireRole(asReq(req), ctx.jwtSecret, 'admin', 'instructor');
    const existing = await ctx.liveClasses.find(idOf(req));
    if (!(await ctx.liveClasses.isHost(existing.course_id ?? 0, c.user_id, c.app_role))) {
      throw forbidden();
    }
    const body = validate(ClassBody.partial(), req.body);

    if (existing.provider === 'zoom') {
      const meeting = LiveClassService.meeting<{ id: string | number }>(existing);
      if (meeting?.id) {
        await ctx.zoom.updateMeeting(meeting.id,
          body.class_topic ?? existing.class_topic ?? '',
          body.class_date_and_time ?? existing.class_date_and_time ?? '');
      }
    }
    const updated = await ctx.liveClasses.update(idOf(req), body);
    const { additional_info, ...safe } = updated;
    return ok(safe, 'Live class updated successfully');
  });

  app.delete('/api/manage/live-classes/:id', async (req) => {
    const c = requireRole(asReq(req), ctx.jwtSecret, 'admin', 'instructor');
    const existing = await ctx.liveClasses.find(idOf(req));
    if (!(await ctx.liveClasses.isHost(existing.course_id ?? 0, c.user_id, c.app_role))) {
      throw forbidden();
    }
    if (existing.provider === 'zoom') {
      const meeting = LiveClassService.meeting<{ id: string | number }>(existing);
      // A Zoom failure must not strand the row: the class is being cancelled
      // either way, and an orphaned Zoom meeting is the lesser problem.
      if (meeting?.id) {
        try { await ctx.zoom.deleteMeeting(meeting.id); } catch { /* logged upstream */ }
      }
    }
    await ctx.liveClasses.remove(idOf(req));
    return ok({}, 'Live class deleted successfully');
  });

  /**
   * LC-04 / LC-05 / LC-06 -- everything the browser needs to join, and nothing
   * more. The role is decided here from the database, never from the request.
   */
  app.get('/api/live-classes/:id/join', async (req) => {
    const c = requireAuth(asReq(req), ctx.jwtSecret);
    const row = await ctx.liveClasses.find(idOf(req));
    const courseId = row.course_id ?? 0;

    if (!(await ctx.liveClasses.canAttend(courseId, c.user_id, c.app_role))) {
      throw forbidden();
    }
    const isHost = await ctx.liveClasses.isHost(courseId, c.user_id, c.app_role);

    const window = joinWindow(row.class_date_and_time);
    // A host may open the room early to set up; a student may not.
    if (!window.open && !isHost) {
      throw new HttpError(403, 'This class is not open yet. It starts at '
        + new Date(row.class_date_and_time ?? '').toUTCString() + '.');
    }

    const { data: user } = await ctx.db.from('users')
      .select('name, email').eq('id', c.user_id).maybeSingle();
    const displayName = String(user?.name ?? 'Participant');
    const email = String(user?.email ?? '');

    if (row.provider === 'jitsi') {
      const { data: course } = await ctx.db.from('courses')
        .select('slug').eq('id', courseId).maybeSingle();
      const meeting = LiveClassService.meeting<{ room_code?: string }>(row);
      const room = roomName(course?.slug as string | null, row.id, meeting?.room_code ?? '');
      return ok({
        provider: 'jitsi', mode: 'embed', is_host: isHost,
        domain: JITSI_DOMAIN, script_url: externalApiUrl(),
        options: jitsiOptions({ room, displayName, email, isHost }),
        class: { id: row.id, class_topic: row.class_topic, note: row.note },
      });
    }

    const meeting = LiveClassService.meeting<{
      id: string | number; password?: string; join_url?: string; start_url?: string;
    }>(row);
    if (!meeting?.id) throw new HttpError(422, 'This class has no meeting.');

    if (await ctx.zoom.webSdkEnabled()) {
      // Signed on the server: the SDK secret never reaches the browser.
      const { signature, sdkKey } = await ctx.zoom.signature(meeting.id, isHost ? 1 : 0);
      return ok({
        provider: 'zoom', mode: 'sdk', is_host: isHost,
        meeting_number: String(meeting.id),
        password: meeting.password ?? '',
        signature, sdk_key: sdkKey,
        user_name: displayName, email,
        class: { id: row.id, class_topic: row.class_topic, note: row.note },
      });
    }

    // start_url signs the host straight in, so only a host may receive it.
    const url = isHost ? meeting.start_url ?? meeting.join_url : meeting.join_url;
    if (!url) throw new HttpError(422, 'This class has no join link.');
    return ok({ provider: 'zoom', mode: 'redirect', is_host: isHost, url });
  });

  /** LC-06 -- the live class settings screen. */
  app.get('/api/admin/live-class-settings', async (req) => {
    requireRole(asReq(req), ctx.jwtSecret, 'admin');
    const keys = ['zoom_account_email', 'zoom_web_sdk', 'zoom_account_id',
      'zoom_client_id', 'zoom_sdk_client_id'] as const;
    const values = Object.fromEntries(await Promise.all(
      keys.map(async (k) => [k, await ctx.settings.get(k)] as const)));
    // The two secrets are reported as set-or-not; they are never sent back.
    return ok({
      ...values,
      zoom_client_secret_set: Boolean(await ctx.settings.get('zoom_client_secret')),
      zoom_sdk_client_secret_set: Boolean(await ctx.settings.get('zoom_sdk_client_secret')),
      configured: await ctx.zoom.configured(),
    });
  });

  app.post('/api/admin/live-class-settings', async (req) => {
    requireRole(asReq(req), ctx.jwtSecret, 'admin');
    const body = validate(z.object({
      zoom_account_email: z.string().email().optional(),
      zoom_web_sdk: z.enum(['active', 'inactive']).optional(),
      zoom_account_id: z.string().max(255).optional(),
      zoom_client_id: z.string().max(255).optional(),
      zoom_client_secret: z.string().max(255).optional(),
      zoom_sdk_client_id: z.string().max(255).optional(),
      zoom_sdk_client_secret: z.string().max(255).optional(),
    }), req.body);

    for (const [key, value] of Object.entries(body)) {
      if (value !== undefined) await ctx.settings.set(key, String(value));
    }
    // Credentials may have changed, so the cached OAuth token is now suspect.
    ctx.zoom.forgetToken();
    return ok({}, 'Live class settings updated');
  });
}
