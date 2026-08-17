/**
 * TB-03 / TB-04 -- a tutor's availability.
 *
 * start_time / end_time are UNIX INTEGERS. tution_type is 1 for a single
 * session and 0 for a repeated one, where Laravel expands a date range into one
 * row per matching weekday.
 *
 * `booking_id` on a schedule is what marks the slot taken.
 */
import type { Db } from '../db/client.ts';
import { HttpError } from '../http/errors.ts';
import { unix } from '../bootcamp/module.service.ts';

const COLUMNS = 'id, tutor_id, category_id, subject_id, price, start_time, end_time, duration, description, tution_type, status, booking_id, created_at, updated_at';

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

/**
 * TB-03 -- expands a repeated schedule into one slot per matching weekday.
 *
 * Returns unix start times. Laravel iterated a CarbonPeriod day by day and kept
 * the start time's time-of-day, which is what this reproduces.
 */
export function repeatSlots(startIso: string, endIso: string, days: string[]): number[] {
  const start = new Date(startIso);
  const end = new Date(endIso);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new HttpError(422, 'That is not a valid date range.');
  }
  if (end < start) throw new HttpError(422, 'The range must end after it starts.');

  const wanted = new Set(days.map((d) => d.toLowerCase()));
  const out: number[] = [];
  const cursor = new Date(start);
  // A year of daily steps is the ceiling; beyond that the form is misused.
  for (let guard = 0; cursor <= end && guard < 400; guard++) {
    if (wanted.has(WEEKDAYS[cursor.getUTCDay()]!)) {
      out.push(Math.floor(cursor.getTime() / 1000));
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}

export class TutorScheduleService {
  #db: Db;
  constructor(db: Db) { this.#db = db; }

  async find(id: number) {
    const { data } = await this.#db.from('tutor_schedules')
      .select(COLUMNS).eq('id', id).maybeSingle();
    if (!data) throw new HttpError(404, 'Schedule not found.');
    return data;
  }

  /** TB-04 -- open slots for a tutor, optionally on one day. */
  async forTutor(tutorId: number, opts: { from?: number; to?: number; onlyOpen?: boolean } = {}) {
    const { data } = await this.#db.from('tutor_schedules')
      .select(COLUMNS).eq('tutor_id', tutorId).order('start_time');
    let rows = data ?? [];
    if (opts.from !== undefined) rows = rows.filter((r) => Number(r.start_time) >= opts.from!);
    if (opts.to !== undefined) rows = rows.filter((r) => Number(r.start_time) <= opts.to!);
    // A slot with a booking_id is taken; the original showed it as available.
    if (opts.onlyOpen) rows = rows.filter((r) => !r.booking_id);
    return rows;
  }

  /** TB-04 -- the slots on one calendar day, in UTC. */
  async onDate(tutorId: number, isoDate: string, onlyOpen = true) {
    const day = new Date(isoDate + 'T00:00:00.000Z');
    if (Number.isNaN(day.getTime())) throw new HttpError(422, 'That is not a valid date.');
    const from = Math.floor(day.getTime() / 1000);
    return this.forTutor(tutorId, { from, to: from + 86_399, onlyOpen });
  }

  /**
   * TB-03 -- create one or many slots.
   *
   * The price is copied from the tutor's can-teach row at creation time, so a
   * later price change does not silently reprice slots a student is looking at.
   * Laravel left tutor_schedules.price null and read the can-teach row at
   * checkout instead.
   */
  async create(tutorId: number, input: {
    category_id: number; subject_id: number; duration: number;
    tution_type: 0 | 1; start_time: string; end_time?: string | null;
    days?: string[]; description?: string | null; price: number;
  }) {
    if (!(input.duration > 0)) throw new HttpError(422, 'A session needs a duration.');

    const starts: number[] = [];
    if (input.tution_type === 0) {
      if (!input.end_time) throw new HttpError(422, 'A repeated schedule needs an end date.');
      if (!input.days?.length) throw new HttpError(422, 'Pick at least one day of the week.');
      starts.push(...repeatSlots(input.start_time, input.end_time, input.days));
      if (!starts.length) throw new HttpError(422, 'No dates in that range match those days.');
    } else {
      const at = unix(input.start_time);
      if (at === null) throw new HttpError(422, 'That is not a valid start time.');
      starts.push(at);
    }

    const now = new Date().toISOString();
    const rows = starts.map((start) => ({
      tutor_id: tutorId,
      category_id: input.category_id,
      subject_id: input.subject_id,
      price: input.price,
      start_time: start,
      end_time: start + input.duration * 60,
      duration: input.duration,
      description: input.description ?? null,
      tution_type: input.tution_type,
      status: 1,
      booking_id: null,
      created_at: now, updated_at: now,
    }));

    const { data, error } = await this.#db.from('tutor_schedules')
      .insert(rows as never).select(COLUMNS);
    if (error) throw new HttpError(500, 'Could not save the schedule: ' + error.message);
    return data ?? [];
  }

  async remove(id: number, tutorId: number): Promise<void> {
    const row = await this.find(id);
    if (Number(row.tutor_id) !== tutorId) throw new HttpError(403, 'This action is unauthorized.');
    // Cancelling a slot someone paid for would strip a session they own.
    if (row.booking_id) throw new HttpError(422, 'That slot has been booked.');
    await this.#db.from('tutor_schedules').delete().eq('id', id);
  }
}
