/**
 * B-02 -- course sections.
 */
import type { Db } from '../db/client.ts';
import { HttpError } from '../http/errors.ts';

export class SectionsService {
  #db: Db;
  constructor(db: Db) { this.#db = db; }

  /**
   * NOTE: sections.sort is varchar in the Laravel schema, while lessons.sort is
   * integer. The column type is preserved (no schema changes), but ordering is
   * done numerically here -- a text sort puts section 10 before section 2, which
   * is a visible defect on any course with ten or more sections.
   */
  async listForCourse(courseId: number) {
    const { data, error } = await this.#db
      .from('sections').select('id, title, sort, course_id, user_id')
      .eq('course_id', courseId);
    if (error) throw new HttpError(500, `sections.list failed: ${error.message}`);
    return [...(data ?? [])].sort((a, b) => Number(a.sort ?? 0) - Number(b.sort ?? 0));
  }

  async create(courseId: number, userId: number, title: string) {
    // New sections land at the end, matching the builder UI.
    const existing = await this.listForCourse(courseId);
    const now = new Date().toISOString();
    const { data, error } = await this.#db.from('sections').insert({
      course_id: courseId, user_id: userId, title: title.trim(),
      sort: String(existing.length + 1), created_at: now, updated_at: now,
    }).select('id, title, sort, course_id, user_id').maybeSingle();
    if (error) throw new HttpError(500, `sections.create failed: ${error.message}`);
    return data;
  }

  async update(id: number, title: string) {
    const { error } = await this.#db.from('sections')
      .update({ title: title.trim(), updated_at: new Date().toISOString() }).eq('id', id);
    if (error) throw new HttpError(500, `sections.update failed: ${error.message}`);
  }

  /**
   * Deletes the section AND its lessons. Laravel relied on application code for
   * this because there are no FK constraints; skipping it would orphan lessons
   * that then show up nowhere but still count toward progress.
   */
  async remove(id: number): Promise<void> {
    await this.#db.from('lessons').delete().eq('section_id', id);
    const { error } = await this.#db.from('sections').delete().eq('id', id);
    if (error) throw new HttpError(500, `sections.delete failed: ${error.message}`);
  }

  /** sort = position + 1, exactly as section_sort() did. */
  async sort(orderedIds: number[]): Promise<void> {
    for (let i = 0; i < orderedIds.length; i++) {
      const { error } = await this.#db.from('sections')
        .update({ sort: String(i + 1) }).eq('id', orderedIds[i]!);
      if (error) throw new HttpError(500, `sections.sort failed: ${error.message}`);
    }
  }
}
