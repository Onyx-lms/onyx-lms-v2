/**
 * TB-05 / TB-06 / TB-07 -- booking a session, joining it, and reviewing a tutor.
 *
 * TWO DEFECTS IN THE ORIGINAL, NOT CARRIED OVER.
 *
 * 1. tution_started() always returned true.
 *      $booking = TutorBooking::where(...)->firstOrNew();
 *      return $booking ? true : null;
 *    firstOrNew() returns a NEW model when nothing matches, so the expression
 *    is truthy for every input -- including a booking id that does not exist.
 *    The join window was therefore never enforced anywhere it was used.
 *
 * 2. The student was sent to the host URL.
 *      return redirect($meeting_info['start_url']);
 *    start_url signs the holder in as the Zoom HOST. Handing it to a student
 *    lets them start and control the meeting. Participants get join_url here.
 */
import type { Db } from '../db/client.ts';
import { HttpError } from '../http/errors.ts';
import { phpJsonEncode } from '../json/php-json.ts';
import type { SettingsService } from '../settings/settings.service.ts';

const COLUMNS = 'id, student_id, tutor_id, schedule_id, price, tax, payment_method, invoice, payment_details, instructor_revenue, admin_revenue, start_time, end_time, joining_data, status, created_at, updated_at';

/** Minutes before the start that a session opens. */
export const TUITION_OPENS_MINUTES = 15;

/**
 * TB-06 -- ports tution_started(), doing what it was meant to do: joinable when
 * it has joining data, starts within the next 15 minutes, and has not ended.
 */
export function tuitionStarted(booking: {
  start_time: number | null; end_time: number | null; joining_data: string | null;
}, now = Date.now()): boolean {
  if (!booking.joining_data) return false;
  const seconds = Math.floor(now / 1000);
  const extended = seconds + TUITION_OPENS_MINUTES * 60;
  return Number(booking.start_time) < extended && Number(booking.end_time) > seconds;
}

export class TutorBookingService {
  #db: Db;
  #settings: SettingsService;
  constructor(db: Db, settings: SettingsService) {
    this.#db = db;
    this.#settings = settings;
  }

  async find(id: number) {
    const { data } = await this.#db.from('tutor_bookings')
      .select(COLUMNS).eq('id', id).maybeSingle();
    if (!data) throw new HttpError(404, 'Booking not found.');
    return data;
  }

  /** TB-05 -- my sessions. */
  async forStudent(studentId: number) {
    const { data } = await this.#db.from('tutor_bookings')
      .select(COLUMNS).eq('student_id', studentId).eq('status', 1)
      .order('start_time', { ascending: false });
    return this.decorate(data ?? []);
  }

  async forTutor(tutorId: number) {
    const { data } = await this.#db.from('tutor_bookings')
      .select(COLUMNS).eq('tutor_id', tutorId).eq('status', 1)
      .order('start_time', { ascending: false });
    return this.decorate(data ?? []);
  }

  /** live | upcoming | archive, from the booking's own window. */
  static tab(booking: { start_time: number | null; end_time: number | null },
             now = Date.now()): 'live' | 'upcoming' | 'archive' {
    const seconds = Math.floor(now / 1000);
    if (Number(booking.end_time) <= seconds) return 'archive';
    if (Number(booking.start_time) - TUITION_OPENS_MINUTES * 60 <= seconds) return 'live';
    return 'upcoming';
  }

  async byInvoice(invoice: string, userId: number, isAdmin: boolean) {
    const { data } = await this.#db.from('tutor_bookings')
      .select(COLUMNS).eq('invoice', invoice).maybeSingle();
    if (!data) throw new HttpError(404, 'Invoice not found.');
    const mine = Number(data.student_id) === userId || Number(data.tutor_id) === userId;
    if (!isAdmin && !mine) throw new HttpError(404, 'Invoice not found.');
    const [decorated] = await this.decorate([data]);
    return decorated;
  }

  /**
   * TB-05 -- book a slot.
   *
   * The slot is claimed by writing booking_id back onto the schedule, which is
   * what stops two students buying the same hour.
   */
  async book(scheduleId: number, studentId: number, input: {
    invoice: string; paymentMethod: string; tax?: number; paymentDetails?: unknown;
  }) {
    const { data: schedule } = await this.#db.from('tutor_schedules')
      .select('id, tutor_id, category_id, subject_id, price, start_time, end_time, booking_id, status')
      .eq('id', scheduleId).maybeSingle();
    if (!schedule || schedule.status !== 1) throw new HttpError(404, 'Schedule not found.');
    if (Number(schedule.tutor_id) === studentId) {
      throw new HttpError(422, 'You cannot book your own session.');
    }
    if (schedule.booking_id) throw new HttpError(422, 'That slot has already been booked.');
    // A slot that has already finished cannot be sold.
    if (Number(schedule.end_time) <= Math.floor(Date.now() / 1000)) {
      throw new HttpError(422, 'That session has already finished.');
    }

    const price = Number(schedule.price ?? 0);
    const percent = Number((await this.#settings.get('instructor_revenue')) ?? 0);
    const instructorRevenue = Math.round(price * (percent / 100) * 100) / 100;
    const adminRevenue = Math.round((price - instructorRevenue) * 100) / 100;

    const now = new Date().toISOString();
    const { data, error } = await this.#db.from('tutor_bookings').insert({
      student_id: studentId,
      tutor_id: schedule.tutor_id,
      schedule_id: scheduleId,
      price,
      tax: input.tax ?? 0,
      payment_method: input.paymentMethod,
      invoice: input.invoice,
      payment_details: input.paymentDetails === undefined
        ? null : phpJsonEncode(input.paymentDetails),
      instructor_revenue: instructorRevenue,
      admin_revenue: adminRevenue,
      start_time: schedule.start_time,
      end_time: schedule.end_time,
      // Filled in on the first join, as Laravel did.
      joining_data: null,
      status: 1,
      created_at: now, updated_at: now,
    }).select(COLUMNS).maybeSingle();
    if (error) throw new HttpError(500, 'Could not book the session: ' + error.message);

    await this.#db.from('tutor_schedules')
      .update({ booking_id: data!.id, updated_at: now }).eq('id', scheduleId);
    return data;
  }

