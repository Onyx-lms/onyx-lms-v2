'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { money } from '@/lib/onyx-money';
import { Icon } from '@/components/onyx-ui';
import { Modal } from '@/components/onyx-modal';
import { completeCheckout } from '@/lib/onyx-checkout-client';

/**
 * Buying a locked course.
 *
 * The payment is a MOCK and the screen says so, in the dialog, before anybody
 * presses the button. That sentence is the whole design: a checkout that looks
 * real and takes no money is a thing somebody will eventually believe, and the
 * cost of them believing it is a learner who thinks they have paid. So the
 * confirm step names the price, names the course, and says plainly that no
 * money moves.
 *
 * What it does NOT do is pretend to be a gateway: there is no card form, no
 * three-digit box, no fake spinner counting to a fake bank.
 *
 * A real provider is now wired in, at exactly the point this used to post.
 * `gateway` decides which of the two happens, and it is worked out on the
 * SERVER from whether this institution has configured a merchant account --
 * never here, because a client that could choose would be a client that could
 * choose to pay nothing. Absent, everything below is the mock it always was,
 * test-payment notice and all, so demos and the existing specs are untouched.
 */
export function BuyCourseButton({ courseId, title, price, currency, compact, gateway }: {
  courseId: number;
  title: string;
  /** Minor units, like every other amount in this product. */
  price: number;
  currency: string;
  compact?: boolean;
  /**
   * The institution's configured gateway, or absent for the mock. Decided on
   * the server -- see the note above.
   */
  gateway?: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const amount = money(price, currency);

  /** The mock: one post, recorded, enrolled. */
  const buyMock = () => start(async () => {
    setError(null);
    const res = await fetch('/api/proxy/onyx/courses/' + courseId + '/purchase', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const body = await res.json().catch(() => ({}));
    if (!body.ok) { setError(body.message ?? 'That did not go through.'); return; }
    setOpen(false);
    router.refresh();
  });

  /**
   * The real one: open a checkout, open the gateway's window, then ask OUR
   * server what happened rather than believing the browser that just came back
   * from a payment page.
   */
  const buyReal = () => start(async () => {
    setError(null);
    const res = await fetch('/api/proxy/onyx/courses/' + courseId + '/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gateway }),
    });
    const started = await res.json().catch(() => ({ ok: false }));
    if (!started.ok) { setError(started.message ?? 'That did not go through.'); return; }

    const end = await completeCheckout(started.data ?? {});
    if (end.status === 'redirected') return;          // the browser is leaving
    if (end.status === 'failed') { setError(end.message); return; }
    if (end.status === 'dismissed') { setError('You have not been charged.'); return; }
    if (end.status === 'pending') {
      setError('Your bank has not confirmed this yet. The course opens as soon as they do.');
      return;
    }
    setOpen(false);
    router.refresh();
  });

  const buy = gateway ? buyReal : buyMock;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={'relative z-10 inline-flex items-center justify-center gap-1.5 rounded-xl '
          + 'bg-brand-600 font-bold text-white hover:bg-brand-700 '
          + (compact ? 'min-h-[38px] px-3.5 text-[13px]' : 'min-h-[42px] w-full px-4 text-sm')}
      >
        <Icon name="lock" className="h-4 w-4" />
        Buy for {amount}
      </button>

      {/*
        * The app's Modal, which portals to <body>, rather than a `fixed`
        * overlay of this component's own. A course card carries
        * `hover:-translate-y-0.5`, and a transformed ancestor becomes the
        * containing block for `position: fixed` -- so a hand-rolled overlay
        * rendered inside the card, at the card's width, halfway down the page.
        * The portal is the fix, and it brings focus handling and Escape with
        * it.
        */}
      {open ? (
        <Modal title="Buy this course" onClose={() => setOpen(false)}>
          <div className="space-y-3.5">
            <p className="text-[13.5px] leading-relaxed text-muted">
              {title} — <span className="font-bold text-ink">{amount}</span>. Paying enrols you
              immediately and the course opens on your list.
            </p>

            {/* Said before the button, not after the charge -- and only while
                it is true. With a gateway configured this is a real payment,
                and leaving the notice up would be the exact lie it exists to
                prevent. */}
            {gateway ? null : (
              <p className="rounded-xl bg-accent-50 px-3 py-2.5 text-[12.5px] leading-relaxed
                            text-accent-700">
                <strong>This is a test payment.</strong> No card is taken and no money moves —
                the purchase is recorded so the rest of the flow is real.
              </p>
            )}

            {error ? (
              <p role="alert" className="text-[13px] text-red-700">{error}</p>
            ) : null}

            <div className="flex gap-2 pt-1">
              <button type="button" onClick={buy} disabled={pending}
                className="min-h-[46px] flex-1 rounded-xl bg-brand-600 px-4 text-sm font-bold
                           text-white hover:bg-brand-700 disabled:opacity-50">
                {pending ? 'Paying…' : 'Pay ' + amount}
              </button>
              <button type="button" onClick={() => setOpen(false)} disabled={pending}
                className="min-h-[46px] rounded-xl border border-line px-4 text-sm font-semibold">
                Cancel
              </button>
            </div>
          </div>
        </Modal>
      ) : null}
    </>
  );
}
