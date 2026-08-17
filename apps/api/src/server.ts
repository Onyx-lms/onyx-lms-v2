import Fastify from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import { createContext } from './context.ts';
import { increment, observe, renderMetrics, health } from '@onyx/core';
import { registerErrorHandler } from './plugins/error-handler.ts';
import { registerAuthRoutes } from './routes/auth.routes.ts';
import { registerAccountRoutes } from './routes/account.routes.ts';
import { registerUserRoutes } from './routes/users.routes.ts';
import { registerCatalogRoutes } from './routes/catalog.routes.ts';
import { registerAuthoringRoutes } from './routes/authoring.routes.ts';
import { registerMediaRoutes } from './routes/media.routes.ts';
import { registerQuizRoutes } from './routes/quiz.routes.ts';
import { registerEnrollmentRoutes } from './routes/enrollment.routes.ts';
import { registerPaymentRoutes } from './routes/payment.routes.ts';
import { registerOfflineRoutes } from './routes/offline.routes.ts';
import { registerPlayerRoutes } from './routes/player.routes.ts';
import { registerCommunityRoutes } from './routes/community.routes.ts';
import { registerReviewRoutes } from './routes/review.routes.ts';
import { registerAdminEnrollmentRoutes } from './routes/admin-enrollment.routes.ts';
import { registerBlogRoutes } from './routes/blog.routes.ts';
import { registerKnowledgeRoutes } from './routes/knowledge.routes.ts';
import { registerMessagingRoutes } from './routes/messaging.routes.ts';
import { registerLiveClassRoutes } from './routes/live-class.routes.ts';
import { registerBootcampRoutes } from './routes/bootcamp.routes.ts';
import { registerTeamRoutes } from './routes/team.routes.ts';
import { registerTutorRoutes } from './routes/tutor.routes.ts';
import { registerReportRoutes } from './routes/reports.routes.ts';
import { registerAdminSettingsRoutes } from './routes/admin-settings.routes.ts';
import { registerOnyxTenancyRoutes } from './routes/onyx/tenancy.routes.ts';
import { registerOnyxLearnRoutes } from './routes/onyx/learn.routes.ts';
import { registerOnyxCodeLabRoutes } from './routes/onyx/codelab.routes.ts';
import { registerOnyxAssessRoutes } from './routes/onyx/assess.routes.ts';
import { registerOnyxCareerRoutes } from './routes/onyx/career.routes.ts';
import { registerOnyxEngageRoutes } from './routes/onyx/engage.routes.ts';
import { registerOnyxCampusRoutes } from './routes/onyx/campus.routes.ts';
import { registerOnyxNotifyRoutes } from './routes/onyx/notify.routes.ts';
import { registerOnyxPlatformRoutes } from './routes/onyx/platform.routes.ts';
import { registerPlatformRoutes } from './routes/platform.routes.ts';

export async function buildServer() {
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info' } });

  await app.register(cors, { origin: process.env.WEB_ORIGIN ?? true, credentials: true });
  await app.register(cookie);
  await app.register(multipart, { limits: { fileSize: 25 * 1024 * 1024 } });

  // Webhook signatures are computed over the EXACT bytes the gateway sent.
  // Fastify's default JSON parser throws the raw string away, so re-serialising
  // req.body would fail every signature check. Keep the original alongside.
  app.addContentTypeParser('application/json', { parseAs: 'string' },
    (req, body, done) => {
      (req as unknown as { rawBody?: string }).rawBody = body as string;
      if (!body) return done(null, undefined);
      try {
        done(null, JSON.parse(body as string));
      } catch (err) {
        (err as { statusCode?: number }).statusCode = 400;
        done(err as Error, undefined);
      }
    });
  registerErrorHandler(app);

  const ctx = createContext();

  /**
   * SCL-03. Every request counted, and the slow ones visible.
   *
   * The route is the label, not the URL: `/api/onyx/courses/119/outline` as a
   * label would make one time series per course and a scrape nobody can read.
   */
  app.addHook('onResponse', async (req, reply) => {
    const route = (req as unknown as { routeOptions?: { url?: string } }).routeOptions?.url
      ?? 'unmatched';
    increment('onyx_http_requests_total', {
      method: req.method, route, status: String(reply.statusCode),
    });
    if (reply.statusCode >= 500) {
      increment('onyx_http_errors_total', { method: req.method, route });
    }
    observe('onyx_http_duration_ms', reply.elapsedTime, { route });
  });

  /**
   * What a scraper reads. Deliberately unauthenticated and deliberately
   * loopback-only in deployment: metrics carry no personal data, and putting a
   * token on the endpoint is how a monitoring stack ends up not monitoring.
   */
  app.get('/metrics', async (_req, reply) => {
    reply.header('Content-Type', 'text/plain; version=0.0.4');
    return reply.send(renderMetrics());
  });

  registerPlatformRoutes(app, ctx);
  registerAuthRoutes(app, ctx);
  registerAccountRoutes(app, ctx);
  registerUserRoutes(app, ctx);
  registerCatalogRoutes(app, ctx);
  registerAuthoringRoutes(app, ctx);
  registerMediaRoutes(app, ctx);
  registerQuizRoutes(app, ctx);
  registerEnrollmentRoutes(app, ctx);
  registerPaymentRoutes(app, ctx);
  registerOfflineRoutes(app, ctx);
  registerPlayerRoutes(app, ctx);
  registerCommunityRoutes(app, ctx);
  registerReviewRoutes(app, ctx);
  registerAdminEnrollmentRoutes(app, ctx);
  registerBlogRoutes(app, ctx);
  registerKnowledgeRoutes(app, ctx);
  registerMessagingRoutes(app, ctx);
  registerLiveClassRoutes(app, ctx);
  registerBootcampRoutes(app, ctx);
  registerTeamRoutes(app, ctx);
  registerTutorRoutes(app, ctx);
  registerReportRoutes(app, ctx);
  registerAdminSettingsRoutes(app, ctx);
  registerOnyxTenancyRoutes(app, ctx);
  registerOnyxLearnRoutes(app, ctx);
  registerOnyxCodeLabRoutes(app, ctx);
  registerOnyxAssessRoutes(app, ctx);
  registerOnyxCareerRoutes(app, ctx);
  registerOnyxEngageRoutes(app, ctx);
  registerOnyxCampusRoutes(app, ctx);
  registerOnyxNotifyRoutes(app, ctx);
  registerOnyxPlatformRoutes(app, ctx);

  // The worker interval below needs the same context the routes use --
  // building a second one would mean a second connection pool.
  (app as unknown as { ctx: typeof ctx }).ctx = ctx;
  return app;
}

