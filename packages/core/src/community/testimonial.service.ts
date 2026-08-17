/**
 * R-03 -- admin-managed testimonials for the home page.
 *
 * Backed by user_reviews (migration 0006). In Laravel the admin screens wrote
 * to a table no migration created, and nothing ever read it back -- the home
 * page rendered hard-coded page-builder copy instead. Here the same admin CRUD
 * feeds a real endpoint the home page reads, so the module actually works.
 *
 * rating is stored as a string, matching instructor_reviews.rating.
 */
import type { Db } from '../db/client.ts';
import type { Database } from '@onyx/types';
import { HttpError } from '../http/errors.ts';

type UserReviewUpdate = Database['public']['Tables']['user_reviews']['Update'];

const COLUMNS = 'id, user_id, rating, review, created_at';

export class TestimonialService {
  #db: Db;
  constructor(db: Db) { this.#db = db; }

  /** Public list for the home page, newest first. */
  async published(limit = 6) {
    const { data } = await this.#db.from('user_reviews')
      .select(COLUMNS).order('id', { ascending: false }).limit(limit);
    return this.#withUsers(data ?? []);
  }

  async all() {
    const { data } = await this.#db.from('user_reviews')
      .select(COLUMNS).order('id', { ascending: false });
    return this.#withUsers(data ?? []);
  }

  async find(id: number) {
    const { data } = await this.#db.from('user_reviews')
      .select(COLUMNS).eq('id', id).maybeSingle();
    if (!data) throw new HttpError(404, 'Testimonial not found.');
    return (await this.#withUsers([data]))[0];
  }

  async create(input: { user_id: number; rating: number; review: string }) {
    const { data: user } = await this.#db.from('users')
      .select('id').eq('id', input.user_id).maybeSingle();
    if (!user) throw new HttpError(422, 'The selected user does not exist.');

    const now = new Date().toISOString();
    const { data, error } = await this.#db.from('user_reviews').insert({
      user_id: input.user_id,
      rating: String(input.rating),
      review: input.review.trim(),
      created_at: now, updated_at: now,
    }).select('id').maybeSingle();
    if (error) throw new HttpError(500, 'Could not save the testimonial: ' + error.message);
    // Through find() so create and list agree on the shape -- rating comes back
    // as a number and the quoted user is attached either way.
    return this.find(data!.id);
  }

  async update(id: number, input: { user_id?: number; rating?: number; review?: string }) {
    await this.find(id);
    const row: UserReviewUpdate = { updated_at: new Date().toISOString() };
    if (input.user_id !== undefined) row.user_id = input.user_id;
    if (input.rating !== undefined) row.rating = String(input.rating);
    if (input.review !== undefined) row.review = input.review.trim();
    await this.#db.from('user_reviews').update(row).eq('id', id);
    return this.find(id);
  }

  async remove(id: number): Promise<void> {
    await this.find(id);
    await this.#db.from('user_reviews').delete().eq('id', id);
  }

  /** Attaches the quoted person; a deleted user leaves the quote intact. */
  async #withUsers(rows: Record<string, unknown>[]) {
    const ids = [...new Set(rows.map((r) => r['user_id']).filter(Boolean))] as number[];
    const { data: users } = ids.length
      ? await this.#db.from('users').select('id, name, photo, role').in('id', ids)
      : { data: [] };
    const byId = new Map((users ?? []).map((u) => [u.id, u]));
    return rows.map((r) => ({
      ...r,
      rating: Number(r['rating'] ?? 0),
      user: byId.get(r['user_id'] as number) ?? null,
    }));
  }
}
