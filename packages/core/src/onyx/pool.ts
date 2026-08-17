/**
 * A Postgres pool for the queue.
 *
 * The queue claims work with `FOR UPDATE SKIP LOCKED` (LAB-02b), which is one
 * statement whose atomicity is the whole point. PostgREST cannot express it, so
 * this is the only part of Onyx that talks to Postgres directly.
 *
 * Reaching Supabase is the same problem tools/db/connect.mjs solves: the direct
 * host `db.<ref>.supabase.co` is **IPv6-only** on projects created after early
 * 2024, so on an IPv4-only network it fails with ENOTFOUND and every symptom
 * points at the database rather than at DNS. The regional session pooler
 * answers over IPv4 and speaks the same protocol.
 *
 * Which host works is decided **once, before the pool exists**. An earlier
 * version built a pool on the direct host and swapped in a new one on the first
 * failure -- which left every caller holding a reference to a pool that had
 * been ended, and their queries hung. Resolving first is the fix: callers get a
 * runner, and the runner awaits a single memoised pool.
 */
import pg from 'pg';

export interface PoolOptions {
  connectionString?: string;
  max?: number;
  env?: Record<string, string | undefined>;
}

/** Candidate connection configs, best first. */
export function poolCandidates(env: Record<string, string | undefined>): {
  label: string; config: pg.PoolConfig;
}[] {
  const strip = (url: string) => url.replace(/[?&]sslmode=[^&]*/, '');
  const out: { label: string; config: pg.PoolConfig }[] = [];
  const direct = strip(env.SUPABASE_DB_URL ?? env.DATABASE_URL ?? '');
  if (direct) out.push({ label: 'direct', config: { connectionString: direct } });
  if (env.SUPABASE_POOLER_URL) {
    out.push({ label: 'pooler (configured)', config: { connectionString: strip(env.SUPABASE_POOLER_URL) } });
  }

  // Same password, user becomes postgres.<project-ref>, host is the regional
  // pooler. Two prefixes because Supabase uses both.
  try {
    const u = new URL(direct);
    const ref = u.hostname.replace(/^db\./, '').replace(/\.supabase\.co$/, '');
    const region = env.SUPABASE_REGION ?? 'ap-northeast-1';
    for (const host of ['aws-0-' + region + '.pooler.supabase.com',
      'aws-1-' + region + '.pooler.supabase.com']) {
      out.push({
        label: 'pooler ' + host,
        config: {
          host, port: 5432, database: 'postgres',
          user: 'postgres.' + ref, password: decodeURIComponent(u.password),
        },
      });
    }
  } catch { /* no usable direct URL to derive from */ }
  return out;
}

let resolving: Promise<pg.Pool> | null = null;

async function resolvePool(opts: PoolOptions): Promise<pg.Pool> {
  const env = opts.env ?? process.env;
  const candidates = opts.connectionString
    ? [{ label: 'given', config: { connectionString: opts.connectionString } }]
    : poolCandidates(env);
  if (!candidates.length) {
    throw new Error('Missing SUPABASE_DB_URL (see .env.example) -- the queue needs it.');
  }

  const tried: string[] = [];
  for (const { label, config } of candidates) {
    const pool = new pg.Pool({
      ...config,
      // Small on purpose: worker concurrency decides how much is in flight, and
      // a large pool here would only queue inside Postgres instead.
      max: opts.max ?? 5,
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 10_000,
    });
    // A pool error must never crash the API; a failed query reports itself.
    pool.on('error', () => {});
    try {
      // Prove the host answers before anyone holds a reference to this pool.
      const client = await pool.connect();
      client.release();
      if (label !== 'direct') {
        console.warn('[onyx] direct database host unreachable, using ' + label);
      }
      return pool;
    } catch (error) {
      tried.push(label + ': ' + (error instanceof Error ? error.message : String(error)));
      await pool.end().catch(() => {});
    }
  }
  throw new Error('Could not reach Postgres for the queue. Tried:\n  ' + tried.join('\n  '));
}

/**
 * A query runner backed by a lazily-resolved pool.
 *
 * Returned synchronously so services can be constructed at boot without
 * awaiting a connection; the first query is what actually connects.
 */
export function onyxSql(opts: PoolOptions = {}): {
  query<R = Record<string, unknown>>(
    text: string, values?: unknown[],
  ): Promise<{ rows: R[]; rowCount: number | null }>;
} {
  return {
    async query(text, values) {
      // `??=` only reassigns when the left side is null/undefined, and a
      // REJECTED promise is neither -- it is a settled value like any other.
      // So a single transient failure (the network blinks the moment the
      // first query runs after boot) used to poison `resolving` forever: every
      // later call awaited the same cached rejection and got the exact same
      // stale error, even minutes after the database was reachable again. The
      // queue -- and with it every Code Lab run and submission -- stayed dead
      // until someone noticed and restarted the process.
      //
      // Caught here, not by hoping poolCandidates() finds another route: the
      // point of `resolving` is to share ONE successful resolution across
      // concurrent callers, not to remember a failure. On rejection the slot
      // is cleared so the next call resolves fresh, and this attempt still
      // reports the real error to its own caller.
      resolving ??= resolvePool(opts).catch((error: unknown) => {
        resolving = null;
        throw error;
      });
      const pool = await resolving;
      return pool.query(text, values as never) as never;
    },
  };
}

/** Closes the pool. Used by tests and by a clean shutdown. */
export async function closeOnyxPool(): Promise<void> {
  if (!resolving) return;
  const pending = resolving;
  resolving = null;
  await pending.then((p) => p.end()).catch(() => {});
}
