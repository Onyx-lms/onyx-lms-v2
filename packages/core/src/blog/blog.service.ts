/**
 * R-04 / R-05 / R-07 -- blog posts, categories, settings and moderation.
 *
 * blogs.status is tinyint(1): 1 published, 0 pending. An instructor may only
 * publish directly when the blog_permission setting allows it; otherwise a post
 * lands as pending for an admin to approve.
 */
import type { Db } from '../db/client.ts';
import { HttpError } from '../http/errors.ts';
import { paginate, type PageQuery, type Paginated } from '../http/pagination.ts';
import { slugify, slugWithId } from '../authoring/slug.ts';
import type { SettingsService } from '../settings/settings.service.ts';

const LIST_COLUMNS = 'id, title, slug, keywords, thumbnail, banner, category_id, user_id, is_popular, status, created_at';
const FULL_COLUMNS = 'id, title, slug, keywords, description, thumbnail, banner, category_id, user_id, is_popular, status, created_at, updated_at';

export interface BlogInput {
  title: string;
  description?: string | null;
  keywords?: string | null;
  category_id?: number | null;
  thumbnail?: string | null;
  banner?: string | null;
  is_popular?: number;
}

export class BlogService {
  #db: Db;
  #settings: SettingsService;
  constructor(db: Db, settings: SettingsService) {
    this.#db = db;
    this.#settings = settings;
  }

  /**
   * R-07 -- the blog module can be switched off entirely.
   *
   * Laravel read this through get_frontend_settings(), i.e. the
   * `frontend_settings` table -- which this deployment never created, so the
   * helper returned false and BlogVisibility redirected every blog route to
   * home. That is the same "schema incomplete" defect that disabled the page
   * builder, not a deliberate setting, so the key is read from `settings` here
   * and an absent value means on. Setting it to 0 still hides the module.
   */
  async isEnabled(): Promise<boolean> {
    const value = await this.#settings.get('blog_visibility_on_the_home_page');
    return value === null || (value !== '0' && value !== 'false' && value !== '');
  }

  async assertEnabled(): Promise<void> {
    if (!(await this.isEnabled())) throw new HttpError(404, 'Not found.');
  }

  /**
   * R-07 -- InstructorBlogPermission. This gates whether an instructor may
   * reach the blog module at all; it is NOT a publish permission. Instructor
   * posts are pending either way (see create()).
   */
  async instructorsAllowed(): Promise<boolean> {
    const value = await this.#settings.get('instructors_blog_permission');
    return value === null || (value !== '0' && value !== 'false' && value !== '');
  }

  async assertInstructorsAllowed(): Promise<void> {
    if (!(await this.instructorsAllowed())) {
      throw new HttpError(403, 'Blog authoring is not available to instructors.');
    }
  }

  // ---- categories ----

  async categories() {
    const { data } = await this.#db.from('blog_categories')
      .select('id, title, subtitle, slug').order('title');
    const rows = data ?? [];
    const counts = await this.postCountsByCategory();
    return rows.map((c) => ({ ...c, post_count: counts.get(c.id) ?? 0 }));
  }

  async postCountsByCategory(): Promise<Map<number, number>> {
    const { data } = await this.#db.from('blogs').select('category_id').eq('status', 1);
    const out = new Map<number, number>();
    for (const r of data ?? []) {
      if (r.category_id == null) continue;
      out.set(r.category_id, (out.get(r.category_id) ?? 0) + 1);
    }
    return out;
  }

  async createCategory(title: string, subtitle: string | null) {
    const now = new Date().toISOString();
    const { data, error } = await this.#db.from('blog_categories')
      .insert({ title: title.trim(), subtitle, slug: slugify(title), created_at: now, updated_at: now })
      .select('id, title, subtitle, slug').maybeSingle();
    if (error) throw new HttpError(500, 'Could not create the category: ' + error.message);
    return data;
  }

