/**
 * C-03 / C-04 -- course catalog and detail.
 *
 * Filter semantics are a direct port of frontend/CourseController::index:
 *   status = active always; parent category includes children; search spans
 *   six columns; price maps to is_paid / discount_flag; newest first by id.
 *
 * Default page size follows the Laravel layout toggle: 9 for grid, 5 for list.
 */
import type { Db } from '../db/client.ts';
import { HttpError } from '../http/errors.ts';
import { paginate, type PageQuery, type Paginated } from '../http/pagination.ts';
import { phpJsonDecode } from '../json/php-json.ts';
import type { CategoriesService } from './categories.service.ts';

export type PriceFilter = 'free' | 'paid' | 'discount';
export type Layout = 'grid' | 'list';

export interface CourseFilters {
  categorySlug?: string;
  search?: string;
  price?: PriceFilter;
  level?: string;
  language?: string;
}

const CARD_COLUMNS = 'id, title, slug, short_description, thumbnail, level, language, is_paid, price, discount_flag, discounted_price, category_id, user_id, created_at';

const DETAIL_COLUMNS = 'id, title, slug, short_description, thumbnail, level, language, is_paid, price, discount_flag, discounted_price, category_id, user_id, created_at, description, requirements, outcomes, faqs, banner, preview, meta_keywords, meta_description, course_type, expiry_period, enable_drip_content, instructor_ids, status';

export function perPageForLayout(layout: Layout): number {
  return layout === 'list' ? 5 : 9;
}

export class CoursesService {
  #db: Db;
  #categories: CategoriesService;
  constructor(db: Db, categories: CategoriesService) {
    this.#db = db;
    this.#categories = categories;
  }

  async list(filters: CourseFilters, page: PageQuery, path: string): Promise<Paginated<unknown>> {
    let query = this.#db.from('courses')
      .select(CARD_COLUMNS, { count: 'exact' })
      .eq('status', 'active');

    if (filters.categorySlug) {
      const ids = await this.#categories.filterIdsForSlug(filters.categorySlug);
      // Unknown slug must return nothing, not silently ignore the filter.
      if (!ids) return paginate([], 0, page, path);
      query = query.in('category_id', ids);
    }

    if (filters.search) {
      const term = `%${filters.search}%`;
      query = query.or([
        `title.ilike.${term}`,
        `short_description.ilike.${term}`,
        `level.ilike.${term}`,
        `meta_keywords.ilike.${term}`,
        `meta_description.ilike.${term}`,
        `description.ilike.${term}`,
      ].join(','));
    }

    if (filters.price === 'paid') query = query.eq('is_paid', 1);
    else if (filters.price === 'free') query = query.eq('is_paid', 0);
    else if (filters.price === 'discount') query = query.eq('discount_flag', 1);

    if (filters.level) query = query.eq('level', filters.level);
    if (filters.language) query = query.eq('language', filters.language);

    const { data, count, error } = await query
      .order('id', { ascending: false })
      .range(page.from, page.to);
    if (error) throw new HttpError(500, `courses.list failed: ${error.message}`);

    const rows = await this.#decorate(data ?? []);
    return paginate(rows, count ?? 0, page, path);
  }

