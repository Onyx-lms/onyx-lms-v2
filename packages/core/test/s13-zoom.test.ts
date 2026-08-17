import { test } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { FakeDb } from './fake-db.ts';
import { ZoomService, zoomTime } from '../src/live/zoom.service.ts';
import { SettingsService } from '../src/settings/settings.service.ts';
import { HttpError } from '../src/http/errors.ts';

interface Call { url: string; init: RequestInit }

/** Records every request and replies from a queue of canned responses. */
function stub(responses: { status: number; body: unknown }[]) {
  const calls: Call[] = [];
  const fetchImpl = (async (url: unknown, init: unknown) => {
    calls.push({ url: String(url), init: (init ?? {}) as RequestInit });
    const next = responses.shift() ?? { status: 200, body: {} };
    return {
      ok: next.status >= 200 && next.status < 300,
      status: next.status,
      json: async () => next.body,
    };
  }) as unknown as typeof globalThis.fetch;
  return { calls, fetchImpl };
}

const SETTINGS = [
  { id: 1, type: 'zoom_client_id', description: 'client-id' },
  { id: 2, type: 'zoom_client_secret', description: 'client-secret' },
  { id: 3, type: 'zoom_account_id', description: 'account-id' },
  { id: 4, type: 'zoom_account_email', description: 'host@onyx.test' },
  { id: 5, type: 'timezone', description: 'Europe/London' },
  { id: 6, type: 'zoom_sdk_client_id', description: 'sdk-key' },
  { id: 7, type: 'zoom_sdk_client_secret', description: 'sdk-secret' },
];

function make(responses: { status: number; body: unknown }[], settings = SETTINGS) {
  const d = new FakeDb({ settings: [...settings] });
  const { calls, fetchImpl } = stub(responses);
  return { svc: new ZoomService(new SettingsService(d as never), fetchImpl), calls };
}

const TOKEN_OK = { status: 200, body: { access_token: 'tok-1', expires_in: 3600 } };

test('LC-02 the OAuth token is basic-authed and cached until just before expiry', async () => {
  const { svc, calls } = make([TOKEN_OK, { status: 200, body: { access_token: 'tok-2', expires_in: 3600 } }]);
  const now = 1_000_000_000_000;

  assert.equal(await svc.token(now), 'tok-1');
  assert.equal(calls.length, 1);
  assert.match(calls[0]!.url, /grant_type=account_credentials&account_id=account-id/);
  const auth = String((calls[0]!.init.headers as Record<string, string>)['Authorization']);
  assert.equal(auth, 'Basic ' + Buffer.from('client-id:client-secret').toString('base64'));

  // Laravel fetched a fresh token on every single call.
  assert.equal(await svc.token(now + 60_000), 'tok-1');
  assert.equal(calls.length, 1, 'still cached');

  // Within a minute of expiry it must not be reused.
  assert.equal(await svc.token(now + 3_600_000), 'tok-2', 'a fresh token, not the stale one');
  assert.equal(calls.length, 2, 'refetched near expiry');
});

test('LC-02 missing credentials and a rejected token both fail loudly', async () => {
  const bare = make([], [{ id: 1, type: 'timezone', description: 'UTC' }]);
  await assert.rejects(() => bare.svc.token(), (e: HttpError) => e.status === 422);
  assert.equal(bare.calls.length, 0, 'no pointless request');
  assert.equal(await bare.svc.configured(), false);

  const refused = make([{ status: 400, body: { reason: 'Invalid client_id' } }]);
  await assert.rejects(() => refused.svc.token(),
    (e: HttpError) => e.status === 502 && /Invalid client_id/.test(e.message));
});

test('LC-03 creating a meeting sends the fields Laravel sent', async () => {
  const { svc, calls } = make([TOKEN_OK, {
    status: 201,
    body: { id: 8123, password: 'pw', join_url: 'https://zoom.us/j/8123',
      start_url: 'https://zoom.us/s/secret' },
  }]);

  const meeting = await svc.createMeeting('Week 1', '2026-08-20T10:00:00.000Z', 45);
  assert.equal(meeting.id, 8123);

  const create = calls[1]!;
  assert.equal(create.url, 'https://api.zoom.us/v2/users/me/meetings');
  assert.equal(create.init.method, 'POST');
  assert.equal((create.init.headers as Record<string, string>)['Authorization'], 'Bearer tok-1');

  const sent = JSON.parse(String(create.init.body));
  assert.equal(sent.topic, 'Week 1');
  assert.equal(sent.type, 2);
  assert.equal(sent.duration, 45);
  assert.equal(sent.schedule_for, 'host@onyx.test');
  assert.equal(sent.timezone, 'Europe/London');
  // Zoom wants no milliseconds and no zone suffix.
  assert.equal(sent.start_time, '2026-08-20T10:00:00');
  assert.deepEqual(sent.settings, { approval_type: 2, join_before_host: true, jbh_time: 0 });
});

