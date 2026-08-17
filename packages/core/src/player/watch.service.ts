/**
 * PL-04 / PL-05 -- watch tracking.
 *
 * The 5-second ping format is ported VERBATIM (see ADR-003): watch_durations
 * .watched_counter stays a JSON array of tick markers, written with
 * phpJsonEncode so both stacks read identical bytes. It is write-heavy by the
 * original's design; H-05 load-tests that path.
 */
import type { Db } from '../db/client.ts';
import { HttpError } from '../http/errors.ts';
import { phpJsonEncode, phpJsonDecode } from '../json/php-json.ts';
import { durationToSeconds } from '../authoring/lesson-types.ts';
import { orderedLessonIds, progressPercent, isWatchedEnough, type DripRule } from './progress.ts';

export interface PingResult {
  lesson_id: number;
  course_progress: number | null;
  is_completed: 0 | 1;
}

export class WatchService {
  #db: Db;
  constructor(db: Db) { this.#db = db; }

  async history(courseId: number, userId: number) {
    const { data } = await this.#db.from('watch_histories')
      .select('id, course_id, student_id, completed_lesson, watching_lesson_id, course_progress, completed_date')
      .eq('course_id', courseId).eq('student_id', userId).maybeSingle();
    return data ?? null;
  }

  async completedLessonIds(courseId: number, userId: number): Promise<number[]> {
    const row = await this.history(courseId, userId);
    return phpJsonDecode<unknown[]>(row?.completed_lesson ?? null, [])
      .map(Number).filter((n) => Number.isFinite(n));
  }

  async courseLessonOrder(courseId: number): Promise<number[]> {
    const [sections, lessons] = await Promise.all([
      this.#db.from('sections').select('id, sort').eq('course_id', courseId),
      this.#db.from('lessons').select('id, section_id, sort').eq('course_id', courseId),
    ]);
    return orderedLessonIds(sections.data ?? [], lessons.data ?? []);
  }

  /** Records which lesson the student is on, creating the row on first play. */
  async setWatching(courseId: number, userId: number, lessonId: number): Promise<void> {
    const existing = await this.history(courseId, userId);
    const now = new Date().toISOString();
    if (existing) {
      await this.#db.from('watch_histories')
        .update({ watching_lesson_id: lessonId, updated_at: now }).eq('id', existing.id);
      return;
    }
    await this.#db.from('watch_histories').insert({
      course_id: courseId, student_id: userId, watching_lesson_id: lessonId,
      completed_lesson: phpJsonEncode([]), course_progress: 0,
      created_at: now, updated_at: now,
    });
  }

  /**
   * The 5-second ping.
   *
   * Ticks are de-duplicated, so seeking back and re-watching cannot inflate the
   * count. Watched seconds are ticks * 5, exactly as Laravel computed them.
   */
  async ping(courseId: number, lessonId: number, userId: number,
             currentDuration: string | number): Promise<PingResult> {
    const marker = String(currentDuration);

    const { data: existing } = await this.#db.from('watch_durations')
      .select('id, watched_counter')
      .eq('watched_course_id', courseId)
      .eq('watched_lesson_id', lessonId)
      .eq('watched_student_id', userId)
      .maybeSingle();

    let ticks = phpJsonDecode<unknown[]>(existing?.watched_counter ?? null, []);
    if (!Array.isArray(ticks)) ticks = [];
    if (!ticks.map(String).includes(marker)) ticks.push(marker);

    const now = new Date().toISOString();
    if (existing) {
      await this.#db.from('watch_durations').update({
        watched_counter: phpJsonEncode(ticks),
        current_duration: Number(currentDuration) || 0,
        updated_at: now,
      }).eq('id', existing.id);
    } else {
      await this.#db.from('watch_durations').insert({
        watched_course_id: courseId,
        watched_lesson_id: lessonId,
        watched_student_id: userId,
        current_duration: Number(currentDuration) || 0,
        watched_counter: phpJsonEncode(ticks),
        created_at: now, updated_at: now,
      });
    }

    const { data: course } = await this.#db.from('courses')
      .select('id, enable_drip_content, drip_content_settings').eq('id', courseId).maybeSingle();

    // Without drip the ping only records position; completion stays manual.
    if (!course?.enable_drip_content) {
      return { lesson_id: lessonId, course_progress: null, is_completed: 0 };
    }

    const rule = phpJsonDecode<DripRule>(course.drip_content_settings,
      { lesson_completion_role: 'percentage', minimum_percentage: 100 });

    const { data: lesson } = await this.#db.from('lessons')
      .select('duration').eq('id', lessonId).maybeSingle();
    const lessonSeconds = durationToSeconds(lesson?.duration ?? null);
    const watchedSeconds = ticks.length * 5;

    if (!isWatchedEnough(watchedSeconds, lessonSeconds, rule)) {
      return { lesson_id: lessonId, course_progress: null, is_completed: 0 };
    }

    const progress = await this.markComplete(courseId, userId, lessonId, { onlyAdd: true });
    return { lesson_id: lessonId, course_progress: progress, is_completed: 1 };
  }

  /**
   * Toggles (or, with onlyAdd, sets) a lesson complete and recomputes progress.
   * Mirrors PlayerController::set_watch_history, which toggled on each call.
   */
  async markComplete(courseId: number, userId: number, lessonId: number,
                     opts: { onlyAdd?: boolean } = {}): Promise<number> {
    const existing = await this.history(courseId, userId);
    let completed = phpJsonDecode<unknown[]>(existing?.completed_lesson ?? null, [])
      .map(Number).filter((n) => Number.isFinite(n));

    if (completed.includes(lessonId)) {
      if (!opts.onlyAdd) completed = completed.filter((id) => id !== lessonId);
    } else {
      completed.push(lessonId);
    }

    const progress = progressPercent(completed, await this.courseLessonOrder(courseId));
    const now = new Date().toISOString();
    const row = {
      completed_lesson: phpJsonEncode(completed),
      watching_lesson_id: lessonId,
      course_progress: progress,
      // completed_date is a unix integer in the Laravel column.
      completed_date: progress >= 100 ? Math.floor(Date.now() / 1000) : null,
      updated_at: now,
    };

    if (existing) {
      await this.#db.from('watch_histories').update(row).eq('id', existing.id);
    } else {
      await this.#db.from('watch_histories').insert({
        course_id: courseId, student_id: userId, created_at: now, ...row,
      });
    }
    return progress;
  }

  /**
   * CERT-01 -- Laravel issued the certificate from inside the player the moment
   * progress reached 100. Same trigger, same 12-character identifier, and
   * idempotent so refreshing the last lesson cannot mint a second one.
   */
  async issueCertificateIfComplete(courseId: number, userId: number): Promise<string | null> {
    const progress = progressPercent(
      await this.completedLessonIds(courseId, userId),
      await this.courseLessonOrder(courseId));
    if (progress < 100) return null;

    const { data: existing } = await this.#db.from('certificates')
      .select('identifier').eq('course_id', courseId).eq('user_id', userId).maybeSingle();
    if (existing) return existing.identifier;

    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let identifier = '';
    for (let i = 0; i < 12; i++) {
      identifier += alphabet[Math.floor(Math.random() * alphabet.length)];
    }
    const now = new Date().toISOString();
    const { error } = await this.#db.from('certificates').insert({
      user_id: userId, course_id: courseId, identifier, created_at: now, updated_at: now,
    });
    if (error) throw new HttpError(500, `Could not issue the certificate: ${error.message}`);
    return identifier;
  }

  /** Watched seconds per lesson, for the sidebar's per-lesson progress. */
  async watchedSecondsByLesson(courseId: number, userId: number): Promise<Map<number, number>> {
    const { data } = await this.#db.from('watch_durations')
      .select('watched_lesson_id, watched_counter')
      .eq('watched_course_id', courseId).eq('watched_student_id', userId);
    const out = new Map<number, number>();
    for (const row of data ?? []) {
      const ticks = phpJsonDecode<unknown[]>(row.watched_counter, []);
      out.set(Number(row.watched_lesson_id), (Array.isArray(ticks) ? ticks.length : 0) * 5);
    }
    return out;
  }
}
