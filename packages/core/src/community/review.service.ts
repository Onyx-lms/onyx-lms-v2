/**
 * R-01 / R-02 -- course and instructor reviews.
 *
 * A course review requires an enrolment: unenrolled accounts rating courses is
 * how review sections get gamed. One review per student per course, editable
 * afterwards -- the rule the Laravel screens enforced.
 */
import type { Db } from '../db/client.ts';
import { HttpError } from '../http/errors.ts';

export interface RatingSummary {
  average: number;
  count: number;
  breakdown: Record<string, number>;
}

function summarise(ratings: number[]): RatingSummary {
  const valid = ratings.map(Number).filter((n) => n > 0);
  const breakdown: Record<string, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const r of valid) {
    const bucket = String(Math.min(5, Math.max(1, Math.round(r))));
    breakdown[bucket] = (breakdown[bucket] ?? 0) + 1;
  }
  return {
    average: valid.length
      ? Math.round((valid.reduce((a, b) => a + b, 0) / valid.length) * 10) / 10 : 0,
    count: valid.length,
    breakdown,
  };
}

export class ReviewService {
  #db: Db;
  constructor(db: Db) { this.#db = db; }

  async forCourse(courseId: number) {
    const { data } = await this.#db.from('reviews')
      .select('id, user_id, course_id, rating, review, review_type, created_at')
      .eq('course_id', courseId).order('id', { ascending: false });
    const rows = data ?? [];

    const userIds = [...new Set(rows.map((r) => r.user_id).filter(Boolean))] as number[];
    const { data: users } = userIds.length
      ? await this.#db.from('users').select('id, name, photo').in('id', userIds)
      : { data: [] };
    const byId = new Map((users ?? []).map((u) => [u.id, u]));
    const reactions = await this.reactionCounts(rows.map((r) => r.id));

    return {
      summary: summarise(rows.map((r) => Number(r.rating ?? 0))),
      reviews: rows.map((r) => ({
        ...r,
        user: byId.get(r.user_id as number) ?? null,
        likes: reactions.get(r.id)?.likes ?? 0,
        dislikes: reactions.get(r.id)?.dislikes ?? 0,
      })),
    };
  }

  async mine(courseId: number, userId: number) {
    const { data } = await this.#db.from('reviews')
      .select('id, rating, review, created_at')
      .eq('course_id', courseId).eq('user_id', userId).maybeSingle();
    return data ?? null;
  }

  /** Creates or updates: one review per student per course. */
  async submit(courseId: number, userId: number, rating: number, review: string) {
    const { data: enrolled } = await this.#db.from('enrollments')
      .select('id').eq('course_id', courseId).eq('user_id', userId).maybeSingle();
    if (!enrolled) {
      throw new HttpError(403, 'Only enrolled students can review this course.');
    }
    if (!(rating >= 1 && rating <= 5)) {
      throw new HttpError(422, 'The given data was invalid.',
        { errors: { rating: ['A rating must be between 1 and 5.'] } });
    }

    const now = new Date().toISOString();
    const existing = await this.mine(courseId, userId);
    if (existing) {
      await this.#db.from('reviews')
        .update({ rating, review: review.trim(), updated_at: now }).eq('id', existing.id);
      return { ...existing, rating, review };
    }
    const { data, error } = await this.#db.from('reviews').insert({
      user_id: userId, course_id: courseId, rating, review: review.trim(),
      review_type: 'course', created_at: now, updated_at: now,
    }).select('id, rating, review, created_at').maybeSingle();
    if (error) throw new HttpError(500, 'Could not save the review: ' + error.message);
    return data;
  }

  async remove(id: number, userId: number, isAdmin: boolean): Promise<void> {
    const { data } = await this.#db.from('reviews')
      .select('id, user_id').eq('id', id).maybeSingle();
    if (!data) throw new HttpError(404, 'Review not found.');
    if (!isAdmin && data.user_id !== userId) {
      throw new HttpError(403, 'This action is unauthorized.');
    }
    await this.#db.from('like_dislike_reviews').delete().eq('review_id', id);
    await this.#db.from('reviews').delete().eq('id', id);
  }

  /** One vote per user per review; voting the same way again clears it. */
  async react(reviewId: number, userId: number, reaction: 'like' | 'dislike') {
    const { data: existing } = await this.#db.from('like_dislike_reviews')
      .select('id, liked, disliked').eq('review_id', reviewId).eq('user_id', userId).maybeSingle();

    const row = reaction === 'like' ? { liked: 1, disliked: 0 } : { liked: 0, disliked: 1 };
    const now = new Date().toISOString();
    if (existing) {
      const alreadyThis = reaction === 'like' ? existing.liked : existing.disliked;
      if (alreadyThis) {
        await this.#db.from('like_dislike_reviews').delete().eq('id', existing.id);
      } else {
        await this.#db.from('like_dislike_reviews')
          .update({ ...row, updated_at: now }).eq('id', existing.id);
      }
    } else {
      await this.#db.from('like_dislike_reviews')
        .insert({ review_id: reviewId, user_id: userId, ...row, created_at: now, updated_at: now });
    }
    return (await this.reactionCounts([reviewId])).get(reviewId) ?? { likes: 0, dislikes: 0 };
  }

  async reactionCounts(ids: number[]): Promise<Map<number, { likes: number; dislikes: number }>> {
    const out = new Map<number, { likes: number; dislikes: number }>();
    if (!ids.length) return out;
    const { data } = await this.#db.from('like_dislike_reviews')
      .select('review_id, liked, disliked').in('review_id', ids);
    for (const r of data ?? []) {
      const id = Number(r.review_id);
      const current = out.get(id) ?? { likes: 0, dislikes: 0 };
      if (r.liked) current.likes += 1;
      if (r.disliked) current.dislikes += 1;
      out.set(id, current);
    }
    return out;
  }
}

