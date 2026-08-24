'use client';

import { useId, useState } from 'react';
import { Icon } from '@/components/onyx-ui';

/**
 * A password box you can look at.
 *
 * Every credential field in the product was a bare `type="password"`, which
 * means a person typing one has no way to check what they typed. That is a
 * real cost and it is not evenly distributed: it lands hardest on long or
 * generated passwords, on phone keyboards, and on anyone whose accuracy at a
 * keyboard is not perfect. The failure it produces -- "those details do not
 * match" -- is also the least informative error in the product, because the
 * API deliberately will not say which half was wrong.
 *
 * It matters twice over on the admin-facing forms. When an operator sets
 * somebody ELSE'S password they then have to pass it on, and a typo there is
 * not a retry: it is an account nobody can get into, discovered by a stranger
 * a day later.
 *
 * Three things this gets right that a naive toggle gets wrong:
 *
 *   * **`type="button"`.** Inside a form, a button with no type is a submit
 *     button. A "show password" that submits the login form half-typed is a
 *     worse bug than the one it fixes.
 *   * **It is a real control, not an icon.** It carries an accessible name
 *     that says what pressing it will do, and `aria-pressed` for the state, so
 *     a screen-reader user is told both. `aria-controls` points at the field.
 *   * **It never leaves the password visible by surprise.** Showing is per
 *     field and per mount; nothing is remembered between visits, so a shared
 *     machine does not reveal the last person's typing.
 *
 * The input keeps its own `name`, so this is a drop-in for the plain input in
 * an uncontrolled form -- every caller here submits through FormData.
 */
export function PasswordField({
  id, name, className, autoComplete, required, minLength, defaultValue, placeholder,
  autoFocus,
}: {
  id: string;
  name: string;
  /** The caller's own field styling -- this component owns no palette. */
  className: string;
  autoComplete?: string;
  required?: boolean;
  minLength?: number;
  defaultValue?: string;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const [shown, setShown] = useState(false);
  const hintId = useId();

  return (
    <div className="relative">
      <input
        id={id}
        name={name}
        type={shown ? 'text' : 'password'}
        required={required}
        minLength={minLength}
        defaultValue={defaultValue}
        placeholder={placeholder}
        autoComplete={autoComplete}
        autoFocus={autoFocus}
        aria-describedby={hintId}
        // Room for the button, so a long password does not run underneath it.
        className={className + ' pr-11'}
      />
      <button
        type="button"
        onClick={() => setShown((v) => !v)}
        aria-pressed={shown}
        aria-controls={id}
        // The name says what pressing it DOES, which is the convention a
        // screen reader user expects from a toggle button.
        aria-label={shown ? 'Hide password' : 'Show password'}
        title={shown ? 'Hide password' : 'Show password'}
        className="absolute right-1 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center
                   rounded-lg text-muted transition hover:bg-slate-100 hover:text-ink
                   focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600"
      >
        <Icon name={shown ? 'eye-off' : 'eye'} className="h-[18px] w-[18px]" />
      </button>
      {/* Announced with the field rather than printed under it: the affordance
          is visible, and one more line of grey text under every password box
          is noise on a form whose whole job is two inputs and a button. */}
      <span id={hintId} className="sr-only">
        {shown ? 'Your password is visible.' : 'Your password is hidden.'}
      </span>
    </div>
  );
}
