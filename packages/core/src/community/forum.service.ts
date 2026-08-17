/**
 * FOR-01 / FOR-02 / FOR-03 -- the per-course Q&A forum.
 *
 * forums is self-referencing: parent_id = 0 is a question, anything else is a
 * reply to that question. No FKs exist, so the tree is assembled here.
 */
import type { Db } from '../db/client.ts';
import type { Database } from '@onyx/types';
import { HttpError } from '../http/errors.ts';
import { paginate, type PageQuery, type Paginated } from '../http/pagination.ts';
import { phpJsonDecode, phpJsonEncode } from '../json/php-json.ts';

type ForumUpdate = Database['public']['Tables']['forums']['Update'];

const COLUMNS = 'id, user_id, course_id, parent_id, title, description, likes, dislikes, created_at';

export class ForumService {
  #db: Db;
  constructor(db: Db) { this.#db = db; }

  async questions(courseId: number, search: string | undefined,
                  page: PageQuery, path: string): Promise<Paginated<unknown>> {
    let query = this.#db.from('forums')
      .select(COLUMNS, { count: 'exact' })
      .eq('course_id', courseId).eq('parent_id', 0);
    if (search) {
      query = query.or('title.ilike.%' + search + '%,description.ilike.%' + search + '%');
    }
    const { data, count, error } = await query
      .order('id', { ascending: false }).range(page.from, page.to);
    if (error) throw new HttpError(500, 'forum.questions failed: ' + error.message);

    const rows = data ?? [];
    const [authors, replyCounts] = await Promise.all([
      this.authors(rows.map((r) => r.user_id)),
      this.replyCounts(rows.map((r) => r.id)),
    ]);
    return paginate(rows.map((r) => ({
      ...r,
      user: authors.get(r.user_id as number) ?? null,
      reply_count: replyCounts.get(r.id) ?? 0,
      likes: ForumService.tally(r.likes).count,
      dislikes: ForumService.tally(r.dislikes).count,
    })), count ?? 0, page, path);
  }

  async thread(questionId: number) {
    const { data: question } = await this.#db.from('forums')
      .select(COLUMNS).eq('id', questionId).maybeSingle();
    if (!question || question.parent_id !== 0) throw new HttpError(404, 'Question not found.');

    const { data: replies } = await this.#db.from('forums')
      .select(COLUMNS).eq('parent_id', questionId).order('id');

    const rows = [question, ...(replies ?? [])];
    const authors = await this.authors(rows.map((r) => r.user_id));
    return {
      question: { ...question, user: authors.get(question.user_id as number) ?? null },
      replies: (replies ?? []).map((r) => ({
        ...r, user: authors.get(r.user_id as number) ?? null,
      })),
    };
  }

  async ask(courseId: number, userId: number, title: string, description: string) {
    const now = new Date().toISOString();
    const { data, error } = await this.#db.from('forums').insert({
      course_id: courseId, user_id: userId, parent_id: 0,
      title: title.trim(), description: description.trim(),
      likes: null, dislikes: null, created_at: now, updated_at: now,
    }).select(COLUMNS).maybeSingle();
    if (error) throw new HttpError(500, 'Could not post the question: ' + error.message);
    return data;
  }

  async reply(questionId: number, userId: number, description: string) {
    const { data: question } = await this.#db.from('forums')
      .select('id, course_id, parent_id').eq('id', questionId).maybeSingle();
    if (!question || question.parent_id !== 0) throw new HttpError(404, 'Question not found.');

    const now = new Date().toISOString();
    const { data, error } = await this.#db.from('forums').insert({
      course_id: question.course_id, user_id: userId, parent_id: questionId,
      title: null, description: description.trim(),
      likes: null, dislikes: null, created_at: now, updated_at: now,
    }).select(COLUMNS).maybeSingle();
    if (error) throw new HttpError(500, 'Could not post the reply: ' + error.message);
    return data;
  }

  /** Only the author may edit or delete their own post. */
  async update(id: number, userId: number, patch: { title?: string; description?: string }) {
    const { data } = await this.#db.from('forums')
      .select('id, user_id').eq('id', id).maybeSingle();
    if (!data) throw new HttpError(404, 'Post not found.');
    if (data.user_id !== userId) throw new HttpError(403, 'This action is unauthorized.');

    const row: ForumUpdate = { updated_at: new Date().toISOString() };
    if (patch.title !== undefined) row.title = patch.title.trim();
    if (patch.description !== undefined) row.description = patch.description.trim();
    await this.#db.from('forums').update(row).eq('id', id);
  }

  async remove(id: number, userId: number, isAdmin: boolean): Promise<void> {
    const { data } = await this.#db.from('forums')
      .select('id, user_id, parent_id').eq('id', id).maybeSingle();
    if (!data) throw new HttpError(404, 'Post not found.');
    if (!isAdmin && data.user_id !== userId) {
      throw new HttpError(403, 'This action is unauthorized.');
    }
    // Deleting a question takes its replies with it, or they orphan.
    if (data.parent_id === 0) await this.#db.from('forums').delete().eq('parent_id', id);
    await this.#db.from('forums').delete().eq('id', id);
  }

  /**
   * FOR-03 -- like / dislike.
   *
   * forums.likes is TEXT holding a JSON ARRAY OF USER IDS, not a counter. That
   * is what makes it one vote per person; a counter would let anyone click
   * repeatedly. Voting the same way again clears the vote, and liking removes
   * any dislike from the same user. Empty arrays store as NULL, as Laravel did.
   */
  async react(id: number, userId: number, reaction: 'like' | 'dislike') {
    const { data } = await this.#db.from('forums')
      .select('id, likes, dislikes').eq('id', id).maybeSingle();
    if (!data) throw new HttpError(404, 'Post not found.');

    const decode = (raw: string | null) =>
      phpJsonDecode<unknown[]>(raw, []).map(Number).filter((n) => Number.isFinite(n));
    const encode = (ids: number[]) => (ids.length ? phpJsonEncode(ids) : null);

    let likes = decode(data.likes);
    let dislikes = decode(data.dislikes);

    if (reaction === 'like') {
      likes = likes.includes(userId) ? likes.filter((u) => u !== userId) : [...likes, userId];
      dislikes = dislikes.filter((u) => u !== userId);
    } else {
      dislikes = dislikes.includes(userId)
        ? dislikes.filter((u) => u !== userId) : [...dislikes, userId];
      likes = likes.filter((u) => u !== userId);
    }

    await this.#db.from('forums').update({
      likes: encode(likes), dislikes: encode(dislikes),
      updated_at: new Date().toISOString(),
    }).eq('id', id);

    return {
      likes: likes.length, dislikes: dislikes.length,
      liked: likes.includes(userId), disliked: dislikes.includes(userId),
    };
  }

  /** Counts for display, decoded from the stored id arrays. */
  static tally(raw: string | null, userId?: number) {
    const ids = phpJsonDecode<unknown[]>(raw, []).map(Number);
    return { count: ids.length, mine: userId !== undefined && ids.includes(userId) };
  }
  async authors(userIds: (number | null)[]): Promise<Map<number, unknown>> {
    const ids = [...new Set(userIds.filter(Boolean))] as number[];
    if (!ids.length) return new Map();
    const { data } = await this.#db.from('users').select('id, name, photo, role').in('id', ids);
    return new Map((data ?? []).map((u) => [u.id, u]));
  }

  async replyCounts(questionIds: number[]): Promise<Map<number, number>> {
    const out = new Map<number, number>();
    if (!questionIds.length) return out;
    const { data } = await this.#db.from('forums').select('parent_id').in('parent_id', questionIds);
    for (const r of data ?? []) {
      out.set(Number(r.parent_id), (out.get(Number(r.parent_id)) ?? 0) + 1);
    }
    return out;
  }
}
