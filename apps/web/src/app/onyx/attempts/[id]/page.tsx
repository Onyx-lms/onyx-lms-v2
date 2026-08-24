import type { Metadata } from 'next';
import { OnyxShell } from '@/components/onyx-shell';
import { OnyxSitPaper } from '@/components/onyx-sit';
import { OnyxAttemptResult } from '@/components/onyx-attempt-result';
import { navFor } from '@/lib/onyx-nav';
import { requireOnyxSession, onyxApi, type Me, onyxApiRecord } from '@/lib/onyx-session';
import type { Assessment, CandidateAttempt } from '@/lib/onyx-assess';

export const metadata: Metadata = { title: 'Attempt' };

/** ASS-01b/c -- the paper itself. Every answer autosaves; the clock is the server's. */
export default async function OnyxAttemptPage({ params }: { params: Promise<{ id: string }> }) {
  await requireOnyxSession();
  const { id } = await params;
  const [me, attempt] = await Promise.all([
    onyxApi<Me>('/api/onyx/me'),
    onyxApiRecord<CandidateAttempt>('/api/onyx/attempts/' + id),
  ]);
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
