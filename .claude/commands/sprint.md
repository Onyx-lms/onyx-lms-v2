---
description: Implement the next sprint from the migration plan, end to end
argument-hint: [sprint id, e.g. S13]
allowed-tools: Bash, Read, Write, Edit, Grep, Glob, TodoWrite
---

Implement sprint **$1** from `MIGRATION_SPRINT_PLAN.csv` in the Laravel checkout
(`$LARAVEL_ROOT`, default `../TT002-LEO-LMS`), following the process
the earlier sprints established. Read `CLAUDE.md` first if it is not already in
context.

**Before writing anything**, for each task in the sprint:

1. Read the Laravel controllers and models named in the `Laravel_Reference`
   column, and the blade views if the task has a frontend layer.
2. Check the referenced tables against the real schema
   (`python -c "import sqlite3; ..."` on `$LARAVEL_ROOT/database/database.sqlite`). The
   source routinely writes to columns and tables that do not exist — confirm
   which code path can actually execute before porting it.
3. Note anything that cannot be ported faithfully: a missing table, a missing
   credential, an authorization hole that should not be copied. Decide, and plan
   to write the decision down.

**Then build**, in this order, so each layer is testable as it lands:

- services in `packages/core/src/<area>/`, then export from `src/index.ts`
- routes in `apps/api/src/routes/`, registered in `server.ts`, wired in `context.ts`
- pages and components in `apps/web/src/`, plus nav entries in `lib/nav.ts`
- unit tests in `packages/core/test/<sprint>-*.test.ts`
- e2e tests in `tests/e2e/<sprint>-*.e2e.ts`

Typecheck as you go (`npx tsc --build --force`). Smoke-test new endpoints against
the running API before building UI on top of them.

**Finish with** the README status table, route list and test counts updated, an
ADR under `docs/` if the sprint required a real architectural decision, and a
green `/verify`.

Ask before adding a table. Report what you skipped and why.
