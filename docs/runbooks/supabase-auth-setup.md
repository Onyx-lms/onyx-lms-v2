# Supabase Auth project setup

DOC-01-adjacent. Two one-time settings this migration needs that live on the
hosted Supabase project itself — a migration file can create the SQL side,
but only someone with dashboard/Management-API access to the project can
flip these, so they're recorded here rather than assumed done. See
`docs/ADR-011-supabase-auth-migration.md` for why any of this exists.

**Status: both done, 2026-08-14.** Applied via the Management API with a
personal access token the user provided for this one operation — not stored
anywhere in this repo or `.env`. Left below as the runbook for re-doing this
against a different project (a new environment, a project reset, etc).

Project ref: `abncsilvkhterszmjemm` (from `SUPABASE_PROJECT_REF` in `.env`).

---

## 1. Register the Custom Access Token Hook

**What you see if this is missing:** every Onyx tenant login succeeds
against Supabase Auth, but every subsequent API call gets 401/403 —
`requireOnyx()` sees a token with no `tenant_id` claim, the same "cannot be
scoped, so it is refused" behavior a token has always gotten when that claim
is absent. Platform-admin login shows the same symptom (no `platform`
claim). This is silent and safe (fails closed, per `onyx.custom_access_token_hook`'s
own comment) but the product is non-functional until the hook is wired up.

**What to do:**

1. Supabase Dashboard → this project → **Authentication → Hooks**.
2. Add hook → **Custom Access Token** → Postgres function.
3. Function: `onyx.custom_access_token_hook` (already created by
   `supabase/onyx/migrations/0015_auth_claims_hook.sql` — if it's not in the
   picker, that migration hasn't been applied against this project yet; run
   `node tools/onyx/apply.mjs 0015`).
4. Enable it.

Equivalent via the Management API (confirmed field names — live-checked
against a `GET` of this same endpoint before writing this, the Dashboard's
own toggle writes exactly these fields):

```
PATCH https://api.supabase.com/v1/projects/abncsilvkhterszmjemm/config/auth
Authorization: Bearer <management-api-token>
Content-Type: application/json

{
  "hook_custom_access_token_enabled": true,
  "hook_custom_access_token_uri": "pg-functions://postgres/onyx/custom_access_token_hook"
}
```

**How to confirm it's live:** sign in as any seeded account (e.g.
`admin@demo.onyx` / `Demo#2026!`), decode the returned access token's
payload (base64url, middle segment), and check for `tenant_id`/`tenant_role`
(tenant accounts) or `platform: true` (the platform-admin account,
`superadmin@onyx.platform` / `Platform#2026!`). Also confirmed the hook
stamps `user_id` (equal to `sub`) — GoTrue's own claims never carry this,
and every call site in this codebase reads `claims.user_id`; see
`0016_auth_claims_hook_user_id.sql` for why that's a separate migration
from `0015`.

---

## 2. OAuth Server Mode

Confirmed field names (`GET`/`PATCH` on the same `config/auth` endpoint as
above — the `GOTRUE_OAUTH_SERVER_*` env-var names in Supabase's own docs
map to these Management API fields, not literally themselves):

```
PATCH https://api.supabase.com/v1/projects/abncsilvkhterszmjemm/config/auth
Authorization: Bearer <management-api-token>
Content-Type: application/json

{
  "oauth_server_enabled": true,
  "oauth_server_allow_dynamic_registration": true,
  "oauth_server_authorization_path": "/oauth/authorize"
}
```

This turns on three real GoTrue endpoints, confirmed live via the project's
own OIDC discovery document
(`GET https://abncsilvkhterszmjemm.supabase.co/auth/v1/.well-known/openid-configuration`):

- `POST /auth/v1/oauth/clients/register` — Dynamic Client Registration
  (RFC 7591). Public, no auth required — any third-party app self-registers
  here directly. Nothing in this codebase calls it; it's GoTrue's own
  endpoint.
- `GET /auth/v1/oauth/authorize` — the delegated-consent authorization
  endpoint a registered client redirects a user to.
- `POST /auth/v1/oauth/token` — token exchange.

**Admin visibility** (`GET`/`DELETE /auth/v1/admin/oauth/clients[/:id]`,
service-role key) is what `packages/core/src/onyx/oauth-clients.service.ts`
wraps, exposed at `GET`/`DELETE /api/onyx/platform/oauth-clients[/:clientId]`
and rendered at `/onyx/platform/oauth-clients` — a platform admin's window
into what has registered, with the ability to revoke one. This is the whole
scope of what Onyx does with OAuth Server Mode today: nothing in the product
registers as a client or consumes one, since no third-party integration
exists yet to need it. Confirmed end-to-end live: registered a real test
client via the public endpoint, saw it appear on the admin page, revoked it
via the page, confirmed it was gone.
