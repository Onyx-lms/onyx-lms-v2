'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Icon, type IconName } from '@/components/onyx-ui';
import { ClashCheck } from '@/components/onyx-clash';
import { Modal } from '@/components/onyx-modal';

/**
 * One authoring form, driven by a field list.
 *
 * The proposal is written almost entirely in verbs -- "faculty must create
 * assignments", "administrators must schedule exams", "employers must post
 * jobs" -- and every one of those needs the same thing: a disclosure, a few
 * inputs, a POST, an error line and a refresh. Writing that ten times by hand
 * is ten chances to style a label differently or forget to surface a 422.
 *
 * So it is one component taking a field spec. Adding an authoring surface is
 * then a description of the fields, which is also why every one of them
 * validates, reports and looks the same.
 */

export type FieldType =
  | 'text' | 'textarea' | 'number' | 'date' | 'datetime' | 'time' | 'select' | 'checkbox'
  /**
   * An amount of money, typed the way money is written.
   *
   * The database stores integer minor units and always will -- floating-point
   * rupees is how a ledger ends up a paisa out. What was wrong was asking a
   * PERSON for them: the field said "Price in paise" with "149900 is ₹1,499.00"
   * underneath, so setting a price meant doing arithmetic, and a slip of two
   * zeroes is the difference between ₹1,499 and ₹149,900.
   *
   * So the field takes rupees and converts on the way out. The conversion is
   * one line in `toBody`; the alternative was every author multiplying by a
   * hundred in their head, for ever.
   */
  | 'money';

export interface Field {
  name: string;
  label: string;
  type?: FieldType;
  required?: boolean;
  placeholder?: string;
  help?: string;
  min?: number;
  max?: number;
  rows?: number;
  options?: { value: string; label: string }[];
  /**
   * Send this field as a number even though the control yields a string.
   *
   * A `<select>` always hands back a string, so an id picker submitted
   * `program_id: "3"` and every one of them was refused with
   * "Expected number, received string". Marking it here keeps the coercion
   * with the field description rather than guessing from the value.
   */
  numeric?: boolean;
  /** Sent when the box is left empty, so a caller can supply a default. */
  fallback?: string | number | boolean;
  /**
   * What the box starts with, which is not the same thing as `fallback`.
   *
   * `fallback` is invisible: the person sees an empty field and something
   * else is sent. `initial` is a value they can read and change before they
   * submit -- which is what a default price has to be, because the number
   * being charged is the whole point of the field.
   */
  initial?: string | number;
  /** Full width in the two-column grid. */
  wide?: boolean;
}

/**
 * One cross-field rule, expressed as data so it can be handed from a Server
 * Component to this one.
 *
 *   `atMost`   -- a number that must not exceed another number
 *   `before`   -- a value that must sort before another (dates, times)
 *
 * Both skip silently when either side is blank: an optional field left empty
 * is not a rule violation, and complaining about it would block a form the
 * server would have accepted.
 */
export type FieldRule =
  | { kind: 'atMost'; field: string; than: string; message: string }
  // A hall's capacity against rows x columns -- the one rule here that is
  // arithmetic over two fields rather than a comparison with one.
  | { kind: 'atMostProduct'; field: string; of: [string, string]; message: string }
  | { kind: 'before'; field: string; than: string; message: string; orEqual?: boolean };

function checkRules(rules: FieldRule[] | undefined, v: Record<string, string>): string | null {
  for (const rule of rules ?? []) {
    const a = v[rule.field];
    if (!a) continue;
    if (rule.kind === 'atMostProduct') {
      const [x, y] = rule.of;
      if (!v[x] || !v[y]) continue;
      if (Number(a) > Number(v[x]) * Number(v[y])) return rule.message;
      continue;
    }
    const b = v[rule.than];
    if (!b) continue;
    if (rule.kind === 'atMost' && Number(a) > Number(b)) return rule.message;
    if (rule.kind === 'before' && (rule.orEqual ? a >= b : a > b)) return rule.message;
  }
  return null;
}

const input = 'mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm '
  + 'focus:border-brand-600 focus:outline-none';
