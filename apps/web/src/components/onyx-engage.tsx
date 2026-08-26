'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  humanMinutes,
  type DiscussionPost, type Nudge, type ProgressSummary, type Ticket,
} from '@/lib/onyx-campus';

async function post(path: string, body?: unknown) {
  const res = await fetch('/api/proxy/' + path, {
    method: 'POST',
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await res.json().catch(() => ({ ok: false, message: 'Bad response' }));
  if (!res.ok || payload.ok === false) {
    throw new Error(payload.message ?? 'That did not work.');
  }
  return payload.data;
}

// ---------------------------------------------------------------------------
// LRN-05
// ---------------------------------------------------------------------------

const URGENCY_ORDER = { high: 0, normal: 1, low: 2 } as const;

/**
 * LRN-05a -- what to do next.
 *
 * Every nudge shows the signal it came from. That is not decoration: a nudge
 * whose reason is invisible is indistinguishable from a nag, and the first
 * thing a learner does with a nag is stop reading them.
 */
export function OnyxNudges({ nudges }: { nudges: Nudge[] }) {
  if (!nudges.length) {
    return (
      <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
        Nothing needs your attention. Everything is submitted and up to date.
      </p>
    );
  }

  const sorted = [...nudges].sort(
    (a, b) => URGENCY_ORDER[a.urgency] - URGENCY_ORDER[b.urgency]);

  return (
    <ul className="space-y-2">
      {sorted.map((n) => (
        <li
          key={n.kind + n.because}
          className={'rounded-xl px-3.5 py-2.5 text-sm ' + (n.urgency === 'high'
            ? 'border border-accent-100 bg-accent-50 text-accent-700'
            : n.urgency === 'normal'
              ? 'border border-line bg-white text-slate-800'
              : 'border border-line bg-white text-muted')}
        >
          <div>
            {n.href ? (
              /*
               * `-my-0.5 py-0.5` is the hit area, not the look.
               *
               * A nudge's whole sentence is the link -- so it is a standing
               * call to action, not a word inside prose, and WCAG 2.2 AA
               * (2.5.8) wants 24px of it. At this size the line box is 19px,
               * so it takes a full 4px each side to clear the floor -- 2px
               * would land on 23 and still fail. The equal negative margin
               * hands the space back, so the card is unmoved.
               */
              <Link href={n.href}
                className="-my-1 inline-block py-1 font-semibold hover:underline">
                {n.message}
              </Link>
            ) : (
              <span className="font-semibold">{n.message}</span>
            )}
          </div>
          {/* Not opacity-70: dimming already-muted text pushed this under
              4.5:1 and made the one line explaining *why* the nudge exists
              the least readable thing in it. */}
          <div className="mt-1 text-xs text-muted">Because: {n.because}</div>
        </li>
      ))}
    </ul>
  );
}

export function OnyxProgress({ progress }: { progress: ProgressSummary }) {
  const tiles = [
    { label: 'Lessons', value: progress.lessons.completed + ' / ' + progress.lessons.total,
      note: progress.lessons.percent + '% complete' },
    { label: 'Assignments', value: String(progress.assignments.submitted),
      note: progress.assignments.due + ' outstanding, ' + progress.assignments.overdue + ' late' },
    { label: 'Attendance', value: progress.attendance.percent + '%',
      note: progress.attendance.attended + ' of ' + progress.attendance.sessions + ' sessions' },
    { label: 'Practice', value: String(progress.practice.solved),
      note: 'solved of ' + progress.practice.attempted + ' attempted' },
  ];

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {tiles.map((t) => (
          <div key={t.label} className="rounded-2xl border border-line p-4">
            <div className="text-xs uppercase tracking-wide text-muted">{t.label}</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums">{t.value}</div>
            <div className="text-xs text-muted">{t.note}</div>
          </div>
        ))}
      </div>

      <div className="rounded-2xl border border-line p-4">
        <div className="flex items-baseline justify-between text-sm">
          <span className="font-medium">
            {progress.streak.current > 0
              ? progress.streak.current + '-day streak'
              : 'No streak yet'}
          </span>
          <span className="text-xs text-muted">
            longest {progress.streak.longest}
            {progress.streak.active_today ? ' · active today' : ' · nothing today'}
          </span>
        </div>
        <p className="mt-1 text-xs text-muted">
          Counted from lessons finished, work submitted and code run &mdash; not from
          signing in.
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// LRN-06a -- discussion
// ---------------------------------------------------------------------------

export function OnyxAskForm({ courseId }: { courseId: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)}
        className="rounded-lg bg-brand-600 px-3 py-2 text-sm text-white">
        Ask a question
      </button>
    );
  }

  return (
    <form
      className="space-y-3 rounded-2xl border border-line p-4"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        start(async () => {
          try {
            await post('onyx/courses/' + courseId + '/discussions', { title, body });
            setTitle('');
            setBody('');
            setOpen(false);
            router.refresh();
          } catch (err) {
            setError(err instanceof Error ? err.message : 'That did not work.');
          }
        });
      }}
    >
      <div>
        <label htmlFor="q-title" className="block text-sm font-medium">Question</label>
        <input id="q-title" value={title} onChange={(e) => setTitle(e.target.value)}
          required minLength={3} maxLength={255}
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
      </div>
      <div>
        <label htmlFor="q-body" className="block text-sm font-medium">What have you tried?</label>
        <textarea id="q-body" value={body} onChange={(e) => setBody(e.target.value)}
          required rows={4}
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
      </div>
      {error ? <p role="alert" className="text-sm text-red-700">{error}</p> : null}
      <div className="flex gap-2">
        <button type="submit" disabled={pending}
          className="rounded-lg bg-brand-600 px-3 py-2 text-sm text-white disabled:opacity-60">
          {pending ? 'Posting...' : 'Post question'}
        </button>
        <button type="button" onClick={() => setOpen(false)}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
          Cancel
        </button>
      </div>
    </form>
  );
}

