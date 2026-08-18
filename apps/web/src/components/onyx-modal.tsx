'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '@/components/onyx-ui';

/**
 * A centered dialog on a backdrop -- the "perfect box for creation" every
 * create-form in the platform console opens into now, instead of expanding
 * inline and shoving the page's own content down. Escape and a backdrop
 * click both close it; the click handler on the backdrop is deliberately
 * separate from the card's own (which stops propagation), so a click inside
 * the form never closes it.
 *
 * Portalled to `document.body` rather than rendered where it is called from.
 * `position: fixed` only ever escapes to the viewport if nothing between it
 * and the root creates its own stacking context -- and `position: sticky`
 * (the platform sidebar, the tenant sidebar) does that unconditionally, spec
 * or no z-index involved. A modal opened from inside that sidebar was
 * confined to competing for stacking order only against the sidebar's own
 * children, so it could never paint above `<main>` next to it: the sidebar
 * dimmed correctly (it's what the backdrop actually out-ranks), but the
 * page's real content sat on top of the backdrop, undimmed, right through
 * it. A portal sidesteps the whole category of ancestor stacking-context
 * bugs -- this one and any other, present or future -- rather than hunting
 * down which ancestor to blame each time.
 *
 * Body scroll is locked for the same reason a modal needs to actually be
 * modal: without it, the page underneath kept scrolling under an open
 * dialog, which is its own broken affordance independent of the stacking bug.
 */
export function Modal({ title, onClose, children, wide }: {
  title: string; onClose: () => void; children: React.ReactNode;
  /** For forms with more than a handful of fields. `max-w-md` is 448px. */
  wide?: boolean;
}) {
  // Portals need a browser document, which does not exist during SSR --
  // this form's own `open` state already guarantees this only ever mounts
  // client-side, but the guard makes that guarantee explicit rather than
  // assumed.
  const [mounted, setMounted] = useState(false);

  // The dialog itself, so focus can be moved into it and kept there.
  const panel = useRef<HTMLDivElement | null>(null);

  /**
   * Closing must not silently bin what somebody typed.
   *
   * This was the highest-frequency way to lose work in the product: a stray
   * click on the dim area, or a reflexive Escape, discarded everything --
   * eight fields into "Schedule an exam", with no warning and nothing to
   * recover. The inputs inside are uncontrolled, so there is nothing to
   * restore afterwards either.
   *
   * "Dirty" is read off the live DOM rather than tracked in state, because
   * this component does not own the form: it wraps whatever its caller
   * renders, and every one of those callers is a different form.
   */
  const closeSafely = useCallback(() => {
    const root = panel.current;
    const touched = root ? [...root.querySelectorAll('input, textarea')].some((node) => {
      const el = node as HTMLInputElement;
      if (el.type === 'checkbox' || el.type === 'radio') return el.checked !== el.defaultChecked;
      if (el.type === 'file') return Boolean(el.files?.length);
      return el.value.trim() !== '' && el.value !== el.defaultValue;
    }) : false;
    if (touched && !window.confirm('Discard what you have typed?')) return;
    onClose();
  }, [onClose]);

  useEffect(() => {
    setMounted(true);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { closeSafely(); return; }
      // A modal that leaks focus to the page behind it is a modal only for
      // people using a mouse.
      if (e.key !== 'Tab' || !panel.current) return;
      const focusable = panel.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]),'
        + ' textarea:not([disabled]), [tabindex]:not([tabindex="-1"])');
      if (!focusable.length) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [closeSafely]);

  // Into the dialog, not left on whatever opened it -- otherwise the first Tab
  // walks the page underneath.
  useEffect(() => {
    if (!mounted) return;
    panel.current?.querySelector<HTMLElement>(
      'input, select, textarea, button')?.focus();
  }, [mounted]);

  if (!mounted) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-ink/40 p-4"
      onClick={closeSafely}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        className={'max-h-[85vh] w-full overflow-y-auto rounded-2xl bg-white p-5 shadow-lift '
          + (wide ? 'max-w-2xl' : 'max-w-md')}
      >
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-[17px] font-bold">{title}</h2>
          <button type="button" onClick={closeSafely} aria-label="Close"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-muted
                       hover:bg-slate-100">
            <Icon name="x" className="h-4 w-4" />
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}
