/**
 * The service container, once per warm instance.
 *
 * `createContext()` builds ~90 service objects and does no I/O while doing it:
 * `onyxServiceClient()` is already module-memoised, `onyxSql()` returns a lazy
 * runner whose pool opens on first query, and the execution provider only reads
 * env. So a cold start pays object allocation and nothing else -- which is why
 * this can stay a plain synchronous singleton rather than a promise.
 *
 * Cached on `globalThis`, not in a module-level `let`. Next's dev server
 * re-evaluates modules on every edit, so a module-scoped cache leaks a fresh
 * container -- and with it a fresh `pg.Pool` -- per save, until the connection
 * limit is reached and the symptom looks like a dead database. Same reason
 * Prisma's own Next.js guidance reaches for `globalThis`.
 */
import { createContext, type AppContext } from './app-context.ts';

const KEY = Symbol.for('@onyx/web/app-context');
type WithCtx = typeof globalThis & { [KEY]?: AppContext };

export function ctx(): AppContext {
  const g = globalThis as WithCtx;
  return (g[KEY] ??= createContext());
}

export type { AppContext };
