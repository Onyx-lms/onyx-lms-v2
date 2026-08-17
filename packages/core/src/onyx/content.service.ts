/**
 * LRN-02 -- content delivery.
 *
 * "Streaming video, documents and resumable lessons with per-learner progress
 * tracking and offline-friendly resources."
 *
 * Two rules run through all of it:
 *
 *   1. Content is reachable only by someone enrolled in its course. Preview
 *      lessons are the single exception, and they are marked as such.
 *   2. Progress is per learner, kept as one row per lesson updated in place.
 *      "Where was I" needs a position, not a history.
 */
import type { OnyxDb } from './db.ts';
import type { LessonType, Role } from '@onyx/types';
import { HttpError } from '../http/errors.ts';
import type { AcademicsService } from './academics.service.ts';

const MODULE_COLUMNS = 'id, tenant_id, course_id, title, summary, sort';
const LESSON_COLUMNS = 'id, tenant_id, course_id, module_id, title, type, path, body, duration_seconds, sort, is_preview';
const PROGRESS_COLUMNS = 'id, tenant_id, course_id, lesson_id, user_id, position_seconds, completed_at, updated_at';
const RESOURCE_COLUMNS = 'id, tenant_id, course_id, lesson_id, title, path, mime, size_bytes, created_at';

export const ONYX_LESSON_TYPES: LessonType[] = ['video', 'document', 'image', 'text', 'link'];

/** The types whose `path` must point at something. `text` carries its own. */
const NEEDS_SOURCE: LessonType[] = ['video', 'document', 'image', 'link'];

/**
 * Who reaches course content without being enrolled in it.
 *
 * Only these two. Testing for `role === 'student'` instead would quietly let
 * `exams` and `placement` -- real roles, with no business in a course they are
 * not part of -- read every lesson in the institution.
 */
const STAFF: Role[] = ['admin', 'faculty'];
const isStaff = (role: Role) => STAFF.includes(role);

/** What the API needs from the storage layer. Kept narrow so tests can fake it. */
export interface SignedUrlSource {
  signedUrl(path: string, expiresInSeconds?: number): Promise<string | null>;
  upload(key: string, body: Uint8Array, contentType?: string): Promise<string>;
  /** Optional so a test fake need only provide it when it exercises uploads. */
  signedUpload?(key: string): Promise<{ path: string; token: string; signedUrl: string }>;
}

/**
 * Where an institution's files live.
 *
 * Namespaced by tenant so one institution's uploads can never collide with or
 * overwrite another's, whatever a filename happens to be. The bucket is shared
 * with the Laravel port (storage is per project, not per schema), so the `onyx/`
 * prefix keeps the two apart there too.
 */
export function onyxStorageKey(tenantId: number, courseId: number, filename: string): string {
  const safe = (filename || 'file')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    // Dots survive the pass above, so `../../x` would still read as a traversal
    // to a human even though the separators are gone. Collapse them.
    .replace(/\.{2,}/g, '.')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(-120) || 'file';
  // A timestamp rather than the bare name: two people uploading "notes.pdf" to
  // the same course must not overwrite each other.
  return 'onyx/' + tenantId + '/courses/' + courseId + '/' + Date.now() + '-' + safe;
}

export class ContentService {
  #db: OnyxDb;
  #academics: AcademicsService;
  #storage: SignedUrlSource;

  constructor(db: OnyxDb, academics: AcademicsService, storage: SignedUrlSource) {
    this.#db = db;
    this.#academics = academics;
    this.#storage = storage;
  }

  // ---- authoring ----

