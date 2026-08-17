# Documentation

DOC-01. Four audiences, four documents — plus the decisions behind the code.

## If you run an institution

**[Administrator's guide](ADMIN-GUIDE.md)** — setting a term up, running it, and
closing it. No terminal, no database. If a step in it cannot be done from a
browser, that is a bug.

## If you want to see what each role sees

**[Role-by-role screen guide](roles/)** — one file per role (student,
faculty, examinations, placement, employer, parent/guardian, administrator,
platform super admin), walking every screen that role's own navigation
offers, with a real screenshot and a description of what it does and what
you can do there. Not a test script — see UAT below for that.

## If you are accepting the system

**[UAT scripts](UAT.md)** — role-by-role acceptance tests, written so an
institution can complete them without a developer in the room. Each says who,
what to do, and what you should see.

## If you are on call

**[Runbook](RUNBOOK.md)** — health and metrics, what to alert on, restoring an
institution's records, verifying the sandbox, and the one known unresolved
fault.

## If you are integrating

**[API reference](API.md)** — every endpoint and who may call it. Generated from
the route files by `npm run docs:api`; `npm run docs:check` runs in the gate, so
it cannot drift from what ships.

---

## Decisions

Architecture decision records — what was chosen, what was rejected, and why.
Read these before changing anything they cover.

| | |
| --- | --- |
| [ADR-001](ADR-001-auth.md) | Custom JWT rather than Supabase Auth |
| [ADR-002](ADR-002-schema-parity.md) | Exact schema parity with the Laravel original |
| [ADR-003](ADR-003-watch-tracking.md) | How watch progress is tracked |
| [ADR-004](ADR-004-messaging.md) | Which generation of messaging was ported |
| [ADR-005](ADR-005-live-classes.md) | Live classes, Jitsi and Zoom |
| [ADR-006](ADR-006-onyx-foundation.md) | Onyx as a second product in this repository |

`CLAUDE.md` at the repository root holds the invariants — the rules that are
expensive to rediscover and costly to break. It is not documentation of the
product; it is documentation of the traps.
