/**
 * BC-03 / BC-04 / BC-05 -- modules, their resources and their live classes.
 *
 * bootcamp_modules.publish_date and expiry_date are UNIX INTEGERS, not
 * datetimes -- unlike live_classes.class_date_and_time. bootcamp_live_classes
 * uses integer start_time / end_time for the same reason. The columns are kept
 * as they are; conversion happens here.
 *
 * `restriction` gates whether a module is open. Laravel compared it loosely, so
 * the meaning is: anything other than a truthy restriction means open.
 */
import type { Db } from '../db/client.ts';
import { HttpError } from '../http/errors.ts';
import { phpJsonEncode, phpJsonDecode } from '../json/php-json.ts';
import { slugify } from '../authoring/slug.ts';

const MODULE_COLUMNS = 'id, bootcamp_id, title, publish_date, expiry_date, restriction, sort, created_at, updated_at';
const CLASS_COLUMNS = 'id, module_id, title, slug, description, start_time, end_time, sort, status, provider, joining_data, force_stop, created_at, updated_at';
const RESOURCE_COLUMNS = 'id, module_id, title, upload_type, file, created_at, updated_at';

/** Seconds, because these columns are unix integers. */
export const unix = (value: string | number | null | undefined): number | null => {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return Math.floor(value);
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : Math.floor(d.getTime() / 1000);
};

/**
 * BC-05 -- ports class_started(): joinable when it is not force-stopped, has
 * joining data, starts within the next 15 minutes, and has not yet ended.
 */
export function classStarted(row: {
  start_time: number | null; end_time: number | null;
  joining_data: string | null; force_stop: number | null;
}, now = Date.now()): boolean {
  if (row.force_stop) return false;
  if (!row.joining_data) return false;
  const seconds = Math.floor(now / 1000);
  const extended = seconds + 15 * 60;
  return Number(row.start_time) < extended && Number(row.end_time) > seconds;
}

export class BootcampModuleService {
  #db: Db;
  constructor(db: Db) { this.#db = db; }

  /** Ports count_bootcamp_modules(). */
  async count(bootcampId?: number): Promise<number> {
    let q = this.#db.from('bootcamp_modules').select('id', { count: 'exact', head: true });
    if (bootcampId) q = q.eq('bootcamp_id', bootcampId);
    const { count } = await q;
    return count ?? 0;
  }

  async forBootcamp(bootcampId: number, opts: { includePrivate?: boolean } = {}) {
    const { data } = await this.#db.from('bootcamp_modules')
      .select(MODULE_COLUMNS).eq('bootcamp_id', bootcampId).order('sort');
    const modules = data ?? [];
    if (!modules.length) return [];

    const ids = modules.map((m) => m.id);
    const [classes, resources] = await Promise.all([
      this.#db.from('bootcamp_live_classes').select(CLASS_COLUMNS).in('module_id', ids).order('sort'),
      this.#db.from('bootcamp_resources').select(RESOURCE_COLUMNS).in('module_id', ids).order('id'),
    ]);

    return modules.map((m) => {
      const mine = (classes.data ?? []).filter((c) => Number(c.module_id) === m.id);
      const files = (resources.data ?? []).filter((r) => Number(r.module_id) === m.id);
      return {
        ...m,
        open: this.isOpen(m as { publish_date: number | null; expiry_date: number | null; restriction: string | null }),
        live_classes: mine.map((c) => ({
          ...c,
          // joining_data holds the provider payload and can carry a host link,
          // so it is decoded here but stripped by the routes for students.
          joining: opts.includePrivate
            ? phpJsonDecode<unknown>(c.joining_data as string, null) : undefined,
          joining_data: undefined,
          startable: classStarted(c as never),
        })),
        resources: files,
      };
    });
  }

  /** A module is open when it has published and has not expired. */
  isOpen(module: { publish_date: number | null; expiry_date: number | null; restriction: string | null },
         now = Date.now()): boolean {
    const seconds = Math.floor(now / 1000);
    if (module.publish_date && Number(module.publish_date) > seconds) return false;
    if (module.expiry_date && Number(module.expiry_date) < seconds) return false;
    return true;
  }

  async find(id: number) {
    const { data } = await this.#db.from('bootcamp_modules')
      .select(MODULE_COLUMNS).eq('id', id).maybeSingle();
    if (!data) throw new HttpError(404, 'Module not found.');
    return data;
  }

  async create(bootcampId: number, input: {
    title: string; publish_date?: string | number | null;
    expiry_date?: string | number | null; restriction?: string | null;
  }) {
    const { count } = await this.#db.from('bootcamp_modules')
      .select('id', { count: 'exact', head: true }).eq('bootcamp_id', bootcampId);
    const now = new Date().toISOString();
    const { data, error } = await this.#db.from('bootcamp_modules').insert({
      bootcamp_id: bootcampId,
      title: input.title.trim(),
      publish_date: unix(input.publish_date),
      expiry_date: unix(input.expiry_date),
      restriction: input.restriction ?? null,
      // Appended at the end, like course sections.
      sort: (count ?? 0) + 1,
      created_at: now, updated_at: now,
    }).select(MODULE_COLUMNS).maybeSingle();
    if (error) throw new HttpError(500, 'Could not create the module: ' + error.message);
    return data;
  }

  async update(id: number, input: {
    title?: string; publish_date?: string | number | null;
    expiry_date?: string | number | null; restriction?: string | null;
  }) {
    await this.find(id);
    const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (input.title !== undefined) row['title'] = input.title.trim();
    if (input.publish_date !== undefined) row['publish_date'] = unix(input.publish_date);
    if (input.expiry_date !== undefined) row['expiry_date'] = unix(input.expiry_date);
    if (input.restriction !== undefined) row['restriction'] = input.restriction;
    await this.#db.from('bootcamp_modules').update(row as never).eq('id', id);
    return this.find(id);
  }

  /** Drag sort: the ids arrive in their new order. */
  async sort(bootcampId: number, orderedIds: number[]): Promise<void> {
    const { data } = await this.#db.from('bootcamp_modules')
      .select('id').eq('bootcamp_id', bootcampId);
    const mine = new Set((data ?? []).map((m) => m.id));
    // Ids from another bootcamp must not be renumbered by this call.
    for (const [index, id] of orderedIds.entries()) {
      if (!mine.has(id)) continue;
      await this.#db.from('bootcamp_modules')
        .update({ sort: index + 1, updated_at: new Date().toISOString() }).eq('id', id);
    }
  }

  /** Ports remove_module_data() for a single module. */
  async remove(id: number): Promise<void> {
    await this.find(id);
    await this.#db.from('bootcamp_live_classes').delete().eq('module_id', id);
    await this.#db.from('bootcamp_resources').delete().eq('module_id', id);
    await this.#db.from('bootcamp_modules').delete().eq('id', id);
  }
}