/** R-02 -- reviews of an instructor rather than a course. */
export class InstructorReviewService {
  #db: Db;
  constructor(db: Db) { this.#db = db; }

  async forInstructor(instructorId: number) {
    const { data } = await this.#db.from('instructor_reviews')
      .select('id, user_id, instructor_id, rating, review, created_at')
      .eq('instructor_id', instructorId).order('id', { ascending: false });
    const rows = data ?? [];

    const userIds = [...new Set(rows.map((r) => r.user_id).filter(Boolean))] as number[];
    const { data: users } = userIds.length
      ? await this.#db.from('users').select('id, name, photo').in('id', userIds)
      : { data: [] };
    const byId = new Map((users ?? []).map((u) => [u.id, u]));

    const ratings = rows.map((r) => Number(r.rating ?? 0)).filter((n) => n > 0);
    return {
      summary: {
        average: ratings.length
          ? Math.round((ratings.reduce((a, b) => a + b, 0) / ratings.length) * 10) / 10 : 0,
        count: ratings.length,
      },
      reviews: rows.map((r) => ({ ...r, user: byId.get(r.user_id as number) ?? null })),
    };
  }

  async submit(instructorId: number, userId: number, rating: number, review: string) {
    if (instructorId === userId) throw new HttpError(422, 'You cannot review yourself.');
    if (!(rating >= 1 && rating <= 5)) {
      throw new HttpError(422, 'The given data was invalid.',
        { errors: { rating: ['A rating must be between 1 and 5.'] } });
    }

    const { data: existing } = await this.#db.from('instructor_reviews')
      .select('id').eq('instructor_id', instructorId).eq('user_id', userId).maybeSingle();

    const now = new Date().toISOString();
    if (existing) {
      await this.#db.from('instructor_reviews')
        // instructor_reviews.rating is varchar, while reviews.rating is integer.
        // Another inconsistency in the original schema, preserved as-is.
        .update({ rating: String(rating), review: review.trim(), updated_at: now })
        .eq('id', existing.id);
      return { id: existing.id, rating, review };
    }
    const { data, error } = await this.#db.from('instructor_reviews').insert({
      instructor_id: instructorId, user_id: userId,
      rating: String(rating), review: review.trim(),
      created_at: now, updated_at: now,
    }).select('id, rating, review').maybeSingle();
    if (error) throw new HttpError(500, 'Could not save the review: ' + error.message);
    return data;
  }
}
