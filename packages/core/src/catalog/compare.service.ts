/**
 * E-07 -- side-by-side course comparison.
 *
 * The Laravel route exists (`routes/custom_route.php` -> CourseController@compare)
 * but `frontend.course.compare` was never added to the repository, so /compare
 * throws "View not found". Its sibling `comparewith()` is worse: it calls
 * CodeIgniter query-builder methods (`->like()`, `->or_like()`) on Eloquent and
 * joins a table named `course` that does not exist.
 *
 * So there is no working behaviour to copy, only the intent: up to three active
 * courses, looked up by slug, shown as a feature matrix.
 */
import type { Db } from '../db/client.ts';
import { phpJsonDecode } from '../json/php-json.ts';

/** Laravel accepted course_1..course_3, so three is the ceiling here too. */
export const MAX_COMPARE = 3;

// One literal on purpose: supabase-js derives the row type from the string, and
// a concatenation widens it to `string`, which loses every column type.
const COLUMNS = 'id, title, slug, short_description, thumbnail, level, language, is_paid, price, discount_flag, discounted_price, category_id, user_id, course_type, expiry_period, enable_drip_content, outcomes, requirements, status';

export class CompareService {
  #db: Db;
  constructor(db: Db) { this.#db = db; }

  /**
   * Looks up the given slugs, in the order asked for. Unknown or unpublished
   * slugs are dropped rather than erroring: one bad link in a shared URL should
   * not blank the whole comparison.
   */
  async bySlugs(slugs: string[]) {
    const wanted = [...new Set(slugs.map((s) => s.trim()).filter(Boolean))].slice(0, MAX_COMPARE);
    if (!wanted.length) return [];

    const { data } = await this.#db.from('courses')
      .select(COLUMNS).in('slug', wanted).eq('status', 'active');
    const bySlug = new Map((data ?? []).map((c) => [String(c.slug), c]));
    const rows = wanted.map((s) => bySlug.get(s)).filter(Boolean) as Record<string, unknown>[];
    if (!rows.length) return [];

    const courseIds = rows.map((c) => Number(c['id']));
    const userIds = [...new Set(rows.map((c) => Number(c['user_id'])).filter(Boolean))];
    const categoryIds = [...new Set(rows.map((c) => Number(c['category_id'])).filter(Boolean))];

    const [lessons, enrolments, reviews, users, categories] = await Promise.all([
      this.#db.from('lessons').select('course_id, duration').in('course_id', courseIds),
      this.#db.from('enrollments').select('course_id').in('course_id', courseIds),
      this.#db.from('reviews').select('course_id, rating').in('course_id', courseIds),
      userIds.length ? this.#db.from('users').select('id, name').in('id', userIds)
                     : Promise.resolve({ data: [] }),
      categoryIds.length ? this.#db.from('categories').select('id, title').in('id', categoryIds)
                         : Promise.resolve({ data: [] }),
    ]);

    const userById = new Map((users.data ?? []).map((u) => [u.id, u]));
    const catById = new Map((categories.data ?? []).map((c) => [c.id, c]));

    const tally = <T>(list: T[], key: (t: T) => number) => {
      const m = new Map<number, T[]>();
      for (const row of list) {
        const id = key(row);
        m.set(id, [...(m.get(id) ?? []), row]);
      }
      return m;
    };
    const lessonsBy = tally(lessons.data ?? [], (l) => Number(l.course_id));
    const enrolBy = tally(enrolments.data ?? [], (e) => Number(e.course_id));
    const reviewBy = tally(reviews.data ?? [], (r) => Number(r.course_id));

    return rows.map((c) => {
      const id = Number(c['id']);
      const mine = reviewBy.get(id) ?? [];
      const ratings = mine.map((r) => Number(r.rating ?? 0)).filter((n) => n > 0);
      return {
        ...c,
        outcomes: phpJsonDecode<string[]>(c['outcomes'] as string, []),
        requirements: phpJsonDecode<string[]>(c['requirements'] as string, []),
        instructor: userById.get(Number(c['user_id'])) ?? null,
        category: catById.get(Number(c['category_id'])) ?? null,
        total_lesson: (lessonsBy.get(id) ?? []).length,
        total_enrollment: (enrolBy.get(id) ?? []).length,
        total_duration: sumDurations((lessonsBy.get(id) ?? []).map((l) => l.duration as string | null)),
        rating: {
          average: ratings.length
            ? Math.round((ratings.reduce((a, b) => a + b, 0) / ratings.length) * 10) / 10
            : 0,
          count: ratings.length,
        },
      };
    });
  }

  /** Candidates to add to the comparison, excluding what is already there. */
  async suggestions(exclude: string[], search: string | undefined, limit = 10) {
    let query = this.#db.from('courses')
      .select('id, title, slug, thumbnail').eq('status', 'active');
    if (search?.trim()) query = query.ilike('title', '%' + search.trim() + '%');
    const { data } = await query.order('id', { ascending: false }).limit(limit + MAX_COMPARE);
    const taken = new Set(exclude);
    return (data ?? []).filter((c) => !taken.has(String(c.slug))).slice(0, limit);
  }
}

/** Lesson durations are "HH:MM:SS" text; this totals them into seconds. */
export function sumDurations(values: (string | null)[]): { seconds: number; label: string } {
  let seconds = 0;
  for (const v of values) {
    if (!v) continue;
    const parts = v.split(':').map((p) => Number(p));
    if (parts.some((n) => !Number.isFinite(n))) continue;
    while (parts.length < 3) parts.unshift(0);
    seconds += (parts[0]! * 3600) + (parts[1]! * 60) + parts[2]!;
  }
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return { seconds, label: h ? h + 'h ' + m + 'm' : m + 'm' };
}
