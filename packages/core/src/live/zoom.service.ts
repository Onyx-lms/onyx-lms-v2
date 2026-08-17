/**
 * LC-02 / LC-03 / LC-04 -- Zoom.
 *
 * Two server-to-server credentials pairs are involved, and mixing them up is
 * the usual way this breaks:
 *
 *   zoom_client_id / zoom_client_secret / zoom_account_id
 *       the Server-to-Server OAuth app -- used to CREATE meetings.
 *   zoom_sdk_client_id / zoom_sdk_client_secret
 *       the Meeting SDK app -- used to SIGN a browser join.
 *
 * The Laravel view printed `zoom_sdk_client_secret` into the page and called
 * ZoomMtg.generateSDKSignature() in the browser -- it even console.log()ged it.
 * Anyone who loaded a class page could read the secret and mint host
 * signatures for any meeting on the account. Signing happens on the server
 * here; the secret never leaves it. See docs/ADR-005-live-classes.md.
 */
import jwt from 'jsonwebtoken';
import { HttpError } from '../http/errors.ts';
import type { SettingsService } from '../settings/settings.service.ts';

export type Fetch = typeof globalThis.fetch;

export interface ZoomMeeting {
  id: number | string;
  topic?: string;
  start_time?: string;
  duration?: number;
  password?: string;
  join_url?: string;
  /** Host credential. Never send this to a participant. */
  start_url?: string;
}

const OAUTH_URL = 'https://zoom.us/oauth/token';
const API = 'https://api.zoom.us/v2';

export class ZoomService {
  #settings: SettingsService;
  #fetch: Fetch;
  #token: { value: string; expiresAt: number } | null = null;

  constructor(settings: SettingsService, fetchImpl: Fetch = globalThis.fetch) {
    this.#settings = settings;
    this.#fetch = fetchImpl;
  }

  async configured(): Promise<boolean> {
    const [id, secret, account] = await Promise.all([
      this.#settings.get('zoom_client_id'),
      this.#settings.get('zoom_client_secret'),
      this.#settings.get('zoom_account_id'),
    ]);
    return Boolean(id && secret && account);
  }

  /**
   * LC-02 -- server-to-server OAuth, cached until shortly before expiry.
   *
   * Laravel fetched a fresh token on every single call, which is both slow and
   * a good way to meet Zoom's rate limit. Tokens last an hour; this reuses one
   * until a minute before it expires.
   */
  async token(now = Date.now()): Promise<string> {
    if (this.#token && this.#token.expiresAt > now + 60_000) return this.#token.value;

    const [clientId, clientSecret, accountId] = await Promise.all([
      this.#settings.get('zoom_client_id'),
      this.#settings.get('zoom_client_secret'),
      this.#settings.get('zoom_account_id'),
    ]);
    if (!clientId || !clientSecret || !accountId) {
      throw new HttpError(422, 'Zoom is not configured. Add the credentials in live class settings.');
    }

    const url = OAUTH_URL + '?grant_type=account_credentials&account_id='
      + encodeURIComponent(accountId);
    const res = await this.#fetch(url, {
      method: 'POST',
      headers: {
        Authorization: 'Basic ' + Buffer.from(clientId + ':' + clientSecret).toString('base64'),
      },
    });
    const body = await res.json().catch(() => ({})) as
      { access_token?: string; expires_in?: number; reason?: string; message?: string };

    if (!res.ok || !body.access_token) {
      // Laravel echoed the failure to stdout and returned null, so the next
      // call failed somewhere less obvious with a useless message.
      throw new HttpError(502, 'Zoom authentication failed: '
        + (body.reason || body.message || 'HTTP ' + res.status));
    }

    this.#token = {
      value: body.access_token,
      expiresAt: now + (body.expires_in ?? 3600) * 1000,
    };
    return this.#token.value;
  }

  /** Drops the cached token, e.g. after the credentials change. */
  forgetToken(): void { this.#token = null; }

  async #call<T>(path: string, init: RequestInit): Promise<T> {
    const token = await this.token();
    const res = await this.#fetch(API + path, {
      ...init,
      headers: {
        Authorization: 'Bearer ' + token,
        'Content-Type': 'application/json',
        ...(init.headers ?? {}),
      },
    });
    if (res.status === 204) return {} as T;

    const body = await res.json().catch(() => ({})) as Record<string, unknown>;
    // Laravel returned Zoom's raw body and the caller sniffed for a `code` key.
    // Surfacing Zoom's own message is the useful half of that; the rest is not.
    if (!res.ok || typeof body['code'] === 'number') {
      throw new HttpError(502, String(body['message'] ?? 'Zoom request failed: HTTP ' + res.status));
    }
    return body as T;
  }

  /** LC-03 -- create a scheduled meeting. */
  async createMeeting(topic: string, startTime: string, duration = 60): Promise<ZoomMeeting> {
    const [email, timezone] = await Promise.all([
      this.#settings.get('zoom_account_email'),
      this.#settings.get('timezone'),
    ]);
    return this.#call<ZoomMeeting>('/users/me/meetings', {
      method: 'POST',
      body: JSON.stringify({
        topic,
        ...(email ? { schedule_for: email } : {}),
        type: 2,
        start_time: zoomTime(startTime),
        duration,
        timezone: timezone ?? 'UTC',
        settings: { approval_type: 2, join_before_host: true, jbh_time: 0 },
      }),
    });
  }

  async updateMeeting(meetingId: string | number, topic: string, startTime: string) {
    await this.#call('/meetings/' + meetingId, {
      method: 'PATCH',
      body: JSON.stringify({ topic, start_time: zoomTime(startTime) }),
    });
  }

  async deleteMeeting(meetingId: string | number) {
    await this.#call('/meetings/' + meetingId, { method: 'DELETE' });
  }

  /**
   * LC-04 -- the Meeting SDK join signature, generated here rather than in the
   * browser. `role` is 1 for the host and 0 for a participant, and the caller
   * decides which from the database -- never from a request parameter.
   */
  async signature(meetingNumber: string | number, role: 0 | 1, now = Date.now()) {
    const [sdkKey, sdkSecret] = await Promise.all([
      this.#settings.get('zoom_sdk_client_id'),
      this.#settings.get('zoom_sdk_client_secret'),
    ]);
    if (!sdkKey || !sdkSecret) {
      throw new HttpError(422, 'The Zoom Meeting SDK credentials are not configured.');
    }

    const iat = Math.floor(now / 1000) - 30;
    const exp = iat + 60 * 60 * 2;
    const token = jwt.sign({
      appKey: sdkKey, sdkKey,
      mn: String(meetingNumber),
      role,
      iat, exp,
      tokenExp: exp,
    }, sdkSecret, { algorithm: 'HS256' });

    // sdkKey is public (it identifies the app); the secret is not returned.
    return { signature: token, sdkKey, expiresAt: exp };
  }

  async webSdkEnabled(): Promise<boolean> {
    return (await this.#settings.get('zoom_web_sdk')) === 'active';
  }
}

/** Zoom wants a local-time string with no zone suffix, as Laravel produced. */
export function zoomTime(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw new HttpError(422, 'That is not a valid date and time.');
  return d.toISOString().replace(/\.\d{3}Z$/, '');
}
