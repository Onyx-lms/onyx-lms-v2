/**
 * LC-01 / LC-06 -- live classes attached to a course.
 *
 * `live_classes` has no end time, only `class_date_and_time`. The Laravel
 * player therefore showed a start button with no window at all; the join window
 * here is derived (see joinWindow) so the button cannot appear a week early.
 *
 * `additional_info` holds the raw provider response as JSON text (Zoom's
 * meeting object). It is one of the JSON-as-text columns, so it goes through
 * the PHP-compatible codec.
 */
import type { Db } from '../db/client.ts';
import type { Database } from '@onyx/types';
import { HttpError } from '../http/errors.ts';
import { phpJsonEncode, phpJsonDecode } from '../json/php-json.ts';

const COLUMNS = 'id, user_id, course_id, class_topic, provider, class_date_and_time, '
  + 'additional_info, note, created_at, updated_at';

type LiveClassUpdate = Database['public']['Tables']['live_classes']['Update'];

export type Provider = 'zoom' | 'jitsi';

/** Minutes before the scheduled start that the join button appears. */
export const JOIN_OPENS_MINUTES = 15;
/** Minutes after the start that a class is still considered joinable. */
export const JOIN_CLOSES_MINUTES = 180;

export interface LiveClassInput {
  course_id: number;
  user_id: number;
  class_topic: string;
  provider: Provider;
  class_date_and_time: string;
  note?: string | null;
}

export interface LiveClassRow {
  id: number;
  user_id: number | null;
  course_id: number | null;
  class_topic: string | null;
  provider: string | null;
  class_date_and_time: string | null;
  additional_info: string | null;
  note: string | null;
}

/**
 * LC-06 -- ports class_started(), which lives on bootcamp_live_classes and
 * reads: not force-stopped, has joining data, starts within the next 15
 * minutes, and has not passed its end time.
 *
 * Course live classes carry no end time, so the close is derived from the
 * start. Everything else is the same rule.
 */
export function joinWindow(startsAt: string | null, now = new Date()) {
  if (!startsAt) return { open: false, opensAt: null, closesAt: null };
  const start = new Date(startsAt);
  if (Number.isNaN(start.getTime())) return { open: false, opensAt: null, closesAt: null };

  const opensAt = new Date(start.getTime() - JOIN_OPENS_MINUTES * 60_000);
  const closesAt = new Date(start.getTime() + JOIN_CLOSES_MINUTES * 60_000);
  return {
    open: now >= opensAt && now <= closesAt,
    opensAt: opensAt.toISOString(),
    closesAt: closesAt.toISOString(),
  };
}

export class LiveClassService {
  #db: Db;
  constructor(db: Db) { this.#db = db; }

  async forCourse(courseId: number) {
    const { data } = await this.#db.from('live_classes')
      .select(COLUMNS).eq('course_id', courseId).order('class_date_and_time');
    return (data ?? []).map((r) => this.#decorate(r as unknown as LiveClassRow));
  }

  async find(id: number): Promise<LiveClassRow> {
    const { data } = await this.#db.from('live_classes')
      .select(COLUMNS).eq('id', id).maybeSingle();
    if (!data) throw new HttpError(404, 'Live class not found.');
    return data as unknown as LiveClassRow;
  }

  /**
   * Who may run the class.
   *
   * The Laravel Jitsi view granted moderator to `role == 'instructor'` -- ANY
   * instructor, in ANY course's room. Host here means the course owner, a named
   * co-instructor, or an admin.
   */
  async isHost(courseId: number, userId: number, appRole: string): Promise<boolean> {
    if (appRole === 'admin') return true;
    const { data: course } = await this.#db.from('courses')
      .select('id, user_id, instructor_ids').eq('id', courseId).maybeSingle();
    if (!course) return false;
    if (Number(course.user_id) === userId) return true;
    const ids = phpJsonDecode<unknown[]>(course.instructor_ids as string, []).map(Number);
    return ids.includes(userId);
  }

  /** A student may see the class only if they hold a live enrolment. */
  async canAttend(courseId: number, userId: number, appRole: string): Promise<boolean> {
    if (await this.isHost(courseId, userId, appRole)) return true;
    const { data } = await this.#db.from('enrollments')
      .select('id, expiry_date').eq('course_id', courseId).eq('user_id', userId).maybeSingle();
    if (!data) return false;
    // An expired enrolment is not an enrolment. A null expiry is lifetime.
    if (!data.expiry_date) return true;
    return new Date(data.expiry_date as string) > new Date();
  }

  async create(input: LiveClassInput, meeting?: unknown) {
    const now = new Date().toISOString();
    const { data, error } = await this.#db.from('live_classes').insert({
      course_id: input.course_id,
      user_id: input.user_id,
      class_topic: input.class_topic.trim(),
      provider: input.provider,
      class_date_and_time: new Date(input.class_date_and_time).toISOString(),
      note: input.note ?? null,
      additional_info: meeting === undefined ? null : phpJsonEncode(meeting),
      created_at: now, updated_at: now,
    }).select(COLUMNS).maybeSingle();
    if (error) throw new HttpError(500, 'Could not schedule the class: ' + error.message);
    return this.#decorate(data as unknown as LiveClassRow);
  }

  async update(id: number, patch: Partial<LiveClassInput>, meeting?: unknown) {
    await this.find(id);
    const row: LiveClassUpdate = { updated_at: new Date().toISOString() };
    if (patch.class_topic !== undefined) row.class_topic = patch.class_topic.trim();
    if (patch.note !== undefined) row.note = patch.note ?? null;
    if (patch.class_date_and_time !== undefined) {
      row.class_date_and_time = new Date(patch.class_date_and_time).toISOString();
    }
    if (meeting !== undefined) row.additional_info = phpJsonEncode(meeting);
    const { error } = await this.#db.from('live_classes').update(row).eq('id', id);
    if (error) throw new HttpError(500, 'Could not update the class: ' + error.message);
    return this.#decorate(await this.find(id));
  }

  async remove(id: number): Promise<void> {
    await this.find(id);
    const { error } = await this.#db.from('live_classes').delete().eq('id', id);
    if (error) throw new HttpError(500, 'Could not delete the class: ' + error.message);
  }

  /** The provider's meeting object, decoded from additional_info. */
  static meeting<T = Record<string, unknown>>(row: LiveClassRow): T | null {
    return phpJsonDecode<T | null>(row.additional_info, null);
  }

  #decorate(row: LiveClassRow) {
    const meeting = LiveClassService.meeting(row);
    const window = joinWindow(row.class_date_and_time);
    return {
      ...row,
      // The raw meeting object carries start_url, which is a host credential --
      // it must never travel to a student. Routes decide what to include.
      meeting_id: (meeting as { id?: number | string } | null)?.id ?? null,
      join_window: window,
    };
  }
}
