/**
 * Where the API's routes are registered, once per warm instance.
 *
 * The register functions are the same ones the Fastify server called, in the same
 * order. Through the migration they lived in apps/api and were imported unedited;
 * they live here now, and the only change any of the 33 files needed was its
 * import line -- Fastify's two type names for the shim's own.
 *
 * The route layer lives here now.
 *
 * Through the migration these files stayed in apps/api, untouched, so the
 * Fastify server could keep serving them as a parity oracle -- the same e2e
 * suites run against both and diffed (tools/onyx/parity-diff.mjs). That job is
 * done: the final serial run had ZERO tests failing on this server that passed
 * on Fastify. So apps/api is gone, its 33 route files moved in, and the two
 * Fastify type names they referenced became the shim's own.
 *
 * That also removed the one cast this file used to carry. The files declared
 * `app: FastifyInstance` and were handed something that merely implemented the
 * subset they used; the compiler was right to object and was overruled in one
 * place on purpose, so the route files could stay byte-identical and keep
 * compiling against Fastify. Now they declare `app: Router` and the types are
 * simply true -- which is worth more than the cast was, and is only affordable
 * because the oracle has already served its purpose.
 *
 * Cached on `globalThis` for the reason context.ts is: Next re-evaluates modules
 * on edit in dev, and rebuilding would re-register every route per request.
 *
 * All 33 files, in `server.ts`'s registration order. The order is preserved for
 * readability rather than correctness -- the matcher resolves by specificity, not
 * by who registered first, precisely so a pair like `/api/blogs/categories` and
 * `/api/blogs/:slug` cannot be decided by which file happened to load earlier
 * (router.test.ts asserts all eight such pairs in the codebase).
 */
import { createRouter, type RouteTable } from './router.ts';
import { ctx } from './context.ts';

import { registerPlatformRoutes } from './routes/platform.routes.ts';
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

const KEY = Symbol.for('@onyx/web/route-table');
type WithTable = typeof globalThis & { [KEY]?: RouteTable };

function build(): RouteTable {
  const app = createRouter();
  const c = ctx();

  registerPlatformRoutes(app, c);
  registerAuthRoutes(app, c);
  registerAccountRoutes(app, c);
  registerUserRoutes(app, c);
  registerCatalogRoutes(app, c);
  registerAuthoringRoutes(app, c);
  registerMediaRoutes(app, c);
  registerQuizRoutes(app, c);
  registerEnrollmentRoutes(app, c);
  registerPaymentRoutes(app, c);
  registerOfflineRoutes(app, c);
  registerPlayerRoutes(app, c);
  registerCommunityRoutes(app, c);
  registerReviewRoutes(app, c);
  registerAdminEnrollmentRoutes(app, c);
  registerBlogRoutes(app, c);
  registerKnowledgeRoutes(app, c);
  registerMessagingRoutes(app, c);
  registerLiveClassRoutes(app, c);
  registerBootcampRoutes(app, c);
  registerTeamRoutes(app, c);
  registerTutorRoutes(app, c);
  registerReportRoutes(app, c);
  registerAdminSettingsRoutes(app, c);
  registerOnyxTenancyRoutes(app, c);
  registerOnyxLearnRoutes(app, c);
  registerOnyxCodeLabRoutes(app, c);
  registerOnyxAssessRoutes(app, c);
  registerOnyxCareerRoutes(app, c);
  registerOnyxEngageRoutes(app, c);
  registerOnyxCampusRoutes(app, c);
  registerOnyxNotifyRoutes(app, c);
  registerOnyxPlatformRoutes(app, c);

  return app;
}

export function routeTable(): RouteTable {
  const g = globalThis as WithTable;
  return (g[KEY] ??= build());
}
