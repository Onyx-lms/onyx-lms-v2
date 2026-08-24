import Link from 'next/link';
import type { Metadata } from 'next';
import { OnyxShell } from '@/components/onyx-shell';
import { OnyxInterviewFeedback } from '@/components/onyx-career';
import { navFor } from '@/lib/onyx-nav';
import { requireOnyxSession, onyxApi, type Me, onyxApiRecord } from '@/lib/onyx-session';
import type { Interview } from '@/lib/onyx-career';

export const metadata: Metadata = { title: 'Interview' };

/**
 * CAR-02a -- one interview.
 *
 * The API decides what this page is given: an unreleased score arrives as null
 * even for the person it is about, and the interviewer's private notes arrive
 * as null for everyone else. There is no branch here that could reveal either.
 */
export default async function OnyxInterviewPage({ params }: { params: Promise<{ id: string }> }) {
  const claims = await requireOnyxSession();
  const { id } = await params;
  const [me, interview] = await Promise.all([
    onyxApi<Me>('/api/onyx/me'),
    onyxApiRecord<Interview>('/api/onyx/interviews/' + id),
  ]);
  const isInterviewer = String(interview.interviewer_id) === claims.user_id;

  return (
    <OnyxShell
      me={me}
      nav={navFor(me.role)}
      title={interview.title}
      subtitle={new Date(interview.scheduled_at).toLocaleString()
        + ' · ' + interview.duration_minutes + ' minutes'}
    >
      <Link href="/onyx/interviews" className="text-sm text-muted hover:underline">
        &larr; All interviews
      </Link>

      <div className="mt-4 space-y-6">
        {interview.join_url && interview.status === 'scheduled' ? (
          <a href={interview.join_url} target="_blank" rel="noreferrer"
            className="inline-block rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium
                       text-white hover:bg-brand-700">
            Join the call
          </a>
        ) : null}

        {isInterviewer ? (
          <section>
            <h2 className="text-sm font-medium uppercase tracking-wide text-muted">
              Feedback
            </h2>
            <p className="mt-1 text-xs text-muted">
              Written first, released deliberately. Nothing here reaches the learner until
              you release it.
            </p>
            <div className="mt-3">
              <OnyxInterviewFeedback interviewId={Number(id)} existing={interview.feedback} />
            </div>
          </section>
        ) : interview.feedback_released && interview.feedback ? (
          <section>
            <h2 className="text-sm font-medium uppercase tracking-wide text-muted">
              Your feedback
            </h2>
            <div className="mt-3 rounded-2xl border border-line p-4">
              <div className="text-2xl font-semibold tabular-nums">
                {interview.overall} <span className="text-base text-muted">/ 5</span>
              </div>
              <ul className="mt-3 space-y-2 text-sm">
                {interview.feedback.map((f, i) => (
                  <li key={i}>
                    <div className="flex justify-between gap-3">
                      <span>{f.criterion}</span>
                      <span className="tabular-nums text-muted">{f.score} / {f.of}</span>
                    </div>
                    {f.comment ? (
                      <p className="text-xs text-muted">{f.comment}</p>
                    ) : null}
                  </li>
                ))}
              </ul>
              {interview.has_recording ? (
                <p className="mt-3 text-xs text-muted">
                  A recording of this interview was kept with your consent. Ask the placement
                  office if you would like it.
                </p>
              ) : null}
            </div>
          </section>
        ) : (
          <p className="text-sm text-muted">
            {interview.status === 'completed'
              ? 'Your feedback has been written and will appear once it is released.'
              : 'Feedback appears here after the interview.'}
          </p>
        )}
      </div>
    </OnyxShell>
  );
}
