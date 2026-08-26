/**
 * Keeping a paper's window on the sitting it is sat in.
 *
 * An exam and the assessment it is sat through are two rows describing one
 * event: the exam says when candidates turn up, the assessment says when the
 * paper will accept an attempt. If those disagree, the product tells a
 * candidate to sit an exam at ten and then refuses to deal them a paper --
 * which is not a bug anyone can diagnose from the screen they are looking at.
 *
 * The tenant-side route has always done this. The **console route did not**:
 * `PlatformService.createExam` accepts an `assessment_id`, checks it is on the
 * same course, writes the link -- and never touches the paper. So an exam
 * scheduled by a platform operator left its paper with whatever window it
 * already had, usually none at all, which also kept the paper off the week
 * (`#assessmentsIn` selects on `closes_at`, and a null one matches nothing).
 * The exam appeared on the calendar and the paper it pointed at did not.
 *
 * One implementation, imported by both, rather than the same fifteen lines in
 * two files that then drift.
 */
import { HttpError } from '@onyx/core';
import type { Role } from '@onyx/types';
import type { AppContext } from './app-context.ts';

export interface ExamLikeRow {
  course_id: number | string;
  starts_at: string;
  duration_minutes: number;
  status: string;
  /**
   * Whether the slot is a lock or an appointment (0043).
   *
   * Off by default. An examination here deals SETS -- parallel papers rotating
   * down the roll, so the person beside you is not holding yours -- and that
   * is what makes everybody sitting at the same instant unnecessary. Switched
   * on, the paper opens at the start and shuts at the end, which is what a
   * hall with an invigilator and a closed door actually needs.
   */
  window_enforced?: boolean | null;
}

/**
 * Opens the paper for exactly the sitting, and closes it when the sitting is
 * cancelled.
 *
 * The course check is repeated here rather than trusted from the caller: this
 * is the last point before somebody else's questions are re-timed, and a
 * mismatched pair is the specific failure it exists to prevent.
 */
export async function syncExamAssessmentWindow(
  ctx: AppContext,
  tenantId: number,
  assessmentId: number,
  exam: ExamLikeRow,
  actor: { userId: string; role: Role },
): Promise<void> {
  const assessment = await ctx.onyxAssess.assessment(tenantId, assessmentId);
  if (Number(assessment.course_id) !== Number(exam.course_id)) {
    throw new HttpError(422,
      'That assessment is not on this exam’s course — pick one that is, or leave it unlinked.');
  }
  const start = Date.parse(exam.starts_at);
  if (!Number.isFinite(start)) throw new HttpError(422, 'That is not a valid start time.');
  const end = start + exam.duration_minutes * 60_000;

  /*
   * The paper opens when the examination starts, and by default never shuts.
   *
   * `opens_at` is still pinned: a paper reachable before the examination it
   * belongs to has been announced to start is a paper somebody reads early.
   * `closes_at` is the half that stops being the product's decision -- see
   * 0043. A candidate who missed the hour, or whose connection dropped inside
   * it, used to be simply out, and the sets are what make that unnecessary.
   *
   * The attempt is still timed either way: `duration_minutes` is the exam's
   * and is what the clock counts down, so a ninety-minute paper is ninety
   * minutes whenever it is begun.
   */
  await ctx.onyxAssess.updateAssessment(tenantId, assessmentId, actor, {
    opens_at: new Date(start).toISOString(),
    closes_at: exam.window_enforced ? new Date(end).toISOString() : null,
    duration_minutes: exam.duration_minutes,
    // A cancelled exam's paper stops taking attempts; scheduling or editing an
    // active one never force-publishes it -- that stays the institution's own
    // decision, made once the paper is actually ready.
    status: exam.status === 'cancelled' ? 'closed' : undefined,
  });
}
