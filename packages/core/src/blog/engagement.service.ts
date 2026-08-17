/**
 * R-06 -- blog comments and likes.
 *
 * These tables come from migration 0005: the Laravel models exist and the
 * controllers write to them, but no migration ever created them.
 *
 * Comments are one level deep -- parent_id 0 is top level, anything else is a
 * reply to one. `check` is the moderation flag and is quoted everywhere because
 * it is a reserved word.
 */
import type { Db } from '../db/client.ts';
import { HttpError } from '../http/errors.ts';

export class BlogEngagementService {
  #db: Db;
  constructor(db: Db) { this.#db = db; }

  /**
   * Threaded comments for a post. Only approved comments are public, but an
   * author always sees their own so it does not appear to vanish.
   */
  async comments(blogId: number, viewerId?: number) {
    const { data } = await this.#db.from('blog_comments')
      .select('id, blog_id, user_id, parent_id, comment, check, created_at')
      .eq('blog_id', blogId).order('id');
    const rows = (data ?? []).filter((r) => r.check === 1 || r.user_id === viewerId);

    const userIds = [...new Set(rows.map((r) => r.user_id).filter(Boolean))] as number[];
    const { data: users } = userIds.length
      ? await this.#db.from('users').select('id, name, photo').in('id', userIds)
      : { data: [] };
    const byId = new Map((users ?? []).map((u) => [u.id, u]));

    const withUser = rows.map((r) => ({ ...r, user: byId.get(r.user_id as number) ?? null }));
    const roots = withUser.filter((r) => !r.parent_id);
    return roots.map((root) => ({
      ...root,
      replies: withUser.filter((r) => Number(r.parent_id) === root.id),
    }));
  }

  async comment(blogId: number, userId: number, text: string, parentId = 0) {
    const { data: post } = await this.#db.from('blogs')
      .select('id, status').eq('id', blogId).maybeSingle();
    if (!post || post.status !== 1) throw new HttpError(404, 'Blog post not found.');

    if (parentId) {
      const { data: parent } = await this.#db.from('blog_comments')
        .select('id, blog_id, parent_id').eq('id', parentId).maybeSingle();
      if (!parent || parent.blog_id !== blogId) throw new HttpError(404, 'Comment not found.');
      // One level of nesting only, as the Laravel views rendered.
      if (parent.parent_id) throw new HttpError(422, 'You cannot reply to a reply.');
    }

    const now = new Date().toISOString();
    const { data, error } = await this.#db.from('blog_comments').insert({
      blog_id: blogId, user_id: userId, parent_id: parentId,
      comment: text.trim(),
      check: 1,
      likes: null,
      created_at: now, updated_at: now,
    }).select('id, blog_id, user_id, parent_id, comment, check, created_at').maybeSingle();
    if (error) throw new HttpError(500, 'Failed to save your comment: ' + error.message);
    return data;
  }

  async updateComment(id: number, userId: number, text: string) {
    const { data } = await this.#db.from('blog_comments')
      .select('id, user_id').eq('id', id).maybeSingle();
    if (!data) throw new HttpError(404, 'Comment not found.');
    if (data.user_id !== userId) throw new HttpError(403, 'This action is unauthorized.');
    await this.#db.from('blog_comments')
      .update({ comment: text.trim(), updated_at: new Date().toISOString() }).eq('id', id);
  }

  async removeComment(id: number, userId: number, isAdmin: boolean): Promise<void> {
    const { data } = await this.#db.from('blog_comments')
      .select('id, user_id, parent_id').eq('id', id).maybeSingle();
    if (!data) throw new HttpError(404, 'Comment not found.');
    if (!isAdmin && data.user_id !== userId) {
      throw new HttpError(403, 'This action is unauthorized.');
    }
    // Deleting a top-level comment takes its replies, or they orphan.
    if (!data.parent_id) await this.#db.from('blog_comments').delete().eq('parent_id', id);
    await this.#db.from('blog_comments').delete().eq('id', id);
  }

  /** One like per person per post; liking again removes it. */
  async toggleLike(blogId: number, userId: number): Promise<boolean> {
    const { data: existing } = await this.#db.from('blog_likes')
      .select('id').eq('blog_id', blogId).eq('user_id', userId).maybeSingle();
    if (existing) {
      await this.#db.from('blog_likes').delete().eq('id', existing.id);
      return false;
    }
    const now = new Date().toISOString();
    const { error } = await this.#db.from('blog_likes')
      .insert({ blog_id: blogId, user_id: userId, created_at: now, updated_at: now });
    // A unique index enforces the same rule in the database, so a race that
    // slips past the read above fails here rather than double-counting.
    if (error) throw new HttpError(500, 'Could not save your like: ' + error.message);
    return true;
  }

  async likeState(blogId: number, viewerId?: number) {
    const { data } = await this.#db.from('blog_likes').select('user_id').eq('blog_id', blogId);
    const rows = data ?? [];
    return {
      count: rows.length,
      liked: viewerId !== undefined && rows.some((r) => r.user_id === viewerId),
    };
  }

  async commentCounts(blogIds: number[]): Promise<Map<number, number>> {
    const out = new Map<number, number>();
    if (!blogIds.length) return out;
    const { data } = await this.#db.from('blog_comments')
      .select('blog_id').in('blog_id', blogIds).eq('check', 1);
    for (const r of data ?? []) {
      out.set(Number(r.blog_id), (out.get(Number(r.blog_id)) ?? 0) + 1);
    }
    return out;
  }
}
