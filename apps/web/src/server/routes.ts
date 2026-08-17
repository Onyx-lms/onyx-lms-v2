/**
 * Where the API's routes are registered, once per warm instance.
 *
 * The register functions are the same ones `apps/api/src/server.ts` calls, in
 * the same order, imported **completely unchanged** -- not one line of the 33
 * route files (3,872 lines, 574 handlers) is edited.
 *
 * THE CAST, AND WHY IT IS HERE RATHER THAN IN 33 FILES.
 *
 * Those files declare `app: FastifyInstance`. The shim implements the subset of
 * that interface they actually use -- five verbs, and a `reply` with the six
 * methods the 22 `reply` call sites touch -- but it is not a FastifyInstance and
 * TypeScript is right to say so. The alternatives were:
 *
 *   * Edit all 33 files to take `Router`. But the files live in apps/api and
 *     the shim lives in apps/web, so that makes the API depend on the web app
 *     -- backwards, and it breaks apps/api's own build.
 *   * Move the shim into packages/core and edit all 33 imports. Cleaner
 *     coupling, but it still means 33 edits, and it makes the route files
 *     unusable by the Fastify server, which is the parity oracle this migration
 *     is verified against (tools/onyx/parity-diff.mjs runs the same e2e suites
 *     against both). Losing the oracle to tidy an import is a bad trade.
 *   * One cast, here. The route files stay byte-identical and keep compiling
 *     against Fastify, so both servers can serve them for the whole migration.
 *
 * What backs the cast is behaviour, not optimism: router.test.ts asserts the
 * matcher's precedence against all eight genuinely ambiguous route pairs in the
 * codebase, and the reply object's header/status/cookie/send semantics including
 * the one Fastify subtlety the routes rely on (a header set before a `throw`
 * survives onto the error response). Anything the shim gets wrong shows up as a
 * parity-diff failure, not as a type error, which is exactly why that harness
 * exists.
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
import type { FastifyInstance } from 'fastify';
import { createRouter, type RouteTable } from './router.ts';
import { ctx } from './context.ts';

import { registerPlatformRoutes } from '../../../api/src/routes/platform.routes.ts';
import { registerAuthRoutes } from '../../../api/src/routes/auth.routes.ts';
import { registerAccountRoutes } from '../../../api/src/routes/account.routes.ts';
import { registerUserRoutes } from '../../../api/src/routes/users.routes.ts';
import { registerCatalogRoutes } from '../../../api/src/routes/catalog.routes.ts';
import { registerAuthoringRoutes } from '../../../api/src/routes/authoring.routes.ts';
import { registerMediaRoutes } from '../../../api/src/routes/media.routes.ts';
import { registerQuizRoutes } from '../../../api/src/routes/quiz.routes.ts';
import { registerEnrollmentRoutes } from '../../../api/src/routes/enrollment.routes.ts';
import { registerPaymentRoutes } from '../../../api/src/routes/payment.routes.ts';
import { registerOfflineRoutes } from '../../../api/src/routes/offline.routes.ts';
import { registerPlayerRoutes } from '../../../api/src/routes/player.routes.ts';
import { registerCommunityRoutes } from '../../../api/src/routes/community.routes.ts';
import { registerReviewRoutes } from '../../../api/src/routes/review.routes.ts';
import { registerAdminEnrollmentRoutes } from '../../../api/src/routes/admin-enrollment.routes.ts';
import { registerBlogRoutes } from '../../../api/src/routes/blog.routes.ts';
import { registerKnowledgeRoutes } from '../../../api/src/routes/knowledge.routes.ts';
import { registerMessagingRoutes } from '../../../api/src/routes/messaging.routes.ts';
import { registerLiveClassRoutes } from '../../../api/src/routes/live-class.routes.ts';
import { registerBootcampRoutes } from '../../../api/src/routes/bootcamp.routes.ts';
import { registerTeamRoutes } from '../../../api/src/routes/team.routes.ts';
import { registerTutorRoutes } from '../../../api/src/routes/tutor.routes.ts';
import { registerReportRoutes } from '../../../api/src/routes/reports.routes.ts';
import { registerAdminSettingsRoutes } from '../../../api/src/routes/admin-settings.routes.ts';
import { registerOnyxTenancyRoutes } from '../../../api/src/routes/onyx/tenancy.routes.ts';
import { registerOnyxLearnRoutes } from '../../../api/src/routes/onyx/learn.routes.ts';
import { registerOnyxCodeLabRoutes } from '../../../api/src/routes/onyx/codelab.routes.ts';
import { registerOnyxAssessRoutes } from '../../../api/src/routes/onyx/assess.routes.ts';
import { registerOnyxCareerRoutes } from '../../../api/src/routes/onyx/career.routes.ts';
import { registerOnyxEngageRoutes } from '../../../api/src/routes/onyx/engage.routes.ts';
import { registerOnyxCampusRoutes } from '../../../api/src/routes/onyx/campus.routes.ts';
import { registerOnyxNotifyRoutes } from '../../../api/src/routes/onyx/notify.routes.ts';
import { registerOnyxPlatformRoutes } from '../../../api/src/routes/onyx/platform.routes.ts';

const KEY = Symbol.for('@onyx/web/route-table');
type WithTable = typeof globalThis & { [KEY]?: RouteTable };

function build(): RouteTable {
  const app = createRouter();
  const c = ctx();
  /** See the note above: one cast, confined to this file. */
  const as = app as unknown as FastifyInstance;

  registerPlatformRoutes(as, c);
  registerAuthRoutes(as, c);
  registerAccountRoutes(as, c);
  registerUserRoutes(as, c);
  registerCatalogRoutes(as, c);
  registerAuthoringRoutes(as, c);
  registerMediaRoutes(as, c);
  registerQuizRoutes(as, c);
  registerEnrollmentRoutes(as, c);
  registerPaymentRoutes(as, c);
  registerOfflineRoutes(as, c);
  registerPlayerRoutes(as, c);
  registerCommunityRoutes(as, c);
  registerReviewRoutes(as, c);
  registerAdminEnrollmentRoutes(as, c);
  registerBlogRoutes(as, c);
  registerKnowledgeRoutes(as, c);
  registerMessagingRoutes(as, c);
  registerLiveClassRoutes(as, c);
  registerBootcampRoutes(as, c);
  registerTeamRoutes(as, c);
  registerTutorRoutes(as, c);
  registerReportRoutes(as, c);
  registerAdminSettingsRoutes(as, c);
  registerOnyxTenancyRoutes(as, c);
  registerOnyxLearnRoutes(as, c);
  registerOnyxCodeLabRoutes(as, c);
  registerOnyxAssessRoutes(as, c);
  registerOnyxCareerRoutes(as, c);
  registerOnyxEngageRoutes(as, c);
  registerOnyxCampusRoutes(as, c);
  registerOnyxNotifyRoutes(as, c);
  registerOnyxPlatformRoutes(as, c);

  return app;
}

export function routeTable(): RouteTable {
  const g = globalThis as WithTable;
  return (g[KEY] ??= build());
}
