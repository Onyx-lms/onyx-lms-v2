/**
 * BC-06 -- bootcamp purchases.
 *
 * ONE INCONSISTENCY TO KNOW ABOUT. `discounted_price` means different things
 * for a course and for a bootcamp, and both meanings live in the same Laravel
 * file, fifty lines apart:
 *
 *   Admin/OfflinePaymentController.php:91   (course)
 *     $amount = $course->discount_flag == 1 ? $course->discounted_price : $course->price;
 *       -> discounted_price IS the final price
 *
 *   Admin/OfflinePaymentController.php:144  (bootcamp)
 *     $price = $bootcamp->discount_flag == 1
 *              ? $bootcamp->price - $bootcamp->discounted_price : $bootcamp->price;
 *       -> discounted_price is the AMOUNT TAKEN OFF
 *
 * Both are preserved as they are. Reading the bootcamp column the course way
 * would overcharge every discounted workshop.
 */
import type { Db } from '../db/client.ts';
import { HttpError } from '../http/errors.ts';
import type { SettingsService } from '../settings/settings.service.ts';

const COLUMNS = 'id, bootcamp_id, user_id, price, admin_revenue, instructor_revenue, payment_type, payment_info, transaction_id, status, invoice, tax, payment_method, created_at, updated_at';

export interface BootcampPricing {
  is_paid: number | null;
  price: number | null;
  discount_flag: number | null;
  discounted_price: number | null;
}

/** The amount actually charged for a bootcamp. See the note above. */
export function bootcampPrice(b: BootcampPricing): number {
  if (!b.is_paid) return 0;
  const list = Number(b.price ?? 0);
  if (!b.discount_flag) return list;
  const off = Number(b.discounted_price ?? 0);
  // A discount larger than the price would otherwise produce a negative charge.
  return Math.max(0, list - off);
}

export class BootcampPurchaseService {
  #db: Db;
  #settings: SettingsService;
  constructor(db: Db, settings: SettingsService) {
    this.#db = db;
    this.#settings = settings;
  }

  /** Laravel used '#' . Str::random(20); same shape, CSPRNG source. */
  newInvoice(): string {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let out = '';
    for (const b of crypto.getRandomValues(new Uint8Array(20))) out += alphabet[b % alphabet.length];
    return out;
  }

  /** Ports is_purchased_bootcamp(). */
  async hasPurchased(bootcampId: number, userId: number): Promise<boolean> {
    const { data } = await this.#db.from('bootcamp_purchases')
      .select('id').eq('bootcamp_id', bootcampId).eq('user_id', userId)
      .eq('status', 1).maybeSingle();
    return Boolean(data);
  }

  async forUser(userId: number) {
    const { data } = await this.#db.from('bootcamp_purchases')
      .select(COLUMNS).eq('user_id', userId).eq('status', 1)
      .order('id', { ascending: false });
    const rows = data ?? [];
    if (!rows.length) return [];

    const ids = [...new Set(rows.map((r) => Number(r.bootcamp_id)))];
    const { data: bootcamps } = await this.#db.from('bootcamps')
      .select('id, title, slug, thumbnail, short_description, user_id').in('id', ids);
    const byId = new Map((bootcamps ?? []).map((b) => [b.id, b]));
    return rows.map((r) => ({ ...r, bootcamp: byId.get(Number(r.bootcamp_id)) ?? null }));
  }

  async byInvoice(invoice: string, userId: number, isAdmin: boolean) {
    const { data } = await this.#db.from('bootcamp_purchases')
      .select(COLUMNS).eq('invoice', invoice).maybeSingle();
    if (!data) throw new HttpError(404, 'Invoice not found.');
    // Someone else's invoice is a 404, not a 403: its existence is private.
    if (!isAdmin && Number(data.user_id) !== userId) {
      throw new HttpError(404, 'Invoice not found.');
    }
    const { data: bootcamp } = await this.#db.from('bootcamps')
      .select('id, title, slug').eq('id', Number(data.bootcamp_id)).maybeSingle();
    const { data: buyer } = await this.#db.from('users')
      .select('id, name, email').eq('id', Number(data.user_id)).maybeSingle();
    return { ...data, bootcamp: bootcamp ?? null, user: buyer ?? null };
  }

