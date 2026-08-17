/**
 * LAB-02b -- the durable job queue.
 *
 * The proposal puts grading, proctoring and notifications "through queues".
 * Everything built before this sprint is synchronous, so this is the gap
 * ADR-006 recorded, closed.
 *
 * **Postgres, not Redis.** The guarantee that matters is durability: a class of
 * 200 submitting at once must degrade in latency, not in correctness, and a row
 * that survives a restart is worth more than one that is fast. It also means no
 * new infrastructure to run, which is the difference between a queue that
 * exists and a queue that is planned.
 *
 * **Claiming is the whole design.** A worker takes work with
 *
 *   UPDATE ... SET status='running'
 *   WHERE id IN (SELECT id FROM onyx_jobs
 *                WHERE status='queued' AND run_after <= now()
 *                ORDER BY id FOR UPDATE SKIP LOCKED LIMIT n)
 *   RETURNING *
 *
 * SKIP LOCKED is what makes "none are double-graded" true under concurrency
 * rather than merely likely: two workers racing for the same row cannot both
 * win, because the second one does not wait for the lock -- it moves on.
 *
 * **Failure is a retry, then a record.** A job that throws goes back to
 * `queued` with a backoff until `max_attempts`, then stops at `failed` with the
 * last error kept. Nothing is silently dropped, and nothing retries forever.
 *
 * **No direct Postgres connection.** This class used to hold one, because the
 * claim is a single statement whose atomicity is the point and PostgREST cannot
 * express `FOR UPDATE SKIP LOCKED`. That was free while the API was one
 * long-lived process with one pool; under serverless it is not -- every warm
 * instance opens its own pool, instances are created in response to load, and
 * Supabase's pooler runs out of connections long before Vercel runs out of
 * appetite for instances.
 *
 * So the three statements that genuinely need SQL became Postgres functions
 * (migration 0019) and everything else is a plain PostgREST insert or update.
 * The claim's atomicity did not move to the client -- it moved *into the
 * database*, which is a stronger place for it. `pool.ts` survives for
 * tools/db/* and the local Fastify server; nothing on a request path opens a
 * socket to Postgres any more.
 */

/**
 * The kinds this codebase handles today, and room for the ones ADR-006 says are
 * coming (proctoring, notifications).
 *
 * A worker claims only the kinds it names, so an unknown kind is left alone
 * rather than failed -- which is what lets a second worker be added without
 * the first one eating its work.
 */
export type JobKind = 'code.run' | 'code.grade' | (string & {});

export interface Job {
  id: number;
  tenant_id: number;
  kind: JobKind;
  payload: Record<string, unknown>;
  attempts: number;
  max_attempts: number;
}

export interface EnqueueInput {
  tenantId: number;
  kind: JobKind;
  payload: Record<string, unknown>;
  maxAttempts?: number;
  /** Seconds to wait before this becomes eligible. */
  delaySeconds?: number;
}

export type JobHandler = (job: Job) => Promise<void>;

/** Exponential, capped. Ten seconds, then twenty, then forty. */
export function backoffSeconds(attempt: number): number {
  return Math.min(10 * 2 ** Math.max(0, attempt - 1), 300);
}

/**
 * The slice of the Supabase client this needs -- narrow so tests can fake it
 * without standing up PostgREST's whole chaining surface.
 *
 * `PromiseLike` rather than `Promise`: supabase-js returns builders that are
 * awaitable but are not Promises.
 */
export interface QueueDb {
  from(table: string): {
    insert(values: Record<string, unknown>): {
      select(columns: string): {
        maybeSingle(): PromiseLike<{ data: { id: number | string } | null; error: { message: string } | null }>;
      };
    };
    update(values: Record<string, unknown>): {
      eq(column: string, value: unknown): PromiseLike<{ error: { message: string } | null }>;
    };
  };
  rpc(fn: string, args?: Record<string, unknown>): PromiseLike<{
    data: unknown; error: { message: string } | null;
  }>;
}

export class QueueService {
  #db: QueueDb;
  #name: string;

  constructor(db: QueueDb, workerName = 'worker') {
    this.#db = db;
    this.#name = workerName;
  }

