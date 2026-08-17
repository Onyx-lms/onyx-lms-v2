/**
 * PL-07a -- player settings and the watermark overlay.
 *
 * player_settings is a key/value table (title -> description), so this is
 * get_player_settings() with the same false-when-missing semantics expressed as
 * null. Watermark placement lives in the main settings table alongside the
 * other watermark_* keys.
 */
import type { Db } from '../db/client.ts';
import { phpJsonDecode, phpJsonEncode } from '../json/php-json.ts';
import type { SettingsService } from '../settings/settings.service.ts';
import type { StorageService } from '../storage/storage.service.ts';

export interface WatermarkConfig {
  /** 'js' overlays in the browser; 'ffmpeg' would burn into the file (not built). */
  type: 'js' | 'ffmpeg' | 'none';
  logo: string | null;
  text: string | null;
  top: number;
  left: number;
  width: number;
  height: number;
  opacity: number;
}

export interface PlayerConfig {
  autoplay: boolean;
  speeds: number[];
  /** Discourages the browser's own download affordance. */
  disable_download: boolean;
  watermark: WatermarkConfig;
}

const DEFAULT_SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];

export class PlayerSettingsService {
  #db: Db;
  #settings: SettingsService;
  #storage: StorageService;

  constructor(db: Db, settings: SettingsService, storage: StorageService) {
    this.#db = db;
    this.#settings = settings;
    this.#storage = storage;
  }

  /** get_player_settings($title) -- null when absent, as PHP returned false. */
  async get(title: string): Promise<string | null> {
    const { data } = await this.#db.from('player_settings')
      .select('description').eq('title', title).maybeSingle();
    return data?.description ?? null;
  }

  async getJson<T>(title: string, fallback: T): Promise<T> {
    return phpJsonDecode<T>(await this.get(title), fallback);
  }

  async set(title: string, description: string): Promise<void> {
    const { data } = await this.#db.from('player_settings')
      .select('id').eq('title', title).maybeSingle();
    const now = new Date().toISOString();
    if (data) {
      await this.#db.from('player_settings')
        .update({ description, updated_at: now }).eq('id', data.id);
    } else {
      await this.#db.from('player_settings')
        .insert({ title, description, created_at: now, updated_at: now });
    }
  }

  /** Everything the player component needs, resolved in one call. */
  async config(): Promise<PlayerConfig> {
    const [
      autoplay, speeds, disableDownload,
      type, logo, text, top, left, width, height, opacity,
    ] = await Promise.all([
      this.get('autoplay'),
      this.getJson<number[]>('playback_speeds', DEFAULT_SPEEDS),
      this.get('disable_download'),
      this.#settings.get('watermark_type'),
      this.#settings.get('watermark_logo'),
      this.#settings.get('watermark'),
      this.#settings.get('watermark_top'),
      this.#settings.get('watermark_left'),
      this.#settings.get('watermark_width'),
      this.#settings.get('watermark_height'),
      this.#settings.get('watermark_opacity'),
    ]);

    const num = (v: string | null, fallback: number) => {
      const n = Number(v);
      return Number.isFinite(n) ? n : fallback;
    };

    // 'ffmpeg' burns the mark into the file and needs a worker binary, which
    // this port does not ship. Fall back to the browser overlay rather than
    // silently rendering no watermark at all.
    const configured = (type ?? 'none') as WatermarkConfig['type'];
    const resolvedType: WatermarkConfig['type'] =
      configured === 'ffmpeg' ? 'js' : configured === 'js' ? 'js' : 'none';

    return {
      autoplay: autoplay === '1' || autoplay === 'true',
      speeds: Array.isArray(speeds) && speeds.length ? speeds.map(Number) : DEFAULT_SPEEDS,
      disable_download: disableDownload !== '0' && disableDownload !== 'false',
      watermark: {
        type: resolvedType,
        logo: logo ? this.#storage.publicUrl(logo) : null,
        text: text ?? null,
        top: num(top, 5),
        left: num(left, 5),
        width: num(width, 15),
        height: num(height, 10),
        opacity: Math.min(1, Math.max(0, num(opacity, 0.5))),
      },
    };
  }

  async updateConfig(input: Partial<{
    autoplay: boolean; speeds: number[]; disable_download: boolean;
  }>): Promise<void> {
    if (input.autoplay !== undefined) await this.set('autoplay', input.autoplay ? '1' : '0');
    if (input.disable_download !== undefined) {
      await this.set('disable_download', input.disable_download ? '1' : '0');
    }
    if (input.speeds) await this.set('playback_speeds', phpJsonEncode(input.speeds));
  }
}
