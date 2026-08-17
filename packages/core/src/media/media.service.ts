/**
 * P-05 -- media library over the media_files table.
 *
 * Uploads land in Supabase Storage under the same key layout Laravel used, and
 * the row records the stored path so existing consumers keep working.
 */
import type { Db } from '../db/client.ts';
import type { StorageService } from '../storage/storage.service.ts';
import { HttpError } from '../http/errors.ts';
import { paginate, type PageQuery, type Paginated } from '../http/pagination.ts';

export type MediaPrivacy = 'public' | 'private';

const IMAGE = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'];
const VIDEO = ['mp4', 'webm', 'mov', 'm4v'];
const DOC = ['pdf', 'doc', 'docx', 'ppt', 'pptx', 'xls', 'xlsx', 'txt', 'zip'];

export function detectFileType(fileName: string): string {
  const ext = (fileName.split('.').pop() ?? '').toLowerCase();
  if (IMAGE.includes(ext)) return 'image';
  if (VIDEO.includes(ext)) return 'video';
  if (DOC.includes(ext)) return 'document';
  return 'other';
}

export class MediaService {
  #db: Db;
  #storage: StorageService;
  constructor(db: Db, storage: StorageService) { this.#db = db; this.#storage = storage; }

  async upload(userId: number, folder: string, fileName: string,
               body: Uint8Array | ArrayBuffer | Blob,
               opts: { contentType?: string; privacy?: MediaPrivacy } = {}) {
    const safeName = fileName.replace(/[^A-Za-z0-9._-]/g, '_');
    const key = `${folder.replace(/^\/+|\/+$/g, '')}/${Date.now()}-${safeName}`;
    await this.#storage.upload(key, body, opts.contentType);

    const now = new Date().toISOString();
    const { data, error } = await this.#db.from('media_files').insert({
      user_id: userId,
      file_name: key,
      file_type: detectFileType(safeName),
      privacy: opts.privacy ?? 'public',
      created_at: now, updated_at: now,
    }).select('id, user_id, file_name, file_type, privacy, created_at').maybeSingle();
    if (error) throw new HttpError(500, `media.upload failed: ${error.message}`);
    return { ...data, url: this.#storage.publicUrl(key) };
  }

  async list(userId: number, page: PageQuery, path: string): Promise<Paginated<unknown>> {
    const { data, count, error } = await this.#db
      .from('media_files').select('id, user_id, file_name, file_type, privacy, created_at', { count: 'exact' })
      .eq('user_id', userId).order('id', { ascending: false }).range(page.from, page.to);
    if (error) throw new HttpError(500, `media.list failed: ${error.message}`);
    const rows = (data ?? []).map((m) => ({
      ...m,
      url: m.privacy === 'private' ? null : this.#storage.publicUrl(m.file_name ?? ''),
    }));
    return paginate(rows, count ?? 0, page, path);
  }

  /** Private items are only reachable through a short-lived signed URL. */
  async signedUrl(id: number, userId: number, expiresIn = 300): Promise<string | null> {
    const { data } = await this.#db.from('media_files')
      .select('file_name, user_id, privacy').eq('id', id).maybeSingle();
    if (!data) throw new HttpError(404, 'File not found.');
    if (data.user_id !== userId) throw new HttpError(403, 'This action is unauthorized.');
    return this.#storage.signedUrl(data.file_name ?? '', expiresIn);
  }

  async remove(id: number, userId: number): Promise<void> {
    const { data } = await this.#db.from('media_files')
      .select('file_name, user_id').eq('id', id).maybeSingle();
    if (!data) throw new HttpError(404, 'File not found.');
    if (data.user_id !== userId) throw new HttpError(403, 'This action is unauthorized.');
    await this.#storage.remove(data.file_name ?? '');
    await this.#db.from('media_files').delete().eq('id', id);
  }
}
