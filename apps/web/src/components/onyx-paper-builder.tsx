'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Icon } from '@/components/onyx-ui';
import { Modal } from '@/components/onyx-modal';

/**
 * ASS-01 -- composing a paper.
 *
 * What this replaces mattered more than it looked. `BuildAssessment` asked for
 * a title, a course, a duration, a window, three proctoring switches and a
 * list of `{bank, take}` rows -- then created the paper and published it in
 * the same click. Everything else the engine actually runs on was unreachable:
 * `instructions`, `attempts_allowed`, `pass_mark`, `anonymous_marking`,
 * `moderation_required` and both shuffle flags could not be set from any
 * screen in the product, despite each one changing how the paper behaves.
 * Section titles were auto-generated as "Section 1" and could not be edited,
 * sections could not be removed once added, and there was no way to leave a
 * draft or to look at the paper before candidates did.
 *
 * So this is a real composer: four steps, every setting the API accepts, and a
 * preview of an actual dealt paper before anything is published.
 *
 * Three deliberate choices worth stating:
 *
 *   * **Draft is the default exit.** "Save as draft" is the primary button and
 *     "Publish" sits behind the preview step. Publishing was previously
 *     automatic and irreversible-ish, which is a strange default for the one
 *     action that exposes a paper to candidates.
 *   * **The settings carry their consequence, not just their name.** A switch
 *     labelled "Anonymous marking" tells you nothing about what happens if you
 *     turn it off; the line under it does.
 *   * **It edits as well as creates.** A paper composed wrongly used to be
 *     unfixable -- the patch endpoint refused sections -- so the remedy was to
 *     abandon it and build another. Passing `existing` opens the same form on
 *     a draft.
 */

const input = 'mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm '
  + 'focus:border-brand-600 focus:outline-none';
const label = 'block text-[13px] font-semibold text-slate-700';

export interface BankOption { id: number; name: string; course_id: number | null }
export interface CourseOption { id: number; title: string }

interface Section { id: string; title: string; bank_id: number; take: number }

export interface ExistingPaper {
  id: number;
  title: string; course_id: number | null; instructions: string | null;
  opens_at: string | null; closes_at: string | null;
  duration_minutes: number; attempts_allowed: number; pass_mark: number | null;
  sections: Section[] | null;
  shuffle_questions: number | boolean; shuffle_options: number | boolean;
  proctoring: number | boolean; require_camera: number | boolean;
  require_screen: number | boolean; anonymous_marking: number | boolean;
  moderation_required: number | boolean;
}

const STEPS = ['Paper', 'Questions', 'Rules', 'Review'] as const;

/** `datetime-local` wants `YYYY-MM-DDTHH:mm`, not an ISO string with a zone. */
const forInput = (iso: string | null) => (iso ? iso.slice(0, 16) : '');
const toIso = (v: string) => (v ? new Date(v).toISOString() : null);
const on = (v: number | boolean | undefined) => v === true || v === 1;

