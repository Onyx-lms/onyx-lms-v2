# ADR-011: Migrate Onyx auth to Supabase Auth

**Status:** Accepted (auth migration, 2026-08)

## Context

ADR-001 deliberately rejected Supabase Auth for the Laravel port, and Onyx
(ADR-006) inherited the same custom-JWT design: the app authenticates
against its own `onyx_users` table and signs its own JWTs with the Supabase
JWT secret, so PostgREST/RLS still trust them. That decision was made
specifically because `auth.users.id` is a uuid and `onyx_users.id` was a
bigint referenced by 54 tables — re-keying all of them was judged too
invasive for the sprint that shipped Onyx's foundation. ADR-001's own
Consequences section named the alternative outright: "migrating to Supabase
Auth as a deliberate v2."

This is that v2, undertaken deliberately: replace Onyx's login with real
Supabase Auth (`auth.users`, GoTrue-issued sessions), rewrite RLS to match,
and additionally enable Supabase's OAuth Server Mode so Onyx can act as an
OAuth 2.1/OIDC provider for future third-party clients. At the time this
started, all Onyx tenant data was seed/demo data rather than live
institutions, which shaped several decisions below toward directness over
the more elaborate live-cutover choreography a production migration would
need.

The legacy Laravel-port auth (`packages/core/src/auth/*`, table `users`,
cookie `onyx_session`) is explicitly **out of scope**. It is a structurally
different, drifted schema serving a different product in the same repo;
folding it in would roughly double the blast radius for something this
migration wasn't asked to touch. It stays on custom JWTs.

## Decision

### Full UUID re-key, not a bridging column

`onyx_users.id` became `uuid`, set equal to `auth.users.id` (Supabase's
standard "profile row" pattern). All 54 dependent tables' bigint FK columns
(69 column instances — `user_id`, `*_by`, `guardian_user_id`, `author_id`,
`actor_id`, `faculty_id`, `marker_id`, `interviewer_id`, `owner_id`, etc.)
were converted in place. Column *names* were preserved throughout — only
types changed — which is what let every RLS policy body stay untouched.

Rejected: a bridging `auth_user_id uuid` column added to `onyx_users` while
keeping bigint as the real PK. That defers the hard problem rather than
avoiding it — every RLS check would need a permanent per-row translation
join from `auth.uid()` to the bigint id, forever, and OAuth Server Mode's
delegated tokens (real `auth.users` uuids) would pay the same tax. A full
re-key is disruptive once; a bridge is a tax paid indefinitely.

### Migration sequence (generated, not hand-maintained)

`tools/onyx/gen_uuid_migration.mjs` introspects the live schema (every
bigint FK into `onyx_users(id)`, every RLS policy with a hard `pg_depend`
dependency on a column being changed) and emits the migrations from that,
rather than a hand-typed list that would drift the moment a new table
landed. Four migrations:

- `0013_auth_uuid_columns.sql` — additive: a uuid twin column next to every
  bigint identity column, zero behavior change.
- `tools/onyx/provision-auth-users.mjs` — creates a real `auth.users` row
  (Supabase Admin API — `auth.users` is GoTrue-owned, never written to
  directly) for every existing `onyx_users` row, then backfills the uuid
  twins.
- `tools/onyx/validate-uuid-backfill.mjs` — the go/no-go gate: count parity
  and referential integrity between old and new columns, non-zero exit on
  any mismatch. Must pass before the next step.
- `0014_auth_uuid_cutover.sql` — destructive: drops every old bigint column,
  promotes each uuid twin in its place, restores nullability/FK/unique/index
  metadata (introspected from the columns being replaced, not re-declared).
  **Also drops and recreates the RLS policies that hold a hard dependency on
  a column being changed** — discovered live, not assumed: Postgres tracks
  policy-to-column dependencies via `pg_depend`, and `DROP COLUMN` fails
  outright if any policy depends on it. 25 policies needed this (24 that
  call the swapped claim helper below, plus `users_same_tenant_read`, which
  depends on `onyx_memberships.user_id` and `onyx_users.id` directly with no
  claim-function call at all — a plain text search for the helper's name
  would have missed it, which is why the generator uses `pg_depend`
  instead).
- `0015_auth_claims_hook.sql` — the Custom Access Token Hook (below).

### `onyx.current_user_id()` is shared with the legacy port — not touched

