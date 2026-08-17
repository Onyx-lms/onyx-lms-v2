/**
 * REV-04 / REV-05 -- instructor payouts.
 *
 * `payouts.status` is 0 for a pending request and 1 for one that has been paid.
 *
 * WHERE THE PAYOUT DETAILS LIVE. Laravel's PayoutSettingsController wrote them
 * to `users.paymentkeys`:
 *     User::where('id', ...)->update(['paymentkeys' => $data]);
 * There IS no `paymentkeys` column on users -- the table has 21 columns and
 * that is not one of them, so the update fails. Meanwhile `payouts` already
 * carries `payment_method` and `payment_details`, which the request flow never
 * filled in. The details are captured per request here, which needs no schema
 * change and is more correct anyway: bank details can change between payouts.
 */
import type { Db } from '../db/client.ts';
import { HttpError } from '../http/errors.ts';
import { phpJsonEncode, phpJsonDecode } from '../json/php-json.ts';
import type { RevenueService } from './revenue.service.ts';

const COLUMNS = 'id, user_id, amount, status, payment_method, payment_details, created_at, updated_at';

export const PAYOUT_PENDING = 0;
export const PAYOUT_PAID = 1;

export class PayoutService {
  #db: Db;
  #revenue: RevenueService;
  constructor(db: Db, revenue: RevenueService) {
    this.#db = db;
    this.#revenue = revenue;
  }

  /** Ports instructor_total_payout(): only what has actually been paid. */
  async totalPaid(instructorId: number): Promise<number> {
    const { data } = await this.#db.from('payouts')
      .select('amount').eq('user_id', instructorId).eq('status', PAYOUT_PAID);
    return Math.round((data ?? []).reduce((t, r) => t + Number(r.amount ?? 0), 0) * 100) / 100;
  }

  async pendingFor(instructorId: number) {
    const { data } = await this.#db.from('payouts')
      .select(COLUMNS).eq('user_id', instructorId).eq('status', PAYOUT_PENDING).maybeSingle();
    return data ? this.#decode(data) : null;
  }

  /** Ports instructor_available_balance(): earned minus paid out. */
  async balance(instructorId: number) {
    const earned = await this.#revenue.instructorRevenue(instructorId);
    const paid = await this.totalPaid(instructorId);
    const pending = await this.pendingFor(instructorId);
    const requested = pending ? Number((pending as { amount: unknown }).amount ?? 0) : 0;
    return {
      earned,
      paid,
      available: Math.round((earned - paid) * 100) / 100,
      // A pending request is money already claimed, so show it separately
      // rather than letting it look spendable.
      pending: requested,
      requestable: Math.round((earned - paid - requested) * 100) / 100,
    };
  }

  async listFor(instructorId: number) {
    const { data } = await this.#db.from('payouts')
      .select(COLUMNS).eq('user_id', instructorId).order('id', { ascending: false });
    return (data ?? []).map((r) => this.#decode(r));
  }

  /** REV-04 admin queue. status omitted means everything. */
  async list(status?: number) {
    let query = this.#db.from('payouts').select(COLUMNS).order('id', { ascending: false });
    if (status !== undefined) query = query.eq('status', status);
    const { data } = await query;
    const rows = data ?? [];

    const ids = [...new Set(rows.map((r) => Number(r.user_id)).filter(Boolean))];
    const { data: users } = ids.length
      ? await this.#db.from('users').select('id, name, email').in('id', ids)
      : { data: [] };
    const byId = new Map((users ?? []).map((u) => [u.id, u]));
    return rows.map((r) => ({ ...this.#decode(r), user: byId.get(Number(r.user_id)) ?? null }));
  }

  /**
   * REV-04 -- request a payout. One at a time, and never more than the balance.
   */
  async request(instructorId: number, amount: number, input: {
    payment_method: string; payment_details?: Record<string, unknown>;
  }) {
    if (await this.pendingFor(instructorId)) {
      throw new HttpError(422, 'Your request is in process.');
    }
    const { available } = await this.balance(instructorId);
    if (!(amount >= 1) || amount > available) {
      throw new HttpError(422, 'You do not have sufficient balance.');
    }

    // Laravel used Payout::insert(), which skips Eloquent timestamps, so
    // created_at stayed NULL -- and the instructor's own history list filters
    // on created_at, so the request they had just made was invisible to them.
    const now = new Date().toISOString();
    const { data, error } = await this.#db.from('payouts').insert({
      user_id: instructorId,
      amount,
      status: PAYOUT_PENDING,
      payment_method: input.payment_method.trim(),
      payment_details: input.payment_details
        ? phpJsonEncode(input.payment_details) : null,
      created_at: now, updated_at: now,
    }).select(COLUMNS).maybeSingle();
    if (error) throw new HttpError(500, 'Could not submit the request: ' + error.message);
    return this.#decode(data as Record<string, unknown>);
  }

  /** An instructor may withdraw their own request, while it is still pending. */
  async withdraw(id: number, instructorId: number): Promise<void> {
    const { data } = await this.#db.from('payouts')
      .select('id, user_id, status').eq('id', id).maybeSingle();
    if (!data || Number(data.user_id) !== instructorId) {
      throw new HttpError(404, 'Data not found.');
    }
    // Deleting a paid payout would make the balance recalculate as if it had
    // never been sent, handing the money back.
    if (data.status === PAYOUT_PAID) {
      throw new HttpError(422, 'That payout has already been paid.');
    }
    await this.#db.from('payouts').delete().eq('id', id);
  }

  /** REV-04 -- an admin marks a request paid. */
  async markPaid(id: number, note?: { payment_method?: string }) {
    const { data } = await this.#db.from('payouts')
      .select(COLUMNS).eq('id', id).maybeSingle();
    if (!data) throw new HttpError(404, 'Data not found.');
    if (data.status === PAYOUT_PAID) {
      throw new HttpError(422, 'That payout has already been paid.');
    }
    const row: Record<string, unknown> = {
      status: PAYOUT_PAID, updated_at: new Date().toISOString(),
    };
    if (note?.payment_method) row['payment_method'] = note.payment_method;
    await this.#db.from('payouts').update(row as never).eq('id', id);
    return { id, status: PAYOUT_PAID };
  }

  #decode(row: Record<string, unknown>) {
    return {
      ...row,
      amount: Number(row['amount'] ?? 0),
      payment_details: phpJsonDecode<Record<string, unknown> | null>(
        row['payment_details'] as string, null),
    };
  }
}
