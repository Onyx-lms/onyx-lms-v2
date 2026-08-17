/**
 * SCL-03 -- observability.
 *
 * "Structured logging, metrics, uptime checks and alerting on grading,
 * proctoring and payment failures", against an acceptance criterion of "a
 * failed grading run pages someone before a learner reports it".
 *
 * There was none. The API logged requests and nothing counted anything, so the
 * only way to learn that grading had stopped working was a learner saying so --
 * and the process disappearing mid-run during development was invisible for
 * exactly the same reason.
 *
 * **Why this rather than a client library.** Prometheus text format is a
 * documented line protocol, and what is needed here is four counter types and a
 * pair of histograms. Adding an instrumentation SDK to a two-dependency
 * repository to emit `name{label="x"} 42` would be the tail wagging the dog.
 * `/metrics` speaks the format every scraper already reads, so this composes
 * with real infrastructure without being it.
 *
 * **Counters only reset on restart.** No windows, no decay, no in-process
 * aggregation beyond a total: a counter that resets is a counter a scraper can
 * reason about (`rate()` handles the rest), and one that quietly forgets is a
 * counter that lies during an incident.
 */

/** The things worth alerting on, named by the requirement. */
export type MetricName =
  | 'onyx_grading_runs_total'
  | 'onyx_grading_failures_total'
  | 'onyx_proctor_events_total'
  | 'onyx_proctor_failures_total'
  | 'onyx_payments_total'
  | 'onyx_payment_failures_total'
  | 'onyx_attempts_expired_total'
  | 'onyx_workspace_runs_total'
  | 'onyx_workspace_run_failures_total'
  | 'onyx_notifications_total'
  | 'onyx_notification_failures_total'
  | 'onyx_http_requests_total'
  | 'onyx_http_errors_total';

const HELP: Record<MetricName, string> = {
  onyx_grading_runs_total: 'Code Lab submissions taken off the queue and graded.',
  onyx_grading_failures_total: 'Grading passes that failed. Alert on any rate above zero.',
  onyx_proctor_events_total: 'Proctoring events recorded during assessments.',
  onyx_proctor_failures_total: 'Proctoring events that could not be recorded.',
  onyx_payments_total: 'Payments settled, by whichever path got there first.',
  onyx_payment_failures_total: 'Payments that failed to settle. Alert on any.',
  onyx_attempts_expired_total: 'Abandoned assessment attempts closed by the sweep.',
  onyx_workspace_runs_total: 'Workspace files run through the sandbox, outside grading.',
  onyx_workspace_run_failures_total: 'Workspace runs the sandbox itself could not complete.',
  onyx_notifications_total: 'Notifications raised.',
  onyx_notification_failures_total: 'Notifications that could not be written or sent.',
  onyx_http_requests_total: 'Requests served.',
  onyx_http_errors_total: 'Requests answered with a 5xx.',
};

const counters = new Map<string, number>();

/**
 * Every counter starts at zero, present.
 *
 * A Prometheus counter does not exist until something increments it, so an
 * alert written against `onyx_payment_failures_total` has nothing to attach to
 * until the first payment fails -- and "no data" and "no failures" look
 * identical on a dashboard. Seeding them means every alert in the runbook is
 * armed from the moment the process starts, which is the only time it matters.
 *
 * Only the unlabelled series can be seeded; a labelled one cannot be enumerated
 * in advance, which is why the alert expressions use the bare name.
 */
for (const name of Object.keys(HELP)) counters.set(name, 0);
/** Bucket upper bounds in milliseconds. A classroom cares about seconds. */
const BUCKETS = [50, 100, 250, 500, 1000, 2500, 5000, 10_000, 30_000];
const histograms = new Map<string, { counts: number[]; sum: number; total: number }>();

