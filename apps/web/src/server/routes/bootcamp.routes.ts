/**
 * S14 -- bootcamps / workshops (BC-01 .. BC-07).
 */
import type { Router, ReqLike } from '../router.ts';
import { z } from 'zod';
import {
  validate, ok, requireAuth, requireRole, forbidden, HttpError,
  parsePageQuery, bootcampPrice, classStarted, type AppRole,
} from '@onyx/core';
import type { AppContext } from '../app-context.ts';

const asReq = (req: ReqLike) => ({
  headers: req.headers as Record<string, string | string[] | undefined>,
  cookies: (req as unknown as { cookies?: Record<string, string> }).cookies,
});

const idOf = (req: ReqLike) => Number((req.params as { id: string }).id);
const AUTHORS: AppRole[] = ['admin', 'instructor'];

const BootcampBody = z.object({
  title: z.string().min(1).max(255),
  category_id: z.number().int().positive().nullish(),
  short_description: z.string().max(5000).nullish(),
  description: z.string().max(200000).nullish(),
  is_paid: z.number().int().min(0).max(1).default(0),
  price: z.number().min(0).nullish(),
  discount_flag: z.number().int().min(0).max(1).default(0),
  discounted_price: z.number().min(0).nullish(),
  publish_date: z.string().max(64).nullish(),
  thumbnail: z.string().max(255).nullish(),
  meta_keywords: z.string().max(5000).nullish(),
  meta_description: z.string().max(5000).nullish(),
  faqs: z.array(z.unknown()).optional(),
  requirements: z.array(z.string()).optional(),
  outcomes: z.array(z.string()).optional(),
});

const ModuleBody = z.object({
  title: z.string().min(1).max(255),
  publish_date: z.union([z.string(), z.number()]).nullish(),
  expiry_date: z.union([z.string(), z.number()]).nullish(),
  restriction: z.string().max(255).nullish(),
});

/** An owner is the author of the bootcamp, or an admin. */
async function assertOwner(ctx: AppContext, bootcampId: number,
                           userId: number, appRole: string): Promise<void> {
  if (appRole === 'admin') return;
  const bootcamp = await ctx.bootcamps.find(bootcampId) as { user_id?: number };
  if (Number(bootcamp.user_id) !== userId) throw forbidden();
}

