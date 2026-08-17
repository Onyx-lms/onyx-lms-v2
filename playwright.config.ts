import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));

const WEB = process.env.E2E_WEB ?? 'http://127.0.0.1:5173';
// The same origin. The API is served by the Next app itself now, so the split
// that used to be here -- a Fastify process on :4000 -- is gone. It keeps its own
// name because the specs read it, and because it can still be pointed at a
// preview deployment independently.
const API = process.env.E2E_API ?? WEB;

/**
 * Browser-level suite -- drives the real Onyx UI in real Chromium.
 *
 * This is NOT the HTTP-level suite in tests/e2e (see tools/e2e-run.mjs and
 * CLAUDE.md). That suite proves the boundary (status codes, redirects, markup
 * strings); this one exists for what only a live browser has: rendering,
 * client-side JavaScript, real form submission, keyboard navigation and
 * computed (not just structural) accessibility. Both talk to the same running
 * api/web and the same real database.
 *
 * `webServer` follows tools/e2e-run.mjs's own sequence -- build the web app,
 * then `next start` against the build, so a stale .next never shows up here as
 * a failing test rather than a build step. `reuseExistingServer: true` means
 * this also runs unchanged against servers `npm run e2e` (or `dev:api` /
 * `dev:web`) already started, which is the common case while iterating.
 */
export default defineConfig({
  testDir: 'tests/browser',
  testMatch: '**/*.spec.ts',
  timeout: 30_000,
  expect: { timeout: 15_000 },
  // Tests within a file run in order (some seed a tenant in beforeAll and
  // clean it up in afterAll); different files still run concurrently, which
  // is why every file uses its own run-unique tenant slugs and emails.
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // The suite shares one real Supabase database -- more workers just means
  // more contention on the same rows, not more throughput.
  workers: 2,
  reporter: [['list']],
  use: {
    baseURL: WEB,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  // One server, because the API is served by the Next app now (docs/ADR-012).
  // This used to start two: a Fastify process on :4000 and the site on :5173.
  webServer: [
    {
      command: 'npm run build --workspace @onyx/web && npm run start --workspace @onyx/web',
      cwd: ROOT,
      // Waits on a page rather than /health: a built Next server answers
      // /health as soon as the route table is registered, but the specs drive
      // pages, and the page router is the half that takes the time.
      url: WEB + '/onyx/login',
      reuseExistingServer: true,
      timeout: 180_000,
    },
  ],
});