/** `name{a="1",b="2"}` -- the series key, with labels in a stable order. */
function series(name: string, labels?: Record<string, string>): string {
  if (!labels || !Object.keys(labels).length) return name;
  const pairs = Object.entries(labels)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => k + '="' + String(v).replace(/["\\\n]/g, '') + '"');
  return name + '{' + pairs.join(',') + '}';
}

export function increment(name: MetricName, labels?: Record<string, string>, by = 1): void {
  const key = series(name, labels);
  counters.set(key, (counters.get(key) ?? 0) + by);
}

/** Records a duration. Used for request latency and for a grading pass. */
export function observe(name: string, ms: number, labels?: Record<string, string>): void {
  const key = series(name, labels);
  const h = histograms.get(key) ?? { counts: new Array(BUCKETS.length + 1).fill(0), sum: 0, total: 0 };
  let i = BUCKETS.findIndex((b) => ms <= b);
  if (i === -1) i = BUCKETS.length;
  h.counts[i] = (h.counts[i] ?? 0) + 1;
  h.sum += ms;
  h.total += 1;
  histograms.set(key, h);
}

/**
 * Everything, in Prometheus text format.
 *
 * The `# HELP` lines are not decoration: they are what somebody reading a
 * dashboard at 3am uses to work out whether the number in front of them is the
 * one they should be worried about.
 */
export function renderMetrics(): string {
  const lines: string[] = [];
  const emitted = new Set<string>();

  for (const [key, value] of [...counters.entries()].sort()) {
    const name = key.split('{')[0]!;
    if (!emitted.has(name)) {
      emitted.add(name);
      const help = HELP[name as MetricName];
      if (help) lines.push('# HELP ' + name + ' ' + help);
      lines.push('# TYPE ' + name + ' counter');
    }
    lines.push(key + ' ' + value);
  }

  for (const [key, h] of [...histograms.entries()].sort()) {
    const name = key.split('{')[0]!;
    const labels = key.includes('{') ? key.slice(key.indexOf('{') + 1, -1) : '';
    if (!emitted.has(name)) {
      emitted.add(name);
      lines.push('# TYPE ' + name + ' histogram');
    }
    let cumulative = 0;
    BUCKETS.forEach((bound, i) => {
      cumulative += h.counts[i] ?? 0;
      const le = 'le="' + bound + '"';
      lines.push(name + '_bucket{' + (labels ? labels + ',' : '') + le + '} ' + cumulative);
    });
    cumulative += h.counts[BUCKETS.length] ?? 0;
    lines.push(name + '_bucket{' + (labels ? labels + ',' : '') + 'le="+Inf"} ' + cumulative);
    lines.push(name + '_sum' + (labels ? '{' + labels + '}' : '') + ' ' + h.sum);
    lines.push(name + '_count' + (labels ? '{' + labels + '}' : '') + ' ' + h.total);
  }

  return lines.join('\n') + '\n';
}

/**
 * What `/health` reports beyond "the process is up".
 *
 * A liveness check that only proves the event loop is turning is a check that
 * stays green while every write fails. This one is asked to reach the database,
 * because that is the dependency whose absence makes the product useless.
 */
export interface HealthReport {
  status: 'up' | 'degraded';
  ts: string;
  uptime_seconds: number;
  checks: { name: string; ok: boolean; ms: number; detail?: string }[];
}

export async function health(
  probes: { name: string; run: () => Promise<unknown> }[],
  now = Date.now,
): Promise<HealthReport> {
  const checks: HealthReport['checks'] = [];
  for (const probe of probes) {
    const started = now();
    try {
      await probe.run();
      checks.push({ name: probe.name, ok: true, ms: now() - started });
    } catch (e) {
      checks.push({
        name: probe.name, ok: false, ms: now() - started,
        detail: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return {
    // Degraded, not down: the process is answering, and saying "down" from
    // inside it would be a claim it cannot make. A load balancer wants the
    // difference; so does whoever is deciding whether to page somebody.
    status: checks.every((c) => c.ok) ? 'up' : 'degraded',
    ts: new Date(now()).toISOString(),
    uptime_seconds: Math.round(process.uptime()),
    checks,
  };
}

/** Test-only. Nothing in the application resets a counter. */
export function resetMetrics(): void {
  counters.clear();
  histograms.clear();
}
