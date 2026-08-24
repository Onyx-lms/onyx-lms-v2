'use client';

import { useOptimistic, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Card, Icon } from '@/components/onyx-ui';
import { RESUME_SECTION_LABELS, type ResumeDoc, type ResumeExtra } from '@/lib/onyx-resume';

/**
 * O10 -- the decisions somebody makes about their own resume.
 *
 * Bespoke rather than a `CreatePanel` field list, and the reason is the shape
 * of the thing: this is a checkbox per derived item, grouped by section, plus a
 * free-text objective and a small list of typed-in extras. `CreatePanel` maps a
 * fixed set of named fields to one POST; here the fields are the person's own
 * record and there is a different number of them for everybody.
 *
 * Every save PATCHes only what changed and then calls `router.refresh()`, so
 * the document above is re-assembled by the server rather than patched in the
 * browser. That is the whole point of the design -- what is on screen is what
 * the PDF will say, because both come from the same assembly.
 *
 * The controls are `useOptimistic` over that, and it is not a nicety. These are
 * fully controlled checkboxes whose `checked` comes from the server: without
 * it, clicking one snaps it straight back and holds it there for the whole
 * round trip -- which on a cold serverless function is long enough to read as
 * "that did not register", and long enough for somebody to click again and
 * undo the change they just made. The optimistic value is discarded the moment
 * the refreshed props arrive, so a save that FAILS also snaps back, which is
 * the correct behaviour and not a bug in this pattern.
 */
/**
 * One group of controls, closed until it is wanted.
 *
 * The rail was six cards stacked -- objective, what to include, extras, order,
 * phone -- roughly two and a half screens of controls beside a document that is
 * itself a screen tall. Everything was equally loud and nothing said what state
 * it was in, so the only way to find out whether anything was hidden was to
 * scroll down and read fourteen checkboxes.
 *
 * `<details>` rather than a tab component: it opens with a click or with Enter,
 * it is announced as expanded or collapsed without a line of ARIA, it survives
 * with JavaScript disabled, and browser find-in-page opens it to reach a match
 * inside. A hand-rolled accordion gets none of that for free.
 *
 * `hint` is the point of the pattern -- "12 of 14 shown", "not written yet" --
 * so the summary line answers the question that would otherwise require
 * opening it.
 */
function Group({ title, hint, children, open = false }: {
  title: string;
  hint?: string;
  children: React.ReactNode;
  open?: boolean;
}) {
  return (
    <Card className="p-0">
      <details open={open} className="group">
        <summary
          className="flex cursor-pointer list-none items-center gap-2 rounded-2xl px-4 py-3
                     hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2
                     focus-visible:ring-brand-600/30"
        >
          <span className="min-w-0 flex-1">
            <span className="block text-[13.5px] font-bold text-ink">{title}</span>
            {hint ? (
              <span className="block text-[12px] text-muted">{hint}</span>
            ) : null}
          </span>
          {/* Rotates to point down when the group is open. Purely decorative:
              the summary element already carries its own expanded state. */}
          <Icon name="chevron" aria-hidden="true"
            className="h-4 w-4 shrink-0 text-muted transition-transform
                       group-open:rotate-90" />
        </summary>
        <div className="border-t border-line px-4 pb-4 pt-3.5">{children}</div>
      </details>
    </Card>
  );
}