  async updateCategory(id: number, title: string, subtitle: string | null) {
    const { error } = await this.#db.from('blog_categories')
      .update({ title: title.trim(), subtitle, slug: slugify(title), updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) throw new HttpError(500, 'Could not update the category: ' + error.message);
  }

  async removeCategory(id: number): Promise<void> {
    // Posts survive, but lose their category rather than disappearing.
    await this.#db.from('blogs').update({ category_id: null }).eq('category_id', id);
    await this.#db.from('blog_categories').delete().eq('id', id);
  }

  // ---- posts ----

  /** R-05 -- the public list: published posts only, popular first. */
  async published(filters: { categorySlug?: string; search?: string },
                  page: PageQuery, path: string): Promise<Paginated<unknown>> {
    let query = this.#db.from('blogs').select(LIST_COLUMNS, { count: 'exact' }).eq('status', 1);

    if (filters.categorySlug) {
      const { data: category } = await this.#db.from('blog_categories')
        .select('id').eq('slug', filters.categorySlug).maybeSingle();
      // An unknown category returns nothing rather than the whole blog.
      if (!category) return paginate([], 0, page, path);
      query = query.eq('category_id', category.id);
    }
    if (filters.search) {
      const term = '%' + filters.search + '%';
      query = query.or('title.ilike.' + term + ',keywords.ilike.' + term
        + ',description.ilike.' + term);
    }

    const { data, count, error } = await query
      .order('is_popular', { ascending: false })
      .order('id', { ascending: false })
      .range(page.from, page.to);
    if (error) throw new HttpError(500, 'blogs.published failed: ' + error.message);
    return paginate(await this.decorate(data ?? []), count ?? 0, page, path);
  }

  async decorate(rows: { user_id: number | null; category_id: number | null }[]) {
    const userIds = [...new Set(rows.map((r) => r.user_id).filter(Boolean))] as number[];
    const catIds = [...new Set(rows.map((r) => r.category_id).filter(Boolean))] as number[];
    const [users, cats] = await Promise.all([
      userIds.length ? this.#db.from('users').select('id, name, photo').in('id', userIds)
                     : Promise.resolve({ data: [] }),
      catIds.length ? this.#db.from('blog_categories').select('id, title, slug').in('id', catIds)
                    : Promise.resolve({ data: [] }),
    ]);
    const userById = new Map((users.data ?? []).map((u) => [u.id, u]));
    const catById = new Map((cats.data ?? []).map((c) => [c.id, c]));
    return rows.map((r) => ({
      ...r,
      author: userById.get(r.user_id as number) ?? null,
      category: catById.get(r.category_id as number) ?? null,
    }));
  }

  async bySlug(slug: string) {
    const { data } = await this.#db.from('blogs')
      .select(FULL_COLUMNS).eq('slug', slug).eq('status', 1).maybeSingle();
    if (!data) throw new HttpError(404, 'Blog post not found.');
    const [decorated] = await this.decorate([data]);
    return decorated;
  }

  /** Authoring list: admins see everything, instructors only their own. */
  async listFor(opts: { userId?: number; status?: number; search?: string },
                page: PageQuery, path: string): Promise<Paginated<unknown>> {
    let query = this.#db.from('blogs').select(LIST_COLUMNS, { count: 'exact' });
    if (opts.userId != null) query = query.eq('user_id', opts.userId);
    if (opts.status !== undefined) query = query.eq('status', opts.status);
    if (opts.search) query = query.ilike('title', '%' + opts.search + '%');

    const { data, count, error } = await query
      .order('id', { ascending: false }).range(page.from, page.to);
    if (error) throw new HttpError(500, 'blogs.list failed: ' + error.message);
    return paginate(await this.decorate(data ?? []), count ?? 0, page, path);
  }

  async find(id: number, ownerId?: number) {
    let query = this.#db.from('blogs').select(FULL_COLUMNS).eq('id', id);
    if (ownerId != null) query = query.eq('user_id', ownerId);
    const { data } = await query.maybeSingle();
    if (!data) throw new HttpError(404, 'Blog post not found.');
    return data;
  }

  /**
   * R-04 / R-07 -- creating a post.
   * Admin posts publish immediately (status 1); instructor posts always land as
   * pending (status 0) for an admin to approve, exactly as the two Laravel
   * controllers hard-coded it.
   */
  async create(userId: number, input: BlogInput, canPublish: boolean) {
    const now = new Date().toISOString();
    const { data, error } = await this.#db.from('blogs').insert({
      user_id: userId,
      title: input.title.trim(),
      slug: slugify(input.title),
      description: input.description ?? null,
      keywords: input.keywords ?? null,
      category_id: input.category_id ?? null,
      thumbnail: input.thumbnail ?? null,
      banner: input.banner ?? null,
      is_popular: input.is_popular ?? 0,
      status: canPublish ? 1 : 0,
      created_at: now, updated_at: now,
    }).select(FULL_COLUMNS).maybeSingle();
    if (error) throw new HttpError(500, 'Could not create the post: ' + error.message);

    // The row id makes the slug unique across duplicate titles, as with courses.
    const slug = slugWithId(input.title, data!.id);
    await this.#db.from('blogs').update({ slug }).eq('id', data!.id);
    return { ...data!, slug };
  }

  async update(id: number, input: BlogInput, ownerId?: number) {
    await this.find(id, ownerId);
    const { error } = await this.#db.from('blogs').update({
      title: input.title.trim(),
      description: input.description ?? null,
      keywords: input.keywords ?? null,
      category_id: input.category_id ?? null,
      thumbnail: input.thumbnail ?? null,
      banner: input.banner ?? null,
      is_popular: input.is_popular ?? 0,
      updated_at: new Date().toISOString(),
    }).eq('id', id);
    if (error) throw new HttpError(500, 'Could not update the post: ' + error.message);
    return this.find(id);
  }

  /** R-07 -- publish / unpublish, and the pending queue. */
  async setStatus(id: number, status: 0 | 1) {
    await this.find(id);
    await this.#db.from('blogs')
      .update({ status, updated_at: new Date().toISOString() }).eq('id', id);
    return this.find(id);
  }

  async pending(page: PageQuery, path: string): Promise<Paginated<unknown>> {
    return this.listFor({ status: 0 }, page, path);
  }

  async remove(id: number, ownerId?: number): Promise<void> {
    await this.find(id, ownerId);
    // No FKs exist, so the engagement rows are ours to clean up.
    await this.#db.from('blog_comments').delete().eq('blog_id', id);
    await this.#db.from('blog_likes').delete().eq('blog_id', id);
    const { error } = await this.#db.from('blogs').delete().eq('id', id);
    if (error) throw new HttpError(500, 'Could not delete the post: ' + error.message);
  }

  async popular(limit = 3) {
    const { data } = await this.#db.from('blogs')
      .select(LIST_COLUMNS).eq('status', 1)
      .order('is_popular', { ascending: false })
      .order('id', { ascending: false })
      .limit(limit);
    return this.decorate(data ?? []);
  }
}
