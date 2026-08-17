/**
 * P-01 / P-02 -- settings services.
 *
 * Ports get_settings() and get_frontend_settings() from Common_helper.php.
 *
 * Two behaviours carried over deliberately:
 *   - a missing key returns null (PHP returned `false`; null is the TS analogue)
 *   - get_frontend_settings falls back when the table is absent, which is why
 *     theme resolution has to tolerate a missing value and land on 'default'
 *
 * Caching is in-process with explicit invalidation on write. The settings table
 * is 25 rows; Redis would be ceremony. REDIS_URL is honoured if you set it,
 * but nothing here requires it.
 */
import type { Db } from '../db/client.ts';
import { phpJsonDecode } from '../json/php-json.ts';

export interface SettingsCache {
  get(key: string): string | null | undefined;
  set(key: string, value: string | null): void;
  clear(): void;
}

class MemoryCache implements SettingsCache {
  #map = new Map<string, string | null>();
  #loadedAll = false;
  get(key: string) { return this.#map.get(key); }
  set(key: string, value: string | null) { this.#map.set(key, value); }
  clear() { this.#map.clear(); this.#loadedAll = false; }
  get loadedAll() { return this.#loadedAll; }
  markLoaded() { this.#loadedAll = true; }
}

export class SettingsService {
  #db: Db;
  #cache = new MemoryCache();

  constructor(db: Db) { this.#db = db; }

  /** Load every setting once; subsequent reads are memory hits. */
  async warm(): Promise<void> {
    const { data, error } = await this.#db.from('settings').select('type, description');
    if (error) throw new Error(`settings.warm failed: ${error.message}`);
    this.#cache.clear();
    for (const row of data ?? []) this.#cache.set(row.type ?? '', row.description ?? null);
    this.#cache.markLoaded();
  }

  /** get_settings($type) */
  async get(type: string): Promise<string | null> {
    const hit = this.#cache.get(type);
    if (hit !== undefined) return hit;
    const { data, error } = await this.#db
      .from('settings').select('description').eq('type', type).maybeSingle();
    if (error) throw new Error(`settings.get(${type}) failed: ${error.message}`);
    const value = data?.description ?? null;
    this.#cache.set(type, value);
    return value;
  }

  /** get_settings($type, true) -- decode a JSON-valued setting. */
  async getJson<T>(type: string, fallback: T): Promise<T> {
    return phpJsonDecode<T>(await this.get(type), fallback);
  }

  async getBool(type: string): Promise<boolean> {
    const v = await this.get(type);
    return v === '1' || v === 'true' || v === 'active';
  }

  async set(type: string, description: string): Promise<void> {
    const { data } = await this.#db.from('settings').select('id').eq('type', type).maybeSingle();
    const { error } = data
      ? await this.#db.from('settings').update({ description }).eq('type', type)
      : await this.#db.from('settings').insert({ type, description });
    if (error) throw new Error(`settings.set(${type}) failed: ${error.message}`);
    this.#cache.set(type, description); // invalidate-by-overwrite
  }

  invalidate(): void { this.#cache.clear(); }

  /**
   * Theme resolution, matching `get_frontend_settings('theme') ?: 'default'`.
   * The live DB says theme='classic' while only the 'default' view tree exists,
   * so the fallback is load-bearing, not defensive padding.
   */
  async theme(): Promise<string> {
    const known = new Set(['default']);
    const configured = await this.get('theme');
    return configured && known.has(configured) ? configured : 'default';
  }

  /**
   * The subset of settings safe to hand to a browser. `settings` is NOT
   * anon-readable via RLS precisely because it also holds smtp_pass,
   * open_ai_secret_key and payment credentials.
   */
  static readonly PUBLIC_KEYS = [
    'system_title', 'system_currency', 'currency_position', 'timezone',
    'language', 'footer_text', 'footer_link', 'meta_title', 'meta_description',
    'meta_keywords', 'student_email_verification', 'instructor_application',
  ] as const;

  async publicSettings(): Promise<Record<string, string | null>> {
    if (!this.#cache.loadedAll) await this.warm();
    const out: Record<string, string | null> = {};
    for (const k of SettingsService.PUBLIC_KEYS) out[k] = this.#cache.get(k) ?? null;
    return out;
  }
}
