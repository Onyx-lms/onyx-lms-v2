'use client';

import { useOptimistic, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Card, Icon, SectionHead } from '@/components/onyx-ui';
import { RESUME_SECTION_LABELS, type ResumeDoc } from '@/lib/onyx-resume';

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
export function ResumeEditor({ doc }: { doc: ResumeDoc }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [objective, setObjective] = useState(doc.objective);
  const [saved, setSaved] = useState(false);

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

  return (
    <>
      <Card>
        <SectionHead title="Objective" />
        <p className="mt-1 text-[12.5px] leading-relaxed text-muted">
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
      </Card>

      <Card>
        <SectionHead title="What to include" />
        <p className="mt-1 text-[12.5px] leading-relaxed text-muted">
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
      </Card>

      <Card>
        <SectionHead title="Your phone number" />
        <label className="mt-2 flex items-start gap-2 text-[13px] leading-snug text-ink">
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
      </Card>

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
