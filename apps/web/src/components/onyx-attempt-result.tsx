import Link from 'next/link';
import { Card, Icon, Pill, SectionHead, StatTile } from '@/components/onyx-ui';
import { OnyxAttemptReview } from '@/components/onyx-attempt-review';
import type { Assessment, CandidateAttempt } from '@/lib/onyx-assess';

/**
 * What a candidate sees once their paper is marked.
 *
 * This did not exist. The data did: `#finalise` writes `auto_points` per
 * answer at submit, `mark()` writes `manual_points`, and
 * `attemptForCandidate` has been serving an `awarded` figure per question the
 * whole time — nothing rendered it. A learner's result was a single sentence
 * on a page they never landed on, and every route that pointed at "your
 * result" pointed at the paper's front page, which shows no score at all.
 *
 * So the marks are shown per question, not just as a total. A total tells
 * somebody they got 12 out of 20; the breakdown tells them which four they
 * lost, which is the only version of a result anybody can learn anything from.
 *
 * **The submission is shown whether or not the mark is out.** What a candidate
 * wrote is their own work, and there is nothing to protect by hiding it from
 * them — a paper still with a marker shows every answer they gave, with the
 * marks blank. Only the MARKS wait.
 *
 * The correct answers are a separate decision and the service makes it: they
 * appear once the candidate has no sitting left, because handing over the key
 * while somebody can still resit makes the resit meaningless, and banks are
 * shared between papers.
 *
 * The marker's comment travels with the marks. It is written per question by
 * the staff marking form and was served to nobody for as long as marking has
 * existed — a marker explaining why an essay lost four marks was writing into
 * the void. It is released on the same condition as the score, because a
 * comment is a mark in prose.
 */
export function OnyxAttemptResult({ assessment, attempt }: {
  assessment: Assessment;
  attempt: CandidateAttempt;
}) {
  const held = attempt.score === null;
  const pct = !held && attempt.max_score
    ? Math.round((Number(attempt.score) / Number(attempt.max_score)) * 100)
    : null;
  const passMark = attempt.pass_mark ?? null;
  const passed = !held && passMark !== null ? Number(attempt.score) >= Number(passMark) : null;

  /*
   * Held back, and said plainly.
   *
   * The old copy was "Results will appear once they are published", which is
   * true and tells somebody nothing about whether that is minutes or a
   * fortnight away. Naming the reason at least says who is waiting on what:
   * a paper with an essay on it is waiting for a person to read it.
   */
  const submission = (
    <section>
      <SectionHead title="Your submission" />
      <Card className="p-0">
        <ol className="divide-y divide-line">
          {attempt.questions.map((q, i) => (
            <OnyxAttemptReview key={q.question_id} question={q} index={i} />
          ))}
        </ol>
      </Card>
    </section>
  );

  if (held) {
    return (
      <div className="space-y-4">
      <Card className="p-4">
        <div className="flex items-start gap-3">
          <Icon name="clock" className="mt-0.5 h-5 w-5 shrink-0 text-muted" />
          <div className="min-w-0">
            <p className="text-[15px] font-bold text-ink">Handed in. Not marked yet.</p>
            <p className="mt-1 text-[13px] leading-relaxed text-muted">
              {assessment.moderation_required
                ? 'This paper is moderated before results are released, so a second '
                  + 'marker sees it after the first.'
                : 'Some of this paper has to be read by a person. Your result appears '
                  + 'here, and on your results page, once it has been marked and released.'}
            </p>
            <Link href="/onyx/results"
              className="mt-2 inline-flex items-center gap-1.5 text-[13px] font-semibold
                         text-brand-700 hover:underline">
              Your results
              <Icon name="chevron" className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>
      </Card>
      {submission}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <StatTile label="Your score"
            value={String(attempt.score) + ' / ' + String(attempt.max_score)} />
          <StatTile label="Percentage" value={pct === null ? '—' : pct + '%'} />
          <StatTile label="Pass mark"
            value={passMark === null ? 'None set' : String(passMark)} />
        </div>
        {passed !== null ? (
          <div className="mt-3">
            <Pill tone={passed ? 'good' : 'late'}>
              {passed ? 'Passed' : 'Not passed'}
            </Pill>
          </div>
        ) : null}
      </Card>

      {submission}
    </div>
  );
}
