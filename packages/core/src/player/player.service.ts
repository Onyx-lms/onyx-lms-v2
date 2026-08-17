/**
 * PL-01 -- assembling the player.
 *
 * Access rules follow PlayerController::course_player:
 *   a free course is open to any signed-in user; a paid one needs a valid
 *   enrolment. An expired enrolment is refused with its own message, because
 *   "buy it again" is a different action from "you never bought this".
 *   Admins, and the course's own instructor, always get in.
 */
import type { Db } from '../db/client.ts';
import { HttpError } from '../http/errors.ts';
import { phpJsonDecode } from '../json/php-json.ts';
import type { EnrollmentService } from '../enrollment/enrollment.service.ts';
import type { WatchService } from './watch.service.ts';
import type { StorageService } from '../storage/storage.service.ts';
import type { PlayerSettingsService } from './player-settings.service.ts';
import { resolveAttachment } from './attachments.ts';
import {
  orderedLessonIds, lockedLessonIds, nextLessonId, previousLessonId,
  progressPercent, type DripRule,
} from './progress.ts';

export type ViewerRole = 'admin' | 'instructor' | 'student' | 'user';

export class PlayerService {
  #db: Db;
  #enrollment: EnrollmentService;
  #watch: WatchService;
  #storage: StorageService;
  #playerSettings: PlayerSettingsService;

  constructor(db: Db, enrollment: EnrollmentService, watch: WatchService,
              storage: StorageService, playerSettings: PlayerSettingsService) {
    this.#db = db;
    this.#enrollment = enrollment;
    this.#watch = watch;
    this.#storage = storage;
    this.#playerSettings = playerSettings;
  }

  async load(slug: string, userId: number, role: ViewerRole, requestedLessonId?: number) {
    const { data: course } = await this.#db.from('courses')
      .select('id, title, slug, status, user_id, is_paid, enable_drip_content, drip_content_settings')
      .eq('slug', slug).maybeSingle();
    if (!course) throw new HttpError(404, 'Course not found.');

    const isOwner = course.user_id === userId;
    const bypass = role === 'admin' || isOwner;

    if (course.is_paid && !bypass) {
      const status = await this.#enrollment.status(course.id, userId);
      if (status === 'expired') {
        throw new HttpError(403,
          'Your course accessibility has expired. You need to buy it again');
      }
      if (!status) throw new HttpError(403, 'Not registered for this course.');
    }

    const [sections, lessons, history, watched] = await Promise.all([
      this.#db.from('sections').select('id, title, sort').eq('course_id', course.id),
      this.#db.from('lessons')
        .select('id, title, section_id, lesson_type, video_type, lesson_src, duration, is_free, sort, summary, attachment, attachment_type')
        .eq('course_id', course.id),
      this.#watch.history(course.id, userId),
      this.#watch.watchedSecondsByLesson(course.id, userId),
    ]);

    const sectionRows = sections.data ?? [];
    const lessonRows = lessons.data ?? [];
    const order = orderedLessonIds(sectionRows, lessonRows);

    const completed = phpJsonDecode<unknown[]>(history?.completed_lesson ?? null, [])
      .map(Number).filter((n) => Number.isFinite(n));

    const locked = lockedLessonIds(order, completed, {
      bypass,
      dripEnabled: Boolean(course.enable_drip_content),
    });
    const lockedSet = new Set(locked);

    // Resume where they left off, else the first lesson.
    let currentId = requestedLessonId ?? history?.watching_lesson_id ?? order[0] ?? null;
    if (currentId !== null && !order.includes(Number(currentId))) currentId = order[0] ?? null;
    if (currentId !== null && lockedSet.has(Number(currentId))) {
      throw new HttpError(403, 'Finish the previous lesson to unlock this one.');
    }

    const byId = new Map(lessonRows.map((l) => [l.id, l]));
    const current = currentId !== null ? byId.get(Number(currentId)) ?? null : null;

    const curriculum = [...sectionRows]
      .sort((a, b) => Number(a.sort ?? 0) - Number(b.sort ?? 0))
      .map((s) => ({
        id: s.id,
        title: s.title,
        lessons: lessonRows
          .filter((l) => l.section_id === s.id)
          .sort((a, b) => Number(a.sort ?? 0) - Number(b.sort ?? 0))
          .map((l) => ({
            id: l.id,
            title: l.title,
            lesson_type: l.lesson_type,
            duration: l.duration,
            is_free: l.is_free,
            completed: completed.includes(l.id),
            locked: lockedSet.has(l.id),
            watched_seconds: watched.get(l.id) ?? 0,
          })),
      }));

    return {
      // PL-07a: the overlay config travels with the payload.
      player: await this.#playerSettings.config(),
      course: {
        id: course.id, title: course.title, slug: course.slug,
        enable_drip_content: course.enable_drip_content,
        drip: phpJsonDecode<DripRule | null>(course.drip_content_settings, null),
      },
      curriculum,
      current,
      progress: progressPercent(completed, order),
      completed_lesson_ids: completed,
      total_lesson: order.length,
      next_lesson_id: currentId !== null ? nextLessonId(order, Number(currentId)) : null,
      previous_lesson_id: currentId !== null ? previousLessonId(order, Number(currentId)) : null,
      can_bypass_drip: bypass,
    };
  }

  /**
   * The lesson source is only handed over once access is proven, so a locked or
   * unenrolled lesson never leaks its video id or file path.
   */
  async lessonSource(lessonId: number, userId: number, role: ViewerRole) {
    const { data: lesson } = await this.#db.from('lessons')
      .select('id, course_id, lesson_type, video_type, lesson_src, duration, is_free, summary, attachment, attachment_type')
      .eq('id', lessonId).maybeSingle();
    if (!lesson) throw new HttpError(404, 'Lesson not found.');

    const { data: course } = await this.#db.from('courses')
      .select('id, slug, user_id, is_paid')
      .eq('id', lesson.course_id as number).maybeSingle();
    if (!course) throw new HttpError(404, 'Course not found.');

    const bypass = role === 'admin' || course.user_id === userId;
    // A free preview lesson is playable without enrolling -- that is its point.
    if (!bypass && !lesson.is_free && course.is_paid) {
      const status = await this.#enrollment.status(course.id, userId);
      if (status !== 'valid') throw new HttpError(403, 'Not registered for this course.');
    }
    return {
      ...lesson,
      // PL-08: a short-lived signed URL, minted only after the access
      // check above -- never a permanent public link.
      attachment_url: await resolveAttachment(
        this.#storage, lesson.attachment, lesson.attachment_type),
    };
  }
}
