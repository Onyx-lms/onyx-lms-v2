/**
 * BC-01 / BC-02 -- bootcamps ("Workshops" in the UI) and their categories.
 *
 * bootcamps.status is tinyint(1) and there is a SEPARATE `pending` column, so
 * the two are not the same axis: status is published/unpublished, pending is
 * awaiting admin approval. An instructor's bootcamp is created pending.
 */
import type { Db } from '../db/client.ts';
import { HttpError } from '../http/errors.ts';
import { phpJsonEncode, phpJsonDecode } from '../json/php-json.ts';
import { slugify, slugWithId } from '../authoring/slug.ts';
import { paginate, type PageQuery, type Paginated } from '../http/pagination.ts';

const COLUMNS = 'id, user_id, category_id, title, slug, short_description, description, is_paid, price, discount_flag, discounted_price, publish_date, thumbnail, faqs, requirements, outcomes, meta_keywords, meta_description, status, pending, created_at, updated_at';

export interface BootcampInput {
  title: string;
  category_id?: number | null;
  short_description?: string | null;
  description?: string | null;
  is_paid?: number;
  price?: number | null;
  discount_flag?: number;
  discounted_price?: number | null;
  publish_date?: string | null;
  thumbnail?: string | null;
  meta_keywords?: string | null;
  meta_description?: string | null;
  faqs?: unknown[];
  requirements?: string[];
  outcomes?: string[];
}

export class BootcampService {
  #db: Db;
  constructor(db: Db) { this.#db = db; }

  // ---- BC-01: categories ----

  async categories() {
    const { data } = await this.#db.from('bootcamp_categories')
      .select('id, title, slug').order('title');
    const rows = data ?? [];
    if (!rows.length) return [];

    // Ports count_bootcamps_by_category(): published bootcamps only.
    const { data: published } = await this.#db.from('bootcamps')
      .select('category_id').eq('status', 1);
    const counts = new Map<number, number>();
    for (const b of published ?? []) {
      const id = Number(b.category_id);
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    return rows.map((c) => ({ ...c, bootcamp_count: counts.get(c.id) ?? 0 }));
  }

  async createCategory(title: string) {
    const now = new Date().toISOString();
    const { data, error } = await this.#db.from('bootcamp_categories')
      .insert({ title: title.trim(), slug: slugify(title), created_at: now, updated_at: now })
      .select('id, title, slug').maybeSingle();
    if (error) throw new HttpError(500, 'Could not create the category: ' + error.message);
    return data;
  }

  async updateCategory(id: number, title: string) {
    await this.#db.from('bootcamp_categories').update({
      title: title.trim(), slug: slugify(title), updated_at: new Date().toISOString(),
    }).eq('id', id);
  }

  async removeCategory(id: number): Promise<void> {
    const { count } = await this.#db.from('bootcamps')
      .select('id', { count: 'exact', head: true }).eq('category_id', id);
    // Laravel deleted the category and left its bootcamps pointing at nothing.
    if (count) throw new HttpError(422, 'That category still has workshops in it.');
    await this.#db.from('bootcamp_categories').delete().eq('id', id);
  }

  // ---- BC-02: the bootcamp itself ----

  /** The public list: published only, newest first. */
  async published(filters: { categorySlug?: string; search?: string },
                  page: PageQuery, path: string): Promise<Paginated<unknown>> {
    let query = this.#db.from('bootcamps').select(COLUMNS, { count: 'exact' }).eq('status', 1);

    if (filters.categorySlug) {
      const { data: category } = await this.#db.from('bootcamp_categories')
        .select('id').eq('slug', filters.categorySlug).maybeSingle();
      // An unknown category returns nothing rather than the whole catalogue.
      if (!category) return paginate([], 0, page, path);
      query = query.eq('category_id', category.id);
    }
    if (filters.search) {
      const term = '%' + filters.search + '%';
      query = query.or('title.ilike.' + term + ',short_description.ilike.' + term);
    }

    const { data, count, error } = await query
      .order('id', { ascending: false }).range(page.from, page.to);
    if (error) throw new HttpError(500, 'bootcamps.published failed: ' + error.message);
    return paginate(await this.decorate(data ?? []), count ?? 0, page, path);
  }

