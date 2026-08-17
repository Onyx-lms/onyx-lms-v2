# Runbook

DOC-01 / DR-01 / SCL-03. For whoever is on call. Each section is "what you see",
then "what to do", in that order — nobody reads background at 3am.

---

## Is it up?

```bash
curl -s http://127.0.0.1:4000/health | jq
```

```json
{ "status": "up", "uptime_seconds": 812, "checks": [ { "name": "database", "ok": true, "ms": 41 } ] }
```

`status` is `up` or `degraded`, and a degraded answer is HTTP **503** so a load
balancer can act on it without parsing the body. `degraded` means the process is
answering but a dependency is not — the check that failed is named.

It deliberately does not say `down`. A process cannot report its own death; that
is what the absence of a response is for.

---

## Metrics

```bash
curl -s http://127.0.0.1:4000/metrics
```

Prometheus text format. Scrape it; do not put a token on it — an authenticated
metrics endpoint is how a monitoring stack ends up not monitoring. It carries no
personal data. Bind it to a private interface in deployment.

### What to alert on

| Alert | Expression | Why |
| --- | --- | --- |
| **Grading is failing** | `rate(onyx_grading_failures_total[5m]) > 0` | SCL-03's acceptance criterion, exactly: pages somebody before a learner reports it. |
| **Grading has stopped** | `rate(onyx_grading_runs_total[15m]) == 0` while submissions exist | A worker that has died looks identical to a quiet afternoon. Pair it with queue depth. |
| **A payment failed** | `rate(onyx_payment_failures_total[5m]) > 0` | Money a learner believes they have paid. Never expected; always page. |
| **Proctoring is dropping events** | `rate(onyx_proctor_failures_total[5m]) > 0` | An integrity timeline with holes in it is worse than none, because it looks complete. |
| **Notifications are not landing** | `rate(onyx_notification_failures_total[15m]) > 0` | `stage="email"` is usually SMTP; `stage="write"` is the database and is serious. |
| **The API is erroring** | `rate(onyx_http_errors_total[5m]) > 0.05 * rate(onyx_http_requests_total[5m])` | 5xx only. 4xx is people, not the server. |
| **Requests are slow** | `histogram_quantile(0.95, onyx_http_duration_ms_bucket) > 3000` | Above this, an assessment autosave starts feeling like a hang. |

---

## The API keeps dying

**Known, and unresolved.** During full end-to-end runs the process has
disappeared mid-run, at a different endpoint each time, leaving nothing on
stdout or stderr.

What has been ruled out:

- **Not an unhandled exception or rejection.** `server.ts` installs handlers for
  both that log `fatal` and then exit; across repeated runs they have never
  fired.
- **Not a V8 heap OOM.** That prints `FATAL ERROR: ... heap out of memory`, and
  it does not appear.

That leaves the process being killed from outside — a supervisor, the OS, or a
container limit. If you hit it:

1. `journalctl -k | grep -i oom` (Linux) or check the container's OOM kill count.
2. Check whatever restarts the process is not also killing it (health check
   timeouts too tight against a slow database will do exactly this — `/health`
   now reaches the database, so a slow database makes it slow).
3. `ONYX_WORKER_INTERVAL_MS=0 ONYX_EXPIRY_SWEEP_MS=0` disables both background
   loops. If it stops dying, the fault is in one of them.

No learner data is at risk when it happens: the queue is durable, and an
abandoned assessment attempt is swept closed when the process comes back.

---

## Restoring an institution's records

DR-01. Rehearse this before you need it.

```bash
# Take one
node tools/db/backup.mjs --tenant demo-university --out backups/

# Prove the file is good -- reads it back, checks every table and row count
node tools/db/backup.mjs --verify backups/demo-university-<stamp>.json

# Put it somewhere
node tools/db/backup.mjs --restore backups/demo-university-<stamp>.json --into demo-university
```

Restoring refuses to write into a tenant that already has data unless you pass
`--force`, because the failure mode of a careless restore is silently merging two
institutions' records.

**A backup nobody has restored is a hope.** Run `--verify` on every backup and a
full `--restore --into` into a scratch slug at least once a quarter; record the
date and how long it took. That measurement is your RPO and RTO — anything else
is an assumption.

---

## The sandbox

Code Lab returns an error when `ONYX_JUDGE0_URL` is unset. That is deliberate:
nothing in this repository will ever run learner code locally as a fallback.

```bash
docker compose -f deploy/judge0/docker-compose.yml up -d
ONYX_JUDGE0_URL=http://127.0.0.1:2358 node tools/onyx/verify-sandbox.mjs
```

The verifier submits a fork bomb, an infinite loop, an allocation bomb, a
network call and a read of `/etc/shadow`, and refuses to certify a host that does
not stop all five. Run it after any kernel upgrade — cgroup v2 silently stops
`isolate` enforcing limits, and a container that is running is not a container
that is isolating.

---

## Sign-in and sign-up are CPU-bound

Measured, not theorised. Creating accounts at concurrency 100 produced a request
that took **132 seconds** and a 500 immediately after it; at concurrency 10 the
same work is steady.

The cause is bcrypt. `bcryptjs` is a pure-JavaScript implementation, so hashing
runs on the main thread rather than the libuv threadpool — it yields between
rounds, so it does not block outright, but a hundred concurrent hashes still
saturate one core and everything else queues behind them. Cost 10 is not
negotiable: it is what the Laravel original wrote, and lowering it would
invalidate every existing password hash.

What this means in practice:

- **Reads and autosaves are unaffected.** Those are I/O-bound, which is why the
  paths SCL-02 actually names behave nothing like this.
- **A sign-in rush is the limit to plan for** — a cohort arriving at 09:00, not
  a cohort working. Scale horizontally: hashing is per-process CPU, so two
  instances is genuinely twice the capacity.
- **Bulk account creation should be paced.** The load test seeds ten at a time
  for exactly this reason.

If this becomes the binding constraint, the fix is moving hashing to
`worker_threads` or swapping to the native `bcrypt` binding — both real pieces
of work, neither yet needed.

---

## Load

```bash
node --env-file=.env tools/onyx/load-test.mjs --learners 1000 --concurrency 100
```

Seeds a throwaway institution, drives sign-in, dashboard reads and autosave
writes at the stated concurrency, reports p50/p95/p99, and deletes everything it
made.

Run it **from a host with production's network shape**. Run from a laptop against
a database in another region it measures the laptop's route, not the product.

### The measurement on record

One API process, a Supabase database in `ap-northeast-1`, driven from a laptop
in India — so the latency below is dominated by that route and is a floor, not a
ceiling.

| | |
| --- | --- |
| Learners | **1,000**, all signed in |
| Sign-in rush | 85s for all 1,000 (12/s) |
| Throughput, working | **373 req/s** |
| Errors | **0** |
| Read latency | p50 317ms · p95 1,779ms · p99 2,840ms |
| Write latency | p50 152ms · p95 290ms · p99 403ms |
| Login latency | p50 8.4s · p95 10.6s — bcrypt, see above |

Writes are the tightest of the three, which is the right way round: an
assessment autosave is the thing a learner notices. Login is an order of
magnitude slower than everything else and is CPU, not the database.

Re-run this after any change to hashing, the queue, or the database's region,
and replace the table. A number with no date on it is a number nobody should
act on — this one is from **11 August 2026**.