  /**
   * Courses the student is enrolled in, with progress.
   * enrollments has no FK, so the join is done in two reads rather than
   * relying on PostgREST embedding that the schema cannot express.
   */
  async enrolledFor(userId: number) {
    const { data: enrolments } = await this.#db
      .from('enrollments').select('id, course_id, expiry_date, entry_date, created_at')
      .eq('user_id', userId).order('id', { ascending: false });

    const ids = [...new Set((enrolments ?? []).map((e) => e.course_id))].filter(Boolean) as number[];
    if (!ids.length) return [];

    const [{ data: courses }, { data: history }] = await Promise.all([
      this.#db.from('courses').select(CARD_COLUMNS).in('id', ids),
      this.#db.from('watch_histories')
        .select('course_id, course_progress, completed_date').eq('student_id', userId),
    ]);

    const progress = new Map((history ?? []).map((h) => [h.course_id, h]));
    const byId = new Map((courses ?? []).map((c) => [c.id, c]));

    return (enrolments ?? []).flatMap((e) => {
      const course = byId.get(e.course_id as number);
      if (!course) return [];
      const h = progress.get(e.course_id as number);
      const expired = e.expiry_date ? new Date(e.expiry_date).getTime() < Date.now() : false;
      return [{
        ...course,
        enrollment_id: e.id,
        expiry_date: e.expiry_date,
        expired,
        progress: Math.round(Number(h?.course_progress ?? 0)),
        completed: Boolean(h?.completed_date),
      }];
    });
  }
  /** Distinct values for the level and language filter dropdowns. */
  async facets(): Promise<{ levels: string[]; languages: string[] }> {
    const { data, error } = await this.#db
      .from('courses').select('level, language').eq('status', 'active');
    if (error) throw new HttpError(500, `courses.facets failed: ${error.message}`);
    const levels = new Set<string>();
    const languages = new Set<string>();
    for (const r of data ?? []) {
      if (r.level) levels.add(r.level);
      if (r.language) languages.add(r.language);
    }
    return { levels: [...levels].sort(), languages: [...languages].sort() };
  }

  async detailBySlug(slug: string) {
    const { data: course } = await this.#db
      .from('courses').select(DETAIL_COLUMNS).eq('slug', slug).eq('status', 'active').maybeSingle();
    if (!course) throw new HttpError(404, 'Course not found.');

    const [sections, lessons, enrolls, reviews, instructor] = await Promise.all([
      this.#db.from('sections').select('id, title, sort').eq('course_id', course.id).order('sort'),
      this.#db.from('lessons')
        .select('id, title, section_id, lesson_type, duration, is_free, sort')
        .eq('course_id', course.id).order('sort'),
      this.#db.from('enrollments').select('id', { count: 'exact', head: true }).eq('course_id', course.id),
      this.#db.from('reviews').select('rating').eq('course_id', course.id),
      this.#instructor(course.user_id),
    ]);

    const lessonRows = lessons.data ?? [];
    const curriculum = (sections.data ?? []).map((s) => ({
      ...s,
      lessons: lessonRows.filter((l) => l.section_id === s.id),
    }));

    const ratings = (reviews.data ?? []).map((r) => Number(r.rating ?? 0)).filter((n) => n > 0);
    const breakdown: Record<string, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    for (const r of ratings) {
      const bucket = String(Math.min(5, Math.max(1, Math.round(r))));
      breakdown[bucket] = (breakdown[bucket] ?? 0) + 1;
    }

    return {
      ...course,
      // JSON-as-text columns, decoded at the boundary.
      requirements: phpJsonDecode<string[]>(course.requirements, []),
      outcomes: phpJsonDecode<string[]>(course.outcomes, []),
      faqs: phpJsonDecode<unknown[]>(course.faqs, []),
      instructor,
      curriculum,
      total_lesson: lessonRows.length,
      total_enrollment: enrolls.count ?? 0,
      rating: {
        average: ratings.length
          ? Math.round((ratings.reduce((a, b) => a + b, 0) / ratings.length) * 10) / 10
          : 0,
        count: ratings.length,
        breakdown,
      },
    };
  }

  async #instructor(userId: number | null) {
    if (!userId) return null;
    const { data } = await this.#db
      .from('users').select('id, name, photo, about, role').eq('id', userId).maybeSingle();
    return data ?? null;
  }

  /** Attaches instructor name/photo to card rows without an N+1. */
  async #decorate(rows: Record<string, unknown>[]) {
    const ids = [...new Set(rows.map((r) => r['user_id']).filter(Boolean))] as number[];
    if (ids.length === 0) return rows;
    const { data } = await this.#db.from('users').select('id, name, photo').in('id', ids);
    const byId = new Map((data ?? []).map((u) => [u.id, u]));
    return rows.map((r) => ({
      ...r,
      instructor_name: byId.get(r['user_id'] as number)?.name ?? null,
      instructor_image: byId.get(r['user_id'] as number)?.photo ?? null,
    }));
  }
}
