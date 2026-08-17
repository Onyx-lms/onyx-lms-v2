/**
 * TP-01 / TP-02 -- team training packages ("Classroom packages").
 *
 * A package buys a group of seats on ONE course. The buyer becomes the leader
 * and fills their seats with members, who are enrolled on the course.
 *
 * Column notes:
 *   pricing_type   INTEGER, 1 = paid and 0 = free (the radio labels say so).
 *   expiry_type    'limited' | 'lifetime'.
 *   start_date /
 *   expiry_date    UNIX INTEGERS, parsed by Laravel from one "start-end" string.
 *   allocation     seat count.
 *   features       JSON as text.
 */
import type { Db } from '../db/client.ts';
import { HttpError } from '../http/errors.ts';
import { phpJsonEncode, phpJsonDecode } from '../json/php-json.ts';
import { slugify, slugWithId } from '../authoring/slug.ts';
import { unix } from '../bootcamp/module.service.ts';
import { paginate, type PageQuery, type Paginated } from '../http/pagination.ts';

const COLUMNS = 'id, user_id, title, slug, course_privacy, course_id, allocation, pricing_type, price, expiry_type, start_date, expiry_date, features, thumbnail, status, created_at, updated_at';

export interface TeamPackageInput {
  title: string;
  course_id: number;
  course_privacy: 'public' | 'private';
  allocation: number;
  pricing_type: 0 | 1;
  price?: number | null;
  expiry_type: 'limited' | 'lifetime';
  start_date?: string | number | null;
  expiry_date?: string | number | null;
  features?: string[];
  thumbnail?: string | null;
}

export class TeamPackageService {
  #db: Db;
  constructor(db: Db) { this.#db = db; }

  async find(id: number, ownerId?: number) {
    let query = this.#db.from('team_training_packages').select(COLUMNS).eq('id', id);
    if (ownerId != null) query = query.eq('user_id', ownerId);
    const { data } = await query.maybeSingle();
    if (!data) throw new HttpError(404, 'Package not found.');
    return this.#decode(data as Record<string, unknown>);
  }

  async bySlug(slug: string) {
    const { data } = await this.#db.from('team_training_packages')
      .select(COLUMNS).eq('slug', slug).eq('status', 1).maybeSingle();
    if (!data) throw new HttpError(404, 'Package not found.');
    const [decorated] = await this.decorate([data as Record<string, unknown>]);
    return decorated;
  }

  /** TP-05 -- the public list. Private packages are never listed. */
  async published(filters: { courseId?: number; search?: string },
                  page: PageQuery, path: string): Promise<Paginated<unknown>> {
    let query = this.#db.from('team_training_packages')
      .select(COLUMNS, { count: 'exact' })
      .eq('status', 1).eq('course_privacy', 'public');
    if (filters.courseId) query = query.eq('course_id', filters.courseId);
    if (filters.search) query = query.ilike('title', '%' + filters.search + '%');

    const { data, count, error } = await query
      .order('id', { ascending: false }).range(page.from, page.to);
    if (error) throw new HttpError(500, 'packages.published failed: ' + error.message);
    return paginate(await this.decorate(data ?? []), count ?? 0, page, path);
  }

  async listFor(opts: { userId?: number; search?: string },
                page: PageQuery, path: string): Promise<Paginated<unknown>> {
    let query = this.#db.from('team_training_packages').select(COLUMNS, { count: 'exact' });
    if (opts.userId != null) query = query.eq('user_id', opts.userId);
    if (opts.search) query = query.ilike('title', '%' + opts.search + '%');
    const { data, count, error } = await query
      .order('id', { ascending: false }).range(page.from, page.to);
    if (error) throw new HttpError(500, 'packages.list failed: ' + error.message);
    return paginate(await this.decorate(data ?? []), count ?? 0, page, path);
  }

  async decorate(rows: Record<string, unknown>[]) {
    const courseIds = [...new Set(rows.map((r) => Number(r['course_id'])).filter(Boolean))];
    const { data: courses } = courseIds.length
      ? await this.#db.from('courses')
          .select('id, title, slug, thumbnail, category_id').in('id', courseIds)
      : { data: [] };
    const byId = new Map((courses ?? []).map((c) => [c.id, c]));
    return rows.map((r) => ({
      ...this.#decode(r),
      course: byId.get(Number(r['course_id'])) ?? null,
    }));
  }

  /**
   * TP-02 -- ports team_packages_by_course_category(). The original loaded
   * every course id in the category and ran one count query per course; this is
   * one query, and it counts published packages only.
   */
  async countByCourseCategory(categoryId: number): Promise<number> {
    const { data: courses } = await this.#db.from('courses')
      .select('id').eq('category_id', categoryId);
    const ids = (courses ?? []).map((c) => c.id);
    if (!ids.length) return 0;
    const { count } = await this.#db.from('team_training_packages')
      .select('id', { count: 'exact', head: true }).in('course_id', ids).eq('status', 1);
    return count ?? 0;
  }

  #decode(row: Record<string, unknown>) {
    return { ...row, features: phpJsonDecode<string[]>(row['features'] as string, []) };
  }

