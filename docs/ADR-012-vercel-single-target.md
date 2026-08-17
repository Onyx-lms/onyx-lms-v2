# ADR-012: one deploy target — Vercel in front, Supabase behind

## Status

Accepted for Onyx LMS **v2** (this repository). Does not apply to v1
(`github.com/Onyx-lms/onyx-lms-v1`), which keeps the Render-hosted API and is
frozen.

## Context

v1 runs as two deployables: the Next.js web app on Vercel and a Fastify API on
Render. The API is on Render's **free plan**, which spins the service down after
15 minutes idle and CPU-throttles it while awake. Every API call pays that tax,
and a first call after idle pays a 30–60 second cold start. Measured on the
deployed v1: login-to-dashboard was 4.0s (admin) to 7.3s (student) with a *warm*
backend, and the dominant cost was the hop itself, not the work.

A separate change had already removed the other half of the problem — the
dashboard's per-course fetch fan-out, which was making 39–41 backend calls to
render one page (now 15). What remained was structural: two deployables, and one
of them slow by plan.

The goal for v2 is therefore **one deploy target**. Not "no server" — see below,
that turns out to be impossible for this product — but no *separately hosted*
server.

## Decision

**The Fastify API is absorbed into the Next.js app on Vercel. Render is removed.
Supabase remains the only other hosted dependency.**

```
Browser
  ├── Supabase SDK ─────────────► Supabase   (Realtime, and reads RLS covers)
  └── Next.js on Vercel ────────► Supabase   (service role; holds every secret)
         └── Vercel Cron ───────► itself     (background jobs)
```

`render.yaml` is deleted. `vercel.json` is the only deployment descriptor.

### What made this affordable

`packages/core` — 13,149 lines across 24 services — has **no Fastify
dependency**. It takes an injected Supabase client and its auth guards take a
plain `{ headers, cookies }` object. And of 574 route handlers, **288 of 293
Onyx handlers never touch Fastify's `reply`**; they return a value. Total `reply`
usage across both products is ~22 call sites.

So the business logic is *reused*, not rewritten, and the route files are
imported behind a small Fastify-shaped shim rather than hand-ported. That is the
only reason full feature parity across both products (Onyx LMS and the Laravel
port) is a realistic scope rather than a multi-month rewrite.

## What this is NOT

**It is not a "no backend" architecture, and it is not RLS-as-authorization.**
Both are tempting readings and both are wrong.

Six integrations hold secrets that must never reach a browser:

| | Why it cannot be client-side |
|---|---|
| Judge0 sandbox | auth token; the `enable_network: false` resource contract |
| 8 payment gateways | tenant-configured secret API keys |
| Payment webhooks | the gateway POSTs to a public URL; no browser is involved |
| SMTP | mailer credentials |
| Supabase Auth Admin | service-role key (account/tenant provisioning) |
| Attendance QR | per-session HMAC secret — in a browser, a student could mint valid check-in codes from home |

And authorization stays in the service layer. `assertCanTeach` ("faculty *of this
course*"), `requireCourseManager`, `assertCanScheduleExam` (which reads a tenant
setting), guardian consent scoping, and `forLearner()`'s grade-hiding are rules
RLS cannot express without a per-row join, or cannot express at all.
`platform.service.ts` (1,731 lines) operates across *every* tenant with no tenant
claim and is structurally incompatible with RLS by design.

**RLS is defense-in-depth here, not the gate.** It matters for exactly one threat:
the browser holds an anon key plus a user JWT (it must, for Realtime), so it can
reach PostgREST directly. Closing that is worthwhile. It is not the same as "the
database now enforces authorization", and anyone who reads it that way will
eventually delete a service-layer check because "RLS covers it". It does not.

Usefully, the existing migrations already `ENABLE` and `FORCE` RLS on all 80
Onyx tables while defining only SELECT policies — and `service_role` carries
`BYPASSRLS`. So writes by `authenticated` are *already* denied, and every policy
added later is additive and reversible, provided no migration touches table
grants or ownership.

## Consequences

### Accepted costs

- **The 2-second grading worker cannot be reproduced.** Vercel Cron's floor is
  one minute (Pro) or once per day (Hobby, where a `* * * * *` expression fails
  at deploy time). Grading becomes "immediately, via `after()`, with cron as the
  retry net". Median latency is as good or better than v1's; the **tail is
  worse** — a failed in-request pass waits for the next cron tick.
- **25 MB uploads must change shape.** Vercel caps request *and* response bodies
  at 4.5 MB. The two upload endpoints become browser → Supabase Storage direct
  via a signed upload URL, then a small "register" POST. Five export endpoints
  (CSV/PDF) must stream, which is exempt from the response cap.
- **Two in-memory subsystems do not survive serverless.** The login rate limiter
  (`MemoryRateLimitStore`) becomes ineffective across instances — a security
  regression, so it moves to a Supabase-backed store via the existing
  `RateLimitStore` interface. `/metrics`' process-local counters return
  near-empty scrapes; the endpoint is removed rather than left to lie during an
  incident.
- **`pg` leaves the request path.** A `pg.Pool` per serverless instance would
  exhaust Supabase's pooler. `QueueService.claim()` is the only method needing
  raw SQL (`FOR UPDATE SKIP LOCKED`); it becomes a Postgres function called via
  `.rpc()`. `pool.ts` stays for local tooling.
- **Performance is not a blanket win.** Removing the Render hop is a large win
  and is the point. But a read moved into the browser travels from the user's
  device to Mumbai rather than Singapore to Mumbai, and RLS policies are
  evaluated per row. Reads stay in Server Components by default.

### Rejected alternative

**Pure browser → Supabase, no server code at all.** This was the original
proposal. It fails on the six secret-holding integrations above and on the two
scheduled jobs, and it would have required dropping the code sandbox, payments,
email, and QR attendance. Keeping server code *on Vercel* costs nothing against
the actual goal, because the goal was one deploy target, not zero servers.

## v2's own project

v2 uses a **separate Supabase project** (`pnhsnpxrxxphgjmrqoia`, `ap-south-1`),
not v1's (`abncsilvkhterszmjemm`, also `ap-south-1`). v2's RLS work applies DDL
across 141 tables; doing that to the database v1 serves is not defensible. Same
region deliberately, so any latency comparison between v1 and v2 measures the
architecture rather than the distance.

The Custom Access Token Hook is registered from `supabase/config.toml` via
`supabase config push`, not clicked in the dashboard. ADR-011 recorded that step
as "outside repo control"; it no longer is. Note the caveat written into that
file: `config push` has no `pull` or `diff` counterpart and resets unspecified
keys to CLI defaults — the first push silently loosened an email rate limit,
which is why every value there is now explicit.