  async createModule(tenantId: number, courseId: number, input: {
    title: string; summary?: string | null; sort?: number;
  }) {
    await this.#academics.course(tenantId, courseId);
    const { data, error } = await this.#db.from('onyx_modules').insert({
      tenant_id: tenantId,
      course_id: courseId,
      title: input.title.trim(),
      summary: input.summary ?? null,
      sort: input.sort ?? 0,
    }).select(MODULE_COLUMNS).maybeSingle();
    if (error) throw new HttpError(500, 'Could not create the module: ' + error.message);
    return data!;
  }

  async createLesson(tenantId: number, moduleId: number, input: {
    title: string; type?: LessonType; path?: string | null; body?: string | null;
    duration_seconds?: number; sort?: number; is_preview?: boolean;
  }) {
    const mod = await this.#module(tenantId, moduleId);
    const type = input.type ?? 'video';
    if (!ONYX_LESSON_TYPES.includes(type)) throw new HttpError(422, 'That is not a lesson type.');
    // A video lesson with nothing to play is the commonest authoring mistake,
    // and it only shows up when a learner opens it.
    if (NEEDS_SOURCE.includes(type) && !input.path?.trim()) {
      throw new HttpError(422, 'A ' + type + ' lesson needs a source.');
    }
    if (type === 'text' && !input.body?.trim()) {
      throw new HttpError(422, 'A text lesson needs some text.');
    }

    const { data, error } = await this.#db.from('onyx_lessons').insert({
      tenant_id: tenantId,
      // Denormalised from the module so the enrolment check is one read.
      course_id: mod.course_id,
      module_id: moduleId,
      title: input.title.trim(),
      type,
      path: input.path ?? null,
      body: input.body ?? null,
      duration_seconds: input.duration_seconds ?? 0,
      sort: input.sort ?? 0,
      is_preview: input.is_preview ? 1 : 0,
    }).select(LESSON_COLUMNS).maybeSingle();
    if (error) throw new HttpError(500, 'Could not create the lesson: ' + error.message);
    return data!;
  }

  // ---- reading ----

  /**
   * The course outline, with each learner's own progress folded in.
   *
   * Someone not enrolled sees the shape of the course and its preview lessons,
   * which is what makes a catalog useful, and nothing else.
   */
  async outline(tenantId: number, courseId: number, userId: string, role: Role) {
    // Not `course()`: an unenrolled learner is *meant* to reach this -- that
    // is what makes a catalog useful -- so this is the one content read with
    // no enrolment gate under it, and therefore the one that has to check
    // publication itself. Without it, a draft's whole module and lesson
    // structure, plus the body of every preview lesson, was public to the
    // tenant.
    const course = await this.#academics.assertCourseVisible(tenantId, courseId, role);
    const enrolled = isStaff(role)
      ? true
      : Boolean(await this.#academics.enrollment(tenantId, courseId, userId)
        .then((e) => e?.status === 1));

    const [{ data: modules }, { data: lessons }] = await Promise.all([
      this.#db.from('onyx_modules').select(MODULE_COLUMNS)
        .eq('tenant_id', tenantId).eq('course_id', courseId).order('sort'),
      this.#db.from('onyx_lessons').select(LESSON_COLUMNS)
        .eq('tenant_id', tenantId).eq('course_id', courseId).order('sort'),
    ]);

    const progress = await this.progressFor(tenantId, courseId, userId);
    const byLesson = new Map(progress.map((p) => [Number(p.lesson_id), p]));

    const visible = (lessons ?? []).map((l) => {
      const locked = !enrolled && !l.is_preview;
      const p = byLesson.get(Number(l.id));
      return {
        ...l,
        // Locked lessons keep their title and length -- that is the catalog --
        // but never their source.
        path: locked ? null : l.path,
        body: locked ? null : l.body,
        locked,
        position_seconds: p?.position_seconds ?? 0,
        completed_at: p?.completed_at ?? null,
      };
    });

    const done = visible.filter((l) => l.completed_at).length;
    return {
      course,
      enrolled,
      modules: (modules ?? []).map((m) => ({
        ...m, lessons: visible.filter((l) => Number(l.module_id) === Number(m.id)),
      })),
      progress: {
        total: visible.length,
        completed: done,
        percent: visible.length ? Math.round((done / visible.length) * 100) : 0,
      },
    };
  }

  /**
   * The bulk twin of `outline()`, for a learner's own enrolled courses.
   *
   * A dashboard building a "resume where you left off" card, or a progress
   * ring per course, needs the same modules-with-progress shape `outline()`
   * returns -- but for every enrolled course at once, and it used to get
   * there by calling `outline()` in a loop, which is three queries
   * (modules, lessons, progress) times every course. This reads modules,
   * lessons and progress for the whole course set in three queries total
   * and folds each course's shape in memory.
   *
   * Only ever called with a learner's own enrolled course ids, so unlike
   * `outline()` there is no staff/enrolment branch to resolve -- every
   * course in the list is already known to be theirs. Keyed by course id --
   * a plain object, since this crosses into a JSON response.
   */
  async outlinesBulk(tenantId: number, courseIds: number[], userId: string) {
    const result: Record<number, Awaited<ReturnType<ContentService['outline']>>> = {};
    if (!courseIds.length) return result;

    const [courses, modulesQ, lessonsQ, progressQ] = await Promise.all([
      this.#academics.coursesByIds(tenantId, courseIds),
      this.#db.from('onyx_modules').select(MODULE_COLUMNS)
        .eq('tenant_id', tenantId).in('course_id', courseIds).order('sort'),
      this.#db.from('onyx_lessons').select(LESSON_COLUMNS)
        .eq('tenant_id', tenantId).in('course_id', courseIds).order('sort'),
      this.#db.from('onyx_lesson_progress').select(PROGRESS_COLUMNS)
        .eq('tenant_id', tenantId).eq('user_id', userId).in('course_id', courseIds),
    ]);

    const courseById = new Map(courses.map((c) => [Number(c.id), c]));
    const modules = modulesQ.data ?? [];
    const lessons = lessonsQ.data ?? [];
    const progress = progressQ.data ?? [];

    const modulesByCourse = new Map<number, typeof modules>();
    for (const m of modules) {
      const c = Number(m.course_id);
      const list = modulesByCourse.get(c) ?? [];
      list.push(m);
      modulesByCourse.set(c, list);
    }
    const lessonsByCourse = new Map<number, typeof lessons>();
    for (const l of lessons) {
      const c = Number(l.course_id);
      const list = lessonsByCourse.get(c) ?? [];
      list.push(l);
      lessonsByCourse.set(c, list);
    }
    const progressByLesson = new Map(progress.map((p) => [Number(p.lesson_id), p]));

    for (const courseId of courseIds) {
      const course = courseById.get(courseId);
      if (!course) continue; // withdrawn or otherwise gone since the id list was built

      const visible = (lessonsByCourse.get(courseId) ?? []).map((l) => {
        const p = progressByLesson.get(Number(l.id));
        return {
          ...l,
          locked: false, // this course is theirs; nothing on it is locked from them
          position_seconds: p?.position_seconds ?? 0,
          completed_at: p?.completed_at ?? null,
        };
      });
      const done = visible.filter((l) => l.completed_at).length;

      result[courseId] = {
        course,
        enrolled: true,
        modules: (modulesByCourse.get(courseId) ?? []).map((m) => ({
          ...m, lessons: visible.filter((l) => Number(l.module_id) === Number(m.id)),
        })),
        progress: {
          total: visible.length,
          completed: done,
          percent: visible.length ? Math.round((done / visible.length) * 100) : 0,
        },
      };
    }
    return result;
  }

  /**
   * One lesson, ready to play.
   *
   * Video paths become short-lived signed URLs rather than public ones: course
   * material that is reachable by anyone with the link is not access-controlled,
   * it is merely unlisted.
   */
  async lesson(tenantId: number, lessonId: number, userId: string, role: Role) {
    const lesson = await this.#lesson(tenantId, lessonId);
    if (!isStaff(role) && !lesson.is_preview) {
      await this.#academics.assertEnrolled(tenantId, Number(lesson.course_id), userId);
    }

    const url = lesson.path
      ? (lesson.type === 'link' ? lesson.path : await this.#storage.signedUrl(lesson.path, 3600))
      : null;
    const progress = await this.#progress(tenantId, lessonId, userId);

    return {
      ...lesson,
      url,
      position_seconds: progress?.position_seconds ?? 0,
      completed_at: progress?.completed_at ?? null,
      resources: await this.resources(tenantId, Number(lesson.course_id), lessonId),
    };
  }

  // ---- progress ----

  async progressFor(tenantId: number, courseId: number, userId: string) {
    const { data } = await this.#db.from('onyx_lesson_progress')
      .select(PROGRESS_COLUMNS)
      .eq('tenant_id', tenantId).eq('course_id', courseId).eq('user_id', userId);
    return data ?? [];
  }

  /**
   * Records where a learner has got to.
   *
   * The position only ever moves forward. Scrubbing back to check something and
   * then closing the tab must not lose the twenty minutes already watched.
   */
  async recordProgress(tenantId: number, lessonId: number, userId: string, input: {
    position_seconds: number; completed?: boolean;
  }) {
    const lesson = await this.#lesson(tenantId, lessonId);
    await this.#academics.assertEnrolled(tenantId, Number(lesson.course_id), userId);

    const position = Math.max(0, Math.floor(input.position_seconds));
    const duration = Number(lesson.duration_seconds) || 0;
    if (duration && position > duration + 5) {
      throw new HttpError(422, 'That position is beyond the end of the lesson.');
    }

    const existing = await this.#progress(tenantId, lessonId, userId);
    const now = new Date().toISOString();
    // Completion is sticky: a learner who rewatches has not un-finished it.
    const completedAt = input.completed
      ? (existing?.completed_at ?? now)
      : (existing?.completed_at ?? null);

    if (existing) {
      const furthest = Math.max(position, Number(existing.position_seconds) || 0);
      await this.#db.from('onyx_lesson_progress').update({
        position_seconds: furthest, completed_at: completedAt, updated_at: now,
      }).eq('id', existing.id);
      return { ...existing, position_seconds: furthest, completed_at: completedAt };
    }

    const { data, error } = await this.#db.from('onyx_lesson_progress').insert({
      tenant_id: tenantId,
      course_id: Number(lesson.course_id),
      lesson_id: lessonId,
      user_id: userId,
      position_seconds: position,
      completed_at: completedAt,
    }).select(PROGRESS_COLUMNS).maybeSingle();
    if (error) throw new HttpError(500, 'Could not save your progress: ' + error.message);
    return data!;
  }

  // ---- LRN-02b: offline-friendly resources ----

  /**
   * LRN-02 -- a ticket for putting lesson media into storage from the browser.
   *
   * The alternative, posting the file to this app and forwarding it, has a
   * ceiling of 4.5 MB on Vercel (docs/ADR-012), which rules out video and most
   * slide decks. So the bytes never touch the app: it mints the key, hands
   * back a one-shot upload URL, and the browser sends the file straight to
   * storage.
   *
   * The caller supplies a filename and nothing else. The key is derived from
   * the tenant and course exactly as `uploadResource` derives it -- a path
   * taken from a request body is a path into somebody else's institution.
   */
  async signLessonUpload(tenantId: number, courseId: number, filename: string) {
    await this.#academics.course(tenantId, courseId);
    if (!this.#storage.signedUpload) {
      throw new HttpError(500, 'This deployment cannot issue upload tickets.');
    }
    return this.#storage.signedUpload(onyxStorageKey(tenantId, courseId, filename));
  }

  /** Uploads a file and records it in one step, under this tenant's prefix. */
  async uploadResource(tenantId: number, courseId: number, createdBy: string, file: {
    filename: string; contentType?: string; bytes: Uint8Array;
  }, input: { title?: string; lesson_id?: number | null }) {
    await this.#academics.course(tenantId, courseId);
    const key = onyxStorageKey(tenantId, courseId, file.filename);
    await this.#storage.upload(key, file.bytes, file.contentType);
    return this.addResource(tenantId, courseId, createdBy, {
      title: input.title?.trim() || file.filename,
      path: key,
      lesson_id: input.lesson_id ?? null,
      mime: file.contentType ?? null,
      size_bytes: file.bytes.byteLength,
    });
  }

  async addResource(tenantId: number, courseId: number, createdBy: string, input: {
    title: string; path: string; lesson_id?: number | null;
    mime?: string | null; size_bytes?: number | null;
  }) {
    await this.#academics.course(tenantId, courseId);
    const { data, error } = await this.#db.from('onyx_resources').insert({
      tenant_id: tenantId,
      course_id: courseId,
      lesson_id: input.lesson_id ?? null,
      title: input.title.trim(),
      path: input.path,
      mime: input.mime ?? null,
      size_bytes: input.size_bytes ?? null,
      created_by: createdBy,
    }).select(RESOURCE_COLUMNS).maybeSingle();
    if (error) throw new HttpError(500, 'Could not add the resource: ' + error.message);
    return data!;
  }

  async resources(tenantId: number, courseId: number, lessonId?: number) {
    let q = this.#db.from('onyx_resources')
      .select(RESOURCE_COLUMNS).eq('tenant_id', tenantId).eq('course_id', courseId);
    if (lessonId) q = q.eq('lesson_id', lessonId);
    const { data } = await q.order('id');
    return data ?? [];
  }

  /**
   * A download link that expires.
   *
   * The acceptance criterion for LRN-02b is that a learner who is not enrolled
   * cannot obtain one, so the enrolment check happens here rather than at the
   * page that renders the button -- a page is not a boundary.
   */
  async resourceUrl(tenantId: number, resourceId: number, userId: string, role: Role) {
    const { data } = await this.#db.from('onyx_resources')
      .select(RESOURCE_COLUMNS).eq('tenant_id', tenantId).eq('id', resourceId).maybeSingle();
    if (!data) throw new HttpError(404, 'Resource not found.');

    if (role === 'faculty') {
      // Faculty of THIS course. The role is not a key to every course's files.
      await this.#academics.assertCanTeach(tenantId, Number(data.course_id), userId, role);
    } else if (role !== 'admin') {
      await this.#academics.assertEnrolled(tenantId, Number(data.course_id), userId);
    }

    const url = await this.#storage.signedUrl(data.path, 300);
    if (!url) throw new HttpError(404, 'That file is no longer available.');
    return { url, expires_in: 300, resource: data };
  }

  // ---- internals ----

  async #module(tenantId: number, id: number) {
    const { data } = await this.#db.from('onyx_modules')
      .select(MODULE_COLUMNS).eq('tenant_id', tenantId).eq('id', id).maybeSingle();
    if (!data) throw new HttpError(404, 'Module not found.');
    return data;
  }

  async #lesson(tenantId: number, id: number) {
    const { data } = await this.#db.from('onyx_lessons')
      .select(LESSON_COLUMNS).eq('tenant_id', tenantId).eq('id', id).maybeSingle();
    if (!data) throw new HttpError(404, 'Lesson not found.');
    return data;
  }

  async #progress(tenantId: number, lessonId: number, userId: string) {
    const { data } = await this.#db.from('onyx_lesson_progress')
      .select(PROGRESS_COLUMNS)
      .eq('tenant_id', tenantId).eq('lesson_id', lessonId).eq('user_id', userId)
      .maybeSingle();
    return data ?? null;
  }
}
