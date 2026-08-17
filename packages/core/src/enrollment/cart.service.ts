/**
 * E-01 / E-02 -- wishlist and cart.
 */
import type { Db } from '../db/client.ts';
import { HttpError } from '../http/errors.ts';
import type { EnrollmentService } from './enrollment.service.ts';
import type { CouponService, AppliedCoupon } from './coupon.service.ts';

const COURSE_COLUMNS = 'id, title, slug, thumbnail, is_paid, price, discount_flag, discounted_price, user_id, level, language';

/** Effective price: the discounted one when a discount is flagged. */
export function effectivePrice(c: {
  is_paid: number | null; price: number | null;
  discount_flag: number | null; discounted_price: number | null;
}): number {
  if (!c.is_paid) return 0;
  if (c.discount_flag && c.discounted_price != null) return Number(c.discounted_price);
  return Number(c.price ?? 0);
}

export class WishlistService {
  #db: Db;
  constructor(db: Db) { this.#db = db; }

  /** @returns true when the course is now on the list. */
  async toggle(userId: number, courseId: number): Promise<boolean> {
    const { data: existing } = await this.#db.from('wishlists')
      .select('id').eq('user_id', userId).eq('course_id', courseId).maybeSingle();
    if (existing) {
      await this.#db.from('wishlists').delete().eq('id', existing.id);
      return false;
    }
    const now = new Date().toISOString();
    await this.#db.from('wishlists')
      .insert({ user_id: userId, course_id: courseId, created_at: now, updated_at: now });
    return true;
  }

  async courseIds(userId: number): Promise<number[]> {
    const { data } = await this.#db.from('wishlists').select('course_id').eq('user_id', userId);
    return (data ?? []).map((r) => r.course_id).filter(Boolean) as number[];
  }

  async list(userId: number) {
    const ids = await this.courseIds(userId);
    if (!ids.length) return [];
    const { data } = await this.#db.from('courses').select(COURSE_COLUMNS).in('id', ids);
    return data ?? [];
  }
}

export interface CartSummary {
  items: Record<string, unknown>[];
  subtotal: number;
  discount: number;
  total: number;
  coupon: AppliedCoupon | null;
}

export class CartService {
  #db: Db;
  #enrollment: EnrollmentService;
  #coupons: CouponService;

  constructor(db: Db, enrollment: EnrollmentService, coupons: CouponService) {
    this.#db = db;
    this.#enrollment = enrollment;
    this.#coupons = coupons;
  }

  async add(userId: number, courseId: number) {
    // Same guards as buying: you cannot cart your own course, nor one you
    // already have active access to.
    await this.#enrollment.assertEnrollable(courseId, userId);
    const { data: existing } = await this.#db.from('cart_items')
      .select('id').eq('user_id', userId).eq('course_id', courseId).maybeSingle();
    if (existing) return;
    const now = new Date().toISOString();
    const { error } = await this.#db.from('cart_items')
      .insert({ user_id: userId, course_id: courseId, created_at: now, updated_at: now });
    if (error) throw new HttpError(500, `Could not add to cart: ${error.message}`);
  }

  async remove(userId: number, courseId: number): Promise<void> {
    await this.#db.from('cart_items').delete().eq('user_id', userId).eq('course_id', courseId);
  }

  async clear(userId: number): Promise<void> {
    await this.#db.from('cart_items').delete().eq('user_id', userId);
  }

  async summary(userId: number, couponCode?: string): Promise<CartSummary> {
    const { data: rows } = await this.#db.from('cart_items')
      .select('id, course_id').eq('user_id', userId).order('id');
    const ids = (rows ?? []).map((r) => r.course_id).filter(Boolean) as number[];
    if (!ids.length) {
      return { items: [], subtotal: 0, discount: 0, total: 0, coupon: null };
    }

    const { data: courses } = await this.#db.from('courses').select(COURSE_COLUMNS).in('id', ids);
    const byId = new Map((courses ?? []).map((c) => [c.id, c]));

    const items = (rows ?? []).flatMap((r) => {
      const course = byId.get(r.course_id as number);
      if (!course) return [];
      return [{ ...course, cart_id: r.id, effective_price: effectivePrice(course) }];
    });

    const subtotal = Math.round(
      items.reduce((sum, i) => sum + i.effective_price, 0) * 100) / 100;

    let coupon: AppliedCoupon | null = null;
    if (couponCode) coupon = await this.#coupons.apply(couponCode, subtotal);

    const discount = coupon?.amount_off ?? 0;
    return {
      items,
      subtotal,
      discount,
      total: Math.max(0, Math.round((subtotal - discount) * 100) / 100),
      coupon,
    };
  }
}