const label = 'block text-[13px] font-semibold text-slate-700';

/**
 * Turns the flat form values into the JSON body the API expects.
 *
 * Numbers must not be sent as strings (zod rejects them), empty optional
 * fields must be omitted rather than sent as "", and dates have to reach the
 * server as ISO — a `datetime-local` input hands over "2026-08-14T09:00",
 * which is not.
 */
function toBody(fields: Field[], data: FormData): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  for (const f of fields) {
    const raw = f.type === 'checkbox'
      ? data.get(f.name) !== null
      : String(data.get(f.name) ?? '').trim();

    if (f.type === 'checkbox') { body[f.name] = raw; continue; }
    if (raw === '') {
      // An empty numeric field is omitted, never sent as "". An optional id
      // picker left on "none" was submitting `program_id: ""`, which zod
      // rejects with "Expected number, received string".
      const empty = f.fallback;
      if (empty !== undefined && empty !== '') body[f.name] = empty;
      continue;
    }
    if (f.type === 'money') {
      // Rounded, not truncated: 12.005 typed into a rupee field is a person
      // meaning 12.01, and `Math.trunc` would quietly take the paisa off.
      body[f.name] = Math.round(Number(raw) * 100);
      continue;
    }
    if (f.type === 'number' || f.numeric) { body[f.name] = Number(raw); continue; }
    if (f.type === 'datetime' || f.type === 'date') {
      body[f.name] = new Date(raw as string).toISOString();
      continue;
    }
    // A time of day is not an instant: a class at 09:00 is at 09:00 whatever
    // the date, so it goes to the API as the "HH:MM" the input already gives.
    if (f.type === 'time') { body[f.name] = raw; continue; }
    body[f.name] = raw;
  }
  return body;
}

