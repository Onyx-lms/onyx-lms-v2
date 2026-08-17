/**
 * P-04 -- storage service.
 *
 * The hard requirement (from H-02): every path already sitting in the database
 * must keep resolving after the move, with ZERO row updates. So the bucket
 * mirrors Laravel's public/uploads tree exactly and we only ever prepend a
 * base -- we never rewrite a stored path.
 */
import type { Db } from '../db/client.ts';

export interface StorageOptions {
  bucket?: string;
  /** CDN/base override; defaults to the Supabase public object URL. */
  publicBase?: string;
}

export class StorageService {
  #db: Db;
  #bucket: string;
  #publicBase: string | null;

  constructor(db: Db, opts: StorageOptions = {}) {
    this.#db = db;
    this.#bucket = opts.bucket || process.env.STORAGE_BUCKET || 'uploads';
    this.#publicBase = opts.publicBase || process.env.STORAGE_PUBLIC_BASE || null;
  }

  /** Normalise a legacy Laravel path to a bucket-relative key. */
  static toKey(storedPath: string): string {
    let p = (storedPath ?? '').trim().replace(/\\/g, '/');
    p = p.replace(/^https?:\/\/[^/]+/i, '');       // absolute URLs written by old code
    p = p.replace(/^\/?(public\/)?(uploads\/)?/i, ''); // strip public/ + uploads/ prefixes
    return p.replace(/^\/+/, '');
  }

  /** Public URL for a path as stored in the DB. */
  publicUrl(storedPath: string | null | undefined): string | null {
    if (!storedPath) return null;
    const key = StorageService.toKey(storedPath);
    if (!key) return null;
    if (this.#publicBase) return `${this.#publicBase.replace(/\/+$/, '')}/${key}`;
    return this.#db.storage.from(this.#bucket).getPublicUrl(key).data.publicUrl;
  }

  /** Time-limited URL for private objects (resources, offline-payment docs). */
  async signedUrl(storedPath: string, expiresInSeconds = 300): Promise<string | null> {
    const key = StorageService.toKey(storedPath);
    const { data, error } = await this.#db.storage
      .from(this.#bucket).createSignedUrl(key, expiresInSeconds);
    if (error) return null;
    return data?.signedUrl ?? null;
  }

  /**
   * A one-shot ticket letting the browser PUT a file straight into the bucket.
   *
   * This exists because of a hard platform limit rather than a preference:
   * a request body through the app is capped at 4.5 MB on Vercel, which is
   * below any real lecture recording and below plenty of slide decks. Routing
   * the bytes through a function would also mean paying for them twice, in
   * duration and in memory, to hand them straight on.
   *
   * The key is still minted by the server -- the browser is told where to put
   * the file, never asked. A caller who could choose its own key could write
   * into another institution's prefix.
   */
  async signedUpload(key: string): Promise<{ path: string; token: string; signedUrl: string }> {
    const { data, error } = await this.#db.storage
      .from(this.#bucket).createSignedUploadUrl(key);
    if (error || !data) {
      throw new Error(`storage.signedUpload(${key}) failed: ${error?.message ?? 'no url'}`);
    }
    return { path: key, token: data.token, signedUrl: data.signedUrl };
  }

  async upload(key: string, body: Uint8Array | ArrayBuffer | Blob, contentType?: string) {
    const { error } = await this.#db.storage.from(this.#bucket).upload(key, body as never, {
      contentType, upsert: true,
    });
    if (error) throw new Error(`storage.upload(${key}) failed: ${error.message}`);
    return key;
  }

  async remove(storedPath: string): Promise<void> {
    await this.#db.storage.from(this.#bucket).remove([StorageService.toKey(storedPath)]);
  }
}