  /** Stores the provider payload the first time somebody joins. */
  async setJoiningData(bookingId: number, payload: unknown) {
    await this.#db.from('tutor_bookings').update({
      joining_data: phpJsonEncode(payload), updated_at: new Date().toISOString(),
    }).eq('id', bookingId);
  }

  async decorate(rows: Record<string, unknown>[]) {
    const userIds = [...new Set(rows.flatMap((r) =>
      [Number(r['student_id']), Number(r['tutor_id'])]).filter(Boolean))];
    const scheduleIds = [...new Set(rows.map((r) => Number(r['schedule_id'])).filter(Boolean))];

    const [users, schedules] = await Promise.all([
      userIds.length ? this.#db.from('users').select('id, name, email, photo').in('id', userIds)
                     : Promise.resolve({ data: [] }),
      scheduleIds.length
        ? this.#db.from('tutor_schedules')
            .select('id, category_id, subject_id, duration, description').in('id', scheduleIds)
        : Promise.resolve({ data: [] }),
    ]);
    const userById = new Map((users.data ?? []).map((u) => [u.id, u]));
    const scheduleById = new Map((schedules.data ?? []).map((s) => [s.id, s]));

    return rows.map((r) => {
      // joining_data can carry a host link, so it never leaves in a list.
      const { joining_data, ...safe } = r;
      return {
        ...safe,
        has_joining_data: Boolean(joining_data),
        student: userById.get(Number(r['student_id'])) ?? null,
        tutor: userById.get(Number(r['tutor_id'])) ?? null,
        schedule: scheduleById.get(Number(r['schedule_id'])) ?? null,
        tab: TutorBookingService.tab(r as never),
        startable: tuitionStarted(r as never),
      };
    });
  }

  // ---- TB-07: tutor reviews ----

  /** Ports total_review_by_tutor_id(), with the average alongside it. */
  async reviewsFor(tutorId: number) {
    const { data } = await this.#db.from('tutor_reviews')
      .select('id, tutor_id, student_id, rating, review, created_at')
      .eq('tutor_id', tutorId).order('id', { ascending: false });
    const rows = data ?? [];

    const ids = [...new Set(rows.map((r) => Number(r.student_id)).filter(Boolean))];
    const { data: users } = ids.length
      ? await this.#db.from('users').select('id, name, photo').in('id', ids)
      : { data: [] };
    const byId = new Map((users ?? []).map((u) => [u.id, u]));

    const ratings = rows.map((r) => Number(r.rating ?? 0)).filter((n) => n > 0);
    return {
      total: rows.length,
      average: ratings.length
        ? Math.round((ratings.reduce((a, b) => a + b, 0) / ratings.length) * 10) / 10
        : 0,
      reviews: rows.map((r) => ({ ...r, student: byId.get(Number(r.student_id)) ?? null })),
    };
  }

  /**
   * TB-07 -- leave a review.
   *
   * Only after a session that has actually finished, and one review per tutor
   * per student. The original had no such check at all.
   */
  async review(tutorId: number, studentId: number, rating: number, text: string) {
    const { data: sessions } = await this.#db.from('tutor_bookings')
      .select('id, end_time').eq('tutor_id', tutorId).eq('student_id', studentId).eq('status', 1);
    const seconds = Math.floor(Date.now() / 1000);
    const completed = (sessions ?? []).some((b) => Number(b.end_time) <= seconds);
    if (!completed) {
      throw new HttpError(422, 'You can review a tutor after a session with them has finished.');
    }

    const { data: existing } = await this.#db.from('tutor_reviews')
      .select('id').eq('tutor_id', tutorId).eq('student_id', studentId).maybeSingle();
    const now = new Date().toISOString();
    if (existing) {
      await this.#db.from('tutor_reviews')
        .update({ rating, review: text.trim(), updated_at: now }).eq('id', existing.id);
      return { updated: true };
    }
    const { error } = await this.#db.from('tutor_reviews').insert({
      tutor_id: tutorId, student_id: studentId, rating,
      review: text.trim(), created_at: now, updated_at: now,
    });
    if (error) throw new HttpError(500, 'Could not save your review: ' + error.message);
    return { updated: false };
  }
}
