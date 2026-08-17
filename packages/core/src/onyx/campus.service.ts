/**
 * CMP-01 -- academic administration and timetables.
 *
 * "Programs, batches, faculty allocation and the institutional console", and
 * "timetable construction with room and faculty clash detection".
 *
 * The acceptance criterion for the timetable is the whole design: "a
 * double-booked room or faculty member is refused **with the clash named**".
 * Two things follow from those last three words.
 *
 * **A clash is refused, not flagged.** Returning a warning and writing the row
 * anyway produces a timetable that is published, printed and wrong. So the
 * check runs before the insert and the insert does not happen.
 *
 * **The refusal says what it collided with.** "That room is busy" sends the
 * registrar hunting through a grid; "CS-201 already has Databases with Dr Rao
 * on Monday 09:00-10:00" is a message they can act on. Naming it costs one
 * extra lookup on the failure path, which is the path nobody is waiting on.
 *
 * Three resources can clash, and all three are checked: the room, the person
 * teaching, and the cohort being taught. The third is the one usually left out,
 * and it is the one learners notice -- a batch cannot be in two rooms at once
 * however free both rooms are.
 */
import type { OnyxDb } from './db.ts';
import { HttpError } from '../http/errors.ts';
import type { AuditService } from './audit.service.ts';

const ROOM_COLUMNS = 'id, tenant_id, code, name, capacity, kind, building, status, created_at';
const SLOT_COLUMNS = 'id, tenant_id, semester_id, course_id, batch_id, room_id, faculty_id, day_of_week, starts_at, ends_at, status, created_at';
const ALLOCATION_COLUMNS = 'id, tenant_id, semester_id, course_id, batch_id, user_id, kind, hours_per_week, created_at';

export const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday',
  'Saturday', 'Sunday'];

/** "09:00" and "09:00:00" both arrive from forms; normalise before comparing. */
function minutesOfDay(time: string): number {
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(time.trim());
  if (!m) throw new HttpError(422, 'A time must look like 09:00, not "' + time + '".');
  const hours = Number(m[1]);
  const mins = Number(m[2]);
  if (hours > 23 || mins > 59) throw new HttpError(422, 'There is no such time as ' + time + '.');
  return hours * 60 + mins;
}

const hhmmss = (time: string): string => {
  const total = minutesOfDay(time);
  return String(Math.floor(total / 60)).padStart(2, '0') + ':'
    + String(total % 60).padStart(2, '0') + ':00';
};

/** Half-open intervals: a class ending at 10:00 does not clash with one starting then. */
const overlaps = (aStart: number, aEnd: number, bStart: number, bEnd: number) =>
  aStart < bEnd && bStart < aEnd;

export interface Clash {
  /** room | faculty | batch -- which resource was already busy. */
  resource: 'room' | 'faculty' | 'batch';
  slot_id: number;
  description: string;
}

export class CampusService {
  #db: OnyxDb;
  #audit: AuditService;

  constructor(db: OnyxDb, audit: AuditService) {
    this.#db = db;
    this.#audit = audit;
  }

  // -------------------------------------------------------------------------
  // CMP-01a: faculty allocation
  // -------------------------------------------------------------------------