export function CreatePanel({
  title, cta, endpoint, fields, extra, icon = 'edit', thenPost, compact, watch,
  confirm, rules,
}: {
  title: string;
  /** Button label, both to open the form and to submit it. */
  cta: string;
  /** Path under /api/proxy/onyx/ — e.g. `courses/12/assignments`. */
  endpoint: string;
  /**
   * Asked before anything is sent, for the panels whose effect is wide or
   * hard to walk back -- publishing a term's timetable to every learner, say.
   */
  confirm?: string;
  /**
   * Cross-field rules the server also enforces, checked here so the answer
   * arrives before the work is retyped rather than as a 422 after it.
   *
   * DATA, not a predicate function. Every caller is a Server Component and
   * this is a Client Component, and a function cannot cross that boundary --
   * passing one renders the whole page 500 rather than failing at the field
   * it belongs to. Learned the hard way: four pages went down at once.
   *
   * Deliberately not a general validation framework either. These are the
   * specific arithmetic rules a person is already doing in their head -- a
   * pass mark above the maximum, an end before a start -- where being told
   * late means filling the form in twice.
   */
  rules?: FieldRule[];
  fields: Field[];
  /** Fixed values merged into every submission. */
  extra?: Record<string, unknown>;
  icon?: IconName;
  /**
   * A follow-up POST to run once the record exists, with `:id` replaced by
   * its id -- `assignments/:id/publish`.
   *
   * A string, not a callback: these panels are rendered from server
   * components, and React refuses to pass a function across that boundary
   * ("Functions cannot be passed directly to Client Components"). Every page
   * using it crashed with a server-side exception until this became data.
   */
  thenPost?: string;
  compact?: boolean;
  /**
   * Something rendered under the fields that needs to see what has been typed
   * so far -- the timetable's clash pre-check is the only user.
   *
   * A named kind rather than a render prop for the same reason `thenPost` is a
   * string: these panels are rendered from server components, and React refuses
   * to pass a function across that boundary.
   */
  watch?: 'timetable-clash';
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [done, setDone] = useState<string | null>(null);
  // Only tracked when something is watching. Every other panel stays
  // uncontrolled, which is why they re-render on nothing.
  const [values, setValues] = useState<Record<string, string>>({});

  async function post(path: string, body?: unknown) {
    const res = await fetch('/api/proxy/onyx/' + path, {
      method: 'POST',
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    return res.json().catch(() => ({ ok: false, message: 'Something went wrong.' }));
  }

  function close() { setOpen(false); setError(null); }

  return (
    <>
      {/* self-start/justify-self-start: several callers put this button next
          to another panel inside a CSS grid row (e.g. the exams page's
          "Schedule an exam" beside "New hall"). Grid stretches an item to
          fill its cell on both axes by default, and a plain button has
          nothing of its own to resist that -- without this it inflates to
          the height AND width of whichever sibling cell is tallest, which
          reads as a giant empty coloured box rather than a button. */}
      <button type="button" onClick={() => { setDone(null); setOpen(true); }}
        className={'inline-flex w-fit shrink-0 items-center gap-2 self-start justify-self-start '
          + 'rounded-xl bg-brand-600 font-semibold text-white hover:bg-brand-700 '
          + (compact ? 'px-3 py-2 text-[13px]' : 'px-4 py-2.5 text-sm')}>
        <Icon name={icon} className="h-4 w-4" />
        {cta}
      </button>

      {done ? (
        <p role="status"
          className="inline-flex items-center gap-1.5 self-start rounded-xl bg-green-50 px-3
                     py-2 text-[12.5px] font-semibold text-green-800">
          <Icon name="check" className="h-4 w-4" />
          {done}
        </p>
      ) : null}

      {open ? (
        <Modal title={title} onClose={close} wide={fields.length > 5}>
          <form
            onChange={watch ? (e) => {
              const form = e.currentTarget as HTMLFormElement;
              const data = new FormData(form);
              setValues(Object.fromEntries(
                [...data.entries()].map(([k, v]) => [k, String(v)])));
            } : undefined}
            onSubmit={(e) => {
              e.preventDefault();
              const form = e.currentTarget;
              const data = new FormData(form);
              setError(null);

              const complaint = checkRules(rules, Object.fromEntries(
                [...data.entries()].map(([k, v]) => [k, String(v)])));
              if (complaint) { setError(complaint); return; }
              if (confirm && !window.confirm(confirm)) return;
              start(async () => {
                const body = { ...toBody(fields, data), ...(extra ?? {}) };
                const res = await post(endpoint, body);
                if (!res.ok) {
                  // Surface the field errors zod returns, not just the headline --
                  // "The given data was invalid" alone tells nobody what to change.
                  const detail = res.errors
                    ? Object.entries(res.errors)
                      .map(([k, v]) => `${k}: ${(v as string[]).join(', ')}`).join(' · ')
                    : '';
                  setError([res.message, detail].filter(Boolean).join(' — '));
                  return;
                }
                if (thenPost) {
                  const follow = await post(thenPost.replace(':id', String(res.data.id)));
                  if (!follow.ok) {
                    setError(follow.message ?? 'Created, but not published.');
                    return;
                  }
                }
                form.reset();
                setOpen(false);
                // Say it worked. Success used to be the panel vanishing and
                // nothing else -- which is exactly what a silent failure looks
                // like, so the rational response was to do it again. Announced
                // through role="status" so it is not only a visual change.
                setDone(title + ' — saved.');
                router.refresh();
              });
            }}
          >
            <div className="grid gap-3 sm:grid-cols-2">
              {fields.map((f) => {
                const id = endpoint.replace(/[^a-z0-9]/gi, '-') + '-' + f.name;
                const common = {
                  id, name: f.name, required: f.required, className: input,
                  ...(f.initial !== undefined ? { defaultValue: String(f.initial) } : {}),
                };
                return (
                  <div key={f.name}
                    className={f.wide || f.type === 'textarea' ? 'sm:col-span-2' : ''}>
                    {f.type === 'checkbox' ? (
                      <label className="mt-1 flex items-center gap-2 text-[13px] font-semibold
                                        text-slate-700">
                        <input type="checkbox" id={id} name={f.name}
                          className="h-4 w-4 rounded border-slate-300" />
                        {f.label}
                      </label>
                    ) : (
                      <>
                        <label className={label} htmlFor={id}>{f.label}</label>
                        {f.type === 'textarea' ? (
                          <textarea {...common} rows={f.rows ?? 3} placeholder={f.placeholder} />
                        ) : f.type === 'select' ? (
                          <select {...common} defaultValue={String(f.fallback ?? '')}>
                            {(f.options ?? []).map((o) => (
                              <option key={o.value} value={o.value}>{o.label}</option>
                            ))}
                          </select>
                        ) : f.type === 'money' ? (
                          /* The currency symbol sits IN the field, so the
                             number beside it needs no explaining. `step` of a
                             hundredth is what makes a keyboard's up-arrow move
                             by a paisa rather than by a rupee. */
                          <div className="relative">
                            <span aria-hidden
                              className="pointer-events-none absolute left-3 top-1/2
                                         -translate-y-1/2 text-[15px] font-semibold text-muted">
                              ₹
                            </span>
                            <input
                              {...common}
                              type="number" inputMode="decimal" step="0.01"
                              min={f.min ?? 0} max={f.max}
                              placeholder={f.placeholder ?? '0.00'}
                              className={(common.className ?? '') + ' pl-7'}
                            />
                          </div>
                        ) : (
                          <input
                            {...common}
                            type={f.type === 'number' ? 'number'
                              : f.type === 'date' ? 'date'
                                : f.type === 'time' ? 'time'
                                  : f.type === 'datetime' ? 'datetime-local' : 'text'}
                            min={f.min} max={f.max} placeholder={f.placeholder}
                          />
                        )}
                      </>
                    )}
                    {f.help ? <p className="mt-1 text-xs text-muted">{f.help}</p> : null}
                  </div>
                );
              })}
            </div>

            {/* Between the fields and the button, which is where somebody looks
                before pressing it. */}
            {watch === 'timetable-clash' ? (
              <div className="mt-3"><ClashCheck fields={values} /></div>
            ) : null}

            {error ? (
              <p role="alert" className="mt-3 rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">
                {error}
              </p>
            ) : null}

            <div className="mt-4 flex gap-2">
              <button type="submit" disabled={pending}
                className="rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-bold text-white
                           hover:bg-brand-700 disabled:opacity-60">
                {pending ? 'Saving…' : cta}
              </button>
              <button type="button" onClick={close}
                className="rounded-xl border border-line px-4 py-2.5 text-sm font-semibold">
                Cancel
              </button>
            </div>
          </form>
        </Modal>
      ) : null}
    </>
  );
}

/** A one-click POST — publish, open, close, activate. */
export function ActionButton({ endpoint, label: text, tone = 'brand', confirm, body }: {
  endpoint: string; label: string;
  tone?: 'brand' | 'danger' | 'quiet';
  confirm?: string;
  body?: unknown;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const tones = {
    brand: 'bg-brand-600 text-white hover:bg-brand-700',
    danger: 'border border-rose-600 text-rose-700 hover:bg-rose-50',
    quiet: 'border border-line text-slate-700 hover:bg-brand-50',
  } as const;

  return (
    <span className="inline-flex flex-col">
      <button type="button" disabled={pending}
        onClick={() => {
          // Asked BEFORE the transition starts. Inside it, the button flipped
          // to "Working…" and disabled itself while the confirm was still on
          // screen, so the answer looked already given whichever way it went.
          if (confirm && !window.confirm(confirm)) return;
          start(async () => {
          setError(null);
          const res = await fetch('/api/proxy/onyx/' + endpoint, {
            method: 'POST',
            headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
            body: body !== undefined ? JSON.stringify(body) : undefined,
          });
          const payload = await res.json().catch(() => ({ ok: false }));
          if (!payload.ok) { setError(payload.message ?? 'That did not work.'); return; }
          router.refresh();
          });
        }}
        className={'rounded-xl px-3 py-2 text-[13px] font-semibold disabled:opacity-60 '
          + tones[tone]}>
        {pending ? 'Working…' : text}
      </button>
      {error ? <span role="alert" className="mt-1 text-xs text-rose-700">{error}</span> : null}
    </span>
  );
}
