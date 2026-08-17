/**
 * C-09 -- public instructor pages.
 *
 * Ports instructor_rating(), instructor_reviews() and count_course_by_instructor().
 */
import type { Db } from '../db/client.ts';
import { HttpError } from '../http/errors.ts';
import { phpJsonDecode } from '../json/php-json.ts';
import { paginate, type PageQuery, type Paginated } from '../http/pagination.ts';

const PUBLIC_COLUMNS = 'id, name, photo, about, skills, facebook, twitter, linkedin, website, role';

export class InstructorsService {
  #db: Db;
  constructor(db: Db) { this.#db = db; }

  async list(page: PageQuery, path: string): Promise<Paginated<unknown>> {
    const { data, count, error } = await this.#db
      .from('users').select(PUBLIC_COLUMNS, { count: 'exact' })
      .eq('role', 'instructor')
      .order('id', { ascending: false })
      .range(page.from, page.to);
    if (error) throw new HttpError(500, `instructors.list failed: ${error.message}`);

    const ids = (data ?? []).map((u) => u.id);
    const [courseCounts, ratings] = await Promise.all([
      this.#courseCounts(ids), this.#ratings(ids),
    ]);
    const rows = (data ?? []).map((u) => ({
      ...u,
      skills: phpJsonDecode<string[]>(u.skills, []),
      course_count: courseCounts.get(u.id) ?? 0,
      rating: ratings.get(u.id) ?? { average: 0, count: 0 },
    }));
    return paginate(rows, count ?? 0, page, path);
  }

  async detail(id: number) {
    const { data } = await this.#db
      .from('users').select('id, name, photo, about, skills, facebook, twitter, linkedin, website, role, educations')
      .eq('id', id).eq('role', 'instructor').maybeSingle();
    if (!data) throw new HttpError(404, 'Instructor not found.');

    const { data: courses } = await this.#db.from('courses')
      .select('id, title, slug, thumbnail, price, is_paid, discount_flag, discounted_price, level')
      .eq('user_id', id).eq('status', 'active')
      .order('id', { ascending: false });

    const [counts, ratings] = await Promise.all([this.#courseCounts([id]), this.#ratings([id])]);
    return {
      ...data,
      skills: phpJsonDecode<string[]>(data.skills, []),
      educations: phpJsonDecode<unknown[]>(data.educations, []),
      courses: courses ?? [],
      course_count: counts.get(id) ?? 0,
      rating: ratings.get(id) ?? { average: 0, count: 0 },
    };
  }

  async #courseCounts(ids: number[]): Promise<Map<number, number>> {
    const counts = new Map<number, number>();
    if (!ids.length) return counts;
    const { data } = await this.#db
      .from('courses').select('user_id').eq('status', 'active').in('user_id', ids);
    for (const r of data ?? []) {
      if (r.user_id == null) continue;
      counts.set(r.user_id, (counts.get(r.user_id) ?? 0) + 1);
    }
    return counts;
  }

  async #ratings(ids: number[]): Promise<Map<number, { average: number; count: number }>> {
    const out = new Map<number, { average: number; count: number }>();
    if (!ids.length) return out;
    const { data } = await this.#db
      .from('instructor_reviews').select('instructor_id, rating').in('instructor_id', ids);
    const buckets = new Map<number, number[]>();
    for (const r of data ?? []) {
      if (r.instructor_id == null) continue;
      const list = buckets.get(r.instructor_id) ?? [];
      list.push(Number(r.rating ?? 0));
      buckets.set(r.instructor_id, list);
    }
    for (const [id, list] of buckets) {
      const valid = list.filter((n) => n > 0);
      out.set(id, {
        average: valid.length
          ? Math.round((valid.reduce((a, b) => a + b, 0) / valid.length) * 10) / 10 : 0,
        count: valid.length,
      });
    }
    return out;
  }
}
