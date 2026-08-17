/**
 * PL-05 / PL-06 -- progress and drip gating, as pure functions.
 *
 * Kept free of database access so the ordering rules can be tested directly.
 * Every rule below is a transcription of Common_helper.php, including the
 * awkward ones.
 */

export interface OrderedLesson {
  id: number;
  section_id: number | null;
  sort: number | null;
}

export interface OrderedSection {
  id: number;
  /** varchar in the schema, so compared numerically -- see SectionsService. */
  sort: string | number | null;
}

/**
 * Course-wide lesson order: sections by sort, then lessons by sort within each.
 * A lesson whose section no longer exists drops out, exactly as the SQL JOIN in
 * next_lesson() did.
 */
export function orderedLessonIds(
  sections: OrderedSection[], lessons: OrderedLesson[],
): number[] {
  const sectionOrder = [...sections]
    .sort((a, b) => Number(a.sort ?? 0) - Number(b.sort ?? 0))
    .map((s) => s.id);

  const out: number[] = [];
  for (const sectionId of sectionOrder) {
    const inSection = lessons
      .filter((l) => l.section_id === sectionId)
      .sort((a, b) => Number(a.sort ?? 0) - Number(b.sort ?? 0));
    for (const lesson of inSection) out.push(lesson.id);
  }
  return out;
}

/** next_lesson() -- the lesson after this one in course order, or null. */
export function nextLessonId(order: number[], currentLessonId: number): number | null {
  const index = order.indexOf(currentLessonId);
  if (index === -1 || index + 1 >= order.length) return null;
  return order[index + 1]!;
}

export function previousLessonId(order: number[], currentLessonId: number): number | null {
  const index = order.indexOf(currentLessonId);
  return index > 0 ? order[index - 1]! : null;
}

/**
 * progress_bar() -- completed count over total lesson count, two decimals,
 * capped at 100.
 *
 * Laravel counted the length of completed_lesson rather than intersecting it
 * with the lessons that still exist, so a deleted lesson could push progress
 * above 100; hence its own cap. We intersect first, which cannot exceed 100,
 * and keep the cap as a belt-and-braces guard.
 */
export function progressPercent(completedLessonIds: number[], allLessonIds: number[]): number {
  const total = allLessonIds.length;
  if (!total) return 0;
  const alive = new Set(allLessonIds);
  const completed = completedLessonIds.filter((id) => alive.has(Number(id))).length;
  return Math.min(100, Math.round(((completed * 100) / total) * 100) / 100);
}

export function isLessonComplete(completedLessonIds: number[], lessonId: number): boolean {
  return completedLessonIds.map(Number).includes(Number(lessonId));
}

export interface LockOptions {
  /** Admins and the course's own instructor see everything. */
  bypass?: boolean;
  dripEnabled: boolean;
}

/**
 * get_locked_lesson_ids() -- which lessons a student may not open yet.
 *
 * Three lessons are always open:
 *   - the very first lesson of the course
 *   - anything already completed
 *   - the single lesson that follows the LAST completed one
 *
 * Note "last completed" means the last ENTRY in completed_lesson, not the
 * furthest lesson in course order. Completing lesson 5 then lesson 2 unlocks
 * lesson 3, not lesson 6. That is the shipped behaviour.
 */
export function lockedLessonIds(
  order: number[], completedLessonIds: number[], opts: LockOptions,
): number[] {
  if (opts.bypass || !opts.dripEnabled) return [];

  const completed = completedLessonIds.map(Number);
  const completedSet = new Set(completed);
  const lastCompleted = completed.length ? completed[completed.length - 1]! : null;
  const unlockedNext = lastCompleted !== null ? nextLessonId(order, lastCompleted) : null;

  const locked: number[] = [];
  for (let i = 0; i < order.length; i++) {
    const lessonId = order[i]!;
    if (i === 0) continue;                       // the first lesson is always open
    if (unlockedNext !== null && lessonId === unlockedNext) continue;
    if (!completedSet.has(lessonId)) locked.push(lessonId);
  }
  return locked;
}

/**
 * PL-06 -- has a lesson been watched enough to count as complete?
 *
 * Ported from HomeController::update_watch_history_with_duration, including the
 * "+4 seconds" tolerance: a player rarely fires a final tick exactly on the end
 * of the media, so being within one tick of the end counts as finished.
 */
export interface DripRule {
  lesson_completion_role: 'duration' | 'percentage';
  minimum_duration?: number;
  minimum_percentage?: number;
}

export function isWatchedEnough(
  watchedSeconds: number, lessonSeconds: number, rule: DripRule,
): boolean {
  if (rule.lesson_completion_role === 'duration') {
    const minimum = Number(rule.minimum_duration ?? 0);
    if (watchedSeconds >= minimum) return true;
  } else {
    const percent = Number(rule.minimum_percentage ?? 0);
    if (watchedSeconds >= (lessonSeconds / 100) * percent) return true;
  }
  return watchedSeconds + 4 >= lessonSeconds && lessonSeconds > 0;
}