  /**
   * `run_after` is computed here rather than as `now() + interval` in SQL.
   *
   * The alternative was a fourth Postgres function for what is otherwise a plain
   * insert. Both clocks are UTC and NTP-synced, and the shortest delay this is
   * ever called with is measured in seconds, so a few milliseconds of skew cannot
   * change which side of `run_after <= now()` a job falls on.
   */
  async enqueue(input: EnqueueInput): Promise<number> {
    const runAfter = new Date(Date.now() + (input.delaySeconds ?? 0) * 1000).toISOString();
    const { data, error } = await this.#db.from('onyx_jobs').insert({
      tenant_id: input.tenantId,
      kind: input.kind,
      payload: input.payload ?? {},
      max_attempts: input.maxAttempts ?? 3,
      run_after: runAfter,
    }).select('id').maybeSingle();
    if (error) throw new Error('Could not enqueue the job: ' + error.message);
    return Number(data!.id);
  }

  /**
   * Takes up to `limit` jobs and marks them running, atomically.
   *
   * Everything about correctness under load lives in this one statement.
   */
  async claim(limit = 1, kinds?: JobKind[]): Promise<Job[]> {
    // The atomicity lives in onyx_claim_jobs (migration 0019), not here. That is
    // the point: FOR UPDATE SKIP LOCKED cannot be expressed through PostgREST,
    // and splitting it into a read and a write from this side would reintroduce
    // the exact race it exists to prevent.
    const { data, error } = await this.#db.rpc('onyx_claim_jobs', {
      p_limit: limit,
      p_worker: this.#name,
      p_kinds: kinds?.length ? kinds : null,
    });
    if (error) throw new Error('Could not claim jobs: ' + error.message);

    return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
      id: Number(r['id']),
      tenant_id: Number(r['tenant_id']),
      kind: r['kind'] as JobKind,
      payload: (r['payload'] ?? {}) as Record<string, unknown>,
      attempts: Number(r['attempts']),
      max_attempts: Number(r['max_attempts']),
    }));
  }

  async complete(id: number): Promise<void> {
    // `locked_by` is kept rather than cleared: on a finished job it records
    // which worker did it, which is the first thing anyone asks when a result
    // looks wrong.
    const { error } = await this.#db.from('onyx_jobs').update({
      status: 'done',
      locked_at: null,
      last_error: null,
      updated_at: new Date().toISOString(),
    }).eq('id', id);
    if (error) throw new Error('Could not complete the job: ' + error.message);
  }

  /**
   * Hands a job back, or gives up on it.
   *
   * Giving up is a state, not a deletion: an operator has to be able to see
   * what failed and why, and a queue that empties itself on failure looks
   * healthy while losing work.
   */
  async fail(job: Job, error: unknown): Promise<'retry' | 'failed'> {
    const message = error instanceof Error ? error.message : String(error);
    const exhausted = job.attempts >= job.max_attempts;
    const backoff = exhausted ? 0 : backoffSeconds(job.attempts);
    const { error: dbError } = await this.#db.from('onyx_jobs').update({
      status: exhausted ? 'failed' : 'queued',
      // Computed here for the same reason enqueue() computes run_after: the
      // alternative is a Postgres function for an otherwise-plain update, and the
      // backoff is measured in tens of seconds, so clock skew is immaterial.
      run_after: new Date(Date.now() + backoff * 1000).toISOString(),
      locked_at: null,
      locked_by: null,
      last_error: message.slice(0, 2000),
      updated_at: new Date().toISOString(),
    }).eq('id', job.id);
    if (dbError) throw new Error('Could not record the failure: ' + dbError.message);
    return exhausted ? 'failed' : 'retry';
  }

  /**
   * Returns jobs whose worker died mid-run.
   *
   * A process killed between claim and complete leaves a row stuck at
   * `running` forever. Nothing else notices, so this is swept on an interval.
   */
  async requeueStale(olderThanSeconds = 300): Promise<number> {
    // A per-row CASE decides whether a job that died holding the lock has any
    // attempts left, which PostgREST cannot express -- hence the function.
    const { data, error } = await this.#db.rpc('onyx_requeue_stale_jobs', {
      p_older_than_seconds: olderThanSeconds,
    });
    if (error) throw new Error('Could not requeue stale jobs: ' + error.message);
    return Number(data ?? 0);
  }

  /** For the operator view, and for tests that need to see the shape. */
  async stats(tenantId?: number) {
    // GROUP BY, in the database. Reading every row back to count them here would
    // be the wrong shape at any real volume.
    const { data, error } = await this.#db.rpc('onyx_job_stats', {
      p_tenant_id: tenantId ?? null,
    });
    if (error) throw new Error('Could not read the queue stats: ' + error.message);
    return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
      status: String(r['status']),
      kind: String(r['kind']),
      count: Number(r['count']),
    }));
  }
}

/**
 * Drains the queue until it is empty.
 *
 * Deliberately a loop rather than a daemon: the API process runs it on an
 * interval and the tests run it directly, so the same code path is what ships
 * and what is proven. `concurrency` claims that many jobs per pass, and each
 * pass is independent -- a handler that throws never stops the others.
 */
export async function drain(queue: QueueService, handlers: Record<string, JobHandler>, opts: {
  concurrency?: number;
  maxPasses?: number;
  kinds?: JobKind[];
  onError?: (message: string) => void;
} = {}): Promise<{ done: number; retried: number; failed: number }> {
  const concurrency = opts.concurrency ?? 4;
  const maxPasses = opts.maxPasses ?? 1000;
  let done = 0;
  let retried = 0;
  let failed = 0;

  for (let pass = 0; pass < maxPasses; pass += 1) {
    const jobs = await queue.claim(concurrency, opts.kinds);
    if (!jobs.length) break;

    await Promise.all(jobs.map(async (job) => {
      const handler = handlers[job.kind];
      if (!handler) {
        // An unknown kind is a deployment mistake, not a transient fault, so it
        // is recorded rather than retried into the ground.
        await queue.fail({ ...job, attempts: job.max_attempts }, 'no handler for ' + job.kind);
        failed += 1;
        return;
      }
      try {
        await handler(job);
        await queue.complete(job.id);
        done += 1;
      } catch (error) {
        const outcome = await queue.fail(job, error);
        if (outcome === 'failed') failed += 1; else retried += 1;
        opts.onError?.('job ' + job.id + ' (' + job.kind + ') failed: '
          + (error instanceof Error ? error.message : String(error)));
      }
    }));
  }

  return { done, retried, failed };
}
