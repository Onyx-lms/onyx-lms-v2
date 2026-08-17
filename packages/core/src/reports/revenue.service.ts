/**
 * REV-01 / REV-02 / REV-03 / REV-06 -- money in, across all four product lines.
 *
 * Revenue lives in four different tables, each with its own instructor_revenue
 * and admin_revenue columns:
 *
 *   payment_histories        courses
 *   bootcamp_purchases       workshops
 *   team_package_purchases   classroom packages
 *   tutor_bookings           tuition sessions
 *
 * The Laravel helpers sum each one separately and add them up
 * (instructor_total_revenue). Same arithmetic here, one pass per table.
 */
import type { Db } from '../db/client.ts';
import { HttpError } from '../http/errors.ts';

export interface Period { from?: string; to?: string }

export interface RevenueLine {
  source: 'course' | 'bootcamp' | 'team_package' | 'tuition';
  count: number;
  gross: number;
  instructor: number;
  admin: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Sums a numeric column across rows, tolerating nulls and text numerics. */
export function sumOf(rows: Record<string, unknown>[], key: string): number {
  return round2(rows.reduce((total, r) => total + Number(r[key] ?? 0), 0));
}

export class RevenueService {
  #db: Db;
  constructor(db: Db) { this.#db = db; }

  #within(rows: Record<string, unknown>[], period: Period) {
    const from = period.from ? new Date(period.from).getTime() : null;
    const to = period.to ? new Date(period.to).getTime() : null;
    if (from === null && to === null) return rows;
    return rows.filter((r) => {
      const at = new Date(String(r['created_at'] ?? '')).getTime();
      if (!Number.isFinite(at)) return false;
      if (from !== null && at < from) return false;
      if (to !== null && at > to) return false;
      return true;
    });
  }

  /** REV-01 -- every line of revenue, optionally for one instructor. */
  async lines(period: Period = {}, instructorId?: number): Promise<RevenueLine[]> {
    const [courses, bootcamps, packages, tuition] = await Promise.all([
      this.courseRows(instructorId),
      this.bootcampRows(instructorId),
      this.packageRows(instructorId),
      this.tuitionRows(instructorId),
    ]);

    const line = (source: RevenueLine['source'], rows: Record<string, unknown>[]): RevenueLine => {
      const within = this.#within(rows, period);
      return {
        source,
        count: within.length,
        gross: sumOf(within, source === 'course' ? 'amount' : 'price'),
        instructor: sumOf(within, 'instructor_revenue'),
        admin: sumOf(within, 'admin_revenue'),
      };
    };
    return [
      line('course', courses),
      line('bootcamp', bootcamps),
      line('team_package', packages),
      line('tuition', tuition),
    ];
  }

  async totals(period: Period = {}, instructorId?: number) {
    const lines = await this.lines(period, instructorId);
    return {
      lines,
      gross: round2(lines.reduce((t, l) => t + l.gross, 0)),
      instructor: round2(lines.reduce((t, l) => t + l.instructor, 0)),
      admin: round2(lines.reduce((t, l) => t + l.admin, 0)),
      sales: lines.reduce((t, l) => t + l.count, 0),
    };
  }

  /** REV-02 -- ports instructor_total_revenue(). */
  async instructorRevenue(instructorId: number): Promise<number> {
    return (await this.totals({}, instructorId)).instructor;
  }

  /** REV-01 -- an admin may remove a revenue line. */
  async removeCourseEntry(id: number): Promise<void> {
    const { data } = await this.#db.from('payment_histories')
      .select('id').eq('id', id).maybeSingle();
    if (!data) throw new HttpError(404, 'Data not found.');
    await this.#db.from('payment_histories').delete().eq('id', id);
  }

  // Course revenue is scoped by who OWNS the course, as Laravel's join did.
  async courseRows(instructorId?: number) {
    const { data } = await this.#db.from('payment_histories')
      .select('id, user_id, course_id, amount, admin_revenue, instructor_revenue, tax, invoice, created_at');
    const rows = data ?? [];
    if (instructorId === undefined) return rows;

    const { data: mine } = await this.#db.from('courses')
      .select('id').eq('user_id', instructorId);
    const ids = new Set((mine ?? []).map((c) => c.id));
    return rows.filter((r) => ids.has(Number(r.course_id)));
  }

  async bootcampRows(instructorId?: number) {
    const { data } = await this.#db.from('bootcamp_purchases')
      .select('id, bootcamp_id, user_id, price, admin_revenue, instructor_revenue, invoice, created_at')
      .eq('status', 1);
    const rows = data ?? [];
    if (instructorId === undefined) return rows;

    const { data: mine } = await this.#db.from('bootcamps')
      .select('id').eq('user_id', instructorId);
    const ids = new Set((mine ?? []).map((b) => b.id));
    return rows.filter((r) => ids.has(Number(r.bootcamp_id)));
  }