The single biggest correction to the original plan, found live: Postgres
refuses to change a function's return type in place while any policy
depends on it (`DROP FUNCTION ... CASCADE` would delete the dependent
policies), confirmed against this project before committing to an
approach. Worse, `onyx.current_user_id()` turned out not to be Onyx-only —
it's also load-bearing for the legacy port's own RLS (`cart_items`,
`wishlists`, `messages`, `quiz_submissions`, etc., all still bigint-keyed
against the port's separate `users` table).

So it was left **entirely untouched**. A new function,
`onyx.current_auth_user_id()` (`RETURNS uuid ... SELECT auth.uid()`), was
added instead, and only the 25 Onyx-table policies that used the old one
were dropped and recreated against the new one. The port's policies keep
calling the original, unaffected. `onyx.current_tenant_id()` and
`onyx.current_app_role()` were untouched outright — tenant ids weren't
re-keyed, and no Onyx policy uses `current_app_role()` (confirmed by grep;
it's the port's).

### Custom Access Token Hook carries tenant scope

GoTrue has no native concept of Onyx's tenancy. `onyx.custom_access_token_hook()`
(a `SECURITY DEFINER` Postgres function — `onyx_memberships`/
`onyx_platform_admins` are FORCE RLS, deny-all to `authenticated`, and
`supabase_auth_admin` has no policy granting it anything, so without
`SECURITY DEFINER` the hook would see zero rows) is registered with the
project (Authentication → Hooks — a hosted-project dashboard/Management-API
setting; see `docs/runbooks/supabase-auth-setup.md`) and runs on every
token GoTrue mints, sign-in and refresh alike:

- Checks `onyx_platform_admins` first; if present, stamps `platform: true`
  and nothing else — same "different shape, not a wider one" guarantee
  `packages/core/src/onyx/auth.ts` always documented.
- Otherwise reads an `active_tenant_id` pointer from
  `auth.users.raw_app_meta_data` (service-role-writable only, never
  client-writable) and resolves `tenant_id`/`tenant_role` fresh against
  `onyx_memberships` at every mint — a role change or removal takes effect
  on the next refresh, not the next login.
- No resolvable membership: no `tenant_id` claim. RLS already treats that as
  "read nothing" — the same "reject rather than default" posture
  `requireOnyx()` always had.

### Login and tenant-switching became multi-step

`TenancyService.signIn()`: sign in (checked first, generic failure message
either way — preserves "which emails exist is not public") → resolve/point
`active_tenant_id` at the chosen membership → `refreshSession()` so the hook
re-fires with the pointer now set. The first-minted token (before the
pointer was set) is deliberately discarded in favour of the refreshed one.
`switchTenant()` follows the same shape but needs the caller's own refresh
token — nothing can mint a token unilaterally anymore, only GoTrue can, in
exchange for a valid refresh token — so `POST /api/onyx/auth/switch`'s
request body grew a `refresh_token` field.

### Verification: JWKS, not a shared secret

Confirmed live against the project (`{SUPABASE_URL}/auth/v1/.well-known/jwks.json`)
before writing any verification code: this project signs with ES256, not
HS256. `packages/core/src/onyx/auth.ts` verifies via `jose`'s
`createRemoteJWKSet()` against that endpoint. Verification is now
inherently asynchronous (cryptographic verification in `jose` always is,
regardless of key type) — `requireOnyx()`/`requireOnyxRole()`/
`requirePlatformAdmin()` became `async`, which is the one call-signature
change that did ripple outward, to every route handler that calls them
(~250 call sites, all mechanical: add `await`).

`issueOnyxToken()`/`issuePlatformToken()` no longer exist — nothing signs
its own tokens anymore. `OnyxTokenClaims.user_id`/`PlatformTokenClaims.user_id`
changed type from `number` to `string` (a real uuid), which is what
surfaced every other place in the codebase — service methods, route
handlers — that held a person's id as a `number` and needed the same
change. `assertUsableOnyxClaims()` was split out of `requireOnyx()` as a
pure function specifically so the claim-shape validation stays
unit-testable without a real GoTrue-signed token, which nothing outside
GoTrue can forge.

### Password migration

No forced reset was attempted or needed: since all data was seed/demo data,
every provisioned `auth.users` row was created with the password already
documented elsewhere in the repo for that account
(`tools/screenshot-roles.mjs`, `docs/roles/*.md`: `Demo#2026!` for every
`*@demo.onyx` account; the one platform-admin fixture
`tests/e2e/harness.ts` hardcodes kept its own `Platform#2026!`). A real
production cutover would instead need a proactive password-reset
communication, since Supabase Auth doesn't accept an externally-hashed
bcrypt value through its standard API.

## Consequences

- Every service method that takes a person's id as a parameter needed its
  type changed from `number` to `string`, plus every `Number(...)`/`num(...)`
  cast on such a value fixed (a uuid through `Number()` silently produces
  `NaN` — a runtime bug the type checker cannot catch on its own; each had
  to be read and judged, not blindly replaced).
- The legacy Laravel-port product is now the only thing left on custom
  JWTs — a real, visible inconsistency, deliberately not resolved here (see
  Context).
- OAuth Server Mode is live (enabled via the Management API, confirmed via
  the project's own OIDC discovery document) and additive on top of this: a
  delegated third-party token is, underneath, a session for an
  already-authenticated `auth.users` row, so it flows through the exact
  same `onyx.current_auth_user_id()`-based RLS and the same Custom Access
  Token Hook as first-party login. Nothing new was needed in RLS for it.
  `packages/core/src/onyx/oauth-clients.service.ts` gives a platform admin
  visibility into what's registered (`/onyx/platform/oauth-clients`) and
  the ability to revoke a client — nothing in Onyx itself registers as a
  client or consumes one, since no third-party integration exists yet to
  need it. Verified end-to-end live (register → appears on the admin page
  → revoke → confirmed gone).
- `tools/onyx/gen_uuid_migration.mjs`, `provision-auth-users.mjs`, and
  `validate-uuid-backfill.mjs` are reusable if a future migration needs the
  same additive-column/backfill/validate/cutover shape again.