  /** Authoring list: admins see everything, instructors only their own. */
  async listFor(opts: { userId?: number; status?: number; search?: string },
                page: PageQuery, path: string): Promise<Paginated<unknown>> {
    let query = this.#db.from('bootcamps').select(COLUMNS, { count: 'exact' });
    if (opts.userId != null) query = query.eq('user_id', opts.userId);
    if (opts.status !== undefined) query = query.eq('status', opts.status);
    if (opts.search) query = query.ilike('title', '%' + opts.search + '%');
    const { data, count, error } = await query
      .order('id', { ascending: false }).range(page.from, page.to);
    if (error) throw new HttpError(500, 'bootcamps.list failed: ' + error.message);
    return paginate(await this.decorate(data ?? []), count ?? 0, page, path);
  }

  async decorate(rows: Record<string, unknown>[]) {
    const userIds = [...new Set(rows.map((r) => Number(r['user_id'])).filter(Boolean))];
    const catIds = [...new Set(rows.map((r) => Number(r['category_id'])).filter(Boolean))];
    const [users, cats] = await Promise.all([
      userIds.length ? this.#db.from('users').select('id, name, photo').in('id', userIds)
                     : Promise.resolve({ data: [] }),
      catIds.length ? this.#db.from('bootcamp_categories').select('id, title, slug').in('id', catIds)
                    : Promise.resolve({ data: [] }),
    ]);
    const userById = new Map((users.data ?? []).map((u) => [u.id, u]));
    const catById = new Map((cats.data ?? []).map((c) => [c.id, c]));
    return rows.map((r) => ({
      ...this.#decode(r),
      instructor: userById.get(Number(r['user_id'])) ?? null,
      category: catById.get(Number(r['category_id'])) ?? null,
    }));
  }

  async find(id: number, ownerId?: number) {
    let query = this.#db.from('bootcamps').select(COLUMNS).eq('id', id);
    if (ownerId != null) query = query.eq('user_id', ownerId);
    const { data } = await query.maybeSingle();
    if (!data) throw new HttpError(404, 'Workshop not found.');
    return this.#decode(data as Record<string, unknown>);
  }

  async bySlug(slug: string) {
    const { data } = await this.#db.from('bootcamps')
      .select(COLUMNS).eq('slug', slug).eq('status', 1).maybeSingle();
    if (!data) throw new HttpError(404, 'Workshop not found.');
    const [decorated] = await this.decorate([data as Record<string, unknown>]);
    return decorated;
  }

