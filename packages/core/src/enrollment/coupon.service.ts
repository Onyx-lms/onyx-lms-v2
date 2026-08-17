/**
 * E-03 -- coupons.
 *
 * DIVERGENCE FROM LARAVEL, on purpose.
 *
 * CartController checks `if ($coupon->status && (time() >= $coupon->expiry))`,
 * and CouponController stores status as the string "0" or "1". In PHP the
 * string "0" is falsy, so a DISABLED coupon skips the expiry check entirely and
 * is accepted forever. Disabled, expired coupons still discount orders.
 *
 * That is a revenue bug, not behaviour worth reproducing. Here a coupon must be
 * BOTH active AND unexpired. The messages and the arithmetic are unchanged.
 */
import type { Db } from '../db/client.ts';
import { HttpError } from '../http/errors.ts';

export interface AppliedCoupon {
  code: string;
  discount: number;
  amount_off: number;
}

/** The status column is varchar but the app writes "1" / "0". */
export function isCouponActive(status: string | null | undefined): boolean {
  const v = String(status ?? '').trim().toLowerCase();
  return v === '1' || v === 'active' || v === 'true';
}

/** expiry is a varchar holding a unix timestamp; a date string is tolerated. */
export function couponExpiryMs(expiry: string | null | undefined): number | null {
  if (!expiry) return null;
  const raw = String(expiry).trim();
  if (/^\d+$/.test(raw)) {
    const n = Number(raw);
    return n < 1e12 ? n * 1000 : n;   // below ~1e12 means seconds
  }
  const parsed = Date.parse(raw);
  return Number.isNaN(parsed) ? null : parsed;
}

export class CouponService {
  #db: Db;
  constructor(db: Db) { this.#db = db; }

  async list() {
    const { data, error } = await this.#db.from('coupons')
      .select('id, code, discount, expiry, status, user_id, created_at')
      .order('id', { ascending: false });
    if (error) throw new HttpError(500, `coupons.list failed: ${error.message}`);
    return data ?? [];
  }

  async create(input: { code: string; discount: number; expiry: string; status?: string }) {
    const code = input.code.trim().toUpperCase();
    const { data: taken } = await this.#db.from('coupons')
      .select('id').eq('code', code).maybeSingle();
    if (taken) {
      throw new HttpError(422, 'The given data was invalid.', {
        errors: { code: ['That coupon code already exists.'] },
      });
    }
    const now = new Date().toISOString();
    const { data, error } = await this.#db.from('coupons').insert({
      code, discount: input.discount, expiry: input.expiry,
      status: input.status ?? '1', created_at: now, updated_at: now,
    }).select('id, code, discount, expiry, status').maybeSingle();
    if (error) throw new HttpError(500, `coupons.create failed: ${error.message}`);
    return data;
  }

  async toggleStatus(id: number) {
    const { data } = await this.#db.from('coupons').select('id, status').eq('id', id).maybeSingle();
    if (!data) throw new HttpError(404, 'Coupon not found.');
    const next = isCouponActive(data.status) ? '0' : '1';
    await this.#db.from('coupons').update({ status: next }).eq('id', id);
    return { id, status: next };
  }

  async remove(id: number): Promise<void> {
    const { error } = await this.#db.from('coupons').delete().eq('id', id);
    if (error) throw new HttpError(500, `coupons.delete failed: ${error.message}`);
  }

  /** `discount` is a percentage, matching how the Laravel cart applies it. */
  async apply(code: string, subtotal: number): Promise<AppliedCoupon> {
    const { data } = await this.#db.from('coupons')
      .select('id, code, discount, expiry, status')
      .eq('code', code.trim().toUpperCase()).maybeSingle();

    if (!data) throw new HttpError(422, 'This coupon is not valid.');
    if (!isCouponActive(data.status)) throw new HttpError(422, 'This coupon is not valid.');

    const expiresAt = couponExpiryMs(data.expiry);
    if (expiresAt !== null && Date.now() >= expiresAt) {
      throw new HttpError(422, 'Ops! coupon is expired.');
    }

    const percent = Math.max(0, Math.min(100, Number(data.discount ?? 0)));
    return {
      code: data.code ?? code,
      discount: percent,
      amount_off: Math.round(((subtotal * percent) / 100) * 100) / 100,
    };
  }
}