  /**
   * TP-01/TP-02 -- creating a package.
   *
   * Laravel's validator wrote `required_if:is_paid,1` for price and expiry_type,
   * but the field is called `pricing_type`. The rule therefore never fired and a
   * paid package could be saved with no price at all. The check is real here.
   */
  async create(userId: number, input: TeamPackageInput) {
    this.#validate(input);
    const now = new Date().toISOString();
    const { data, error } = await this.#db.from('team_training_packages').insert({
      ...this.#writable(input),
      user_id: userId,
      slug: slugify(input.title),
      status: 1,
      created_at: now, updated_at: now,
    }).select(COLUMNS).maybeSingle();
    if (error) throw new HttpError(500, 'Could not create the package: ' + error.message);

    const slug = slugWithId(input.title, data!.id);
    await this.#db.from('team_training_packages').update({ slug }).eq('id', data!.id);
    return this.#decode({ ...(data as Record<string, unknown>), slug });
  }

  async update(id: number, input: TeamPackageInput, ownerId?: number) {
    await this.find(id, ownerId);
    this.#validate(input);
    const { error } = await this.#db.from('team_training_packages')
      .update({ ...this.#writable(input), updated_at: new Date().toISOString() }).eq('id', id);
    if (error) throw new HttpError(500, 'Could not update the package: ' + error.message);
    return this.find(id);
  }

  async toggleStatus(id: number, ownerId?: number) {
    const current = await this.find(id, ownerId) as Record<string, unknown>;
    await this.#db.from('team_training_packages').update({
      status: current['status'] ? 0 : 1, updated_at: new Date().toISOString(),
    }).eq('id', id);
    return this.find(id);
  }

  async duplicate(id: number, actingUserId: number, isAdmin: boolean) {
    const source = await this.find(id, isAdmin ? undefined : actingUserId) as Record<string, unknown>;
    const now = new Date().toISOString();
    const { features, ...rest } = source;
    delete rest['id']; delete rest['created_at']; delete rest['updated_at'];

    const { data, error } = await this.#db.from('team_training_packages').insert({
      ...rest,
      user_id: isAdmin ? actingUserId : (source['user_id'] as number),
      // A copy starts hidden so it cannot be bought before it is finished.
      status: 0,
      features: phpJsonEncode(features ?? []),
      slug: slugify(String(source['title'] ?? '')),
      created_at: now, updated_at: now,
    } as never).select('id').maybeSingle();
    if (error) throw new HttpError(500, 'Could not duplicate the package: ' + error.message);

    await this.#db.from('team_training_packages')
      .update({ slug: slugWithId(String(source['title'] ?? ''), data!.id) }).eq('id', data!.id);
    return this.find(data!.id);
  }

  async remove(id: number, ownerId?: number): Promise<void> {
    await this.find(id, ownerId);
    const { count } = await this.#db.from('team_package_purchases')
      .select('id', { count: 'exact', head: true }).eq('package_id', id).eq('status', 1);
    // Deleting a sold package would strand its members' course access.
    if (count) throw new HttpError(422, 'This package has been purchased and cannot be deleted.');
    await this.#db.from('team_package_members').delete().eq('team_package_id', id);
    await this.#db.from('team_training_packages').delete().eq('id', id);
  }

  #validate(input: TeamPackageInput): void {
    if (input.pricing_type === 1 && !(Number(input.price) > 0)) {
      throw new HttpError(422, 'A paid package needs a price.');
    }
    if (input.expiry_type === 'limited') {
      const start = unix(input.start_date ?? null);
      const expiry = unix(input.expiry_date ?? null);
      if (start === null || expiry === null) {
        throw new HttpError(422, 'A limited package needs a start and an end date.');
      }
      if (expiry <= start) throw new HttpError(422, 'The package must end after it starts.');
    }
    if (!(Number(input.allocation) > 0)) {
      // Laravel allowed min:0, which creates a package with no seats to fill.
      throw new HttpError(422, 'A package needs at least one seat.');
    }
  }

  #writable(input: TeamPackageInput): Record<string, unknown> {
    const limited = input.expiry_type === 'limited';
    return {
      title: input.title.trim(),
      course_id: input.course_id,
      course_privacy: input.course_privacy,
      allocation: Number(input.allocation),
      pricing_type: input.pricing_type,
      price: input.pricing_type === 1 ? Number(input.price ?? 0) : 0,
      expiry_type: input.expiry_type,
      // Dates only mean something for a limited package; keeping stale ones
      // would silently expire a package switched back to lifetime.
      start_date: limited ? unix(input.start_date ?? null) : null,
      expiry_date: limited ? unix(input.expiry_date ?? null) : null,
      features: phpJsonEncode(input.features ?? []),
      thumbnail: input.thumbnail ?? null,
    };
  }
}
