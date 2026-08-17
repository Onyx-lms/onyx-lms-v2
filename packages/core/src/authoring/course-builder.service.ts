/**
 * B-01 / B-06 / B-07 / B-08 -- course authoring.
 */
import type { Db } from '../db/client.ts';
import { HttpError } from '../http/errors.ts';
import { phpJsonEncode, phpJsonDecode } from '../json/php-json.ts';
import { slugify, slugWithId } from './slug.ts';
import { paginate, type PageQuery, type Paginated } from '../http/pagination.ts';

export type CourseStatus = 'active' | 'draft' | 'pending' | 'inactive';

export interface CourseInput {
  title: string;
  short_description?: string | null;
  description?: string | null;
  category_id?: number | null;
  level?: string | null;
  language?: string | null;
  course_type?: string | null;
  is_paid?: number;
  price?: number | null;
  discount_flag?: number;
  discounted_price?: number | null;
  thumbnail?: string | null;
  banner?: string | null;
  preview?: string | null;
  meta_keywords?: string | null;
  meta_description?: string | null;
  requirements?: string[];
  outcomes?: string[];
  faqs?: unknown[];
  expiry_period?: number | null;
  enable_drip_content?: number;
  drip_content_settings?: { lesson_completion_role: 'duration' | 'percentage'; minimum_duration?: number; minimum_percentage?: number } | null;
}

const COLUMNS = 'id, title, slug, short_description, description, user_id, category_id, course_type, status, level, language, is_paid, price, discount_flag, discounted_price, thumbnail, banner, preview, meta_keywords, meta_description, requirements, outcomes, faqs, instructor_ids, expiry_period, enable_drip_content, drip_content_settings, created_at, updated_at';

