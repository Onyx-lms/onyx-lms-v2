/**
 * LAB-02b -- the worker that turns queued submissions into graded ones.
 *
 * Deliberately tiny. It maps a job kind to a service call and decides what
 * happens on the last failed attempt; everything else lives in QueueService
 * (claiming, retries, backoff) or CodeLabService (grading).
 *
 * The one judgement here: a submission whose job has exhausted its retries must
 * not sit at `queued` forever. A learner staring at a spinner that will never
 * resolve is worse than being told the grader is down, so the last attempt
 * marks the submission `failed` with the reason.
 */
import { drain, type Job, type JobHandler, type QueueService } from './queue.service.ts';
import { increment, observe } from './metrics.ts';
import type { CodeLabService } from './codelab.service.ts';

export interface CodeLabWorkerOptions {
  concurrency?: number;
  maxPasses?: number;
  onError?: (message: string) => void;
}

export function codeLabHandlers(codelab: CodeLabService, queue: QueueService): Record<string, JobHandler> {
  const evaluate: JobHandler = async (job: Job) => {
    const submissionId = Number(job.payload.submission_id);
    if (!submissionId) throw new Error('job ' + job.id + ' has no submission_id');

    try {
      await codelab.evaluate(job.tenant_id, submissionId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // Last attempt: stop the spinner and say why. Earlier attempts leave the
      // submission queued, because a retry may well succeed.
      if (job.attempts >= job.max_attempts) {
        await codelab.markFailed(job.tenant_id, submissionId, message);
      }
      throw error;
    }
  };

  void queue;
  return { 'code.run': evaluate, 'code.grade': evaluate };
}

/**
 * One pass of the worker. The API calls this on an interval and the tests call
 * it directly, so what ships is what is proven.
 */
export async function runCodeLabWorker(
  queue: QueueService, codelab: CodeLabService, opts: CodeLabWorkerOptions = {},
) {
  // Anything left `running` by a process that died is eligible again first --
  // otherwise it is invisible work that never completes.
  await queue.requeueStale();
  const started = Date.now();
  const result = await drain(queue, codeLabHandlers(codelab, queue), {
    concurrency: opts.concurrency ?? 4,
    maxPasses: opts.maxPasses ?? 1000,
    kinds: ['code.run', 'code.grade'],
    onError: opts.onError,
  });

  // SCL-03's acceptance criterion is "a failed grading run pages someone before
  // a learner reports it". These are the numbers that page: a non-zero rate on
  // failures, or a runs rate that falls to nothing.
  increment('onyx_grading_runs_total', undefined, result.done);
  increment('onyx_grading_failures_total', undefined, result.failed);
  if (result.done || result.failed) observe('onyx_grading_pass_ms', Date.now() - started);
  return result;
}
