/**
 * E-04 -- the enrollment engine.
 *
 * Two things carried over from Laravel, and one deliberate correction:
 *
 *   expiry period   courses.expiry_period is in MONTHS, applied as
 *                   expiry_period * 30 days. Not calendar months.
 *   enroll_status   'valid' | 'expired' | false, exactly as the helper returned.
 *
 * CORRECTION: Laravel wrote strtotime() -- a unix integer -- into
 * enrollments.expiry_date, which is a datetime column. Postgres rejects an
 * integer there, so we store a real timestamp, which is what the column always
 * claimed to hold. Comparisons are date comparisons.
 */
import type { Db } from '../db/client.ts';
import { HttpError } from '../http/errors.ts';

export type EnrollStatus = 'valid' | 'expired' | false;
export type EnrollmentType = 'free' | 'paid' | 'admin' | 'team' | 'offline';

export function expiryDateFor(expiryPeriodMonths: number | null | undefined): string | null {
  const months = Number(expiryPeriodMonths ?? 0);
  if (!(months > 0)) return null;
  const at = new Date();
  at.setDate(at.getDate() + months * 30);
  return at.toISOString();
}

export class EnrollmentService {
  #db: Db;
  constructor(db: Db) { this.#db = db; }

  /** Port of enroll_status(). */
  async status(courseId: number, userId: number): Promise<EnrollStatus> {
    const { data } = await this.#db.from('enrollments')
      .select('id, expiry_date').eq('course_id', courseId).eq('user_id', userId).maybeSingle();
    if (!data) return false;
    if (!data.expiry_date) return 'valid';
    return new Date(data.expiry_date).getTime() >= Date.now() ? 'valid' : 'expired';
  }

  async isActivelyEnrolled(courseId: number, userId: number): Promise<boolean> {
    return (await this.status(courseId, userId)) === 'valid';
  }

  /**
   * Guards shared by "add to cart", "buy" and "enrol free", so the three paths
   * cannot disagree about who may enrol.
   */
  async assertEnrollable(courseId: number, userId: number) {
    const { data: course } = await this.#db.from('courses')
      .select('id, user_id, is_paid, price, discount_flag, discounted_price, expiry_period, status, title, slug')
      .eq('id', courseId).maybeSingle();
    if (!course) throw new HttpError(404, 'Data not found.');

    if (course.user_id === userId) {
      throw new HttpError(422, 'Ops! You own this course.');
    }
    if (await this.isActivelyEnrolled(courseId, userId)) {
      throw new HttpError(422, 'You already enrolled in this course');
    }
    return course;
  }

  async enroll(courseId: number, userId: number, type: EnrollmentType) {
    const { data: course } = await this.#db.from('courses')
      .select('id, expiry_period').eq('id', courseId).maybeSingle();
    if (!course) throw new HttpError(404, 'Data not found.');

    const now = new Date().toISOString();
    const row = {
      user_id: userId,
      course_id: courseId,
      enrollment_type: type,
      expiry_date: expiryDateFor(course.expiry_period),
      entry_date: Math.floor(Date.now() / 1000),
      created_at: now,
      updated_at: now,
    };

    // Re-enrolling after expiry replaces the old row rather than stacking, so
    // enroll_status stays single-valued.
    const { data: existing } = await this.#db.from('enrollments')
      .select('id').eq('course_id', courseId).eq('user_id', userId).maybeSingle();

    const { error } = existing
      ? await this.#db.from('enrollments').update(row).eq('id', existing.id)
      : await this.#db.from('enrollments').insert(row);
    if (error) throw new HttpError(500, `Enrolment failed: ${error.message}`);
    return { course_id: courseId, user_id: userId, expiry_date: row.expiry_date };
  }

  /** E-05: free courses enrol immediately, no payment path. */
  async enrollFree(courseId: number, userId: number) {
    const course = await this.assertEnrollable(courseId, userId);
    if (course.is_paid) throw new HttpError(422, 'This course is not free.');
    await this.enroll(courseId, userId, 'free');
    // Clear it from the cart so it cannot be "bought" afterwards.
    await this.#db.from('cart_items').delete().eq('user_id', userId).eq('course_id', courseId);
    return course;
  }

  /** E-06: admin enrols a student directly. */
  async enrollManually(courseId: number, userId: number) {
    const { data: user } = await this.#db.from('users').select('id').eq('id', userId).maybeSingle();
    if (!user) throw new HttpError(404, 'Student not found.');
    if (await this.isActivelyEnrolled(courseId, userId)) {
      throw new HttpError(422, 'This student is already enrolled in that course.');
    }
    return this.enroll(courseId, userId, 'admin');
  }

  async remove(enrollmentId: number): Promise<void> {
    const { error } = await this.#db.from('enrollments').delete().eq('id', enrollmentId);
    if (error) throw new HttpError(500, `Could not delete the enrolment: ${error.message}`);
  }
}
