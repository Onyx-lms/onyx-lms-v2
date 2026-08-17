---
description: Run the full verification gate and report honestly
allowed-tools: Bash, Read, Grep
---

Run the complete gate and report the result. Do not stop at the first stage.

1. `npm run verify:all` — parity, unit tests, typecheck, deployment audit, e2e.
   It builds the web app first, so it takes several minutes. Run it in the
   background and wait for the notification rather than polling.
2. `python tools/grading-differential.py` — quiz scoring against the PHP algorithm.
3. `git status --short` from the repository root — confirm nothing has leaked
   into the Laravel source tree (`../app`, `../database`, `../resources`,
   `../routes`, `../package.json`, `../tests`, `../tools`).

Report the actual numbers from the output: tables/columns matched, unit test
count, RLS coverage, e2e count, differential agreements. If any stage fails,
show the failing assertion and diagnose it — **do not** adjust a test so that it
passes unless the test itself is wrong, and say so plainly if it is.

Two failure modes that have masqueraded as passes before, both fixed but worth
re-checking if something looks odd:

- a stage that prints success and then aborts on exit, breaking the `&&` chain so
  later stages never run — check the exit code, not just the last line;
- `next start` serving a stale `.next`, so new pages 404 and the suite appears to
  find a frontend bug.