export function ResumeEditor({ doc }: { doc: ResumeDoc }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [objective, setObjective] = useState(doc.objective);
  const [saved, setSaved] = useState(false);
  const [draft, setDraft] = useState({ section: 'experience', title: '', detail: '', when: '' });

  // Two optimistic values rather than one object: they are saved by different
  // controls and a shared reducer would make an in-flight phone change revert
  // an in-flight hide.
  const [hiddenNow, setHiddenNow] = useOptimistic(
    doc.hidden, (_prev: string[], next: string[]) => next);
  const [phoneNow, setPhoneNow] = useOptimistic(
    doc.include_phone, (_prev: boolean, next: boolean) => next);

  const hidden = new Set(hiddenNow);

  const save = (patch: Record<string, unknown>, optimistic?: () => void) =>
    start(async () => {
      // Inside the transition, which is the only place useOptimistic accepts
      // an update -- outside one it throws rather than being ignored.
      optimistic?.();
      setError(null);
      setSaved(false);
      const res = await fetch('/api/proxy/onyx/my/resume', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const body = await res.json().catch(() => ({ ok: false }));
      if (!body.ok) { setError(body.message ?? 'That did not save.'); return; }
      setSaved(true);
      router.refresh();
    });

  /**
   * Extras are saved as the WHOLE list, because that is what the column is.
   * Each entry carries its id back so the server can tell an edit from an
   * insertion -- a list without ids would renumber on every save, and the
   * `hidden` keys pointing into it would start naming the wrong entries.
   */
  const addExtra = () => {
    if (!draft.title.trim()) return;
    save({ extras: [...doc.extras, { ...draft, title: draft.title.trim() }] });
    // The section is kept: somebody adding two jobs is adding them to the same
    // place, and re-picking it each time is the sort of small friction that
    // stops people entering the second one.
    setDraft({ section: draft.section, title: '', detail: '', when: '' });
  };

  const removeExtra = (id: number) =>
    save({ extras: doc.extras.filter((e: ResumeExtra) => e.id !== id) });

  /** One step up or down. Out of range is a no-op rather than a wrap. */
  const move = (index: number, by: number) => {
    const next = [...doc.section_order];
    const to = index + by;
    if (to < 0 || to >= next.length) return;
    [next[index], next[to]] = [next[to]!, next[index]!];
    save({ section_order: next });
  };

  const toggle = (key: string) => {
    const next = new Set(hidden);
    if (next.has(key)) next.delete(key); else next.add(key);
    save({ hidden: [...next] }, () => setHiddenNow([...next]));
  };

  // Grouped by the section each item belongs to, so the checkboxes read in the
  // same order as the document beside them.
  const bySection = new Map<string, { key: string; label: string }[]>();
  for (const item of doc.available) {
    bySection.set(item.section, [...(bySection.get(item.section) ?? []), item]);
  }

  // What each group says about itself before it is opened. The counts come
  // from the optimistic value, so a box ticked a moment ago is already
  // reflected in the summary above it rather than a round trip later.
  const shown = doc.available.length - hidden.size;
  const hints = {
    objective: doc.objective.trim()
      ? doc.objective.trim().slice(0, 60) + (doc.objective.trim().length > 60 ? '…' : '')
      : 'Not written yet — the first thing a reader sees',
    include: doc.available.length
      ? shown + ' of ' + doc.available.length + ' shown'
      : 'Nothing on your record yet',
    extras: doc.extras.length
      ? doc.extras.length + (doc.extras.length === 1 ? ' entry added' : ' entries added')
      : 'Nothing added',
    order: doc.section_order.length + ' sections',
    phone: phoneNow
      ? (doc.phone ? 'Shown on the resume' : 'On, but there is no number to show')
      : 'Hidden',
  };

  return (
    <>
      <Group title="Objective" hint={hints.objective} open={!doc.objective.trim()}>
        <p className="text-[12.5px] leading-relaxed text-muted">
          The one part of a resume nothing can derive for you: what you are looking for.
          A sentence or two, addressed to whoever is reading it.
        </p>
        <textarea
          value={objective}
          onChange={(e) => setObjective(e.target.value)}
          rows={4}
          maxLength={1200}
          aria-label="Your objective"
          placeholder="A graduate role in backend engineering, at a team that reviews code carefully."
          className="mt-2 w-full rounded-xl border border-line bg-surface px-3 py-2 text-[13px]
                     leading-relaxed focus:border-brand-600 focus:outline-none"
        />
        <button
          type="button"
          onClick={() => save({ objective })}
          disabled={pending || objective === doc.objective}
          className="mt-2 min-h-[38px] rounded-xl bg-brand-600 px-3.5 text-[13px] font-bold
                     text-white hover:bg-brand-700 disabled:opacity-50"
        >
          {pending ? 'Saving…' : 'Save'}
        </button>
      </Group>

      <Group title="What to include" hint={hints.include}>
        <p className="text-[12.5px] leading-relaxed text-muted">
          Everything your institution holds is included by default, so anything you earn from
          now on appears here on its own. Clear a box to leave that one out.
        </p>

        {doc.available.length ? (
          <div className="mt-3 space-y-4">
            {[...bySection.entries()].map(([section, items]) => (
              <fieldset key={section}>
                <legend className="text-[11px] font-bold uppercase tracking-wide text-muted">
                  {RESUME_SECTION_LABELS[section] ?? section}
                </legend>
                <div className="mt-1.5 space-y-1.5">
                  {items.map((item) => (
                    <label key={item.key}
                      className="flex items-start gap-2 text-[13px] leading-snug text-ink">
                      <input
                        type="checkbox"
                        checked={!hidden.has(item.key)}
                        onChange={() => toggle(item.key)}
                        className="mt-0.5 h-4 w-4 shrink-0 rounded border-line
                                   text-brand-600 focus:ring-brand-600"
                      />
                      <span className={hidden.has(item.key) ? 'text-muted line-through' : ''}>
                        {item.label}
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>
            ))}
          </div>
        ) : (
          <p className="mt-3 text-[12.5px] text-muted">
            Nothing to choose from yet. This fills in as your record here does.
          </p>
        )}
      </Group>

      <Group title="Anything else" hint={hints.extras}>
        <p className="text-[12.5px] leading-relaxed text-muted">
          A job, a publication, something you volunteered for &mdash; whatever your
          institution does not already know about. It goes into whichever section you pick.
        </p>

        {doc.extras.length ? (
          <ul className="mt-3 space-y-2">
            {doc.extras.map((entry: ResumeExtra) => (
              <li key={entry.id}
                className="flex items-start justify-between gap-2 rounded-xl border
                           border-line px-3 py-2">
                <div className="min-w-0 text-[13px] leading-snug">
                  <p className="font-semibold text-ink">{entry.title}</p>
                  <p className="text-[12px] text-muted">
                    {[RESUME_SECTION_LABELS[entry.section] ?? entry.section,
                      entry.when, entry.detail].filter(Boolean).join('  \u00b7  ')}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => removeExtra(entry.id)}
                  disabled={pending}
                  aria-label={'Remove ' + entry.title}
                  className="shrink-0 rounded-lg p-1.5 text-muted hover:bg-red-50
                             hover:text-red-700 disabled:opacity-50"
                >
                  <Icon name="trash" className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        ) : null}

        {/* A form rather than a row of loose inputs, so it submits on Enter --
            which is what somebody typing a one-line entry will do. */}
        <form className="mt-3 space-y-2"
          onSubmit={(e) => { e.preventDefault(); addExtra(); }}>
          <div className="flex gap-2">
            <div className="min-w-0 flex-1">
              <label htmlFor="extra-title" className="sr-only">What it was</label>
              <input
                id="extra-title" name="extra-title" value={draft.title}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                placeholder="Summer intern, Acme Logistics"
                maxLength={200}
                className="w-full rounded-xl border border-line bg-surface px-3 py-2
                           text-[13px] focus:border-brand-600 focus:outline-none"
              />
            </div>
            <div className="w-24 shrink-0">
              <label htmlFor="extra-when" className="sr-only">When</label>
              <input
                id="extra-when" name="extra-when" value={draft.when}
                onChange={(e) => setDraft({ ...draft, when: e.target.value })}
                placeholder="2024"
                maxLength={40}
                className="w-full rounded-xl border border-line bg-surface px-3 py-2
                           text-[13px] focus:border-brand-600 focus:outline-none"
              />
            </div>
          </div>

          <label htmlFor="extra-detail" className="sr-only">A line about it</label>
          <input
            id="extra-detail" name="extra-detail" value={draft.detail}
            onChange={(e) => setDraft({ ...draft, detail: e.target.value })}
            placeholder="Built the internal dispatch tool."
            maxLength={1000}
            className="w-full rounded-xl border border-line bg-surface px-3 py-2
                       text-[13px] focus:border-brand-600 focus:outline-none"
          />

          <div className="flex gap-2">
            <label htmlFor="extra-section" className="sr-only">Which section</label>
            <select
              id="extra-section" name="extra-section" value={draft.section}
              onChange={(e) => setDraft({ ...draft, section: e.target.value })}
              className="min-w-0 flex-1 rounded-xl border border-line bg-surface px-3 py-2
                         text-[13px] focus:border-brand-600 focus:outline-none"
            >
              {/* Not "Objective" -- that section is one field, written above,
                  and an extra filed into it would be a second objective. */}
              {doc.section_order.filter((k: string) => k !== 'objective').map((key: string) => (
                <option key={key} value={key}>{RESUME_SECTION_LABELS[key] ?? key}</option>
              ))}
            </select>
            <button
              type="submit"
              disabled={pending || !draft.title.trim()}
              className="shrink-0 rounded-xl bg-brand-600 px-3.5 text-[13px] font-bold
                         text-white hover:bg-brand-700 disabled:opacity-50"
            >
              Add
            </button>
          </div>
        </form>
      </Group>

      <Group title="Order" hint={hints.order}>
        <p className="text-[12.5px] leading-relaxed text-muted">
          What a reader sees first. A section with nothing in it is not printed, so moving an
          empty one changes nothing until it fills.
        </p>
        {/*
          * Buttons, not drag-and-drop. Dragging needs a library and is a
          * keyboard-accessibility problem in its own right; two buttons with
          * real labels work with a mouse, a keyboard and a screen reader on the
          * first day, and this is a list of eight.
          */}
        <ol className="mt-3 space-y-1.5">
          {doc.section_order.map((key: string, i: number) => (
            <li key={key}
              className="flex items-center justify-between gap-2 rounded-xl border
                         border-line px-3 py-1.5 text-[13px]">
              <span className="text-ink">{RESUME_SECTION_LABELS[key] ?? key}</span>
              <span className="flex shrink-0 gap-1">
                <button
                  type="button" onClick={() => move(i, -1)}
                  disabled={pending || i === 0}
                  aria-label={'Move ' + (RESUME_SECTION_LABELS[key] ?? key) + ' up'}
                  className="rounded-lg p-1.5 text-muted hover:bg-brand-50 hover:text-ink
                             disabled:opacity-30"
                >
                  <Icon name="chevron" className="h-4 w-4 -rotate-90" />
                </button>
                <button
                  type="button" onClick={() => move(i, 1)}
                  disabled={pending || i === doc.section_order.length - 1}
                  aria-label={'Move ' + (RESUME_SECTION_LABELS[key] ?? key) + ' down'}
                  className="rounded-lg p-1.5 text-muted hover:bg-brand-50 hover:text-ink
                             disabled:opacity-30"
                >
                  <Icon name="chevron" className="h-4 w-4 rotate-90" />
                </button>
              </span>
            </li>
          ))}
        </ol>
      </Group>

      <Group title="Your phone number" hint={hints.phone}>
        <label className="flex items-start gap-2 text-[13px] leading-snug text-ink">
          <input
            type="checkbox"
            checked={phoneNow}
            onChange={(e) => save({ include_phone: e.target.checked },
              () => setPhoneNow(e.target.checked))}
            className="mt-0.5 h-4 w-4 shrink-0 rounded border-line
                       text-brand-600 focus:ring-brand-600"
          />
          <span>
            Show my phone number on the resume.
            {/* Said plainly, because the answer is not obvious and the
                consequence is that a number goes to strangers. */}
            <span className="block text-[12px] text-muted">
              Off by default. A resume is a document you email to people you have not met.
            </span>
            {/* The setting is on and there is nothing to show. Said here
                rather than left as a box that appears to have done nothing. */}
            {phoneNow && !doc.phone ? (
              <span className="block text-[12px] text-amber-700">
                There is no phone number on your profile yet, so nothing is being shown.
              </span>
            ) : null}
          </span>
        </label>
      </Group>

      {error ? (
        <p role="alert" className="text-[13px] text-red-700">{error}</p>
      ) : saved && !pending ? (
        <p aria-live="polite" className="flex items-center gap-1.5 text-[12.5px] text-muted">
          <Icon name="check" className="h-4 w-4" />
          Saved.
        </p>
      ) : null}
    </>
  );
}