// Only boot when executed directly, so tests can import buildServer freely.
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))) {
  const port = Number(process.env.PORT ?? 4000);
  const app = await buildServer();

  /**
   * Say something before dying.
   *
   * The API was disappearing part-way through full end-to-end runs -- at a
   * different endpoint each time, and silently: nothing on stdout, nothing on
   * stderr, every remaining test failing with connection-refused and no way to
   * tell a crash from a kill. Node's default handler prints an unhandled
   * rejection and exits, but only for rejections it can see; anything raised
   * outside a request's own promise chain left no trace at all.
   *
   * These do not swallow the fault. The process still exits non-zero -- an API
   * that has hit an unhandled exception has an unknown amount of state behind
   * it and should be replaced, not nursed. What changes is that the next person
   * reading the log finds out what happened.
   */
  const die = (kind: string) => (err: unknown) => {
    try {
      app.log.fatal({ err, kind }, 'onyx api is exiting on an ' + kind);
    } catch {
      // The logger is part of what might be broken. Getting the reason onto
      // the terminal matters more than getting it formatted.
      console.error('[api] exiting on an ' + kind, err);
    }
    process.exitCode = 1;
    // Enough of a beat for a piped stderr to flush before the process goes.
    setTimeout(() => process.exit(1), 100).unref();
  };
  process.on('uncaughtException', die('uncaught exception'));
  process.on('unhandledRejection', die('unhandled rejection'));

  app.listen({ port, host: '0.0.0.0' })
    .catch((err) => { app.log.error(err); process.exit(1); });

  // LAB-02b. The Code Lab worker runs in-process on an interval: one deployable
  // is worth more than a second one nobody remembers to start, and the queue is
  // durable either way. Splitting it into its own process later changes only
  // this block.
  //
  // unref() so a pending tick never holds the process open on shutdown.
  const everyMs = Number(process.env.ONYX_WORKER_INTERVAL_MS ?? 2000);
  if (everyMs > 0) {
    const ctx = (app as unknown as { ctx: {
      onyxRunWorker: (o?: { concurrency?: number }) => Promise<unknown>;
      onyxAssess: { expireOverdueEverywhere: () => Promise<{ tenants: number; expired: number }> };
    } }).ctx;
    let running = false;
    setInterval(() => {
      // Skip rather than overlap. Two passes at once would claim different jobs
      // -- SKIP LOCKED makes that safe -- but the pool is small and throughput
      // is not the problem the interval is solving.
      if (running) return;
      running = true;
      void ctx.onyxRunWorker({ concurrency: Number(process.env.ONYX_WORKER_CONCURRENCY ?? 4) })
        .catch((err) => app.log.error({ err }, 'onyx worker pass failed'))
        .finally(() => { running = false; });
    }, everyMs).unref();
  }

  /**
   * ASS-01b. Ends attempts whose time ran out while nobody was looking.
   *
   * The paper's own timer hands in at zero, so this only ever catches the
   * candidate whose browser died -- but until now nothing caught them at all.
   * Their attempt sat at `in_progress` for ever, and the marking queue excludes
   * that status, so the paper was never marked and no invigilator was told.
   *
   * A minute rather than the worker's two seconds: nothing here is urgent, the
   * timer covers the ordinary case, and a sweep is a write per abandoned paper.
   * Skips its own overlap for the same reason the worker does.
   */
  const sweepMs = Number(process.env.ONYX_EXPIRY_SWEEP_MS ?? 60_000);
  if (sweepMs > 0) {
    const ctx = (app as unknown as { ctx: {
      onyxAssess: { expireOverdueEverywhere: () => Promise<{ tenants: number; expired: number }> };
    } }).ctx;
    let sweeping = false;
    setInterval(() => {
      if (sweeping) return;
      sweeping = true;
      void ctx.onyxAssess.expireOverdueEverywhere()
        .then((r) => {
          // Logged only when it did something. A line a minute saying "nothing
          // expired" is how a log stops being read.
          if (r.expired) {
            app.log.info({ ...r }, 'onyx expired abandoned assessment attempts');
          }
        })
        .catch((err) => app.log.error({ err }, 'onyx attempt expiry sweep failed'))
        .finally(() => { sweeping = false; });
    }, sweepMs).unref();
  }
}
