import type { OnyxDb } from './db.ts';
import { HttpError } from '../http/errors.ts';

const SECTION_COLUMNS = 'id, tenant_id, name, code, sort, status, created_at, updated_at';

/**
 * The teaching divisions an institution runs, and who is in them.
 *
 * A section is the group a learner is actually taught with: Alpha, Beta and
 * Gamma at one institution, Section A, B and C at most others. Timetables are
 * drawn per section and examinations are sat per section, so "which section" is
 * the first question a programme office asks about a student — and the product
 * had no idea the concept existed.
 *
 * Deliberately its own small service rather than more methods on tenancy. What
 * it owns is one table and one column on another; folding it into a service
 * that already runs sign-in, roles and permissions would bury it.
 *
 * **The default set is per institution, and only the names differ.** Malla
 * Reddy names its divisions Alpha, Beta and Gamma; everywhere else the
 * convention is Section A, B and C. Both are just rows: an institution renames,
 * reorders, adds or retires them afterwards, and nothing in this service treats
 * one naming as more real than the other.
 */
export const GREEK_SECTIONS = [
  { name: 'Alpha', code: 'alpha' },
  { name: 'Beta', code: 'beta' },
  { name: 'Gamma', code: 'gamma' },
] as const;

export const LETTER_SECTIONS = [
  { name: 'Section A', code: 'a' },
  { name: 'Section B', code: 'b' },
  { name: 'Section C', code: 'c' },
] as const;

export class OnyxSectionsService {
  #db: OnyxDb;

  constructor(db: OnyxDb) {
    this.#db = db;
  }

  /**
   * The sections an institution runs, in teaching order.
   *
   * Retired ones are excluded unless asked for. A retired section still has
   * people and examinations pointing at it — that is why it is retired rather
   * than deleted — so an administrator's screen has to be able to see it.
   */
  async list(tenantId: number, opts: { includeRetired?: boolean } = {}) {
    let q = this.#db.from('onyx_sections')
      .select(SECTION_COLUMNS).eq('tenant_id', tenantId);
    if (!opts.includeRetired) q = q.eq('status', 1);
    const { data } = await q.order('sort', { ascending: true }).order('id', { ascending: true });
    return data ?? [];
  }

  async section(tenantId: number, id: number) {
    const { data } = await this.#db.from('onyx_sections')
      .select(SECTION_COLUMNS).eq('tenant_id', tenantId).eq('id', id).maybeSingle();
    if (!data) throw new HttpError(404, 'No such section.');
    return data;
  }

