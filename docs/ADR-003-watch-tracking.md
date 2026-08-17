# ADR-003: `watch_durations` is ported verbatim

**Status:** Accepted (Sprint S00 / task PL-04)

## Context

The player posts a progress ping every 5 seconds. Laravel appends each tick to a
JSON array in `watch_durations.watched_counter` -- a read-modify-write of an
unbounded text blob, per student, per lesson, every 5 seconds.

This was raised during planning as a scaling concern. The decision was made to
keep the schema unchanged.

## Decision

Port the behaviour and the storage format **exactly**, including the array
contents and their encoding. `phpJsonEncode` guarantees the bytes match what
Laravel writes, so both stacks can run against one database during cutover.

## Consequences

- Write amplification is carried over unchanged. Task **H-05** load-tests this
  path specifically so the ceiling is measured before it is hit in production.
- If it does become a problem, the fix is additive and does not require touching
  this column: a narrow append-only ticks table plus a periodic roll-up, with
  `watched_counter` kept in sync for compatibility. That is a future decision,
  not a Sprint-1 one.