export function registerBootcampRoutes(app: Router, ctx: AppContext): void {
  // ---- BC-01 / BC-07: public ----

  app.get('/api/bootcamps', async (req) => {
    const q = req.query as { category?: string; search?: string };
    return ok(await ctx.bootcamps.published(
      { categorySlug: q.category, search: q.search },
      parsePageQuery(req.query as Record<string, string>), '/api/bootcamps'));
  });

  app.get('/api/bootcamps/categories', async () => ok(await ctx.bootcamps.categories()));

  app.get('/api/bootcamps/:slug', async (req) => {
    const slug = (req.params as { slug: string }).slug;
    const bootcamp = await ctx.bootcamps.bySlug(slug) as Record<string, unknown>;
    const id = Number(bootcamp['id']);

    // Modules are listed for everyone (that is the syllabus), but the live
    // class joining payload and the resources are for buyers only.
    const claims = optionalClaims(req, ctx);
    const purchased = claims
      ? await ctx.bootcampPurchases.hasPurchased(id, claims.user_id)
      : false;
    const owner = claims
      ? claims.app_role === 'admin' || Number(bootcamp['user_id']) === claims.user_id
      : false;
    const modules = await ctx.bootcampModules.forBootcamp(id, { includePrivate: purchased || owner });

    return ok({
      bootcamp: { ...bootcamp, effective_price: bootcampPrice(bootcamp as never) },
      modules: purchased || owner ? modules : modules.map(stripPaidContent),
      purchased, owner,
      seo: await ctx.seo.resolve({
        route: 'bootcamp.details',
        entity: { kind: 'bootcamp', id },
        fallback: {
          title: String(bootcamp['title'] ?? ''),
          description: String(bootcamp['short_description'] ?? ''),
          keywords: String(bootcamp['meta_keywords'] ?? ''),
          image: String(bootcamp['thumbnail'] ?? ''),
        },
      }),
    });
  });

  // ---- BC-02: authoring ----

  app.get('/api/manage/bootcamps', async (req) => {
    const c = requireRole(asReq(req), ctx.jwtSecret, ...AUTHORS);
    const q = req.query as { search?: string; status?: string };
    return ok(await ctx.bootcamps.listFor({
      userId: c.app_role === 'admin' ? undefined : c.user_id,
      status: q.status === undefined ? undefined : Number(q.status),
      search: q.search,
    }, parsePageQuery(req.query as Record<string, string>), '/api/manage/bootcamps'));
  });

  app.get('/api/manage/bootcamps/:id', async (req) => {
    const c = requireRole(asReq(req), ctx.jwtSecret, ...AUTHORS);
    await assertOwner(ctx, idOf(req), c.user_id, c.app_role);
    const bootcamp = await ctx.bootcamps.find(idOf(req));
    return ok({
      bootcamp,
      modules: await ctx.bootcampModules.forBootcamp(idOf(req), { includePrivate: true }),
    });
  });

  app.post('/api/manage/bootcamps', async (req) => {
    const c = requireRole(asReq(req), ctx.jwtSecret, ...AUTHORS);
    const body = validate(BootcampBody, req.body);
    // Admin workshops publish immediately; an instructor's waits for approval.
    return ok(await ctx.bootcamps.create(c.user_id, body, c.app_role === 'admin'),
      c.app_role === 'admin' ? 'Workshop created.' : 'Workshop submitted for approval.');
  });

  app.patch('/api/manage/bootcamps/:id', async (req) => {
    const c = requireRole(asReq(req), ctx.jwtSecret, ...AUTHORS);
    await assertOwner(ctx, idOf(req), c.user_id, c.app_role);
    const body = validate(BootcampBody, req.body);
    return ok(await ctx.bootcamps.update(idOf(req), body), 'Workshop updated.');
  });

  app.post('/api/manage/bootcamps/:id/duplicate', async (req) => {
    const c = requireRole(asReq(req), ctx.jwtSecret, ...AUTHORS);
    await assertOwner(ctx, idOf(req), c.user_id, c.app_role);
    return ok(await ctx.bootcamps.duplicate(idOf(req), c.user_id, c.app_role === 'admin'),
      'Workshop has been duplicated.');
  });

  app.delete('/api/manage/bootcamps/:id', async (req) => {
    const c = requireRole(asReq(req), ctx.jwtSecret, ...AUTHORS);
    await assertOwner(ctx, idOf(req), c.user_id, c.app_role);
    await ctx.bootcamps.remove(idOf(req));
    return ok({}, 'Workshop deleted.');
  });

  // ---- BC-01 / BC-02 admin: categories and approval ----

  app.post('/api/admin/bootcamp-categories', async (req) => {
    requireRole(asReq(req), ctx.jwtSecret, 'admin');
    const body = validate(z.object({ title: z.string().min(1).max(255) }), req.body);
    return ok(await ctx.bootcamps.createCategory(body.title), 'Category added.');
  });

  app.patch('/api/admin/bootcamp-categories/:id', async (req) => {
    requireRole(asReq(req), ctx.jwtSecret, 'admin');
    const body = validate(z.object({ title: z.string().min(1).max(255) }), req.body);
    await ctx.bootcamps.updateCategory(idOf(req), body.title);
    return ok({}, 'Category updated.');
  });

  app.delete('/api/admin/bootcamp-categories/:id', async (req) => {
    requireRole(asReq(req), ctx.jwtSecret, 'admin');
    await ctx.bootcamps.removeCategory(idOf(req));
    return ok({}, 'Category deleted.');
  });

  app.get('/api/admin/bootcamps/pending', async (req) => {
    requireRole(asReq(req), ctx.jwtSecret, 'admin');
    return ok(await ctx.bootcamps.pending(
      parsePageQuery(req.query as Record<string, string>), '/api/admin/bootcamps/pending'));
  });

  app.post('/api/admin/bootcamps/:id/status', async (req) => {
    requireRole(asReq(req), ctx.jwtSecret, 'admin');
    const body = validate(z.object({ status: z.union([z.literal(0), z.literal(1)]) }), req.body);
    return ok(await ctx.bootcamps.setStatus(idOf(req), body.status), 'Status updated.');
  });

  // ---- BC-03: modules ----

  app.post('/api/manage/bootcamps/:id/modules', async (req) => {
    const c = requireRole(asReq(req), ctx.jwtSecret, ...AUTHORS);
    await assertOwner(ctx, idOf(req), c.user_id, c.app_role);
    const body = validate(ModuleBody, req.body);
    return ok(await ctx.bootcampModules.create(idOf(req), body), 'Module added.');
  });

  app.patch('/api/manage/bootcamp-modules/:id', async (req) => {
    const c = requireRole(asReq(req), ctx.jwtSecret, ...AUTHORS);
    const module = await ctx.bootcampModules.find(idOf(req));
    await assertOwner(ctx, Number(module.bootcamp_id), c.user_id, c.app_role);
    return ok(await ctx.bootcampModules.update(idOf(req), validate(ModuleBody.partial(), req.body)),
      'Module updated.');
  });

  app.post('/api/manage/bootcamps/:id/modules/sort', async (req) => {
    const c = requireRole(asReq(req), ctx.jwtSecret, ...AUTHORS);
    await assertOwner(ctx, idOf(req), c.user_id, c.app_role);
    const body = validate(z.object({ ids: z.array(z.number().int().positive()) }), req.body);
    await ctx.bootcampModules.sort(idOf(req), body.ids);
    return ok({}, 'Order saved.');
  });

  app.delete('/api/manage/bootcamp-modules/:id', async (req) => {
    const c = requireRole(asReq(req), ctx.jwtSecret, ...AUTHORS);
    const module = await ctx.bootcampModules.find(idOf(req));
    await assertOwner(ctx, Number(module.bootcamp_id), c.user_id, c.app_role);
    await ctx.bootcampModules.remove(idOf(req));
    return ok({}, 'Module deleted.');
  });

  // ---- BC-04: resources ----

  app.post('/api/manage/bootcamp-modules/:id/resources', async (req) => {
    const c = requireRole(asReq(req), ctx.jwtSecret, ...AUTHORS);
    const module = await ctx.bootcampModules.find(idOf(req));
    await assertOwner(ctx, Number(module.bootcamp_id), c.user_id, c.app_role);
    const body = validate(z.object({
      title: z.string().min(1).max(255),
      upload_type: z.enum(['resource', 'record']),
      file: z.string().min(1).max(255),
    }), req.body);
    return ok(await ctx.bootcampResources.create(idOf(req), body),
      body.upload_type === 'record' ? 'Record has been uploaded.' : 'Resource has been uploaded.');
  });

  app.delete('/api/manage/bootcamp-resources/:id', async (req) => {
    const c = requireRole(asReq(req), ctx.jwtSecret, ...AUTHORS);
    const resource = await ctx.bootcampResources.find(idOf(req));
    const module = await ctx.bootcampModules.find(Number(resource.module_id));
    await assertOwner(ctx, Number(module.bootcamp_id), c.user_id, c.app_role);
    await ctx.bootcampResources.remove(idOf(req));
    return ok({}, 'Resource has been deleted.');
  });

  /**
   * BC-04 -- a signed, short-lived download link. Resources are paid content,
   * so the purchase is checked here rather than trusting a bucket path.
   */
  app.get('/api/bootcamp-resources/:id/download', async (req) => {
    const c = requireAuth(asReq(req), ctx.jwtSecret);
    const resource = await ctx.bootcampResources.find(idOf(req));
    const module = await ctx.bootcampModules.find(Number(resource.module_id));
    const bootcamp = await ctx.bootcamps.find(Number(module.bootcamp_id)) as { user_id?: number };

    const allowed = c.app_role === 'admin'
      || Number(bootcamp.user_id) === c.user_id
      || await ctx.bootcampPurchases.hasPurchased(Number(module.bootcamp_id), c.user_id);
    if (!allowed) throw forbidden();

    const url = await ctx.storage.signedUrl(String(resource.file), 300);
    // signedUrl returns null when the object is not in the bucket. Handing the
    // client {url: null} looks like success and fails later, somewhere less
    // obvious, so say what is wrong here.
    if (!url) throw new HttpError(404, 'That file is no longer available.');
    return ok({ url, title: resource.title, upload_type: resource.upload_type });
  });

  // ---- BC-05: bootcamp live classes ----

  app.post('/api/manage/bootcamp-modules/:id/live-classes', async (req) => {
    const c = requireRole(asReq(req), ctx.jwtSecret, ...AUTHORS);
    const module = await ctx.bootcampModules.find(idOf(req));
    await assertOwner(ctx, Number(module.bootcamp_id), c.user_id, c.app_role);
    const body = validate(z.object({
      title: z.string().min(1).max(255),
      description: z.string().max(20000).nullish(),
      start_time: z.union([z.string(), z.number()]),
      end_time: z.union([z.string(), z.number()]),
      provider: z.enum(['zoom', 'jitsi']).default('jitsi'),
    }), req.body);
    return ok(await ctx.bootcampClasses.create(idOf(req), body), 'Live class added.');
  });

  app.delete('/api/manage/bootcamp-live-classes/:id', async (req) => {
    const c = requireRole(asReq(req), ctx.jwtSecret, ...AUTHORS);
    const cls = await ctx.bootcampClasses.find(idOf(req));
    const module = await ctx.bootcampModules.find(Number(cls.module_id));
    await assertOwner(ctx, Number(module.bootcamp_id), c.user_id, c.app_role);
    await ctx.bootcampClasses.remove(idOf(req));
    return ok({}, 'Live class deleted.');
  });

  /** BC-05 -- stop a running class, which is what force_stop means. */
  app.post('/api/manage/bootcamp-live-classes/:id/stop', async (req) => {
    const c = requireRole(asReq(req), ctx.jwtSecret, ...AUTHORS);
    const cls = await ctx.bootcampClasses.find(idOf(req));
    const module = await ctx.bootcampModules.find(Number(cls.module_id));
    await assertOwner(ctx, Number(module.bootcamp_id), c.user_id, c.app_role);
    await ctx.bootcampClasses.forceStop(idOf(req));
    return ok({}, 'Class stopped.');
  });

  /** BC-05 -- join. Buyers only, and only inside the class window. */
  app.get('/api/bootcamp-live-classes/:id/join', async (req) => {
    const c = requireAuth(asReq(req), ctx.jwtSecret);
    const cls = await ctx.bootcampClasses.find(idOf(req));
    const module = await ctx.bootcampModules.find(Number(cls.module_id));
    const bootcampId = Number(module.bootcamp_id);
    const bootcamp = await ctx.bootcamps.find(bootcampId) as { user_id?: number };

    const isHost = c.app_role === 'admin' || Number(bootcamp.user_id) === c.user_id;
    if (!isHost && !(await ctx.bootcampPurchases.hasPurchased(bootcampId, c.user_id))) {
      throw forbidden();
    }
    // class_started(): not stopped, has joining data, inside the window.
    if (!isHost && !classStarted(cls as never)) {
      throw new HttpError(403, 'This class is not open.');
    }
    return ok(await ctx.bootcampClasses.joinPayload(idOf(req), isHost));
  });

  // ---- BC-06 / BC-07: purchases and my-workshops ----

  app.get('/api/my-bootcamps', async (req) => {
    const c = requireAuth(asReq(req), ctx.jwtSecret);
    return ok(await ctx.bootcampPurchases.forUser(c.user_id));
  });

  app.get('/api/my-bootcamps/:slug', async (req) => {
    const c = requireAuth(asReq(req), ctx.jwtSecret);
    const slug = (req.params as { slug: string }).slug;
    const bootcamp = await ctx.bootcamps.bySlug(slug) as Record<string, unknown>;
    const id = Number(bootcamp['id']);

    const owner = c.app_role === 'admin' || Number(bootcamp['user_id']) === c.user_id;
    if (!owner && !(await ctx.bootcampPurchases.hasPurchased(id, c.user_id))) {
      throw forbidden();
    }
    return ok({
      bootcamp,
      modules: await ctx.bootcampModules.forBootcamp(id, { includePrivate: true }),
    });
  });

  app.post('/api/bootcamps/:id/enrol-free', async (req) => {
    const c = requireAuth(asReq(req), ctx.jwtSecret);
    const invoice = '#' + ctx.bootcampPurchases.newInvoice();
    return ok(await ctx.bootcampPurchases.enrolFree(idOf(req), c.user_id, invoice),
      'Enrolled in the workshop successfully');
  });

  /**
   * BC-06 -- the paid path. Laravel routed a workshop purchase through
   * offline_payments with item_type 'bootcamp'; approving one records the
   * bootcamp_purchase and its revenue split.
   */
  app.post('/api/bootcamps/:id/purchase', async (req) => {
    const c = requireAuth(asReq(req), ctx.jwtSecret);
    const body = validate(z.object({
      phone_on: z.string().max(255).nullish(),
      bank_no: z.string().max(255).nullish(),
      doc: z.string().max(255).nullish(),
    }).default({}), req.body ?? {});
    return ok(await ctx.offline.submitBootcamp(c.user_id, idOf(req), body),
      'Your request is in process.');
  });

  app.get('/api/bootcamp-invoices/:invoice', async (req) => {
    const c = requireAuth(asReq(req), ctx.jwtSecret);
    const invoice = (req.params as { invoice: string }).invoice;
    return ok(await ctx.bootcampPurchases.byInvoice(invoice, c.user_id, c.app_role === 'admin'));
  });

  app.get('/api/manage/bootcamp-revenue', async (req) => {
    const c = requireRole(asReq(req), ctx.jwtSecret, ...AUTHORS);
    const target = c.app_role === 'admin'
      ? Number((req.query as { instructor?: string }).instructor ?? c.user_id)
      : c.user_id;
    return ok(await ctx.bootcampPurchases.revenueFor(target));
  });
}

/** Claims when a valid token is present, otherwise undefined. */
function optionalClaims(req: ReqLike, ctx: AppContext) {
  try {
    return requireAuth(asReq(req), ctx.jwtSecret);
  } catch {
    return undefined;
  }
}

/** The syllabus without the parts a buyer paid for. */
function stripPaidContent(module: Record<string, unknown>) {
  const classes = (module['live_classes'] as Record<string, unknown>[] | undefined) ?? [];
  return {
    ...module,
    resources: [],
    resource_count: ((module['resources'] as unknown[] | undefined) ?? []).length,
    live_classes: classes.map((c) => ({
      id: c['id'], title: c['title'], start_time: c['start_time'],
      end_time: c['end_time'], provider: c['provider'],
    })),
  };
}
