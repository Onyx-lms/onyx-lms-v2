'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Icon, type IconName } from '@/components/onyx-ui';
import { ClashCheck } from '@/components/onyx-clash';

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
  | 'text' | 'textarea' | 'number' | 'date' | 'datetime' | 'time' | 'select' | 'checkbox';

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
  /** Full width in the two-column grid. */
  wide?: boolean;
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
}: {
  title: string;
  /** Button label, both to open the form and to submit it. */
  cta: string;
  /** Path under /api/proxy/onyx/ — e.g. `courses/12/assignments`. */
  endpoint: string;
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

  if (!open) {
    return (
      // self-start/justify-self-start: several callers put this button next
      // to another panel inside a CSS grid row (e.g. the exams page's
      // "Schedule an exam" beside "New hall"). Grid stretches an item to
      // fill its cell on both axes by default, and a plain button has
      // nothing of its own to resist that -- without this it inflates to
      // the height AND width of whichever sibling cell is tallest, which
      // reads as a giant empty coloured box rather than a button.
      <button type="button" onClick={() => setOpen(true)}
        className={'inline-flex w-fit shrink-0 items-center gap-2 self-start justify-self-start '
          + 'rounded-xl bg-brand-600 font-semibold text-white hover:bg-brand-700 '
          + (compact ? 'px-3 py-2 text-[13px]' : 'px-4 py-2.5 text-sm')}>
        <Icon name={icon} className="h-4 w-4" />
        {cta}
      </button>
    );
  }

  return (
    <form
      className="rounded-2xl border border-line bg-white p-4 shadow-card"
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
            if (!follow.ok) { setError(follow.message ?? 'Created, but not published.'); return; }
          }
          form.reset();
          setOpen(false);
          router.refresh();
        });
      }}
    >
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-bold">{title}</h3>
        <button type="button" onClick={() => { setOpen(false); setError(null); }}
          aria-label="Cancel"
          className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-line text-muted">
          ✕
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {fields.map((f) => {
          const id = endpoint.replace(/[^a-z0-9]/gi, '-') + '-' + f.name;
          const common = { id, name: f.name, required: f.required, className: input };
          return (
            <div key={f.name} className={f.wide || f.type === 'textarea' ? 'sm:col-span-2' : ''}>
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
        <button type="button" onClick={() => { setOpen(false); setError(null); }}
          className="rounded-xl border border-line px-4 py-2.5 text-sm font-semibold">
          Cancel
        </button>
      </div>
    </form>
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
        onClick={() => start(async () => {
          if (confirm && !window.confirm(confirm)) return;
          setError(null);
          const res = await fetch('/api/proxy/onyx/' + endpoint, {
            method: 'POST',
            headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
            body: body !== undefined ? JSON.stringify(body) : undefined,
          });
          const payload = await res.json().catch(() => ({ ok: false }));
          if (!payload.ok) { setError(payload.message ?? 'That did not work.'); return; }
          router.refresh();
        })}
        className={'rounded-xl px-3 py-2 text-[13px] font-semibold disabled:opacity-60 '
          + tones[tone]}>
        {pending ? 'Working…' : text}
      </button>
      {error ? <span role="alert" className="mt-1 text-xs text-rose-700">{error}</span> : null}
    </span>
  );
}
