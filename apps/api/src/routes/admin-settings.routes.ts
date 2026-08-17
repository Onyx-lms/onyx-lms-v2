/**
 * S18 -- admin settings (SET-01 .. SET-09).
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  validate, ok, requireAuth, requireRole, HttpError,
  SETTING_GROUPS, type SettingGroup,
} from '@onyx/core';
import type { AppContext } from '../context.ts';

const asReq = (req: FastifyRequest) => ({
  headers: req.headers as Record<string, string | string[] | undefined>,
  cookies: (req as unknown as { cookies?: Record<string, string> }).cookies,
});

const idOf = (req: FastifyRequest) => Number((req.params as { id: string }).id);

function groupOf(req: FastifyRequest): SettingGroup {
  const name = (req.params as { group: string }).group;
  if (!(name in SETTING_GROUPS)) throw new HttpError(404, 'Not a settings screen.');
  return name as SettingGroup;
}

export function registerAdminSettingsRoutes(app: FastifyInstance, ctx: AppContext): void {
  // ---- SET-01 / SET-02 / SET-04 / SET-05 ----

  app.get('/api/admin/settings/:group', async (req) => {
    requireRole(asReq(req), ctx.jwtSecret, 'admin');
    return ok(await ctx.settingsAdmin.group(groupOf(req)));
  });

  app.post('/api/admin/settings/:group', async (req) => {
    requireRole(asReq(req), ctx.jwtSecret, 'admin');
    const body = validate(z.record(z.string(), z.unknown()), req.body ?? {});
    const result = await ctx.settingsAdmin.saveGroup(groupOf(req), body);
    // Cached settings would otherwise serve the old values for the process life.
    ctx.settings.invalidate();
    return ok(result, 'Settings updated.');
  });

  app.get('/api/admin/settings', async (req) => {
    requireRole(asReq(req), ctx.jwtSecret, 'admin');
    return ok(await ctx.settingsAdmin.all());
  });

  // ---- SET-03: payment gateways ----

  app.get('/api/admin/gateways', async (req) => {
    requireRole(asReq(req), ctx.jwtSecret, 'admin');
    return ok(await ctx.platformAdmin.gateways());
  });

  app.patch('/api/admin/gateways/:id', async (req) => {
    requireRole(asReq(req), ctx.jwtSecret, 'admin');
    const body = validate(z.object({
      status: z.union([z.literal(0), z.literal(1)]).optional(),
      test_mode: z.union([z.literal(0), z.literal(1)]).optional(),
      keys: z.record(z.string(), z.unknown()).optional(),
    }), req.body);
    return ok(await ctx.platformAdmin.saveGateway(idOf(req), body), 'Gateway updated.');
  });

  // ---- SET-06: languages ----

  app.get('/api/admin/languages', async (req) => {
    requireRole(asReq(req), ctx.jwtSecret, 'admin');
    return ok(await ctx.platformAdmin.languages());
  });

  app.post('/api/admin/languages', async (req) => {
    requireRole(asReq(req), ctx.jwtSecret, 'admin');
    const body = validate(z.object({
      name: z.string().min(1).max(255),
      direction: z.enum(['ltr', 'rtl']).default('ltr'),
    }), req.body);
    const made = await ctx.platformAdmin.addLanguage(body.name, body.direction);
    ctx.i18n.invalidate();
    return ok(made, 'Language added.');
  });

  app.post('/api/admin/languages/:id/direction', async (req) => {
    requireRole(asReq(req), ctx.jwtSecret, 'admin');
    const body = validate(z.object({ direction: z.enum(['ltr', 'rtl']) }), req.body);
    await ctx.platformAdmin.setDirection(idOf(req), body.direction);
    ctx.i18n.invalidate();
    return ok({}, 'Direction updated.');
  });

  app.delete('/api/admin/languages/:id', async (req) => {
    requireRole(asReq(req), ctx.jwtSecret, 'admin');
    await ctx.platformAdmin.removeLanguage(idOf(req), await ctx.settings.get('language'));
    ctx.i18n.invalidate();
    return ok({}, 'Language deleted.');
  });

  app.get('/api/admin/languages/:id/phrases', async (req) => {
    requireRole(asReq(req), ctx.jwtSecret, 'admin');
    const q = req.query as { search?: string; page?: string; per_page?: string };
    const perPage = Math.min(Number(q.per_page ?? 50), 200);
    const page = Math.max(1, Number(q.page ?? 1));
    const from = (page - 1) * perPage;
    const found = await ctx.platformAdmin.phrases(idOf(req), q.search, from, from + perPage - 1);
    return ok({ ...found, page, per_page: perPage });
  });

  app.post('/api/admin/languages/:id/phrases', async (req) => {
    requireRole(asReq(req), ctx.jwtSecret, 'admin');
    const body = validate(z.object({ phrases: z.record(z.string(), z.string()) }), req.body);
    const result = await ctx.platformAdmin.savePhrases(idOf(req), body.phrases);
    ctx.i18n.invalidate();
    return ok(result, 'Translations saved.');
  });

  app.get('/api/admin/languages/:id/export', async (req) => {
    requireRole(asReq(req), ctx.jwtSecret, 'admin');
    return ok(await ctx.platformAdmin.exportLanguage(idOf(req)));
  });

  app.post('/api/admin/languages/:id/import', async (req) => {
    requireRole(asReq(req), ctx.jwtSecret, 'admin');
    const body = validate(z.object({ phrases: z.record(z.string(), z.string()) }), req.body);
    const result = await ctx.platformAdmin.importLanguage(idOf(req), body.phrases);
    ctx.i18n.invalidate();
    return ok(result, 'Import complete.');
  });

  // ---- SET-07: newsletters ----

  app.get('/api/admin/newsletters', async (req) => {
    requireRole(asReq(req), ctx.jwtSecret, 'admin');
    return ok({
      campaigns: await ctx.campaigns.campaigns(),
      subscribers: await ctx.campaigns.subscribers(),
    });
  });

  app.post('/api/admin/newsletters', async (req) => {
    requireRole(asReq(req), ctx.jwtSecret, 'admin');
    const body = validate(z.object({
      subject: z.string().min(1).max(255),
      description: z.string().max(200000).default(''),
    }), req.body);
    return ok(await ctx.campaigns.createCampaign(body.subject, body.description),
      'Campaign saved.');
  });

  app.delete('/api/admin/newsletters/:id', async (req) => {
    requireRole(asReq(req), ctx.jwtSecret, 'admin');
    await ctx.campaigns.removeCampaign(idOf(req));
    return ok({}, 'Campaign deleted.');
  });

  app.delete('/api/admin/newsletter-subscribers/:id', async (req) => {
    requireRole(asReq(req), ctx.jwtSecret, 'admin');
    await ctx.campaigns.removeSubscriber(idOf(req));
    return ok({}, 'Subscriber removed.');
  });

  app.post('/api/admin/newsletters/:id/send', async (req) => {
    requireRole(asReq(req), ctx.jwtSecret, 'admin');
    const body = validate(z.object({
      include_users: z.boolean().default(false),
      batch_size: z.number().int().min(1).max(100).default(25),
    }).default({}), req.body ?? {});
    return ok(await ctx.campaigns.send(idOf(req), {
      includeUsers: body.include_users, batchSize: body.batch_size,
    }), 'Campaign sent.');
  });

  // ---- SET-08: page builder ----

  app.get('/api/admin/pages', async (req) => {
    requireRole(asReq(req), ctx.jwtSecret, 'admin');
    return ok(await ctx.campaigns.pages());
  });

  app.get('/api/admin/pages/:id', async (req) => {
    requireRole(asReq(req), ctx.jwtSecret, 'admin');
    return ok(await ctx.campaigns.page(idOf(req)));
  });

  app.post('/api/admin/pages', async (req) => {
    requireRole(asReq(req), ctx.jwtSecret, 'admin');
    const body = validate(z.object({
      id: z.number().int().positive().optional(),
      identifier: z.string().min(1).max(255),
      name: z.string().min(1).max(255),
      html: z.string().max(500000).optional(),
      status: z.union([z.literal(0), z.literal(1)]).optional(),
    }), req.body);
    return ok(await ctx.campaigns.savePage(body), 'Page saved.');
  });

  app.delete('/api/admin/pages/:id', async (req) => {
    requireRole(asReq(req), ctx.jwtSecret, 'admin');
    await ctx.campaigns.removePage(idOf(req));
    return ok({}, 'Page deleted.');
  });

  // ---- SET-09: become an instructor ----

  app.get('/api/me/instructor-application', async (req) => {
    const c = requireAuth(asReq(req), ctx.jwtSecret);
    return ok({
      open: await ctx.campaigns.applicationsOpen(),
      note: await ctx.settings.get('instructor_application_note'),
      application: await ctx.campaigns.myApplication(c.user_id),
    });
  });

  app.post('/api/me/instructor-application', async (req) => {
    const c = requireAuth(asReq(req), ctx.jwtSecret);
    const body = validate(z.object({
      phone: z.string().min(1).max(255),
      description: z.string().min(1).max(20000),
      document: z.string().min(1).max(255),
    }), req.body);
    return ok(await ctx.campaigns.apply(c.user_id, body),
      'Your application has been submitted.');
  });

  app.get('/api/admin/instructor-applications', async (req) => {
    requireRole(asReq(req), ctx.jwtSecret, 'admin');
    const q = req.query as { status?: string };
    return ok(await ctx.campaigns.applications(
      q.status === undefined ? undefined : Number(q.status)));
  });

  app.post('/api/admin/instructor-applications/:id/approve', async (req) => {
    requireRole(asReq(req), ctx.jwtSecret, 'admin');
    return ok(await ctx.campaigns.approve(idOf(req)), 'Application approve successfully');
  });

  app.delete('/api/admin/instructor-applications/:id', async (req) => {
    requireRole(asReq(req), ctx.jwtSecret, 'admin');
    await ctx.campaigns.removeApplication(idOf(req));
    return ok({}, 'Application delete successfully');
  });

  /** The uploaded document is private, so it is served as a signed URL. */
  app.get('/api/admin/instructor-applications/:id/document', async (req) => {
    requireRole(asReq(req), ctx.jwtSecret, 'admin');
    const rows = await ctx.campaigns.applications();
    const row = rows.find((a) => a.id === idOf(req));
    if (!row?.document) throw new HttpError(404, 'File does not exists');
    const url = await ctx.storage.signedUrl(String(row.document), 300);
    if (!url) throw new HttpError(404, 'File does not exists');
    return ok({ url });
  });
}
