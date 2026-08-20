'use client';

import { useEffect, useState } from 'react';
import { Icon } from '@/components/onyx-ui';

type Choice = 'light' | 'dark';

/**
 * Light or dark, in the top bar where people look for it.
 *
 * Deliberately a two-state switch rather than light/dark/system. "System" is
 * the right default and the wrong control: it is a third position that looks
 * identical to whichever of the other two it currently resolves to, so the
 * button stops saying what it will do. The default IS system -- the script in
 * the root layout reads `prefers-color-scheme` when nobody has chosen -- and
 * pressing this is how somebody overrides it.
 *
 * The choice is written to localStorage and applied to <html> immediately, so
 * it survives navigation without a round trip, and it is applied before paint
 * on the next load (again, see the layout) so nobody watches a white page
 * become dark.
 */
export function ThemeToggle({ className = '' }: { className?: string }) {
  const [choice, setChoice] = useState<Choice | null>(null);

  // Read what the pre-paint script already decided rather than deciding again,
  // so the button never disagrees with the page it is sitting on.
  useEffect(() => {
    const applied = document.documentElement.getAttribute('data-theme');
    setChoice(applied === 'dark' ? 'dark' : 'light');
  }, []);

  const flip = () => {
    const next: Choice = choice === 'dark' ? 'light' : 'dark';
    setChoice(next);
    document.documentElement.setAttribute('data-theme', next);
    try { window.localStorage.setItem('onyx-theme', next); } catch { /* private mode */ }
  };

  // Until the effect runs, the server and the client disagree about which icon
  // belongs here; rendering neither avoids a hydration mismatch and a flash of
  // the wrong one.
  const dark = choice === 'dark';

  return (
    <button
      type="button"
      onClick={flip}
      aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'}
      title={dark ? 'Light theme' : 'Dark theme'}
      className={'grid h-10 w-10 place-items-center rounded-xl border border-line text-muted '
        + 'transition hover:bg-brand-50 hover:text-brand-700 ' + className}
    >
      {choice === null ? (
        <span className="h-[19px] w-[19px]" aria-hidden="true" />
      ) : (
        // The icon shows what pressing it gives you, not what you are in.
        <Icon name={dark ? 'sun' : 'moon'} />
      )}
    </button>
  );
}