  /**
   * Free enrolment. Laravel refused when the buyer owns the workshop or has
   * already bought it, and wrote a zero-revenue row.
   */
  async enrolFree(bootcampId: number, userId: number, invoice: string) {
    const bootcamp = await this.#requirePurchasable(bootcampId, userId);
    if (bootcamp.is_paid) throw new HttpError(422, 'This workshop is not free.');

    const now = new Date().toISOString();
    const { data, error } = await this.#db.from('bootcamp_purchases').insert({
      invoice, user_id: userId, bootcamp_id: bootcampId,
      price: 0, tax: 0, payment_method: 'free', status: 1,
      admin_revenue: 0, instructor_revenue: 0,
      created_at: now, updated_at: now,
    }).select(COLUMNS).maybeSingle();
    if (error) throw new HttpError(500, 'Could not enrol you: ' + error.message);
    return data;
  }

  /**
   * A paid purchase, once the gateway has confirmed. The revenue split reuses
   * the `instructor_revenue` setting that course payments use, so one number
   * governs the whole platform.
   */
  async record(input: {
    bootcampId: number; userId: number; invoice: string;
    price: number; tax?: number; paymentMethod: string;
    transactionId?: string | null; paymentInfo?: string | null;
  }) {
    const bootcamp = await this.#requirePurchasable(input.bootcampId, input.userId);

    const percent = Number((await this.#settings.get('instructor_revenue')) ?? 0);
    const instructorRevenue = bootcamp.is_paid
      ? Math.round(input.price * (percent / 100) * 100) / 100
      : 0;
    const adminRevenue = Math.round((input.price - instructorRevenue) * 100) / 100;

    const now = new Date().toISOString();
    const { data, error } = await this.#db.from('bootcamp_purchases').insert({
      invoice: input.invoice,
      user_id: input.userId,
      bootcamp_id: input.bootcampId,
      price: input.price,
      tax: input.tax ?? 0,
      payment_method: input.paymentMethod,
      transaction_id: input.transactionId ?? null,
      payment_info: input.paymentInfo ?? null,
      status: 1,
      admin_revenue: adminRevenue,
      instructor_revenue: instructorRevenue,
      created_at: now, updated_at: now,
    }).select(COLUMNS).maybeSingle();
    if (error) throw new HttpError(500, 'Could not record the purchase: ' + error.message);
    return data;
  }

  /** BC-06 -- what an instructor earned, and what the platform kept. */
  async revenueFor(instructorId: number) {
    const { data: mine } = await this.#db.from('bootcamps')
      .select('id').eq('user_id', instructorId);
    const ids = (mine ?? []).map((b) => b.id);
    if (!ids.length) return { sales: 0, gross: 0, instructor: 0, admin: 0 };

    const { data } = await this.#db.from('bootcamp_purchases')
      .select('price, admin_revenue, instructor_revenue').in('bootcamp_id', ids).eq('status', 1);
    const rows = data ?? [];
    const sum = (k: 'price' | 'admin_revenue' | 'instructor_revenue') =>
      Math.round(rows.reduce((a, r) => a + Number(r[k] ?? 0), 0) * 100) / 100;
    return {
      sales: rows.length,
      gross: sum('price'),
      instructor: sum('instructor_revenue'),
      admin: sum('admin_revenue'),
    };
  }

  async #requirePurchasable(bootcampId: number, userId: number) {
    const { data: bootcamp } = await this.#db.from('bootcamps')
      .select('id, user_id, is_paid, price, discount_flag, discounted_price, status')
      .eq('id', bootcampId).maybeSingle();
    if (!bootcamp || bootcamp.status !== 1) throw new HttpError(404, 'Workshop not found.');
    if (Number(bootcamp.user_id) === userId) throw new HttpError(422, 'You own this item.');
    if (await this.hasPurchased(bootcampId, userId)) {
      throw new HttpError(422, 'Item is already purchased.');
    }
    return bootcamp;
  }
}
