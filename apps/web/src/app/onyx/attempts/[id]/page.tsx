import type { Metadata } from 'next';
import { OnyxShell } from '@/components/onyx-shell';
import { OnyxSitPaper } from '@/components/onyx-sit';
import { navFor } from '@/lib/onyx-nav';
import { requireOnyxSession, onyxApi, type Me } from '@/lib/onyx-session';
import type { Assessment, CandidateAttempt } from '@/lib/onyx-assess';

export const metadata: Metadata = { title: 'Attempt' };

/** ASS-01b/c -- the paper itself. Every answer autosaves; the clock is the server's. */
export default async function OnyxAttemptPage({ params }: { params: Promise<{ id: string }> }) {
  await requireOnyxSession();
  const { id } = await params;
  const [me, attempt] = await Promise.all([
    onyxApi<Me>('/api/onyx/me'),
    onyxApi<CandidateAttempt>('/api/onyx/attempts/' + id),
  ]);
  const assessment = await onyxApi<Assessment>('/api/onyx/assessments/' + attempt.assessment_id);

  if (attempt.status !== 'in_progress') {
    return (
      <OnyxShell me={me} nav={navFor(me.role)} title={assessment.title}>
        <p className="text-sm text-slate-700">
          This attempt is finished.
          {attempt.score !== null
            ? ' You scored ' + attempt.score + ' out of ' + attempt.max_score + '.'
            : ' Results will appear once they are published.'}
        </p>
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