  async allocate(tenantId: number, input: {
    semester_id: number; course_id: number; user_id: string;
    batch_id?: number | null; kind?: 'lead' | 'assistant' | 'lab'; hours_per_week?: number;
  }) {
    await this.#assertBelongs('onyx_semesters', tenantId, input.semester_id, 'semester');
    await this.#assertBelongs('onyx_courses', tenantId, input.course_id, 'course');
    if (input.batch_id) {
      await this.#assertBelongs('onyx_batches', tenantId, input.batch_id, 'batch');
    }

    // Allocating a learner to teach would satisfy the foreign key and nothing
    // else, so the membership is checked rather than assumed.
    const { data: membership } = await this.#db.from('onyx_memberships').select('role')
      .eq('tenant_id', tenantId).eq('user_id', input.user_id).eq('status', 1).maybeSingle();
    if (!membership) throw new HttpError(422, 'That person is not a member of this institution.');
    if (membership.role !== 'faculty' && membership.role !== 'admin') {
      throw new HttpError(422, 'Only faculty can be allocated to teach a course.');
    }

    const { data, error } = await this.#db.from('onyx_faculty_allocations').insert({
      tenant_id: tenantId,
      semester_id: input.semester_id,
      course_id: input.course_id,
      batch_id: input.batch_id ?? null,
      user_id: input.user_id,
      kind: input.kind ?? 'lead',
      hours_per_week: input.hours_per_week ?? 0,
    }).select(ALLOCATION_COLUMNS).maybeSingle();

    if (error) {
      if (/duplicate key|unique/i.test(error.message)) {
        throw new HttpError(409, 'That allocation already exists.');
      }
      throw new HttpError(500, 'Could not allocate: ' + error.message);
    }
    return data;
  }

  async allocations(tenantId: number, filters: { semester_id?: number; user_id?: string } = {}) {
    let q = this.#db.from('onyx_faculty_allocations').select(ALLOCATION_COLUMNS)
      .eq('tenant_id', tenantId);
    if (filters.semester_id) q = q.eq('semester_id', filters.semester_id);
    if (filters.user_id) q = q.eq('user_id', filters.user_id);
    const { data } = await q.order('id', { ascending: true });
    return data ?? [];
  }

  /**
   * Teaching load per person for a term.
   *
   * The console's one genuinely useful number: who is carrying twenty hours and
   * who is carrying four.
   */
  async workload(tenantId: number, semesterId: number) {
    const rows = await this.allocations(tenantId, { semester_id: semesterId });
    const byPerson = new Map<string, { user_id: string; name: string | null; courses: number; hours: number }>();
    for (const r of rows) {
      const id = String(r.user_id);
      const entry = byPerson.get(id) ?? { user_id: id, name: null, courses: 0, hours: 0 };
      entry.courses += 1;
      entry.hours += Number(r.hours_per_week ?? 0);
      byPerson.set(id, entry);
    }
    if (byPerson.size) {
      const { data } = await this.#db.from('onyx_users').select('id, name').in('id', [...byPerson.keys()]);
      for (const u of data ?? []) {
        const entry = byPerson.get(String(u.id));
        if (entry) entry.name = String(u.name);
      }
    }
    return [...byPerson.values()].sort((a, b) => b.hours - a.hours);
  }

  // -------------------------------------------------------------------------
  // Rooms
  // -------------------------------------------------------------------------

  async createRoom(tenantId: number, input: {
    code: string; name: string; capacity?: number;
    kind?: 'lecture' | 'lab' | 'seminar' | 'hall'; building?: string | null;
  }) {
    const code = input.code.trim().toUpperCase();
    if (!code) throw new HttpError(422, 'A room needs a code.');

    const { data, error } = await this.#db.from('onyx_rooms').insert({
      tenant_id: tenantId,
      code,
      name: input.name.trim(),
      capacity: input.capacity ?? 0,
      kind: input.kind ?? 'lecture',
      building: input.building ?? null,
      status: 1,
    }).select(ROOM_COLUMNS).maybeSingle();

    if (error) {
      if (/duplicate key|unique/i.test(error.message)) {
        throw new HttpError(409, 'A room with the code ' + code + ' already exists.');
      }
      throw new HttpError(500, 'Could not create the room: ' + error.message);
    }
    return data;
  }

  async rooms(tenantId: number) {
    const { data } = await this.#db.from('onyx_rooms').select(ROOM_COLUMNS)
      .eq('tenant_id', tenantId).order('code', { ascending: true });
    return data ?? [];
  }

  // -------------------------------------------------------------------------
  // CMP-01b: the timetable
  // -------------------------------------------------------------------------

  /**
   * Everything already scheduled that would collide with this slot.
   *
   * Public because the UI wants to ask before it submits, and because a check
   * a caller can run is a check that gets run.
   */
  async clashes(tenantId: number, slot: {
    semester_id: number; room_id: number; faculty_id: string; batch_id: number;
    day_of_week: number; starts_at: string; ends_at: string; exclude_id?: number;
  }): Promise<Clash[]> {
    const start = minutesOfDay(slot.starts_at);
    const end = minutesOfDay(slot.ends_at);

    // Everything on that weekday in that term. A timetable is a few hundred
    // rows; fetching the day and comparing in memory is simpler than three
    // overlap queries and is not the slow part of anything.
    const { data } = await this.#db.from('onyx_timetable_slots').select(SLOT_COLUMNS)
      .eq('tenant_id', tenantId)
      .eq('semester_id', slot.semester_id)
      .eq('day_of_week', slot.day_of_week);

    const candidates = (data ?? []).filter((s) => Number(s.id) !== slot.exclude_id);
    const hits = candidates.filter((s) =>
      overlaps(start, end, minutesOfDay(String(s.starts_at)), minutesOfDay(String(s.ends_at))));
    if (!hits.length) return [];

    const clashes: Clash[] = [];
    for (const hit of hits) {
      const when = WEEKDAYS[slot.day_of_week - 1] + ' '
        + String(hit.starts_at).slice(0, 5) + '-' + String(hit.ends_at).slice(0, 5);
      if (Number(hit.room_id) === slot.room_id) {
        clashes.push({
          resource: 'room',
          slot_id: Number(hit.id),
          description: await this.#describe(tenantId, hit, when, 'room'),
        });
      }
      if (String(hit.faculty_id) === slot.faculty_id) {
        clashes.push({
          resource: 'faculty',
          slot_id: Number(hit.id),
          description: await this.#describe(tenantId, hit, when, 'faculty'),
        });
      }
      if (Number(hit.batch_id) === slot.batch_id) {
        clashes.push({
          resource: 'batch',
          slot_id: Number(hit.id),
          description: await this.#describe(tenantId, hit, when, 'batch'),
        });
      }
    }
    return clashes;
  }

  /** The named half of "refused with the clash named". */
  async #describe(tenantId: number, slot: Record<string, unknown>, when: string,
    resource: 'room' | 'faculty' | 'batch'): Promise<string> {
    const [room, course, person] = await Promise.all([
      this.#db.from('onyx_rooms').select('code, name')
        .eq('tenant_id', tenantId).eq('id', Number(slot.room_id)).maybeSingle(),
      this.#db.from('onyx_courses').select('code, title')
        .eq('tenant_id', tenantId).eq('id', Number(slot.course_id)).maybeSingle(),
      this.#db.from('onyx_users').select('name').eq('id', String(slot.faculty_id)).maybeSingle(),
    ]);

    const roomName = room.data ? String(room.data.code) : 'a room';
    const courseName = course.data ? String(course.data.title) : 'another course';
    const personName = person.data ? String(person.data.name) : 'another lecturer';

    if (resource === 'room') {
      return roomName + ' already has ' + courseName + ' with ' + personName + ' on ' + when + '.';
    }
    if (resource === 'faculty') {
      return personName + ' is already teaching ' + courseName + ' in ' + roomName
        + ' on ' + when + '.';
    }
    return 'That batch is already in ' + courseName + ' in ' + roomName + ' on ' + when + '.';
  }

  async schedule(tenantId: number, input: {
    semester_id: number; course_id: number; batch_id: number; room_id: number;
    faculty_id: string; day_of_week: number; starts_at: string; ends_at: string;
  }) {
    if (input.day_of_week < 1 || input.day_of_week > 7) {
      throw new HttpError(422, 'A weekday is 1 (Monday) to 7 (Sunday).');
    }
    if (minutesOfDay(input.ends_at) <= minutesOfDay(input.starts_at)) {
      throw new HttpError(422, 'A class has to end after it starts.');
    }

    await this.#assertBelongs('onyx_semesters', tenantId, input.semester_id, 'semester');
    await this.#assertBelongs('onyx_courses', tenantId, input.course_id, 'course');
    await this.#assertBelongs('onyx_batches', tenantId, input.batch_id, 'batch');
    await this.#assertBelongs('onyx_rooms', tenantId, input.room_id, 'room');
    // A batch with nobody in it is a session for nobody, and the id being
    // real (checked above) is not the same thing -- an empty batch passes
    // that check every time. Refused here rather than left to be noticed
    // once the room is booked and the paper is printed.
    const { count: batchSize } = await this.#db.from('onyx_batch_members')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId).eq('batch_id', input.batch_id);
    if (!batchSize) {
      throw new HttpError(422, 'That batch has nobody in it yet -- add its members before '
        + 'scheduling a class for them.');
    }

    const clashes = await this.clashes(tenantId, input);
    if (clashes.length) {
      // The description goes in the message so a human reads it, and the
      // resource goes in `errors` so a form can highlight the right field.
      throw new HttpError(409, clashes.map((c) => c.description).join(' '), {
        errors: clashes.reduce<Record<string, string[]>>((acc, c) => {
          (acc[c.resource] ??= []).push(c.description);
          return acc;
        }, {}),
      });
    }

    const { data, error } = await this.#db.from('onyx_timetable_slots').insert({
      tenant_id: tenantId,
      semester_id: input.semester_id,
      course_id: input.course_id,
      batch_id: input.batch_id,
      room_id: input.room_id,
      faculty_id: input.faculty_id,
      day_of_week: input.day_of_week,
      starts_at: hhmmss(input.starts_at),
      ends_at: hhmmss(input.ends_at),
      status: 'draft',
    }).select(SLOT_COLUMNS).maybeSingle();
    if (error) throw new HttpError(500, 'Could not schedule that: ' + error.message);
    return data;
  }

  async timetable(tenantId: number, filters: {
    semester_id?: number; batch_id?: number; faculty_id?: string; room_id?: number;
    /**
     * A learner's own grid, by the courses they are actually enrolled in --
     * not by batch, because plenty of enrolments here carry no batch at all
     * (an individually-enrolled learner is not in any formal cohort, and
     * still needs to see their own classes).
     */
    course_ids?: number[];
    /** A learner may only ever see the published grid. */
    publishedOnly?: boolean;
  } = {}) {
    let q = this.#db.from('onyx_timetable_slots').select(SLOT_COLUMNS).eq('tenant_id', tenantId);
    if (filters.semester_id) q = q.eq('semester_id', filters.semester_id);
    if (filters.batch_id) q = q.eq('batch_id', filters.batch_id);
    if (filters.faculty_id) q = q.eq('faculty_id', filters.faculty_id);
    if (filters.room_id) q = q.eq('room_id', filters.room_id);
    if (filters.course_ids) q = q.in('course_id', filters.course_ids);
    if (filters.publishedOnly) q = q.eq('status', 'published');

    const { data } = await q
      .order('day_of_week', { ascending: true })
      .order('starts_at', { ascending: true });
    return data ?? [];
  }

  /**
   * Publish a term's timetable.
   *
   * Re-checks every slot against every other before publishing. A draft can be
   * built in any order, and two slots that were both fine when written can
   * still collide once a third moved -- publishing is the last point at which
   * catching that is cheap.
   */
  async publish(tenantId: number, semesterId: number, actorId: string) {
    const slots = await this.timetable(tenantId, { semester_id: semesterId });
    if (!slots.length) throw new HttpError(422, 'There is nothing to publish.');

    for (let i = 0; i < slots.length; i += 1) {
      for (let j = i + 1; j < slots.length; j += 1) {
        const a = slots[i]!;
        const b = slots[j]!;
        if (Number(a.day_of_week) !== Number(b.day_of_week)) continue;
        if (!overlaps(
          minutesOfDay(String(a.starts_at)), minutesOfDay(String(a.ends_at)),
          minutesOfDay(String(b.starts_at)), minutesOfDay(String(b.ends_at)))) continue;

        for (const [field, label] of [
          ['room_id', 'room'], ['batch_id', 'batch'],
        ] as const) {
          if (Number(a[field]) === Number(b[field])) {
            throw new HttpError(409, 'Slots ' + a.id + ' and ' + b.id
              + ' share a ' + label + ' on ' + WEEKDAYS[Number(a.day_of_week) - 1]
              + '. Fix that before publishing.');
          }
        }
        // faculty_id is a person's uuid now, so it is compared as a string
        // rather than folded into the Number() comparison above.
        if (String(a.faculty_id) === String(b.faculty_id)) {
          throw new HttpError(409, 'Slots ' + a.id + ' and ' + b.id
            + ' share a lecturer on ' + WEEKDAYS[Number(a.day_of_week) - 1]
            + '. Fix that before publishing.');
        }
      }
    }

    const { error } = await this.#db.from('onyx_timetable_slots')
      .update({ status: 'published' })
      .eq('tenant_id', tenantId).eq('semester_id', semesterId);
    if (error) throw new HttpError(500, 'Could not publish: ' + error.message);

    await this.#audit.record(
      { tenant_id: tenantId, user_id: actorId },
      { action: 'timetable.published', entityType: 'semester', entityId: semesterId,
        after: { slots: slots.length } });
    return { published: slots.length };
  }

  async removeSlot(tenantId: number, id: number) {
    const { data } = await this.#db.from('onyx_timetable_slots').select('id')
      .eq('tenant_id', tenantId).eq('id', id).maybeSingle();
    if (!data) throw new HttpError(404, 'No such timetable slot.');
    await this.#db.from('onyx_timetable_slots').delete().eq('tenant_id', tenantId).eq('id', id);
    return { ok: true };
  }

  // -------------------------------------------------------------------------

  /**
   * Loads a parent row and 404s when it belongs to another institution.
   *
   * Deliberately not "filter by tenant and return nothing": answering 200 with
   * an empty list for somebody else's id leaks no data but confirms the id is
   * real, which is a question the caller had no right to have answered.
   */
  async #assertBelongs(table: 'onyx_semesters' | 'onyx_courses' | 'onyx_batches' | 'onyx_rooms',
    tenantId: number, id: number, label: string) {
    const { data } = await this.#db.from(table).select('id')
      .eq('tenant_id', tenantId).eq('id', id).maybeSingle();
    if (!data) throw new HttpError(404, 'No such ' + label + '.');
  }
}
