/** Sprint-1 platform endpoints: settings, i18n dictionary, health. */
import type { Router } from '../router.ts';
import { ok, notFound, health } from '@onyx/core';
import type { AppContext } from '../app-context.ts';

export function registerPlatformRoutes(app: Router, ctx: AppContext): void {
  /**
   * SCL-03. Liveness that actually proves something.
   *
   * The old version reported "up" as long as the event loop was turning, which
   * stays green while every write fails. This reaches the database, because
   * that is the dependency whose absence makes the product useless -- and it
   * answers 503 when a probe fails, so a load balancer can act on it rather
   * than parsing the body.
   */
  app.get('/health', async (_req, reply) => {
    const report = await health([
      {
        name: 'database',
        // The cheapest read that proves PostgREST answers and the schema is
        // there. Counting rows would grow with the product.
        run: () => ctx.settings.get('system_title'),
      },
    ]);
    if (report.status !== 'up') reply.code(503);
    return ok(report);
  });

  /** Curated public settings only -- see SettingsService.PUBLIC_KEYS. */
  app.get('/api/settings', async () => ok(await ctx.settings.publicSettings()));

  app.get('/api/settings/theme', async () => ok({ theme: await ctx.settings.theme() }));

  app.get('/api/languages', async () => ok(await ctx.i18n.languages()));

  /** Full phrase dictionary for a language -- feeds next-intl on the web side. */
  app.get<{ Params: { language: string } }>(
    '/api/i18n/:language',
    async (req) => {
      // Read once. `params` is indexed, and with noUncheckedIndexedAccess every
      // access is `string | undefined` -- which was invisible under Fastify's
      // looser typing. The matcher never binds a parameter to an empty string
      // (router.test.ts asserts it), so the fallback is unreachable; if it ever
      // were reached, an empty language falls through to the 404 below, which is
      // the right answer anyway.
      const language = req.params['language'] ?? '';
      const dict = await ctx.i18n.dictionary(language);
      if (Object.keys(dict).length === 0) {
        const known = await ctx.i18n.findLanguage(language);
        if (!known) throw notFound(`Unknown language "${language}".`);
      }
      return ok({
        language,
        direction: await ctx.i18n.direction(language),
        phrases: dict,
      });
    },
  );
}