export function PaperBuilder({ banks, courses, existing, label: cta }: {
  banks: BankOption[]; courses: CourseOption[];
  existing?: ExistingPaper; label?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [stepAt, setStepAt] = useState(0);
  /**
   * The paper this composer has already created, if it has.
   *
   * Previewing has to SAVE first -- the preview is drawn by the server from a
   * real paper -- so by the time anybody reaches the last step there is a
   * draft with an id. Without remembering it, "Publish to candidates" posted a
   * second paper and published that one, leaving the preview's draft behind as
   * an orphan. Every paper composed through here littered one.
   */
  const [createdId, setCreatedId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [preview, setPreview] = useState<{
    questions: { prompt: string; type: string; points: number;
      options: { id: string; text: string }[] }[];
    total_points: number; shuffled: boolean;
  } | null>(null);

  const [form, setForm] = useState({
    title: existing?.title ?? '',
    course_id: existing?.course_id ? String(existing.course_id) : '',
    instructions: existing?.instructions ?? '',
    opens_at: forInput(existing?.opens_at ?? null),
    closes_at: forInput(existing?.closes_at ?? null),
    duration_minutes: existing?.duration_minutes ?? 60,
    attempts_allowed: existing?.attempts_allowed ?? 1,
    pass_mark: existing?.pass_mark ?? null as number | null,
    shuffle_questions: existing ? on(existing.shuffle_questions) : true,
    shuffle_options: existing ? on(existing.shuffle_options) : true,
    proctoring: existing ? on(existing.proctoring) : false,
    require_camera: existing ? on(existing.require_camera) : false,
    require_screen: existing ? on(existing.require_screen) : false,
    anonymous_marking: existing ? on(existing.anonymous_marking) : true,
    moderation_required: existing ? on(existing.moderation_required) : false,
  });
  const [sections, setSections] = useState<Section[]>(
    existing?.sections?.length
      ? existing.sections
      : [{ id: 's1', title: 'Section 1', bank_id: banks[0]?.id ?? 0, take: 5 }]);

  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  function close() {
    setOpen(false); setStepAt(0); setError(null); setPreview(null);
    // Forgotten on the way out, or the next paper composed without a reload
    // would overwrite the last one instead of being its own.
    setCreatedId(null);
  }

  const addSection = () => setSections((s) => [...s, {
    // Ids must be unique and stable; the index is not enough once a middle
    // section has been removed.
    id: 's' + (Math.max(0, ...s.map((x) => Number(String(x.id).replace(/\D/g, '')) || 0)) + 1),
    title: 'Section ' + (s.length + 1),
    bank_id: banks[0]?.id ?? 0,
    take: 5,
  }]);
  const editSection = (i: number, patch: Partial<Section>) =>
    setSections((s) => s.map((x, n) => (n === i ? { ...x, ...patch } : x)));
  const removeSection = (i: number) => setSections((s) => s.filter((_, n) => n !== i));
  const move = (i: number, by: number) => setSections((s) => {
    const to = i + by;
    if (to < 0 || to >= s.length) return s;
    const out = [...s];
    [out[i], out[to]] = [out[to]!, out[i]!];
    return out;
  });

  function payload() {
    return {
      title: form.title,
      course_id: form.course_id ? Number(form.course_id) : null,
      instructions: form.instructions || null,
      opens_at: toIso(form.opens_at),
      closes_at: toIso(form.closes_at),
      duration_minutes: Number(form.duration_minutes),
      attempts_allowed: Number(form.attempts_allowed),
      pass_mark: form.pass_mark === null || String(form.pass_mark) === ''
        ? null : Number(form.pass_mark),
      sections: sections.map((s) => ({ ...s, bank_id: Number(s.bank_id), take: Number(s.take) })),
      shuffle_questions: form.shuffle_questions,
      shuffle_options: form.shuffle_options,
      proctoring: form.proctoring,
      require_camera: form.require_camera,
      require_screen: form.require_screen,
      anonymous_marking: form.anonymous_marking,
      moderation_required: form.moderation_required,
    };
  }

  async function send(path: string, body?: unknown, method = 'POST') {
    const res = await fetch('/api/proxy/onyx/' + path, {
      method,
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return res.json().catch(() => ({ ok: false, message: 'Something went wrong.' }));
  }

  /** Save, then optionally publish. Returns the paper id, or null on failure. */
  async function save(publish: boolean): Promise<number | null> {
    setError(null);
    const body = payload();
    // Editing an existing paper, or re-saving the one this composer already
    // created a moment ago on the way to the preview. Either way it is a
    // PATCH; only the first save of a brand-new paper is a POST.
    const targetId = existing ? existing.id : createdId;
    const saved = targetId
      ? await send('assessments/' + targetId, body, 'PATCH')
      : await send('assessments', body);
    if (!saved.ok) {
      const detail = saved.errors
        ? Object.entries(saved.errors)
          .map(([k, v]) => `${k}: ${(v as string[]).join(', ')}`).join(' · ')
        : '';
      setError([saved.message, detail].filter(Boolean).join(' — '));
      return null;
    }
    const id = targetId ?? Number(saved.data.id);
    // Remembered before publishing, so a failed publish followed by a retry
    // updates this paper rather than creating another.
    if (targetId === null) setCreatedId(id);
    if (publish) {
      const done = await send('assessments/' + id + '/publish');
      if (!done.ok) { setError(done.message ?? 'Saved as a draft, but not published.'); return null; }
    }
    return id;
  }

  async function loadPreview() {
    setError(null);
    const id = await save(false);
    if (id === null) return;
    const got = await send('assessments/' + id + '/preview', undefined, 'GET');
    if (!got.ok) { setError(got.message ?? 'Could not draw a preview.'); return; }
    setPreview(got.data);
    setStepAt(3);
  }

  const totalDrawn = sections.reduce((n, s) => n + Number(s.take || 0), 0);
  const canAdvance = stepAt === 0
    ? form.title.trim().length > 0
    : stepAt === 1
      ? sections.length > 0 && sections.every((s) => s.bank_id && Number(s.take) > 0)
      : true;

  return (
    <>
      <button type="button" onClick={() => setOpen(true)}
        className="inline-flex w-fit shrink-0 items-center gap-2 self-start justify-self-start
                   rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white
                   hover:bg-brand-700">
        <Icon name="edit" className="h-4 w-4" />
        {cta ?? (existing ? 'Edit this paper' : 'Create a paper')}
      </button>

      {open ? (
        <Modal title={existing ? 'Edit "' + existing.title + '"' : 'Create a paper'} onClose={close}>
          {/* The steps are shown as a path, not a progress bar: which one you
              are on, and what is still to come. */}
          <ol className="mb-4 flex flex-wrap items-center gap-1.5 text-[12.5px]">
            {STEPS.map((s, i) => (
              <li key={s} className="flex items-center gap-1.5">
                <button type="button"
                  onClick={() => (i < stepAt ? setStepAt(i) : undefined)}
                  className={'rounded-full px-2.5 py-1 font-semibold '
                    + (i === stepAt ? 'bg-brand-600 text-white'
                      : i < stepAt ? 'bg-brand-50 text-brand-700 hover:bg-brand-100'
                        : 'bg-slate-100 text-muted')}>
                  {i + 1}. {s}
                </button>
                {i < STEPS.length - 1
                  ? <Icon name="chevron" className="h-3.5 w-3.5 text-muted" /> : null}
              </li>
            ))}
          </ol>

          {/* ---------------------------------------------------- 1. Paper */}
          {stepAt === 0 ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className={label} htmlFor="p-title">Title</label>
                <input id="p-title" className={input} value={form.title} required
                  placeholder="Mid-term class test"
                  onChange={(e) => set('title', e.target.value)} />
              </div>
              <div>
                <label className={label} htmlFor="p-course">Course</label>
                <select id="p-course" className={input} value={form.course_id}
                  onChange={(e) => set('course_id', e.target.value)}>
                  <option value="">No course — institution-wide</option>
                  {courses.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
                </select>
                <p className="mt-1 text-xs text-muted">
                  A paper on a course is limited to people enrolled on it.
                </p>
              </div>
              <div>
                <label className={label} htmlFor="p-duration">Duration (minutes)</label>
                <input id="p-duration" type="number" min={1} max={1440} className={input}
                  value={form.duration_minutes}
                  onChange={(e) => set('duration_minutes', Number(e.target.value))} />
              </div>
              <div>
                <label className={label} htmlFor="p-opens">Opens</label>
                <input id="p-opens" type="datetime-local" className={input}
                  value={form.opens_at} onChange={(e) => set('opens_at', e.target.value)} />
              </div>
              <div>
                <label className={label} htmlFor="p-closes">Closes</label>
                <input id="p-closes" type="datetime-local" className={input}
                  value={form.closes_at} onChange={(e) => set('closes_at', e.target.value)} />
              </div>
              <div className="sm:col-span-2">
                <label className={label} htmlFor="p-instructions">
                  Instructions to candidates
                </label>
                <textarea id="p-instructions" rows={3} className={input}
                  value={form.instructions}
                  placeholder="Answer every question. Marks are shown beside each one."
                  onChange={(e) => set('instructions', e.target.value)} />
                <p className="mt-1 text-xs text-muted">
                  Shown on the page before Start, where somebody will actually read it.
                </p>
              </div>
            </div>
          ) : null}

          {/* ------------------------------------------------ 2. Questions */}
          {stepAt === 1 ? (
            <div className="space-y-3">
              <p className="text-[13px] text-muted">
                A paper draws its questions from banks when a candidate starts, so
                two people rarely get the same paper. Each section says which bank
                and how many.
              </p>

              {banks.length === 0 ? (
                <p role="alert" className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900">
                  There are no question banks yet. Create one and add questions to
                  it before composing a paper.
                </p>
              ) : null}

              {sections.map((s, i) => (
                <div key={s.id} className="rounded-xl border border-line bg-canvas p-3">
                  <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
                    <div>
                      <label className={label} htmlFor={'sec-t-' + s.id}>Section name</label>
                      <input id={'sec-t-' + s.id} className={input} value={s.title}
                        onChange={(e) => editSection(i, { title: e.target.value })} />
                    </div>
                    <div>
                      <label className={label} htmlFor={'sec-b-' + s.id}>Draw from</label>
                      <select id={'sec-b-' + s.id} className={input} value={s.bank_id}
                        onChange={(e) => editSection(i, { bank_id: Number(e.target.value) })}>
                        {banks.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                      </select>
                    </div>
                    <div className="w-28">
                      <label className={label} htmlFor={'sec-n-' + s.id}>Questions</label>
                      <input id={'sec-n-' + s.id} type="number" min={1} max={500} className={input}
                        value={s.take}
                        onChange={(e) => editSection(i, { take: Number(e.target.value) })} />
                    </div>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <button type="button" onClick={() => move(i, -1)} disabled={i === 0}
                      className="rounded-lg border border-line px-2 py-1 text-[12px] font-semibold
                                 disabled:opacity-40">
                      Move up
                    </button>
                    <button type="button" onClick={() => move(i, 1)}
                      disabled={i === sections.length - 1}
                      className="rounded-lg border border-line px-2 py-1 text-[12px] font-semibold
                                 disabled:opacity-40">
                      Move down
                    </button>
                    {/* Removing the last section would leave a paper that
                        cannot be published, so the button goes rather than
                        failing at the end. */}
                    {sections.length > 1 ? (
                      <button type="button" onClick={() => removeSection(i)}
                        className="rounded-lg border border-rose-200 px-2 py-1 text-[12px]
                                   font-semibold text-rose-700 hover:bg-rose-50">
                        Remove
                      </button>
                    ) : null}
                  </div>
                </div>
              ))}

              <div className="flex flex-wrap items-center justify-between gap-2">
                <button type="button" onClick={addSection} disabled={!banks.length}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-line
                             px-3 py-2 text-[13px] font-semibold disabled:opacity-50">
                  <Icon name="plus" className="h-4 w-4" /> Add a section
                </button>
                <span className="text-[13px] font-semibold text-muted">
                  {totalDrawn} question{totalDrawn === 1 ? '' : 's'} per candidate
                </span>
              </div>
            </div>
          ) : null}

          {/* ---------------------------------------------------- 3. Rules */}
          {stepAt === 2 ? (
            <div className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className={label} htmlFor="p-attempts">Attempts allowed</label>
                  <input id="p-attempts" type="number" min={1} max={20} className={input}
                    value={form.attempts_allowed}
                    onChange={(e) => set('attempts_allowed', Number(e.target.value))} />
                </div>
                <div>
                  <label className={label} htmlFor="p-pass">Pass mark</label>
                  <input id="p-pass" type="number" min={0} className={input}
                    value={form.pass_mark ?? ''} placeholder="No pass mark"
                    onChange={(e) => set('pass_mark',
                      e.target.value === '' ? null : Number(e.target.value))} />
                </div>
              </div>

              <Switches form={form} set={set} />
            </div>
          ) : null}

          {/* --------------------------------------------------- 4. Review */}
          {stepAt === 3 ? (
            <div className="space-y-3">
              {preview ? (
                <>
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="text-[13px] font-semibold">
                      {preview.questions.length} question
                      {preview.questions.length === 1 ? '' : 's'} · {preview.total_points} marks
                    </p>
                    {preview.shuffled ? (
                      <p className="text-[12.5px] text-muted">
                        One possible draw — shuffling is on, so candidates differ.
                      </p>
                    ) : null}
                  </div>
                  <ol className="space-y-2">
                    {preview.questions.map((q, i) => (
                      <li key={i} className="rounded-xl border border-line bg-white p-3">
                        <div className="flex items-start justify-between gap-3">
                          <p className="min-w-0 flex-1 text-sm font-semibold">
                            {i + 1}. {q.prompt}
                          </p>
                          <span className="shrink-0 text-[12.5px] tabular-nums text-muted">
                            {q.points} {q.points === 1 ? 'mark' : 'marks'}
                          </span>
                        </div>
                        {q.options?.length ? (
                          <ul className="mt-1.5 space-y-0.5 text-[13px] text-muted">
                            {q.options.map((o) => (
                              <li key={o.id}>{o.id}. {o.text}</li>
                            ))}
                          </ul>
                        ) : (
                          <p className="mt-1 text-[12.5px] italic text-muted">
                            {q.type === 'essay' ? 'Written answer' : 'Typed answer'}
                          </p>
                        )}
                      </li>
                    ))}
                  </ol>
                </>
              ) : (
                <p className="text-[13px] text-muted">Drawing a sample paper…</p>
              )}
            </div>
          ) : null}

          {error ? (
            <p role="alert" className="mt-3 rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">
              {error}
            </p>
          ) : null}

          <div className="mt-4 flex flex-wrap gap-2 border-t border-line pt-4">
            {stepAt > 0 ? (
              <button type="button" onClick={() => setStepAt(stepAt - 1)}
                className="rounded-xl border border-line px-4 py-2.5 text-sm font-semibold">
                Back
              </button>
            ) : null}

            {stepAt < 2 ? (
              <button type="button" disabled={!canAdvance} onClick={() => setStepAt(stepAt + 1)}
                className="rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-bold text-white
                           hover:bg-brand-700 disabled:opacity-50">
                Next
              </button>
            ) : null}

            {stepAt === 2 ? (
              <button type="button" disabled={pending}
                onClick={() => start(async () => { await loadPreview(); })}
                className="rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-bold text-white
                           hover:bg-brand-700 disabled:opacity-60">
                {pending ? 'Saving…' : 'Preview the paper'}
              </button>
            ) : null}

            {/* Draft is the primary exit. Publishing is the one action that
                puts a paper in front of candidates, so it is deliberate. */}
            <button type="button" disabled={pending}
              onClick={() => start(async () => {
                const id = await save(false);
                if (id !== null) { close(); router.refresh(); }
              })}
              className="rounded-xl border border-line px-4 py-2.5 text-sm font-semibold
                         disabled:opacity-60">
              Save as draft
            </button>

            {stepAt === 3 ? (
              <button type="button" disabled={pending}
                onClick={() => start(async () => {
                  const id = await save(true);
                  if (id !== null) { close(); router.refresh(); }
                })}
                className="rounded-xl bg-green-700 px-4 py-2.5 text-sm font-bold text-white
                           hover:bg-green-800 disabled:opacity-60">
                {pending ? 'Publishing…' : 'Publish to candidates'}
              </button>
            ) : null}

            <button type="button" onClick={close}
              className="ml-auto rounded-xl px-4 py-2.5 text-sm font-semibold text-muted">
              Cancel
            </button>
          </div>
        </Modal>
      ) : null}
    </>
  );
}

/**
 * The switches, with what each one actually does.
 *
 * Every one of these was previously unreachable from any screen while quietly
 * governing real behaviour -- a marker seeing names or not, a paper needing a
 * second opinion before results go out. A label alone does not tell an author
 * what turning it off costs, so each carries its consequence.
 */
function Switches({ form, set }: {
  form: Record<string, unknown>;
  set: (k: never, v: never) => void;
}) {
  const items = [
    { k: 'shuffle_questions', title: 'Shuffle the questions',
      note: 'Each candidate gets them in a different order.' },
    { k: 'shuffle_options', title: 'Shuffle the options',
      note: 'Answer positions differ, so "it was the third one" does not travel.' },
    { k: 'anonymous_marking', title: 'Mark anonymously',
      note: 'The marker sees "Candidate 1", not a name. Turn this off and papers '
        + 'are marked with names showing.' },
    { k: 'moderation_required', title: 'Require moderation',
      note: 'Results cannot be published until every attempt has a moderator’s mark.' },
    { k: 'proctoring', title: 'Monitor the sitting',
      note: 'Records events — tab switches, pastes — and asks for consent first. '
        + 'No video is stored.' },
    { k: 'require_camera', title: 'Require a camera', note: 'Only applies when monitoring is on.' },
    { k: 'require_screen', title: 'Require screen sharing', note: 'Only applies when monitoring is on.' },
  ] as const;

  return (
    <div className="divide-y divide-line rounded-xl border border-line">
      {items.map((it) => {
        // The two device switches do nothing unless monitoring is on, so they
        // say so and disable rather than silently having no effect.
        const dependent = it.k === 'require_camera' || it.k === 'require_screen';
        const disabled = dependent && !form.proctoring;
        return (
          <label key={it.k}
            className={'flex items-start gap-3 p-3 ' + (disabled ? 'opacity-50' : '')}>
            <input type="checkbox" className="mt-0.5 h-4 w-4 rounded border-slate-300"
              checked={Boolean(form[it.k])} disabled={disabled}
              onChange={(e) => set(it.k as never, e.target.checked as never)} />
            <span className="min-w-0 flex-1">
              <span className="block text-[13px] font-semibold text-slate-700">{it.title}</span>
              <span className="mt-0.5 block text-xs text-muted">{it.note}</span>
            </span>
          </label>
        );
      })}
    </div>
  );
}
