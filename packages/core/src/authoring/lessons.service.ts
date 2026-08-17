/**
 * B-03 / B-04 / B-05 -- lessons.
 */
import type { Db } from '../db/client.ts';
import { HttpError } from '../http/errors.ts';
import {
  extractVideoId, isVideoLesson, isLessonType, validateLesson,
  secondsToTimeFormat, durationToSeconds, type LessonType,
} from './lesson-types.ts';

export interface LessonInput {
  title: string;
  lesson_type: string;
  section_id: number;
  lesson_src?: string | null;
  video_type?: string | null;
  duration?: string | null;
  summary?: string | null;
  description?: string | null;
  attachment?: string | null;
  attachment_type?: string | null;
  thumbnail?: string | null;
  is_free?: number;
  total_mark?: number | null;
  pass_mark?: number | null;
  retake?: number | null;
}

const COLUMNS = 'id, title, course_id, section_id, user_id, lesson_type, video_type, lesson_src, duration, thumbnail, is_free, sort, summary, description, attachment, attachment_type, total_mark, pass_mark, retake, status';

export class LessonsService {
  #db: Db;
  constructor(db: Db) { this.#db = db; }

  async listForCourse(courseId: number) {
    const { data, error } = await this.#db
      .from('lessons').select(COLUMNS).eq('course_id', courseId).order('sort');
    if (error) throw new HttpError(500, `lessons.list failed: ${error.message}`);
    return data ?? [];
  }

  async create(courseId: number, userId: number, input: LessonInput) {
    const errors = validateLesson(input);
    if (Object.keys(errors).length) {
      throw new HttpError(422, 'The given data was invalid.', { errors });
    }

    const { data: siblings } = await this.#db
      .from('lessons').select('id').eq('section_id', input.section_id);

    const now = new Date().toISOString();
    const { data, error } = await this.#db.from('lessons').insert({
      title: input.title.trim(),
      course_id: courseId,
      section_id: input.section_id,
      user_id: userId,
      ...this.#typeFields(input),
      sort: (siblings?.length ?? 0) + 1,
      is_free: input.is_free ?? 0,
      status: 1,
      created_at: now,
      updated_at: now,
    }).select(COLUMNS).maybeSingle();
    if (error) throw new HttpError(500, `lessons.create failed: ${error.message}`);
    return data;
  }

  async update(id: number, input: LessonInput) {
    const errors = validateLesson(input);
    if (Object.keys(errors).length) {
      throw new HttpError(422, 'The given data was invalid.', { errors });
    }
    const { error } = await this.#db.from('lessons').update({
      title: input.title.trim(),
      section_id: input.section_id,
      ...this.#typeFields(input),
      is_free: input.is_free ?? 0,
      updated_at: new Date().toISOString(),
    }).eq('id', id);
    if (error) throw new HttpError(500, `lessons.update failed: ${error.message}`);
  }

  async remove(id: number): Promise<void> {
    // Quiz lessons own their questions; leaving them behind would let a deleted
    // quiz keep contributing marks.
    await this.#db.from('questions').delete().eq('quiz_id', id);
    const { error } = await this.#db.from('lessons').delete().eq('id', id);
    if (error) throw new HttpError(500, `lessons.delete failed: ${error.message}`);
  }

  async sort(orderedIds: number[]): Promise<void> {
    for (let i = 0; i < orderedIds.length; i++) {
      const { error } = await this.#db.from('lessons')
        .update({ sort: i + 1 }).eq('id', orderedIds[i]!);
      if (error) throw new HttpError(500, `lessons.sort failed: ${error.message}`);
    }
  }

  /** Total runtime of a course, formatted like total_durations(). */
  async totalDuration(courseId: number): Promise<string> {
    const rows = await this.listForCourse(courseId);
    const seconds = rows.reduce((sum, l) => sum + durationToSeconds(l.duration), 0);
    return secondsToTimeFormat(seconds);
  }

  /** Normalises the type-specific columns so lesson_src holds an id, not a URL. */
  #typeFields(input: LessonInput) {
    const type = input.lesson_type as LessonType;
    const src = input.lesson_src ? extractVideoId(type, input.lesson_src) : null;
    const fields: Record<string, unknown> = {
      lesson_type: type,
      lesson_src: src,
      summary: input.summary ?? null,
      description: input.description ?? null,
      attachment: input.attachment ?? null,
      attachment_type: input.attachment_type ?? null,
      thumbnail: input.thumbnail ?? null,
      video_type: null,
      duration: null,
      total_mark: null,
      pass_mark: null,
      retake: null,
    };
    if (isVideoLesson(type)) {
      fields['duration'] = input.duration ?? '00:00:00';
      fields['video_type'] = input.video_type
        ?? (type === 'youtube' ? 'youtube' : type === 'vimeo' ? 'vimeo' : 'html5');
    }
    if (type === 'quiz') {
      fields['total_mark'] = input.total_mark ?? 0;
      fields['pass_mark'] = input.pass_mark ?? 0;
      fields['retake'] = input.retake ?? 0;
    }
    return fields;
  }
}

export { isLessonType };
