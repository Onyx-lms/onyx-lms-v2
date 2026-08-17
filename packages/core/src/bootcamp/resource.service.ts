/**
 * BC-04 / BC-05 -- module resources and bootcamp live classes.
 *
 * bootcamp_resources arrived in migration 0008: the model and controller exist
 * in Laravel but no migration ever created the table, so uploads threw there.
 *
 * bootcamp_live_classes uses UNIX INTEGER start_time / end_time and a
 * `joining_data` JSON-as-text column, unlike course live classes which use a
 * timestamp and `additional_info`. Both shapes are preserved.
 */
import type { Db } from '../db/client.ts';
import { HttpError } from '../http/errors.ts';
import { phpJsonEncode, phpJsonDecode } from '../json/php-json.ts';
import { slugify } from '../authoring/slug.ts';
import { unix, classStarted } from './module.service.ts';
import { newRoomCode, roomName, jitsiOptions, externalApiUrl, JITSI_DOMAIN } from '../live/jitsi.ts';

const RESOURCE_COLUMNS = 'id, module_id, title, upload_type, file, created_at, updated_at';
const CLASS_COLUMNS = 'id, module_id, title, slug, description, start_time, end_time, sort, status, provider, joining_data, force_stop, created_at, updated_at';

export class BootcampResourceService {
  #db: Db;
  constructor(db: Db) { this.#db = db; }

  async find(id: number) {
    const { data } = await this.#db.from('bootcamp_resources')
      .select(RESOURCE_COLUMNS).eq('id', id).maybeSingle();
    if (!data) throw new HttpError(404, 'Resource not found.');
    return data;
  }

  async forModule(moduleId: number) {
    const { data } = await this.#db.from('bootcamp_resources')
      .select(RESOURCE_COLUMNS).eq('module_id', moduleId).order('id');
    return data ?? [];
  }

  async create(moduleId: number, input: {
    title: string; upload_type: 'resource' | 'record'; file: string;
  }) {
    const now = new Date().toISOString();
    const { data, error } = await this.#db.from('bootcamp_resources').insert({
      module_id: moduleId,
      title: input.title.trim(),
      upload_type: input.upload_type,
      file: input.file,
      created_at: now, updated_at: now,
    }).select(RESOURCE_COLUMNS).maybeSingle();
    if (error) throw new HttpError(500, 'Could not save the resource: ' + error.message);
    return data;
  }

  async remove(id: number): Promise<void> {
    await this.find(id);
    await this.#db.from('bootcamp_resources').delete().eq('id', id);
  }
}

export class BootcampClassService {
  #db: Db;
  constructor(db: Db) { this.#db = db; }

  async find(id: number) {
    const { data } = await this.#db.from('bootcamp_live_classes')
      .select(CLASS_COLUMNS).eq('id', id).maybeSingle();
    if (!data) throw new HttpError(404, 'Live class not found.');
    return data;
  }

  async create(moduleId: number, input: {
    title: string; description?: string | null;
    start_time: string | number; end_time: string | number;
    provider: 'zoom' | 'jitsi';
  }) {
    const start = unix(input.start_time);
    const end = unix(input.end_time);
    if (start === null || end === null) {
      throw new HttpError(422, 'That is not a valid start or end time.');
    }
    // Without this a class can never open: class_started() needs end > now.
    if (end <= start) throw new HttpError(422, 'The class must end after it starts.');

    const { count } = await this.#db.from('bootcamp_live_classes')
      .select('id', { count: 'exact', head: true }).eq('module_id', moduleId);

    const now = new Date().toISOString();
    const { data, error } = await this.#db.from('bootcamp_live_classes').insert({
      module_id: moduleId,
      title: input.title.trim(),
      slug: slugify(input.title),
      description: input.description ?? null,
      start_time: start,
      end_time: end,
      sort: (count ?? 0) + 1,
      status: 1,
      provider: input.provider,
      // joining_data is what class_started() checks for, so a class is only
      // joinable once this exists. Jitsi needs nothing but a room code.
      joining_data: phpJsonEncode({ room_code: newRoomCode() }),
      force_stop: 0,
      created_at: now, updated_at: now,
    }).select(CLASS_COLUMNS).maybeSingle();
    if (error) throw new HttpError(500, 'Could not create the class: ' + error.message);
    return { ...data, joining_data: undefined };
  }

  /** force_stop ends a class early; it can never be joined again. */
  async forceStop(id: number): Promise<void> {
    await this.find(id);
    await this.#db.from('bootcamp_live_classes')
      .update({ force_stop: 1, updated_at: new Date().toISOString() }).eq('id', id);
  }

  async remove(id: number): Promise<void> {
    await this.find(id);
    await this.#db.from('bootcamp_live_classes').delete().eq('id', id);
  }

  /** BC-05 -- what the browser needs to join, and nothing more. */
  async joinPayload(id: number, isHost: boolean) {
    const cls = await this.find(id);
    const joining = phpJsonDecode<{ room_code?: string }>(cls.joining_data as string, {});
    const { data: module } = await this.#db.from('bootcamp_modules')
      .select('id, bootcamp_id, title').eq('id', Number(cls.module_id)).maybeSingle();
    const { data: bootcamp } = await this.#db.from('bootcamps')
      .select('slug').eq('id', Number(module?.bootcamp_id ?? 0)).maybeSingle();

    const room = roomName(bootcamp?.slug as string | null, cls.id, joining.room_code ?? '');
    return {
      provider: cls.provider ?? 'jitsi',
      mode: 'embed' as const,
      is_host: isHost,
      domain: JITSI_DOMAIN,
      script_url: externalApiUrl(),
      options: jitsiOptions({ room, displayName: 'Participant', email: '', isHost }),
      class: {
        id: cls.id, title: cls.title, description: cls.description,
        start_time: cls.start_time, end_time: cls.end_time,
        startable: classStarted(cls as never),
      },
    };
  }
}
