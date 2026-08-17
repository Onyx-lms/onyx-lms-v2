/**
 * TB-01 / TB-02 / TB-04 -- the tutor taxonomy and who can teach what.
 *
 * tutor_categories and tutor_subjects are flat lists with a status flag.
 * tutor_can_teach links an instructor to one (category, subject) pair and
 * carries the PRICE -- tutor_schedules.price is left null by the Laravel
 * schedule form, so the can-teach row is the authority on what a session costs.
 */
import type { Db } from '../db/client.ts';
import { HttpError } from '../http/errors.ts';
import { slugify } from '../authoring/slug.ts';

const TAXONOMY_COLUMNS = 'id, name, slug, status, created_at, updated_at';
const TEACH_COLUMNS = 'id, instructor_id, category_id, subject_id, description, price, thumbnail, status, created_at, updated_at';

export type Taxonomy = 'tutor_categories' | 'tutor_subjects';

export class TutorCatalogService {
  #db: Db;
  constructor(db: Db) { this.#db = db; }

  // ---- TB-01 ----

  async list(table: Taxonomy, activeOnly = false) {
    let query = this.#db.from(table).select(TAXONOMY_COLUMNS);
    if (activeOnly) query = query.eq('status', 1);
    const { data } = await query.order('name');
    return data ?? [];
  }

  async create(table: Taxonomy, name: string) {
    const now = new Date().toISOString();
    const { data, error } = await this.#db.from(table).insert({
      name: name.trim(), slug: slugify(name), status: 1, created_at: now, updated_at: now,
    }).select(TAXONOMY_COLUMNS).maybeSingle();
    if (error) throw new HttpError(500, 'Could not create it: ' + error.message);
    return data;
  }

  async rename(table: Taxonomy, id: number, name: string) {
    const { data } = await this.#db.from(table).select('id').eq('id', id).maybeSingle();
    if (!data) throw new HttpError(404, 'Not found.');
    await this.#db.from(table).update({
      name: name.trim(), slug: slugify(name), updated_at: new Date().toISOString(),
    }).eq('id', id);
  }

  async toggleStatus(table: Taxonomy, id: number) {
    const { data } = await this.#db.from(table)
      .select('id, status').eq('id', id).maybeSingle();
    if (!data) throw new HttpError(404, 'Not found.');
    const status = data.status ? 0 : 1;
    await this.#db.from(table)
      .update({ status, updated_at: new Date().toISOString() }).eq('id', id);
    return { id, status };
  }

  async remove(table: Taxonomy, id: number): Promise<void> {
    const column = table === 'tutor_categories' ? 'category_id' : 'subject_id';
    const { count } = await this.#db.from('tutor_can_teach')
      .select('id', { count: 'exact', head: true }).eq(column, id);
    // Deleting it would leave can-teach rows pointing at nothing.
    if (count) throw new HttpError(422, 'This is still in use by a tutor.');
    await this.#db.from(table).delete().eq('id', id);
  }

  // ---- TB-02: what an instructor can teach ----

  async canTeachFor(instructorId: number) {
    const { data } = await this.#db.from('tutor_can_teach')
      .select(TEACH_COLUMNS).eq('instructor_id', instructorId).order('id');
    return this.decorate(data ?? []);
  }

  async findCanTeach(id: number, instructorId?: number) {
    let query = this.#db.from('tutor_can_teach').select(TEACH_COLUMNS).eq('id', id);
    if (instructorId != null) query = query.eq('instructor_id', instructorId);
    const { data } = await query.maybeSingle();
    if (!data) throw new HttpError(404, 'Subject not found.');
    return data;
  }

  /** The price for one tutor teaching one subject, or null if they do not. */
  async priceFor(tutorId: number, categoryId: number, subjectId: number): Promise<number | null> {
    const { data } = await this.#db.from('tutor_can_teach')
      .select('price, status').eq('instructor_id', tutorId)
      .eq('category_id', categoryId).eq('subject_id', subjectId).maybeSingle();
    if (!data || data.status !== 1) return null;
    return Number(data.price ?? 0);
  }

  async addCanTeach(instructorId: number, input: {
    category_id: number; subject_id: number; price: number;
    description?: string | null; thumbnail?: string | null;
  }) {
    for (const [table, id] of [['tutor_categories', input.category_id],
                               ['tutor_subjects', input.subject_id]] as const) {
      const { data } = await this.#db.from(table)
        .select('id, status').eq('id', id).maybeSingle();
      if (!data || data.status !== 1) {
        throw new HttpError(422, 'That category or subject is not available.');
      }
    }
    const { data: existing } = await this.#db.from('tutor_can_teach')
      .select('id').eq('instructor_id', instructorId)
      .eq('category_id', input.category_id).eq('subject_id', input.subject_id).maybeSingle();
    // A second row for the same pair would make priceFor() ambiguous.
    if (existing) throw new HttpError(422, 'You already teach that subject.');

    const now = new Date().toISOString();
    const { data, error } = await this.#db.from('tutor_can_teach').insert({
      instructor_id: instructorId,
      category_id: input.category_id,
      subject_id: input.subject_id,
      price: input.price,
      description: input.description ?? null,
      thumbnail: input.thumbnail ?? null,
      status: 1,
      created_at: now, updated_at: now,
    }).select(TEACH_COLUMNS).maybeSingle();
    if (error) throw new HttpError(500, 'Could not save it: ' + error.message);
    return data;
  }

  async updateCanTeach(id: number, instructorId: number, input: {
    price?: number; description?: string | null; thumbnail?: string | null; status?: 0 | 1;
  }) {
    await this.findCanTeach(id, instructorId);
    const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (input.price !== undefined) row['price'] = input.price;
    if (input.description !== undefined) row['description'] = input.description;
    if (input.thumbnail !== undefined) row['thumbnail'] = input.thumbnail;
    if (input.status !== undefined) row['status'] = input.status;
    await this.#db.from('tutor_can_teach').update(row as never).eq('id', id);
    return this.findCanTeach(id);
  }

  async removeCanTeach(id: number, instructorId: number): Promise<void> {
    const row = await this.findCanTeach(id, instructorId);
    const { count } = await this.#db.from('tutor_schedules')
      .select('id', { count: 'exact', head: true })
      .eq('tutor_id', instructorId)
      .eq('category_id', Number(row.category_id))
      .eq('subject_id', Number(row.subject_id));
    if (count) throw new HttpError(422, 'Remove the schedules for that subject first.');
    await this.#db.from('tutor_can_teach').delete().eq('id', id);
  }

  /** TB-04 -- tutors offering a subject, for the public directory. */
  async tutors(filters: { categoryId?: number; subjectId?: number; search?: string }) {
    let query = this.#db.from('tutor_can_teach').select(TEACH_COLUMNS).eq('status', 1);
    if (filters.categoryId) query = query.eq('category_id', filters.categoryId);
    if (filters.subjectId) query = query.eq('subject_id', filters.subjectId);
    const { data } = await query.order('id', { ascending: false });

    let rows = await this.decorate(data ?? []);
    if (filters.search?.trim()) {
      const needle = filters.search.trim().toLowerCase();
      rows = rows.filter((r) => {
        const t = r.tutor as { name?: string | null } | null;
        return (t?.name ?? '').toLowerCase().includes(needle);
      });
    }
    return rows;
  }

  async decorate(rows: Record<string, unknown>[]) {
    const tutorIds = [...new Set(rows.map((r) => Number(r['instructor_id'])).filter(Boolean))];
    const catIds = [...new Set(rows.map((r) => Number(r['category_id'])).filter(Boolean))];
    const subIds = [...new Set(rows.map((r) => Number(r['subject_id'])).filter(Boolean))];

    const [tutors, cats, subs] = await Promise.all([
      tutorIds.length ? this.#db.from('users').select('id, name, photo, about').in('id', tutorIds)
                      : Promise.resolve({ data: [] }),
      catIds.length ? this.#db.from('tutor_categories').select('id, name, slug').in('id', catIds)
                    : Promise.resolve({ data: [] }),
      subIds.length ? this.#db.from('tutor_subjects').select('id, name, slug').in('id', subIds)
                    : Promise.resolve({ data: [] }),
    ]);
    const tutorById = new Map((tutors.data ?? []).map((u) => [u.id, u]));
    const catById = new Map((cats.data ?? []).map((c) => [c.id, c]));
    const subById = new Map((subs.data ?? []).map((s) => [s.id, s]));

    return rows.map((r) => ({
      ...r,
      tutor: tutorById.get(Number(r['instructor_id'])) ?? null,
      category: catById.get(Number(r['category_id'])) ?? null,
      subject: subById.get(Number(r['subject_id'])) ?? null,
    }));
  }
}
