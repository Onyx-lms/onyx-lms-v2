'use client';

import Link from 'next/link';
import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Icon } from '@/components/onyx-ui';

/**
 * Clears the whole inbox in one act.
 *
 * Per-item marking exists in the API and is deliberately not offered here.
 * Opening a notification is what "I have seen this" means to a person; making
 * them tick each one is bookkeeping the product should be doing for them.
 */
export function MarkAllRead() {
  const router = useRouter();
  const [pending, start] = useTransition();

  return (
    <button
      type="button" disabled={pending}
      onClick={() => start(async () => {
        await fetch('/api/proxy/onyx/notifications/read', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        });
        router.refresh();
      })}
      className="inline-flex min-h-[38px] items-center rounded-2xl border border-line px-3.5
                 text-[13px] font-semibold text-slate-700 hover:bg-brand-50 disabled:opacity-60"
    >
      {pending ? 'Marking…' : 'Mark all as read'}
    </button>
  );
}

/**
 * The header bell, with a count.
 *
 * Polls rather than holding a socket open. A notification is not a chat
 * message -- being told ninety seconds late costs nothing, and a realtime
 * connection per signed-in tab is a real cost to carry for that. The interval
 * stops while the tab is hidden, so a laptop full of background tabs is not
 * quietly asking every minute for ever.
 */
export function NotificationBell() {
  const [unread, setUnread] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;

    const poll = async () => {
      // Nothing to show, and nothing to ask, while nobody is looking.
      if (document.visibilityState === 'hidden') return;
      try {
        const res = await fetch('/api/proxy/onyx/notifications/unread');
        const body = await res.json();
        if (!cancelled && body?.ok) setUnread(Number(body.data.unread) || 0);
      } catch { /* a count that failed to load is not worth reporting */ }
    };

    void poll();
    const timer = setInterval(() => { void poll(); }, 90_000);
    // Coming back to the tab is the moment somebody most wants it to be right.
    document.addEventListener('visibilitychange', poll);
    return () => {
      cancelled = true;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', poll);
    };
  }, []);

  return (
    <Link
      href="/onyx/inbox"
      aria-label={unread ? unread + ' unread notifications' : 'Inbox'}
      className="relative grid h-11 w-11 place-items-center rounded-2xl text-muted
                 hover:bg-brand-50 hover:text-brand-700"
    >
      <Icon name="bell" className="h-[20px] w-[20px]" />
      {unread ? (
        <span
          aria-hidden="true"
          className="absolute right-1.5 top-1.5 grid min-w-[17px] place-items-center
                     rounded-full bg-accent-700 px-1 text-[10.5px] font-bold leading-[17px]
                     text-white"
        >
          {unread > 9 ? '9+' : unread}
        </span>
      ) : null}
    </Link>
  );
}
