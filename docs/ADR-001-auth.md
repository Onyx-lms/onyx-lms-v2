# ADR-001: Custom JWT auth instead of Supabase Auth

**Status:** Accepted (Sprint S00, task F-08)

## Context

The port must not change the database schema. Supabase Auth owns `auth.users`,
whose primary key is a **uuid**. Our `public.users.id` is a **bigint**, and it is
referenced by more than thirty tables (`courses.user_id`, `enrollments.user_id`,
`certificates.user_id`, ...). Credentials also already live in
`public.users.password` as Laravel bcrypt hashes, alongside `role`, `status` and
`remember_token`.

Adopting Supabase Auth would require either a new mapping column or a primary
key type change. Both are schema changes.

## Decision

Authenticate in the Node API against the existing `users` table, and sign our
own JWTs **with the Supabase JWT secret** so Postgres and PostgREST trust them.
Supabase provides Postgres, Storage and Realtime. It does not provide auth.

### Claim rules

| Claim | Value | Why it matters |
| --- | --- | --- |
| `role` | always `authenticated` | PostgREST runs `SET ROLE` from this claim. Putting `admin` here tries to switch to a Postgres role named `admin` and every request fails. |
| `app_role` | `admin` / `instructor` / `student` / `user` | The application role. Read by `onyx.current_app_role()`. |
| `user_id` | bigint | Read by `onyx.current_user_id()`. |
| `sub` | stringified id | Present for convention only. |

### `auth.uid()` must not be used

Supabase defines it as `(... ->> 'sub')::uuid`. Our ids are bigint, so it throws.
Every RLS policy reads `onyx.current_user_id()` instead. This is enforced in
`supabase/migrations/0003_rls.sql`.

## Password compatibility

PHP writes `$2y$`; bcryptjs accepts `$2a$`/`$2b$`/`$2x$`. They are the same
algorithm -- `$2y$` was PHP's tag after the 2011 crypt_blowfish fix. We normalise
the prefix before comparing, and emit `$2y$` when hashing so rows written by Node
stay byte-compatible with rows written by Laravel during a phased cutover.

Result: **every existing password keeps working. No resets, no migration.**

## Consequences

- No social login, MFA or magic links for free. Adding them later means either
  building them or migrating to Supabase Auth as a deliberate v2 (which needs the
  schema constraint lifted).
- Token revocation is our problem. Access tokens are short-lived; refresh lives
  in an httpOnly cookie.
- The service-role key must never reach the browser. See ADR-002.