test('LC-03 a Zoom error surfaces the message Zoom itself returned', async () => {
  // Zoom answers 200 with a `code` key on some failures, which is why the
  // status alone is not enough.
  const soft = make([TOKEN_OK, { status: 200, body: { code: 3001, message: 'Meeting not found' } }]);
  await assert.rejects(() => soft.svc.createMeeting('t', '2026-08-20T10:00:00Z'),
    (e: HttpError) => e.status === 502 && e.message === 'Meeting not found');

  const hard = make([TOKEN_OK, { status: 429, body: { message: 'Too many requests' } }]);
  await assert.rejects(() => hard.svc.updateMeeting(1, 't', '2026-08-20T10:00:00Z'),
    (e: HttpError) => e.message === 'Too many requests');
});

test('LC-03 update and delete address the meeting directly', async () => {
  const { svc, calls } = make([TOKEN_OK, { status: 204, body: {} }, { status: 204, body: {} }]);

  await svc.updateMeeting(8123, 'Week 1 (moved)', '2026-08-21T11:30:00.000Z');
  assert.equal(calls[1]!.url, 'https://api.zoom.us/v2/meetings/8123');
  assert.equal(calls[1]!.init.method, 'PATCH');
  assert.deepEqual(JSON.parse(String(calls[1]!.init.body)),
    { topic: 'Week 1 (moved)', start_time: '2026-08-21T11:30:00' });

  await svc.deleteMeeting(8123);
  assert.equal(calls[2]!.init.method, 'DELETE');
});

test('LC-04 the join signature is made server-side and never returns the secret', async () => {
  const { svc, calls } = make([]);
  // Real time, because jwt.verify() checks exp against the real clock.
  const now = Date.now();

  const host = await svc.signature(8123, 1, now);
  assert.equal(calls.length, 0, 'signing is local crypto, not an API call');
  assert.equal(host.sdkKey, 'sdk-key');
  assert.equal(Object.values(host).includes('sdk-secret'), false,
    'the SDK secret must never leave the server');

  // It has to verify against the secret, or the browser cannot join.
  const claims = jwt.verify(host.signature, 'sdk-secret') as Record<string, unknown>;
  assert.equal(claims['mn'], '8123');
  assert.equal(claims['role'], 1);
  assert.equal(claims['sdkKey'], 'sdk-key');
  assert.equal(Number(claims['exp']) > Number(claims['iat']), true);

  const guest = await svc.signature(8123, 0, now);
  assert.equal((jwt.verify(guest.signature, 'sdk-secret') as { role: number }).role, 0);
  assert.notEqual(guest.signature, host.signature, 'the role is inside the signature');

  // A wrong secret must not verify -- that is the whole point of signing here.
  assert.throws(() => jwt.verify(host.signature, 'guessed-secret'));
});

test('LC-04 signing without SDK credentials is refused, not silently unsigned', async () => {
  const { svc } = make([], SETTINGS.filter((s) => !s.type.startsWith('zoom_sdk')));
  await assert.rejects(() => svc.signature(1, 0), (e: HttpError) => e.status === 422);
});

test('LC-04 the web SDK is off unless the setting says active', async () => {
  const off = make([]);
  assert.equal(await off.svc.webSdkEnabled(), false, 'absent means off');

  const on = make([], [...SETTINGS, { id: 8, type: 'zoom_web_sdk', description: 'active' }]);
  assert.equal(await on.svc.webSdkEnabled(), true);
});

test('LC-03 an unparseable date is refused before it reaches Zoom', () => {
  assert.equal(zoomTime('2026-08-20T10:00:00.000Z'), '2026-08-20T10:00:00');
  assert.throws(() => zoomTime('whenever'), (e: unknown) => (e as HttpError).status === 422);
});
