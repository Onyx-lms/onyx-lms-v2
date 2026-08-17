import Link from 'next/link';
import type { Metadata } from 'next';
import { OnyxShell } from '@/components/onyx-shell';
import { OnyxReplyForm, OnyxVote, OnyxResolve, OnyxEscalate } from '@/components/onyx-engage';
import { navFor } from '@/lib/onyx-nav';
import { requireOnyxSession, onyxApi, type Me } from '@/lib/onyx-session';
import type { DiscussionDetail } from '@/lib/onyx-campus';

export const metadata: Metadata = { title: 'Question' };

/**
 * LRN-06a -- one thread.
 *
 * "Resolved" is shown, not hidden: the acceptance criterion is that a resolved
 * thread stays searchable and visibly resolved, so the answer marker sits
 * beside the reply rather than the thread disappearing from the list.
 */
export default async function OnyxDiscussionPage({ params }: { params: Promise<{ id: string }> }) {
  await requireOnyxSession();
  const { id } = await params;
  const [me, thread] = await Promise.all([
    onyxApi<Me>('/api/onyx/me'),
    onyxApi<DiscussionDetail>('/api/onyx/discussions/' + id),
  ]);

  const mine = String(thread.author_id) === me.user_id;
  const staff = me.role === 'admin' || me.role === 'faculty';

  return (
    <OnyxShell
      me={me}
      nav={navFor(me.role)}
      title={thread.title}
      subtitle={(thread.author?.name ?? 'Someone') + ' asked · '
        + (thread.status === 'resolved' ? 'resolved' : thread.status)}
    >
      <div className="space-y-6">
        <div className="rounded-2xl border border-line p-4">
          <p className="whitespace-pre-wrap text-sm text-slate-700">{thread.body}</p>
          {thread.status === 'open' && (mine || staff) ? (
            <div className="mt-3">
              <OnyxEscalate discussionId={thread.id} />
            </div>
          ) : null}
        </div>

        <section>
          <h2 className="text-sm font-medium uppercase tracking-wide text-muted">
            {thread.reply_count} {thread.reply_count === 1 ? 'reply' : 'replies'}
          </h2>
          <ul className="mt-3 space-y-3">
            {thread.posts.map((p) => (
              <li key={p.id}
                className={'rounded-xl border p-4 ' + (p.is_answer
                  ? 'border-emerald-300 bg-emerald-50' : 'border-line')}>
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-sm font-medium">{p.author?.name ?? 'Someone'}</span>
                  <span className="text-xs text-muted">
                    {new Date(p.created_at).toLocaleString()}
                  </span>
                </div>
                {p.is_answer ? (
                  <div className="mt-1 text-xs font-medium text-emerald-700">
                    Marked as the answer
                  </div>
                ) : null}
                <p className="mt-2 whitespace-pre-wrap text-sm">{p.body}</p>
                <div className="mt-2 flex items-center gap-2">
                  <OnyxVote post={p} />
                  {(mine || staff) ? (
                    <OnyxResolve discussionId={thread.id} postId={p.id}
                      resolved={thread.answer_post_id === p.id} />
                  ) : null}
                </div>
              </li>
            ))}
            {thread.posts.length === 0 ? (
              <li className="text-sm text-muted">No replies yet.</li>
            ) : null}
          </ul>
        </section>

        <OnyxReplyForm discussionId={thread.id} />

        <Link href={'/onyx/courses/' + thread.course_id} className="text-sm text-brand-600 underline">
          Back to the course
        </Link>
      </div>
    </OnyxShell>
  );
}
