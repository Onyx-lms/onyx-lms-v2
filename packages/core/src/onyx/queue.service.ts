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
 * This class talks to Postgres directly rather than through PostgREST: the
 * claim is one statement whose atomicity is the point, and expressing it as
 * separate reads and writes would reintroduce exactly the race it prevents.
 */

/** The narrow slice of `pg` this needs, so tests can supply their own. */
export interface SqlRunner {
  query<R = Record<string, unknown>>(
    text: string, values?: unknown[],
  ): Promise<{ rows: R[]; rowCount: number | null }>;
}

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

export class QueueService {
  #sql: SqlRunner;
  #name: string;

  constructor(sql: SqlRunner, workerName = 'worker') {
    this.#sql = sql;
    this.#name = workerName;
  }

  async enqueue(input: EnqueueInput): Promise<number> {
    const { rows } = await this.#sql.query<{ id: string }>(
      `INSERT INTO public."onyx_jobs"
         ("tenant_id", "kind", "payload", "max_attempts", "run_after")
       VALUES ($1, $2, $3::jsonb, $4, now() + make_interval(secs => $5))
       RETURNING "id"`,
      [input.tenantId, input.kind, JSON.stringify(input.payload ?? {}),
        input.maxAttempts ?? 3, input.delaySeconds ?? 0],
    );
    return Number(rows[0]!.id);
  }

  /**
   * Takes up to `limit` jobs and marks them running, atomically.
   *
   * Everything about correctness under load lives in this one statement.
   */
  async claim(limit = 1, kinds?: JobKind[]): Promise<Job[]> {
    const kindFilter = kinds?.length ? 'AND j."kind" = ANY($3)' : '';
    const params: unknown[] = [limit, this.#name];
    if (kinds?.length) params.push(kinds);

    const { rows } = await this.#sql.query<Record<string, unknown>>(
      `UPDATE public."onyx_jobs" AS t
          SET "status" = 'running',
              "attempts" = t."attempts" + 1,
              "locked_at" = now(),
              "locked_by" = $2,
              "updated_at" = now()
        WHERE t."id" IN (
          SELECT j."id" FROM public."onyx_jobs" j
           WHERE j."status" = 'queued'
             AND j."run_after" <= now()
             ${kindFilter}
           ORDER BY j."id"
           FOR UPDATE SKIP LOCKED
           LIMIT $1
        )
        RETURNING t."id", t."tenant_id", t."kind", t."payload",
                  t."attempts", t."max_attempts"`,
      params,
    );

    return rows.map((r) => ({
      id: Number(r.id),
      tenant_id: Number(r.tenant_id),
      kind: r.kind as JobKind,
      payload: (r.payload ?? {}) as Record<string, unknown>,
      attempts: Number(r.attempts),
      max_attempts: Number(r.max_attempts),
    }));
  }

  async complete(id: number): Promise<void> {
    // `locked_by` is kept rather than cleared: on a finished job it records
    // which worker did it, which is the first thing anyone asks when a result
    // looks wrong.
    await this.#sql.query(
      `UPDATE public."onyx_jobs"
          SET "status" = 'done', "locked_at" = NULL,
              "last_error" = NULL, "updated_at" = now()
        WHERE "id" = $1`, [id]);
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
    await this.#sql.query(
      `UPDATE public."onyx_jobs"
          SET "status" = $2,
              "run_after" = now() + make_interval(secs => $3),
              "locked_at" = NULL, "locked_by" = NULL,
              "last_error" = $4, "updated_at" = now()
        WHERE "id" = $1`,
      [job.id, exhausted ? 'failed' : 'queued',
        exhausted ? 0 : backoffSeconds(job.attempts), message.slice(0, 2000)],
    );
    return exhausted ? 'failed' : 'retry';
  }

  /**
   * Returns jobs whose worker died mid-run.
   *
   * A process killed between claim and complete leaves a row stuck at
   * `running` forever. Nothing else notices, so this is swept on an interval.
   */
  async requeueStale(olderThanSeconds = 300): Promise<number> {
    const { rowCount } = await this.#sql.query(
      `UPDATE public."onyx_jobs"
          SET "status" = CASE WHEN "attempts" >= "max_attempts" THEN 'failed' ELSE 'queued' END,
              "locked_at" = NULL, "locked_by" = NULL,
              "last_error" = COALESCE("last_error", 'worker stopped without finishing'),
              "updated_at" = now()
        WHERE "status" = 'running'
          AND "locked_at" < now() - make_interval(secs => $1)`,
      [olderThanSeconds]);
    return rowCount ?? 0;
  }

  /** For the operator view, and for tests that need to see the shape. */
  async stats(tenantId?: number) {
    const { rows } = await this.#sql.query<{ status: string; kind: string; n: string }>(
      `SELECT "status", "kind", count(*)::text AS n FROM public."onyx_jobs"
        WHERE ($1::bigint IS NULL OR "tenant_id" = $1)
        GROUP BY "status", "kind"`, [tenantId ?? null]);
    return rows.map((r) => ({ status: r.status, kind: r.kind, count: Number(r.n) }));
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