  async packageRows(instructorId?: number) {
    const { data } = await this.#db.from('team_package_purchases')
      .select('id, package_id, user_id, price, admin_revenue, instructor_revenue, invoice, created_at')
      .eq('status', 1);
    const rows = data ?? [];
    if (instructorId === undefined) return rows;

    const { data: mine } = await this.#db.from('team_training_packages')
      .select('id').eq('user_id', instructorId);
    const ids = new Set((mine ?? []).map((p) => p.id));
    return rows.filter((r) => ids.has(Number(r.package_id)));
  }

  async tuitionRows(instructorId?: number) {
    let query = this.#db.from('tutor_bookings')
      .select('id, tutor_id, student_id, price, admin_revenue, instructor_revenue, invoice, created_at')
      .eq('status', 1);
    // Tuition is the only stream keyed directly on the instructor.
    if (instructorId !== undefined) query = query.eq('tutor_id', instructorId);
    const { data } = await query;
    return data ?? [];
  }

  /**
   * REV-06 -- the last N calendar months, for the chart. Months with no sales
   * appear as zero rather than being missing, so the axis never jumps.
   */
  async monthly(months = 12, instructorId?: number) {
    const now = new Date();
    const buckets: { month: string; gross: number; instructor: number; admin: number }[] = [];
    const index = new Map<string, number>();
    for (let i = months - 1; i >= 0; i--) {
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
      const key = d.toISOString().slice(0, 7);
      index.set(key, buckets.length);
      buckets.push({ month: key, gross: 0, instructor: 0, admin: 0 });
    }

    const [courses, bootcamps, packages, tuition] = await Promise.all([
      this.courseRows(instructorId), this.bootcampRows(instructorId),
      this.packageRows(instructorId), this.tuitionRows(instructorId),
    ]);
    const add = (rows: Record<string, unknown>[], amountKey: string) => {
      for (const r of rows) {
        const key = String(r['created_at'] ?? '').slice(0, 7);
        const at = index.get(key);
        if (at === undefined) continue;
        buckets[at]!.gross += Number(r[amountKey] ?? 0);
        buckets[at]!.instructor += Number(r['instructor_revenue'] ?? 0);
        buckets[at]!.admin += Number(r['admin_revenue'] ?? 0);
      }
    };
    add(courses, 'amount');
    add(bootcamps, 'price');
    add(packages, 'price');
    add(tuition, 'price');

    return buckets.map((b) => ({
      month: b.month, gross: round2(b.gross),
      instructor: round2(b.instructor), admin: round2(b.admin),
    }));
  }

  /**
   * REV-03 -- one buyer's purchases across all four product types, newest
   * first. The original had a separate screen per type.
   */
  async purchasesFor(userId: number) {
    const [courses, bootcamps, packages, tuition] = await Promise.all([
      this.#db.from('payment_histories')
        .select('id, course_id, amount, invoice, created_at').eq('user_id', userId),
      this.#db.from('bootcamp_purchases')
        .select('id, bootcamp_id, price, invoice, created_at').eq('user_id', userId).eq('status', 1),
      this.#db.from('team_package_purchases')
        .select('id, package_id, price, invoice, created_at').eq('user_id', userId).eq('status', 1),
      this.#db.from('tutor_bookings')
        .select('id, tutor_id, price, invoice, created_at').eq('student_id', userId).eq('status', 1),
    ]);

    const rows = [
      ...(courses.data ?? []).map((r) => ({
        kind: 'course' as const, id: r.id, reference: Number(r.course_id),
        amount: Number(r.amount ?? 0), invoice: r.invoice, created_at: r.created_at,
      })),
      ...(bootcamps.data ?? []).map((r) => ({
        kind: 'bootcamp' as const, id: r.id, reference: Number(r.bootcamp_id),
        amount: Number(r.price ?? 0), invoice: r.invoice, created_at: r.created_at,
      })),
      ...(packages.data ?? []).map((r) => ({
        kind: 'team_package' as const, id: r.id, reference: Number(r.package_id),
        amount: Number(r.price ?? 0), invoice: r.invoice, created_at: r.created_at,
      })),
      ...(tuition.data ?? []).map((r) => ({
        kind: 'tuition' as const, id: r.id, reference: Number(r.tutor_id),
        amount: Number(r.price ?? 0), invoice: r.invoice, created_at: r.created_at,
      })),
    ];
    return rows.sort((a, b) =>
      new Date(String(b.created_at ?? 0)).getTime()
      - new Date(String(a.created_at ?? 0)).getTime());
  }
}
