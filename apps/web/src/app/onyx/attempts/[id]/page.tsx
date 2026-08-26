import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { OnyxShell } from '@/components/onyx-shell';
import { OnyxSitPaper } from '@/components/onyx-sit';
import { OnyxAttemptResult } from '@/components/onyx-attempt-result';
import { navFor } from '@/lib/onyx-nav';
import { requireOnyxSession, onyxApi, type Me, onyxApiRecord } from '@/lib/onyx-session';
import type { Assessment, CandidateAttempt } from '@/lib/onyx-assess';
import { isExamsStaff } from '@/lib/onyx-assess';

export const metadata: Metadata = { title: 'Attempt' };

/** ASS-01b/c -- the paper itself. Every answer autosaves; the clock is the server's. */
export default async function OnyxAttemptPage({ params }: { params: Promise<{ id: string }> }) {
  await requireOnyxSession();
  const { id } = await params;
  const me = await onyxApi<Me>('/api/onyx/me');

  /*
   * This page is the CANDIDATE's, and it used to answer staff with a 500.
   *
   * `GET /api/onyx/attempts/:id` is candidate-scoped -- `attemptForCandidate`
   * refuses an attempt that is not the caller's own, correctly, with a 403.
   * The page then threw that into the error boundary, so an administrator, an
   * examinations officer or a lecturer opening any attempt link got "This page
   * could not be loaded". A permission answered as a server error is the worst
   * of both: it reads as the product being broken, and it tells somebody
   * nothing about what to do instead.
   *
   * Staff are sent to the marker's view rather than to the denied page,
   * because that is the page they were actually reaching for -- the script,
   * the answers, and the marks -- and they are already entitled to it. A
   * learner opening somebody else's attempt still gets refused, which is the
   * only case where refusal is the right answer.
   */
  // `isExamsStaff`, not `isStaff`: the examinations office marks and reviews
  // too, and it is a role the marking page already admits. Using the narrower
  // predicate would have left the exams officer on the very 500 this fixes.
  if (isExamsStaff(me.role)) redirect('/onyx/attempts/' + id + '/mark');

  const attempt = await onyxApiRecord<CandidateAttempt>('/api/onyx/attempts/' + id);
  const assessment = await onyxApiRecord<Assessment>('/api/onyx/assessments/' + attempt.assessment_id);

  if (attempt.status !== 'in_progress') {
    /*
     * The result, where the candidate actually ends up.
     *
     * This used to be one sentence, on a page nothing navigated to -- handing
     * in redirected to the paper's front page, which shows no score. Now
     * submitting lands here, and every "your result" link in the product
     * points at it.
     */
    return (
      <OnyxShell
        me={me}
        nav={navFor(me.role)}
        title={assessment.title}
        subtitle={'Attempt ' + attempt.attempt + ' — your result'}
      >
        <OnyxAttemptResult assessment={assessment} attempt={attempt} />
      </OnyxShell>
    );
  }

  return (
    <OnyxShell
      me={me}
      nav={navFor(me.role)}
      title={assessment.title}
      subtitle={'Attempt ' + attempt.attempt}
    >
      <OnyxSitPaper assessment={assessment} attempt={attempt} />
    </OnyxShell>
  );
}