export function OnyxReplyForm({ discussionId, parentId }: {
  discussionId: number; parentId?: number;
}) {
  const router = useRouter();
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const fieldId = 'reply-' + discussionId + '-' + (parentId ?? 'root');

  return (
    <form
      className="mt-3 space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        start(async () => {
          try {
            await post('onyx/discussions/' + discussionId + '/replies',
              { body, parent_id: parentId ?? null });
            setBody('');
            router.refresh();
          } catch (err) {
            setError(err instanceof Error ? err.message : 'That did not work.');
          }
        });
      }}
    >
      <label htmlFor={fieldId} className="sr-only">Your reply</label>
      <textarea id={fieldId} value={body} onChange={(e) => setBody(e.target.value)}
        required rows={3} placeholder="Reply..."
        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
      {error ? <p role="alert" className="text-sm text-red-700">{error}</p> : null}
      <button type="submit" disabled={pending}
        className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm text-white disabled:opacity-60">
        {pending ? 'Posting...' : 'Reply'}
      </button>
    </form>
  );
}

/**
 * One vote per person.
 *
 * The count comes from the server's list of voters rather than a counter, so
 * clicking twice removes the vote instead of adding a second one -- which is
 * also what the button says it will do.
 */
export function OnyxVote({ post: p }: { post: DiscussionPost }) {
  const router = useRouter();
  const [state, setState] = useState({ count: p.vote_count, voted: p.voted });
  const [pending, start] = useTransition();

  return (
    <button
      type="button"
      disabled={pending}
      aria-pressed={state.voted}
      className={'rounded-lg border px-2 py-1 text-xs tabular-nums disabled:opacity-60 '
        + (state.voted ? 'border-slate-900 bg-brand-600 text-white' : 'border-slate-300')}
      onClick={() => start(async () => {
        const result = await post('onyx/posts/' + p.id + '/vote') as
          { votes: number; voted: boolean };
        setState({ count: result.votes, voted: result.voted });
        router.refresh();
      })}
    >
      {state.voted ? 'Voted' : 'Helpful'} · {state.count}
    </button>
  );
}

