# ADR-006: the Onyx foundation — a new product, tenant-scoped from the first migration

## Status

Accepted (Onyx O01). Supersedes the schema-parity constraint **for Onyx only**;
the Laravel port keeps it in full.

## Context

Two different products now live in this repository.

**The port** (sprints S00–S18) is a faithful migration of the Laravel LMS
"EZiL Certify" — a commercial marketplace: catalog, cart, gateways, blog,
workshops, tutor booking. Its governing rule has been exact schema parity with
the Laravel database: 61 tables, identical names, columns and order, verified on
every run by `npm run verify:parity`. Six tables were added beyond those 61, each
after asking, and each only because a Laravel model wrote to a table no migration
created.

**Onyx LMS** is the product described in the proposal at
`onyx.proposal.ezil.work` — an *institutional* platform: 25 requirements across
Learn, Code Lab, Assess, Career and Campus, delivered in four phases, multi-tenant,
targeting 1,000 learners.

Measured against those 25 requirements, the port supplies roughly three outright
(content delivery, certificates, discussion), eight in part, and fourteen not at
all. Onyx needs attendance, programs, semesters, batches, timetables, exams,
halls, seating, transcripts, placements, employers, jobs, hackathons, problems,
test cases, proctoring events, fee structures, guardians and tenants. **None of
those exist in the Laravel schema, and none can, because that schema is fixed by
the parity contract.**

Parity and Onyx are therefore mutually exclusive. That is the decision this ADR
records, along with the one architectural choice everything else depends on.

## Decision

### 1. Onyx is a new product that reuses the port's parts

Onyx does not extend the 61 ported tables. It gets its own schema, designed for
an institution rather than a marketplace.

What is reused is the code that was expensive to get right and is not
schema-shaped:

| Reused | Where it came from |
| --- | --- |
| Custom-JWT auth, role guards, scoped tokens | ADR-001, ADR-004 |
| Deny-all + FORCE RLS pattern and claim helpers | S01 |
| PHP-compatible JSON codec | ADR-002 (still needed for imported data) |
| Video player, watch tracking, progress and drip | S09, ADR-003 |
| Certificates with public verification | S10 — this *is* CAR-03 |
| Payments, gateways, idempotent fulfilment | S07, S08 — becomes CMP-03 |
| Messaging over Supabase Realtime | S12 |
| Jitsi sessions and the booking model | S13, S16 — becomes CAR-02 |
| The verification gate: parity, audit, unit, e2e, pooler fallback | throughout |

### 2. Onyx tables are prefixed `onyx_`, in `public`

The port owns `public` and must keep auditing at 61/61 tables and 580 columns.
Onyx tables sit alongside them as **`onyx_tenants`, `onyx_users`,
`onyx_memberships`, `onyx_audit_logs`**, and so on.

A dedicated `onyx_app` schema was built first and is the tidier design. It was
withdrawn during O01: **PostgREST only serves schemas the project is configured
to expose**, and the exposed-schema list is a project-wide setting on a live
Supabase project the port already depends on. Changing it via `supabase config
push` would have pushed a locally-generated config over the project's real
settings, so it was not done unilaterally. Everything through PostgREST failed
with `Invalid schema: onyx_app` until the tables moved.

What this costs, and what it does not:

- It costs tidiness. Two products share a namespace, kept apart by a prefix.
- It does **not** cost isolation. Tenant isolation is enforced by RLS policies
  and the `tenant_id` claim, neither of which depends on the schema name.
- It does not cost the port's gate: `db:audit` counts and reports Onyx tables
  separately, so the port still reads `RLS: enabled on 67/67 tables` and Onyx
  reads as its own line.

Reversing it is a rename plus one dashboard setting (Settings → API → Exposed
schemas), which is worth doing when Onyx moves to its own project. Nothing
crosses the boundary except the shared claim helpers in the `onyx` schema
(`onyx.current_user_id()`, `onyx.current_app_role()`, and now
`onyx.current_tenant_id()` and `onyx.assert_tenant_scoped()`).

### 3. Tenancy is in migration 0001, not retrofitted

CMP-05 is Phase 1 in the proposal, and it is foundational in the literal sense:
every table and every policy depends on it.

- A `tenants` table.
- **`tenant_id bigint NOT NULL` on every Onyx table**, from the first migration.
- Every RLS policy carries a tenant predicate, not only an ownership one.
- A `tenant_id` claim in the access token; `requireAuth` rejects a token without
  one.
- Roles are held per tenant in `memberships`, so one person can be a student at
  one institution and faculty at another.

The alternative — build single-tenant and add tenancy in Phase 4 — was
considered and rejected. It means revisiting every table, every policy and every
query written in between, at exactly the point where the system is largest and
carrying real institutional data.

## Consequences

- **`verify:parity` continues to guard the port and says nothing about Onyx.**
  Onyx needs its own structural check; a cross-tenant isolation test in the gate
  is the equivalent guarantee (task SEC-01), and it is worth more here than
  column-order parity ever was.
- **Two products, one repository.** The port keeps `apps/api` and `apps/web` and
  its green gate. Onyx code is namespaced alongside it and shares `packages/core`.
  If the two ever need to ship separately, the split is along the `onyx_` table
  prefix and the namespaced directories.
- **The Laravel data is not Onyx's data.** There is no automatic migration path
  from a marketplace course catalog to programs, semesters and batches. Any
  import is a discovery-time mapping exercise, not a schema translation.
- **The two products share one web origin and must not share a session.** Onyx
  uses its own cookie (`onyx_tenant_session`), the shared proxy picks the cookie
  by path, and the root layout renders the port's storefront header and footer
  only outside `/onyx` -- an institutional platform must not wear another
  product's branding.
- **Queues are a real gap.** The proposal puts grading, proctoring and
  notifications "through queues"; the port is synchronous throughout. Nothing in
  the reuse list helps here. It is scheduled as LAB-02b and SCL-01 rather than
  assumed, and the provider is a discovery decision.

## What this does not decide

Deliberately left open, because the proposal itself defers them to discovery:
the code execution provider (self-hosted Judge0 or otherwise), the queue
technology, the proctoring capture and storage approach, hosting, and whether
each institution eventually gets its own database rather than a shared one with
row-level isolation. The tenancy model above works under either answer to that
last question, which is why it is safe to build on now.