  /**
   * A code that cannot collide with an existing one, in any casing.
   *
   * "A" and "a" are the same section to everybody except a unique index, so the
   * code is lower-cased before it is stored and before it is compared. Spaces
   * become hyphens rather than being dropped, so "Section 1" and "Section1" do
   * not silently become the same row.
   */
  /**
   * A unique violation, however the driver reports it.
   *
   * Matched on the message as well as the code, which is the convention every
   * other service here follows: the code is absent from some drivers and from
   * the test double, so checking only `23505` sent a plain "already exists"
   * down the 500 path and told an operator the database had failed when in
   * fact they had typed a duplicate.
   */
  #isDuplicate(error: { code?: string; message?: string } | null): boolean {
    if (!error) return false;
    return error.code === '23505' || /duplicate key|unique/i.test(error.message ?? '');
  }

  #clean(raw: string): string {
    const code = String(raw ?? '').trim().toLowerCase().replace(/\s+/g, '-')
      .replace(/[^a-z0-9-]/g, '');
    if (!code) throw new HttpError(422, 'A section needs a short code.');
    return code.slice(0, 20);
  }

  async create(tenantId: number, input: { name: string; code?: string; sort?: number }) {
    const name = String(input.name ?? '').trim();
    if (!name) throw new HttpError(422, 'A section needs a name.');
    const code = this.#clean(input.code || name);

    // Placed last unless told otherwise, so adding a fourth section does not
    // land it between the first and the second.
    let sort = input.sort;
    if (sort === undefined) {
      const existing = await this.list(tenantId, { includeRetired: true });
      sort = existing.reduce((n, s) => Math.max(n, Number(s.sort ?? 0)), 0) + 1;
    }

    const { data, error } = await this.#db.from('onyx_sections')
      .insert({ tenant_id: tenantId, name, code, sort, status: 1 })
      .select(SECTION_COLUMNS).maybeSingle();
    if (this.#isDuplicate(error)) {
      throw new HttpError(422, 'This institution already has a section with the code “'
        + code + '”.');
    }
    if (error) throw new HttpError(500, 'Could not create the section: ' + error.message);
    return data!;
  }

  async update(tenantId: number, id: number, patch: {
    name?: string; code?: string; sort?: number; status?: number;
  }) {
    const before = await this.section(tenantId, id);
    const next: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (patch.name !== undefined) {
      const name = String(patch.name).trim();
      if (!name) throw new HttpError(422, 'A section needs a name.');
      next.name = name;
    }
    if (patch.code !== undefined) next.code = this.#clean(patch.code);
    if (patch.sort !== undefined) next.sort = Number(patch.sort);
    if (patch.status !== undefined) next.status = Number(patch.status) === 1 ? 1 : 0;

    const { data, error } = await this.#db.from('onyx_sections')
      .update(next).eq('tenant_id', tenantId).eq('id', id)
      .select(SECTION_COLUMNS).maybeSingle();
    if (this.#isDuplicate(error)) {
      throw new HttpError(422, 'Another section here already uses that code.');
    }
    if (error) throw new HttpError(500, 'Could not save the section: ' + error.message);
    return { before, section: data! };
  }

  /**
   * Retire a section, or remove one nobody is in.
   *
   * Removing is offered only while nothing points at it. Once a learner has
   * been in it or an examination has been set for it, the row is part of the
   * record of who sat what, and `ON DELETE SET NULL` would quietly unassign
   * both. Retiring keeps the history and takes it off every picker.
   */
  async remove(tenantId: number, id: number) {
    await this.section(tenantId, id);
    const [people, papers, sittings] = await Promise.all([
      this.#db.from('onyx_memberships').select('id').eq('tenant_id', tenantId)
        .eq('section_id', id).limit(1),
      this.#db.from('onyx_assessments').select('id').eq('tenant_id', tenantId)
        .eq('section_id', id).limit(1),
      this.#db.from('onyx_exams').select('id').eq('tenant_id', tenantId)
        .eq('section_id', id).limit(1),
    ]);
    const used = (people.data ?? []).length + (papers.data ?? []).length
      + (sittings.data ?? []).length;
    if (used) {
      throw new HttpError(422, 'People or papers still belong to this section. '
        + 'Retire it instead — it then disappears from every picker while the record of '
        + 'who was in it stays intact.');
    }
    await this.#db.from('onyx_sections').delete().eq('tenant_id', tenantId).eq('id', id);
    return { id, removed: true };
  }

  /**
   * Put somebody in a section, or take them out of one.
   *
   * `null` unassigns, which is a real thing to want: a learner leaving a
   * section before the next is decided, and every staff member, who has none.
   */
  async assign(tenantId: number, membershipId: number, sectionId: number | null) {
    if (sectionId !== null) await this.section(tenantId, sectionId);
    const { data, error } = await this.#db.from('onyx_memberships')
      .update({ section_id: sectionId })
      .eq('tenant_id', tenantId).eq('id', membershipId)
      .select('id, user_id, role, section_id').maybeSingle();
    if (error) throw new HttpError(500, 'Could not save that: ' + error.message);
    if (!data) throw new HttpError(404, 'No such member here.');
    return data;
  }

  /** One person's section, by user id. What every visibility check needs. */
  async sectionOf(tenantId: number, userId: string): Promise<number | null> {
    const { data } = await this.#db.from('onyx_memberships')
      .select('section_id').eq('tenant_id', tenantId).eq('user_id', userId)
      .eq('status', 1).maybeSingle();
    return data?.section_id == null ? null : Number(data.section_id);
  }

  /** How many people are in each section, for a screen that lists them. */
  async counts(tenantId: number): Promise<Map<number, number>> {
    const { data } = await this.#db.from('onyx_memberships')
      .select('section_id').eq('tenant_id', tenantId).eq('status', 1);
    const out = new Map<number, number>();
    for (const row of data ?? []) {
      if (row.section_id == null) continue;
      const key = Number(row.section_id);
      out.set(key, (out.get(key) ?? 0) + 1);
    }
    return out;
  }

  /**
   * The sections an institution starts with.
   *
   * Called when an institution first needs them rather than at creation, so
   * this arrives for the institutions that already exist as well as the ones
   * created next. Does nothing if any section is already there — an
   * institution that has renamed or removed its own must not have three put
   * back.
   */
  async seedDefaults(
    tenantId: number,
    preset: readonly { name: string; code: string }[] = LETTER_SECTIONS,
  ) {
    const existing = await this.list(tenantId, { includeRetired: true });
    if (existing.length) return existing;
    for (const [i, s] of preset.entries()) {
      await this.create(tenantId, { name: s.name, code: s.code, sort: i + 1 });
    }
    return this.list(tenantId, { includeRetired: true });
  }
}

/**
 * Whether something set for a section is for this person.
 *
 * The rule every visibility check applies, in one place so the calendar, the
 * paper list and `start()` cannot disagree about it:
 *
 *   * a paper with no section is for everybody, which is what every row
 *     created before sections existed means and must keep meaning;
 *   * otherwise it is for the people in that section, and nobody else.
 *
 * Staff are not filtered by this at all — they set the papers and have no
 * section of their own — so callers apply it only for a learner.
 */
export function isForSection(
  rowSection: number | null | undefined,
  viewerSection: number | null | undefined,
): boolean {
  if (rowSection == null) return true;
  return viewerSection != null && Number(rowSection) === Number(viewerSection);
}