export function OnyxResolve({ discussionId, postId, resolved }: {
  discussionId: number; postId: number; resolved: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();

  return (
    <button
      type="button"
      disabled={pending}
      className="rounded-lg border border-emerald-600 px-2 py-1 text-xs text-emerald-700 disabled:opacity-60"
      onClick={() => start(async () => {
        await post('onyx/discussions/' + discussionId
          + (resolved ? '/reopen' : '/resolve'), resolved ? undefined : { post_id: postId });
        router.refresh();
      })}
    >
      {resolved ? 'Reopen' : 'This answered it'}
    </button>
  );
}

/**
 * LRN-06b -- escalate.
 *
 * Deliberately not a silent action: the confirmation names what happens, which
 * is that a person is going to be asked to look at this.
 */
export function OnyxEscalate({ discussionId }: { discussionId: number }) {
  const router = useRouter();
  const [note, setNote] = useState('');
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)}
        className="rounded-lg border border-amber-600 px-3 py-1.5 text-sm text-amber-800">
        Escalate to a mentor
      </button>
    );
  }

  return (
    <form
      className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        start(async () => {
          try {
            const ticket = await post('onyx/discussions/' + discussionId + '/escalate',
              { note }) as { id: number };
            router.push('/onyx/support/' + ticket.id);
          } catch (err) {
            setError(err instanceof Error ? err.message : 'That did not work.');
          }
        });
      }}
    >
      <p className="text-xs text-amber-900">
        This raises a ticket a named mentor has to pick up, with a deadline. The
        thread stays here and keeps its replies.
      </p>
      <label htmlFor={'esc-' + discussionId} className="sr-only">Anything to add?</label>
      <textarea id={'esc-' + discussionId} value={note} rows={2}
        onChange={(e) => setNote(e.target.value)} placeholder="Anything to add?"
        className="w-full rounded-lg border border-amber-300 px-3 py-2 text-sm" />
      {error ? <p role="alert" className="text-sm text-red-700">{error}</p> : null}
      <div className="flex gap-2">
        <button type="submit" disabled={pending}
          className="rounded-lg bg-amber-700 px-3 py-1.5 text-sm text-white disabled:opacity-60">
          {pending ? 'Escalating...' : 'Escalate'}
        </button>
        <button type="button" onClick={() => setOpen(false)}
          className="rounded-lg border border-amber-400 px-3 py-1.5 text-sm">Cancel</button>
      </div>
    </form>
  );
}

/** How late, or how long left. The "age is visible" half of the criterion. */
export function OnyxSla({ ticket }: { ticket: Ticket }) {
  if (ticket.resolved_at) {
    return (
      <span className="text-xs text-muted">
        closed after {humanMinutes(ticket.age_minutes)}
        {ticket.breached ? ' · missed its deadline' : ''}
      </span>
    );
  }
  const left = ticket.minutes_remaining ?? 0;
  return (
    <span className={'text-xs tabular-nums ' + (left < 0 ? 'text-red-700' : 'text-muted')}>
      {left < 0
        ? humanMinutes(left) + ' past its deadline'
        : humanMinutes(left) + ' left'}
      {' · open ' + humanMinutes(ticket.age_minutes)}
    </span>
  );
}

export function OnyxTicketActions({ ticket, canMentor }: {
  ticket: Ticket; canMentor: boolean;
}) {
  const router = useRouter();
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const act = (path: string, body?: unknown) => start(async () => {
    setError(null);
    try {
      await post('onyx/tickets/' + ticket.id + path, body);
      setNote('');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not work.');
    }
  });

  return (
    <div className="space-y-3 rounded-2xl border border-line p-4">
      <label htmlFor={'note-' + ticket.id} className="block text-sm font-medium">
        {canMentor ? 'Reply to this ticket' : 'Add to this ticket'}
      </label>
      <textarea id={'note-' + ticket.id} value={note} rows={3}
        onChange={(e) => setNote(e.target.value)}
        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
      {error ? <p role="alert" className="text-sm text-red-700">{error}</p> : null}
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={pending || !note.trim()}
          onClick={() => act('/respond', { note })}
          className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm text-white disabled:opacity-60">
          Send
        </button>
        {canMentor && !ticket.owner_id ? (
          <button type="button" disabled={pending} onClick={() => act('/assign', {})}
            className="rounded-lg border border-slate-900 px-3 py-1.5 text-sm">
            Take this
          </button>
        ) : null}
        {ticket.resolved_at ? (
          <button type="button" disabled={pending} onClick={() => act('/reopen', { note })}
            className="rounded-lg border border-amber-600 px-3 py-1.5 text-sm text-amber-800">
            Reopen
          </button>
        ) : (
          <button type="button" disabled={pending} onClick={() => act('/resolve', { note })}
            className="rounded-lg border border-emerald-600 px-3 py-1.5 text-sm text-emerald-700">
            Mark resolved
          </button>
        )}
      </div>
    </div>
  );
}
