'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { money } from '@/lib/onyx-money';
import { Icon } from '@/components/onyx-ui';
import { Modal } from '@/components/onyx-modal';
import { completeCheckout } from '@/lib/onyx-checkout-client';

/**
 * Signing up for a Live Class.
 *
 * Deliberately NOT the course Buy button with a different noun. What a course
 * purchase buys is an enrolment -- an outline, lessons, progress -- and the
 * button can honestly say "the course opens on your list". A domain has none of
 * that: it is a programme the institution runs off-product, and what this
 * records is a name on a list somebody in the office reads. So the wording
 * commits to being contacted rather than to being let in, because the second
 * would be a promise the product cannot keep.
 *
 * Three paths, and which one a person gets is decided on the SERVER:
 *
 *   free           -- one POST, no dialog, no money.
 *   no gateway     -- the mock, which is what a deployment without a merchant
 *                     account gets and what keeps demos and specs working.
 *   a gateway      -- a real payment through `completeCheckout`, the same
 *                     helper the course and invoice paths use.
 *
 * A client cannot choose between the last two, because a client that could
 * would be a client that could choose to pay nothing.
 */
export function RegisterForDomain({ domainId, title, price, currency, gateway, registered }: {
  domainId: number;
  title: string;
  /** Minor units, like every other amount in this product. */
  price: number;
  currency: string;
  /** The institution's configured gateway, or absent for the mock. */
  gateway?: string | null;
  registered: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const free = price <= 0;
  const amount = money(price, currency);

  if (registered) {
    return (
      <p className="inline-flex min-h-[42px] items-center gap-2 rounded-xl bg-emerald-50
                    px-4 text-[13.5px] font-semibold text-emerald-800">
        <Icon name="check" className="h-4 w-4" />
        You are registered. The office will be in touch.
      </p>
    );
  }

  /** Free, or a deployment with no gateway: one post, one row, no theatre. */
  const registerDirect = () => start(async () => {
    setError(null);
    const res = await fetch('/api/proxy/onyx/domains/' + domainId + '/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const body = await res.json().catch(() => ({ ok: false }));
    if (!body.ok) { setError(body.message ?? 'That did not go through.'); return; }
    setOpen(false);
    router.refresh();
  });

  /** A real gateway: open a checkout, then ask our server what happened. */
  const payAndRegister = () => start(async () => {
    setError(null);
    const res = await fetch('/api/proxy/onyx/domains/' + domainId + '/checkout', {
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
      setError('Your bank has not confirmed this yet. Your place is held once they do.');
      return;
    }
    setOpen(false);
    router.refresh();
  });

  // Free never reaches a gateway: a zero-rupee order is a provider error rather
  // than a purchase, and there is nothing to charge.
  const go = free || !gateway ? registerDirect : payAndRegister;

  // Nothing to weigh up and nothing to be charged, so no dialog. A confirmation
  // step in front of a free action is a step that only ever gets in the way.
  if (free) {
    return (
      <div className="flex flex-col items-end gap-1.5">
        <button type="button" onClick={registerDirect} disabled={pending}
          className="inline-flex min-h-[42px] items-center gap-2 rounded-xl bg-brand-600
                     px-4 text-[14px] font-bold text-white hover:bg-brand-700
                     disabled:opacity-50">
          <Icon name="check" className="h-4 w-4" />
          {pending ? 'Registering…' : 'Register'}
        </button>
        {error ? <p role="alert" className="text-[12.5px] text-red-700">{error}</p> : null}
      </div>
    );
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)}
        className="inline-flex min-h-[42px] items-center gap-2 rounded-xl bg-brand-600
                   px-4 text-[14px] font-bold text-white hover:bg-brand-700">
        <Icon name="lock" className="h-4 w-4" />
        Register for {amount}
      </button>

      {open ? (
        <Modal title="Register for this Live Class" onClose={() => setOpen(false)}>
          <div className="space-y-3.5">
            <p className="text-[13.5px] leading-relaxed text-muted">
              {title} — <span className="font-bold text-ink">{amount}</span>.
            </p>

            {/* What this actually buys, said before the money and not after.
                A domain has no outline to open, so promising one would be a
                promise the product cannot keep. */}
            <p className="rounded-xl bg-brand-50 px-3 py-2.5 text-[12.5px] leading-relaxed
                          text-brand-800">
              This reserves your place. Live Classes are run by the institution rather than
              through this site, so somebody from the office will contact you with the
              schedule and joining details.
            </p>

            {gateway ? null : (
              <p className="rounded-xl bg-accent-50 px-3 py-2.5 text-[12.5px] leading-relaxed
                            text-accent-700">
                <strong>This is a test payment.</strong> No card is taken and no money moves —
                the registration is recorded so the rest of the flow is real.
              </p>
            )}

            {error ? (
              <p role="alert" className="text-[13px] text-red-700">{error}</p>
            ) : null}

            <div className="flex gap-2 pt-1">
              <button type="button" onClick={go} disabled={pending}
                className="min-h-[46px] flex-1 rounded-xl bg-brand-600 px-4 text-sm font-bold
                           text-white hover:bg-brand-700 disabled:opacity-50">
                {pending ? 'Working…' : 'Pay ' + amount}
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