export class CourseBuilderService {
  #db: Db;
  constructor(db: Db) { this.#db = db; }

  async listFor(opts: { userId?: number; status?: CourseStatus; search?: string },
                page: PageQuery, path: string): Promise<Paginated<unknown>> {
    let query = this.#db.from('courses').select(COLUMNS, { count: 'exact' });
    // Instructors only ever see their own courses; admins pass no userId.
    if (opts.userId != null) query = query.eq('user_id', opts.userId);
    if (opts.status) query = query.eq('status', opts.status);
    if (opts.search) query = query.or(`title.ilike.%${opts.search}%,slug.ilike.%${opts.search}%`);
    const { data, count, error } = await query
      .order('id', { ascending: false }).range(page.from, page.to);
    if (error) throw new HttpError(500, `courses.list failed: ${error.message}`);
    return paginate((data ?? []).map((c) => this.#decode(c)), count ?? 0, page, path);
  }

  async find(id: number, ownerId?: number) {
    let query = this.#db.from('courses').select(COLUMNS).eq('id', id);
    if (ownerId != null) query = query.eq('user_id', ownerId);
    const { data } = await query.maybeSingle();
    if (!data) throw new HttpError(404, 'Data not found.');
    return this.#decode(data);
  }

  async create(userId: number, input: CourseInput, canPublish: boolean) {
    const now = new Date().toISOString();
    const { data, error } = await this.#db.from('courses').insert({
      ...this.#writable(input),
      user_id: userId,
      // Laravel gates publishing behind instructor_can_publish_course.
      status: canPublish ? 'active' : 'pending',
      slug: slugify(input.title),
      created_at: now,
      updated_at: now,
    }).select(COLUMNS).maybeSingle();
    if (error) throw new HttpError(500, `courses.create failed: ${error.message}`);

    // Laravel appends the id so slugs stay unique across duplicate titles.
    const slug = slugWithId(input.title, data!.id);
    await this.#db.from('courses').update({ slug }).eq('id', data!.id);
    return this.#decode({ ...data!, slug });
  }

  async update(id: number, input: CourseInput, ownerId?: number) {
    await this.find(id, ownerId);
    const { error } = await this.#db.from('courses')
      .update({ ...this.#writable(input), updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) throw new HttpError(500, `courses.update failed: ${error.message}`);
    return this.find(id);
  }

  async setStatus(id: number, status: CourseStatus, ownerId?: number) {
    await this.find(id, ownerId);
    const { error } = await this.#db.from('courses')
      .update({ status, updated_at: new Date().toISOString() }).eq('id', id);
    if (error) throw new HttpError(500, `courses.status failed: ${error.message}`);
    return this.find(id);
  }

  /**
   * B-07 duplicate: a deep copy. Laravel only copied the course row, leaving
   * the clone with no curriculum -- we copy sections, lessons and questions so
   * "duplicate" produces something actually usable.
   */
  async duplicate(id: number, actingUserId: number, isAdmin: boolean) {
    const source = await this.find(id, isAdmin ? undefined : actingUserId) as Record<string, unknown>;
    const now = new Date().toISOString();

    const { requirements, outcomes, faqs, drip_content_settings, ...rest } = source as Record<string, unknown>;
    delete rest['id']; delete rest['created_at']; delete rest['updated_at'];

    const { data: copy, error } = await this.#db.from('courses').insert({
      ...rest,
      user_id: isAdmin ? actingUserId : (source['user_id'] as number | null),
      status: 'draft',
      requirements: phpJsonEncode(requirements ?? []),
      outcomes: phpJsonEncode(outcomes ?? []),
      faqs: phpJsonEncode(faqs ?? []),
      drip_content_settings: drip_content_settings ? phpJsonEncode(drip_content_settings) : null,
      slug: slugify(String(source['title'] ?? '')),
      created_at: now, updated_at: now,
    }).select('id, title').maybeSingle();
    if (error) throw new HttpError(500, `courses.duplicate failed: ${error.message}`);

    const newId = copy!.id;
    await this.#db.from('courses')
      .update({ slug: slugWithId(String(source['title'] ?? ''), newId) }).eq('id', newId);
    await this.#copyCurriculum(id, newId, now);
    return this.find(newId);
  }

  async #copyCurriculum(fromCourse: number, toCourse: number, now: string) {
    const { data: sections } = await this.#db
      .from('sections').select('id, title, sort, user_id').eq('course_id', fromCourse).order('sort');
    const { data: lessons } = await this.#db
      .from('lessons').select('*').eq('course_id', fromCourse).order('sort');

    const sectionMap = new Map<number, number>();
    for (const s of sections ?? []) {
      const { data } = await this.#db.from('sections').insert({
        course_id: toCourse, user_id: s.user_id, title: s.title, sort: s.sort,
        created_at: now, updated_at: now,
      }).select('id').maybeSingle();
      if (data) sectionMap.set(s.id, data.id);
    }

    for (const l of lessons ?? []) {
      const row = { ...(l as Record<string, unknown>) };
      const sourceLessonId = row['id'] as number;
      delete row['id']; delete row['created_at']; delete row['updated_at'];
      row['course_id'] = toCourse;
      row['section_id'] = sectionMap.get(l.section_id as number) ?? null;
      const { data: newLesson } = await this.#db.from('lessons')
        .insert({ ...row, created_at: now, updated_at: now }).select('id').maybeSingle();

      // Quiz lessons carry their questions across too.
      if (l.lesson_type === 'quiz' && newLesson) {
        const { data: questions } = await this.#db
          .from('questions').select('*').eq('quiz_id', sourceLessonId);
        for (const q of questions ?? []) {
          const qRow = { ...(q as Record<string, unknown>) };
          delete qRow['id']; delete qRow['created_at']; delete qRow['updated_at'];
          await this.#db.from('questions')
            .insert({ ...qRow, quiz_id: newLesson.id, created_at: now, updated_at: now });
        }
      }
    }
  }

  async remove(id: number, ownerId?: number): Promise<void> {
    await this.find(id, ownerId);
    // No FK constraints exist, so the cleanup is ours to do.
    const { data: lessons } = await this.#db.from('lessons').select('id').eq('course_id', id);
    for (const l of lessons ?? []) await this.#db.from('questions').delete().eq('quiz_id', l.id);
    await this.#db.from('lessons').delete().eq('course_id', id);
    await this.#db.from('sections').delete().eq('course_id', id);
    await this.#db.from('course_approval_requests').delete().eq('course_id', id);
    const { error } = await this.#db.from('courses').delete().eq('id', id);
    if (error) throw new HttpError(500, `courses.delete failed: ${error.message}`);
  }

  // ---- B-08: approval workflow ----

  async requestApproval(courseId: number, userId: number, message: string) {
    const { data: existing } = await this.#db.from('course_approval_requests')
      .select('id').eq('course_id', courseId).maybeSingle();
    if (existing) throw new HttpError(422, 'An approval request is already pending.');

    const now = new Date().toISOString();
    await this.#db.from('course_approval_requests').insert({
      course_id: courseId, user_id: userId, message, read_status: 0,
      created_at: now, updated_at: now,
    });
    await this.#db.from('courses').update({ status: 'pending' }).eq('id', courseId);
  }

  async pendingApprovals(page: PageQuery, path: string): Promise<Paginated<unknown>> {
    const { data, count, error } = await this.#db
      .from('course_approval_requests').select('id, course_id, user_id, message, read_status, created_at', { count: 'exact' })
      .order('id', { ascending: false }).range(page.from, page.to);
    if (error) throw new HttpError(500, `approvals.list failed: ${error.message}`);
    return paginate(data ?? [], count ?? 0, page, path);
  }

  async resolveApproval(courseId: number, approve: boolean) {
    await this.#db.from('courses')
      .update({ status: approve ? 'active' : 'inactive', updated_at: new Date().toISOString() })
      .eq('id', courseId);
    await this.#db.from('course_approval_requests')
      .update({ read_status: 1 }).eq('course_id', courseId);
  }

  /** Encodes the JSON-as-text columns on the way in. */
  #writable(input: CourseInput): Record<string, unknown> {
    const row: Record<string, unknown> = {
      title: input.title.trim(),
      short_description: input.short_description ?? null,
      description: input.description ?? null,
      category_id: input.category_id ?? null,
      level: input.level ?? null,
      language: input.language ?? null,
      course_type: input.course_type ?? null,
      is_paid: input.is_paid ?? 0,
      price: input.is_paid ? input.price ?? 0 : null,
      discount_flag: input.discount_flag ?? 0,
      discounted_price: input.discount_flag ? input.discounted_price ?? 0 : null,
      thumbnail: input.thumbnail ?? null,
      banner: input.banner ?? null,
      preview: input.preview ?? null,
      meta_keywords: input.meta_keywords ?? null,
      meta_description: input.meta_description ?? null,
      expiry_period: input.expiry_period ?? null,
      enable_drip_content: input.enable_drip_content ?? 0,
    };
    if (input.requirements) row['requirements'] = phpJsonEncode(input.requirements);
    if (input.outcomes) row['outcomes'] = phpJsonEncode(input.outcomes);
    if (input.faqs) row['faqs'] = phpJsonEncode(input.faqs);
    // Drip settings are only meaningful when drip is on; storing them otherwise
    // leaves stale rules that switch on unexpectedly later.
    row['drip_content_settings'] = input.enable_drip_content && input.drip_content_settings
      ? phpJsonEncode(input.drip_content_settings) : null;
    return row;
  }

  /** Decodes the JSON-as-text columns on the way out. */
  #decode(course: Record<string, unknown>): Record<string, unknown> {
    return {
      ...course,
      requirements: phpJsonDecode<string[]>(course['requirements'] as string, []),
      outcomes: phpJsonDecode<string[]>(course['outcomes'] as string, []),
      faqs: phpJsonDecode<unknown[]>(course['faqs'] as string, []),
      drip_content_settings: phpJsonDecode<unknown>(course['drip_content_settings'] as string, null),
    };
  }
}