  /**
   * BC-02 -- creating. `status` and `pending` are separate axes: an admin
   * publishes straight away, an instructor's workshop is unpublished AND
   * pending until an admin approves it.
   */
  async create(userId: number, input: BootcampInput, isAdmin: boolean) {
    const now = new Date().toISOString();
    const { data, error } = await this.#db.from('bootcamps').insert({
      ...this.#writable(input),
      user_id: userId,
      slug: slugify(input.title),
      status: isAdmin ? 1 : 0,
      pending: isAdmin ? 0 : 1,
      created_at: now, updated_at: now,
    }).select(COLUMNS).maybeSingle();
    if (error) throw new HttpError(500, 'Could not create the workshop: ' + error.message);

    // The row id keeps the slug unique across duplicate titles, as with courses.
    const slug = slugWithId(input.title, data!.id);
    await this.#db.from('bootcamps').update({ slug }).eq('id', data!.id);
    return this.#decode({ ...(data as Record<string, unknown>), slug });
  }

  async update(id: number, input: BootcampInput, ownerId?: number) {
    await this.find(id, ownerId);
    const { error } = await this.#db.from('bootcamps')
      .update({ ...this.#writable(input), updated_at: new Date().toISOString() }).eq('id', id);
    if (error) throw new HttpError(500, 'Could not update the workshop: ' + error.message);
    return this.find(id);
  }

  /** Publish / unpublish. Approving also clears the pending flag. */
  async setStatus(id: number, status: 0 | 1) {
    await this.find(id);
    await this.#db.from('bootcamps').update({
      status, pending: status ? 0 : 1, updated_at: new Date().toISOString(),
    }).eq('id', id);
    return this.find(id);
  }

  async pending(page: PageQuery, path: string): Promise<Paginated<unknown>> {
    const { data, count, error } = await this.#db.from('bootcamps')
      .select(COLUMNS, { count: 'exact' }).eq('pending', 1)
      .order('id', { ascending: false }).range(page.from, page.to);
    if (error) throw new HttpError(500, 'bootcamps.pending failed: ' + error.message);
    return paginate(await this.decorate(data ?? []), count ?? 0, page, path);
  }

  /**
   * BC-02 -- duplicate. Laravel copied only the bootcamp row, so the clone had
   * no modules; the modules, their live classes and their resources are copied
   * here, exactly as course duplication does.
   */
  async duplicate(id: number, actingUserId: number, isAdmin: boolean) {
    const source = await this.find(id, isAdmin ? undefined : actingUserId) as Record<string, unknown>;
    const now = new Date().toISOString();

    const { faqs, requirements, outcomes, ...rest } = source;
    delete rest['id']; delete rest['created_at']; delete rest['updated_at'];

    const { data: copy, error } = await this.#db.from('bootcamps').insert({
      ...rest,
      user_id: isAdmin ? actingUserId : (source['user_id'] as number | null),
      // A copy is never live until someone says so.
      status: 0,
      pending: 0,
      faqs: phpJsonEncode(faqs ?? []),
      requirements: phpJsonEncode(requirements ?? []),
      outcomes: phpJsonEncode(outcomes ?? []),
      slug: slugify(String(source['title'] ?? '')),
      created_at: now, updated_at: now,
    }).select('id').maybeSingle();
    if (error) throw new HttpError(500, 'Could not duplicate the workshop: ' + error.message);

    const newId = copy!.id;
    await this.#db.from('bootcamps')
      .update({ slug: slugWithId(String(source['title'] ?? ''), newId) }).eq('id', newId);
    await this.#copyModules(id, newId, now);
    return this.find(newId);
  }

  async #copyModules(fromId: number, toId: number, now: string) {
    const { data: modules } = await this.#db.from('bootcamp_modules')
      .select('*').eq('bootcamp_id', fromId).order('sort');

    for (const m of modules ?? []) {
      const row = { ...(m as Record<string, unknown>) };
      const sourceModuleId = row['id'] as number;
      delete row['id']; delete row['created_at']; delete row['updated_at'];
      // The row came back from a select, so it already has every required
      // column; TypeScript cannot see that through Record<string, unknown>.
      const { data: created } = await this.#db.from('bootcamp_modules')
        .insert({ ...row, bootcamp_id: toId, created_at: now, updated_at: now } as never)
        .select('id').maybeSingle();
      if (!created) continue;

      for (const table of ['bootcamp_live_classes', 'bootcamp_resources'] as const) {
        const { data: children } = await this.#db.from(table)
          .select('*').eq('module_id', sourceModuleId);
        for (const child of children ?? []) {
          const c = { ...(child as Record<string, unknown>) };
          delete c['id']; delete c['created_at']; delete c['updated_at'];
          await this.#db.from(table)
            .insert({ ...c, module_id: created.id, created_at: now, updated_at: now } as never);
        }
      }
    }
  }

  /**
   * BC-02 -- deleting. Ports remove_module_data(), which in turn calls
   * remove_live_class_data() and remove_resource_data(). No FKs exist, so the
   * cascade is ours to do or the children orphan.
   */
  async remove(id: number, ownerId?: number): Promise<void> {
    await this.find(id, ownerId);
    const { data: modules } = await this.#db.from('bootcamp_modules')
      .select('id').eq('bootcamp_id', id);
    for (const m of modules ?? []) {
      await this.#db.from('bootcamp_live_classes').delete().eq('module_id', m.id);
      await this.#db.from('bootcamp_resources').delete().eq('module_id', m.id);
    }
    await this.#db.from('bootcamp_modules').delete().eq('bootcamp_id', id);
    const { error } = await this.#db.from('bootcamps').delete().eq('id', id);
    if (error) throw new HttpError(500, 'Could not delete the workshop: ' + error.message);
  }

  #decode(row: Record<string, unknown>) {
    return {
      ...row,
      faqs: phpJsonDecode<unknown[]>(row['faqs'] as string, []),
      requirements: phpJsonDecode<string[]>(row['requirements'] as string, []),
      outcomes: phpJsonDecode<string[]>(row['outcomes'] as string, []),
    };
  }

  #writable(input: BootcampInput): Record<string, unknown> {
    return {
      title: input.title.trim(),
      category_id: input.category_id ?? null,
      short_description: input.short_description ?? null,
      description: input.description ?? null,
      is_paid: input.is_paid ?? 0,
      price: input.is_paid ? input.price ?? 0 : null,
      discount_flag: input.discount_flag ?? 0,
      discounted_price: input.discount_flag ? input.discounted_price ?? 0 : null,
      publish_date: input.publish_date ?? null,
      thumbnail: input.thumbnail ?? null,
      meta_keywords: input.meta_keywords ?? null,
      meta_description: input.meta_description ?? null,
      faqs: phpJsonEncode(input.faqs ?? []),
      requirements: phpJsonEncode(input.requirements ?? []),
      outcomes: phpJsonEncode(input.outcomes ?? []),
    };
  }
}
