/**
 * ASS-02b -- the signalling behind live invigilation.
 *
 * No video reaches this service, so what is testable here is the part that
 * decides who may watch whom, and the part that keeps two negotiations from
 * reading each other's messages. Both are the sort of thing that works
 * perfectly in a demo with one invigilator and one candidate, and comes apart
 * the first time an exam hall has two of each.
 *
 * The refusals matter most. A live feed of somebody's room is the most
 * invasive thing this product does, and every one of the conditions below is
 * something a candidate agreed to or did not:
 *
 *   * a paper that was never set up for watching cannot be watched, whatever
 *     an invigilator asks for -- its candidates consented to less;
 *   * a candidate who never consented cannot be watched;
 *   * a finished attempt cannot be watched, because there is nobody sitting
 *     there and the camera would be pointed at somebody's evening.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { FakeDb } from './fake-db.ts';
import { ProctorService } from '../src/onyx/proctor.service.ts';
import { AuditService } from '../src/onyx/audit.service.ts';
import type { OnyxDb } from '../src/onyx/db.ts';
import { HttpError } from '../src/http/errors.ts';

const T = 1;
const OTHER = 2;
const CANDIDATE = 'u-candidate';
const NOW = 1_800_000_000_000;

function seed() {
  return new FakeDb({
    onyx_assessments: [
      { id: 10, tenant_id: T, course_id: 5, title: 'Watched paper',
        proctoring: 1, require_camera: 1, watch_camera: true, status: 'published' },
      { id: 11, tenant_id: T, course_id: 5, title: 'Unwatched paper',
        proctoring: 1, require_camera: 1, watch_camera: false, status: 'published' },
    ],
    onyx_assessment_attempts: [
      { id: 100, tenant_id: T, assessment_id: 10, user_id: CANDIDATE, attempt: 1,
        status: 'in_progress', consented_at: '2026-08-23T10:00:00Z',
        started_at: '2026-08-23T10:00:00Z', expires_at: '2026-08-23T11:00:00Z',
        integrity_flags: 0, integrity_status: 'clear', paper: [], max_score: 10 },
      { id: 101, tenant_id: T, assessment_id: 11, user_id: CANDIDATE, attempt: 1,
        status: 'in_progress', consented_at: '2026-08-23T10:00:00Z',
        started_at: '2026-08-23T10:00:00Z', expires_at: '2026-08-23T11:00:00Z',
        integrity_flags: 0, integrity_status: 'clear', paper: [], max_score: 10 },
      { id: 102, tenant_id: T, assessment_id: 10, user_id: CANDIDATE, attempt: 2,
        status: 'submitted', consented_at: '2026-08-23T09:00:00Z',
        started_at: '2026-08-23T09:00:00Z', expires_at: '2026-08-23T09:30:00Z',
        integrity_flags: 0, integrity_status: 'clear', paper: [], max_score: 10 },
      { id: 103, tenant_id: T, assessment_id: 10, user_id: CANDIDATE, attempt: 3,
        status: 'in_progress', consented_at: null,
        started_at: '2026-08-23T10:00:00Z', expires_at: '2026-08-23T11:00:00Z',
        integrity_flags: 0, integrity_status: 'clear', paper: [], max_score: 10 },
    ],
    onyx_proctor_signals: [],
    onyx_audit_logs: [],
  });
}

function service(db: FakeDb) {
  const audit = new AuditService(db as unknown as OnyxDb);
  return new ProctorService(db as unknown as OnyxDb, audit, () => NOW);
}

// ------------------------------------------------------------- who may watch

test('a paper set up for watching can be watched', async () => {
  const db = seed();
  const proctor = service(db);
  const started = await proctor.startWatch(T, 100, { userId: 'u-staff' });
  assert.match(started.session_id, /^[0-9a-f-]{36}$/);

  // Recorded, because watching somebody is an act that should be accountable
  // afterwards rather than only visible at the time.
  const logged = db.tables.onyx_audit_logs.some((r) => r.action === 'proctor.watched');
  assert.equal(logged, true, 'watching somebody was not written to the audit log');
});

test('a paper that was never set up for watching cannot be', async () => {
  // The candidates sitting it agreed to monitoring that does not include a
  // human on the other end of their camera.
  const db = seed();
  await assert.rejects(
    service(db).startWatch(T, 101, { userId: 'u-staff' }),
    (e: HttpError) => e.status === 422);
});

test('a candidate who never consented cannot be watched', async () => {
  const db = seed();
  await assert.rejects(
    service(db).startWatch(T, 103, { userId: 'u-staff' }),
    (e: HttpError) => e.status === 422);
});

test('a finished attempt cannot be watched', async () => {
  // There is nobody sitting there. The camera would be pointed at somebody's
  // evening.
  const db = seed();
  await assert.rejects(
    service(db).startWatch(T, 102, { userId: 'u-staff' }),
    (e: HttpError) => e.status === 422);
});

test('an attempt at another institution is not found', async () => {
  const db = seed();
  await assert.rejects(
    service(db).startWatch(OTHER, 100, { userId: 'u-staff' }),
    (e: HttpError) => e.status === 404);
});

// ------------------------------------------------------------- who is who

test('only the candidate is the candidate', async () => {
  const db = seed();
  const proctor = service(db);
  assert.equal(await proctor.isCandidate(T, 100, CANDIDATE), true);
  assert.equal(await proctor.isCandidate(T, 100, 'u-staff'), false);
  // The one that matters: a classmate must not be able to pass themselves off
  // as the candidate and read an invigilator's half of the exchange.
  assert.equal(await proctor.isCandidate(T, 100, 'u-classmate'), false);
});

// ---------------------------------------------------------- the negotiation

test('each side reads only what the other sent', async () => {
  const db = seed();
  const proctor = service(db);
  const { session_id } = await proctor.startWatch(T, 100, { userId: 'u-staff' });

  await proctor.postSignal(T, 100, {
    sessionId: session_id, sender: 'watcher', kind: 'offer', payload: { sdp: 'o' } });
  await proctor.postSignal(T, 100, {
    sessionId: session_id, sender: 'candidate', kind: 'answer', payload: { sdp: 'a' } });

  const forCandidate = await proctor.pollSignals(T, 100, {
    sessionId: session_id, sender: 'candidate' });
  const forWatcher = await proctor.pollSignals(T, 100, {
    sessionId: session_id, sender: 'watcher' });

  // A poll that returned your own messages would have each side answering
  // itself, which fails in a way that looks like a network problem.
  assert.deepEqual(forCandidate.map((s) => s.kind), ['offer']);
  assert.deepEqual(forWatcher.map((s) => s.kind), ['answer']);
});

test('two invigilators watching one candidate do not cross', async () => {
  // The case that works with one of each and comes apart with two: session A's
  // answer reaching session B leaves both connections half-built.
  const db = seed();
  const proctor = service(db);
  const a = await proctor.startWatch(T, 100, { userId: 'u-staff-a' });
  const b = await proctor.startWatch(T, 100, { userId: 'u-staff-b' });
  assert.notEqual(a.session_id, b.session_id);

  await proctor.postSignal(T, 100, {
    sessionId: a.session_id, sender: 'watcher', kind: 'offer', payload: { s: 'a' } });
  await proctor.postSignal(T, 100, {
    sessionId: b.session_id, sender: 'watcher', kind: 'offer', payload: { s: 'b' } });

  const seenByA = await proctor.pollSignals(T, 100, {
    sessionId: a.session_id, sender: 'candidate' });
  assert.equal(seenByA.length, 1);
  assert.deepEqual(seenByA[0]!.payload, { s: 'a' });
});

test('polling after an id returns only what is newer', async () => {
  const db = seed();
  const proctor = service(db);
  const { session_id } = await proctor.startWatch(T, 100, { userId: 'u-staff' });

  for (const n of [1, 2, 3]) {
    await proctor.postSignal(T, 100, {
      sessionId: session_id, sender: 'watcher', kind: 'ice', payload: { n } });
  }
  const first = await proctor.pollSignals(T, 100,
    { sessionId: session_id, sender: 'candidate' });
  assert.equal(first.length, 3);

  const rest = await proctor.pollSignals(T, 100, {
    sessionId: session_id, sender: 'candidate', after: Number(first[1]!.id) });
  // Ordered by id rather than timestamp: ICE candidates written in the same
  // millisecond still have an order, and applying them out of order is how a
  // connection fails intermittently on a fast network.
  assert.equal(rest.length, 1);
  assert.deepEqual(rest[0]!.payload, { n: 3 });
});

test('a huge payload is refused', async () => {
  // The column is jsonb and a candidate can write to it. Signalling messages
  // are a few hundred bytes; anything near this is somebody using an exam as
  // storage.
  const db = seed();
  const proctor = service(db);
  const { session_id } = await proctor.startWatch(T, 100, { userId: 'u-staff' });
  await assert.rejects(
    proctor.postSignal(T, 100, {
      sessionId: session_id, sender: 'candidate', kind: 'ice',
      payload: { blob: 'x'.repeat(20_000) },
    }),
    (e: HttpError) => e.status === 422);
});

// ------------------------------------------------------------ being watched

test('the candidate is told when somebody is watching, and when they stop', async () => {
  // The indicator on their own screen reads this. A live feed with no sign of
  // it on the watched person's screen is not something this product does.
  const db = seed();
  const proctor = service(db);
  const quiet = await proctor.watchState(T, 100);
  assert.equal(quiet.watched, false);

  const { session_id } = await proctor.startWatch(T, 100, { userId: 'u-staff' });
  await proctor.postSignal(T, 100, {
    sessionId: session_id, sender: 'watcher', kind: 'offer', payload: { sdp: 'o' } });

  const now = await proctor.watchState(T, 100);
  assert.equal(now.watched, true);
  assert.equal(now.session_id, session_id);
});

test('a negotiation nobody finished stops counting as being watched', async () => {
  // A candidate who closed their laptop mid-offer would otherwise leave the
  // indicator on for ever, and an invigilator watching a spinner.
  const db = seed();
  const stale = new AuditService(db as unknown as OnyxDb);
  const proctor = new ProctorService(db as unknown as OnyxDb, stale, () => NOW);
  const { session_id } = await proctor.startWatch(T, 100, { userId: 'u-staff' });
  await proctor.postSignal(T, 100, {
    sessionId: session_id, sender: 'watcher', kind: 'offer', payload: {} });

  // The same service, asked well after the messages went stale.
  const later = new ProctorService(db as unknown as OnyxDb, stale,
    () => NOW + ProctorService.SIGNAL_TTL_MS + 1000);
  assert.equal((await later.watchState(T, 100)).watched, false);
});
