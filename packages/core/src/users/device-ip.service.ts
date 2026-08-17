/**
 * A-10 -- device / IP tracking (IpDetectorMiddleware port).
 *
 * Laravel wrote a row per request. That is a lot of rows for no extra signal,
 * so we key on (user, session) and only insert when that pair is new. Same
 * table, same columns; fewer duplicates.
 */
import type { Db } from '../db/client.ts';

export class DeviceIpService {
  #db: Db;
  constructor(db: Db) { this.#db = db; }

  async record(userId: number, ip: string, sessionId: string, userAgent: string): Promise<void> {
    const { data: existing } = await this.#db
      .from('device_ips').select('id').eq('user_id', userId).eq('session_id', sessionId).maybeSingle();
    if (existing) return;

    const now = new Date().toISOString();
    await this.#db.from('device_ips').insert({
      user_id: userId,
      ip_address: ip.slice(0, 255),
      session_id: sessionId.slice(0, 255),
      user_agent: userAgent.slice(0, 255),
      created_at: now,
      updated_at: now,
    });
  }
}
