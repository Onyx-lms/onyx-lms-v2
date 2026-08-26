'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  ProblemDraftFields, blankProblemDraft, createProblemFromDraft, problemDraftError,
  type ProblemDraft,
} from '@/components/onyx-code-problem';
import { Icon } from '@/components/onyx-ui';

/**
 * A question bank of parallel SETS, which is how an examination is really set.
 *
 * **What this replaces, and why.** The button used to say "Create a paper", and
 * it made one: a title, a window, and a pile of questions drawn from at random
 * per candidate. That is not how anybody sets an examination. A setter writes
 * Set 1, Set 2, Set 3 — each a whole paper of the same shape, each of
 * comparable difficulty — and the sets rotate down the register so that
 * neighbours never hold the same one. Roll 1 sits Set 1, roll 2 sits Set 2,
 * roll 11 comes back round to Set 1, out of arm's reach.
 *
 * Random sampling could not express that. It gave variety and no guarantee —
 * two independent draws of five from thirty overlap about six times in ten —
 * and, worse, it took the sets away from the person whose judgement they are:
 * two papers are parallel when a setter says they are, not when a shuffle
 * happens to produce them.
 *
 * So this builds the BANK, and the bank is what an examination is scheduled
 * from. One bank, many sets, and the engine deals each candidate the set their
 * roll number lands on.
 *
 * The set is the unit on screen for the same reason it is the unit in the
 * database: a setter works one paper at a time, checking it is complete, before
 * starting the next.
 */

export type BankQuestionType =
  'single' | 'multiple' | 'truefalse' | 'short' | 'essay' | 'code' | 'web';

const TYPES: { value: BankQuestionType; label: string }[] = [
  { value: 'single', label: 'Multiple choice — one answer' },
  { value: 'multiple', label: 'Multiple choice — several answers' },
  { value: 'truefalse', label: 'True or false' },
  { value: 'short', label: 'Short answer (matched against a list)' },
  { value: 'essay', label: 'Descriptive (marked by hand)' },
  { value: 'code', label: 'Write code (marked by running tests)' },
  { value: 'web', label: 'Build a web page (HTML, CSS and JavaScript)' },
];

const CHOICE: BankQuestionType[] = ['single', 'multiple'];
const OPTION_IDS = ['a', 'b', 'c', 'd'] as const;

/** "Write the problem here" — the fallback is the picker, not the front door. */
const NEW_PROBLEM = '__new__';

interface Draft {
  type: BankQuestionType;
  prompt: string;
  points: string;
  options: string[];
  correct: string;
  correctMany: string[];
  accepted: string;
  problemId: string;
  /**
   * The web draft, kept beside the code one rather than replacing it.
   *
   * Somebody trying "code", typing a statement, then switching to "web" should
   * not have their work quietly converted into a starter page -- and switching
   * back should find the code problem as they left it. Two drafts, one shown.
   */
  webProblemId: string;
  webProblem: ProblemDraft;
  problem: ProblemDraft;
  manualOnly: boolean;
}

const blank = (): Draft => ({
  type: 'single', prompt: '', points: '2',
  options: ['', '', '', ''], correct: '', correctMany: [], accepted: '',
  problemId: NEW_PROBLEM, problem: blankProblemDraft('code'),
  webProblemId: NEW_PROBLEM, webProblem: blankProblemDraft('web'),
  manualOnly: false,
});

interface SetDraft { questions: Draft[] }

/*
 * No width in here, deliberately.
 *
 * This baked in `w-full`, so the one control that wanted to be small --
 * `field + ' w-16'` on Marks -- emitted `w-full` and `w-16` together. Tailwind
 * decides that by the order it happens to write the two rules, not by the
 * order they are concatenated, and `w-full` won: a box for a number between 1
 * and 1000 stretched the whole width of the composer and pushed the question
 * itself onto the next line. `onyx-manage.tsx` has always kept width out of
 * its `input` for exactly this reason.
 *
 * So width is now the caller's, always stated, and two widths can never fight.
 */
const field = 'rounded-xl border border-line bg-white px-3 py-2 text-[13px] '
  + 'focus:border-brand-500 focus:outline-none';
const label = 'block text-[12.5px] font-semibold text-slate-700';
const button = 'rounded-xl bg-brand-600 px-4 py-2 text-[13.5px] font-bold text-white '
  + 'hover:bg-brand-700 disabled:opacity-60';
const quiet = 'rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-[13px] '
  + 'font-semibold hover:bg-slate-50 disabled:opacity-60';

export function BankComposer({
  basePath, courses, problems = [], onDone, singleSetOption = false, noun = 'examination',
}: {
  /** `onyx/banks` for an institution, or the console's tenant-scoped path. */
  basePath: string;
  courses: { id: number; label: string }[];
  problems?: { id: number; title: string; status: string; kind?: string }[];
  /** Where to go when it is built. Defaults to refreshing the page. */
  onDone?: (bankId: number) => void;
  /**
   * Offer "one set" as a first-class choice, and start on it.
   *
   * An assessment is usually a class test everybody sits together off one
   * paper, and forcing the set machinery on that is ceremony for nothing: a
   * one-set bank is dealt to everybody identically, which is exactly the old
   * behaviour and the right default there. An examination is the other way
   * round — parallel sets are the point — so it starts on sets and does not
   * offer the switch at all.
   */
  singleSetOption?: boolean;
  /** What this bank will be used for, in the prose. */
  noun?: 'examination' | 'assessment';
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [courseId, setCourseId] = useState(courses[0] ? String(courses[0].id) : '');
  const [sets, setSets] = useState<SetDraft[]>([{ questions: [blank()] }]);
  const [active, setActive] = useState(0);
  /** Whether this bank is parallel sets or one paper everybody sits. */
  const [multi, setMulti] = useState(!singleSetOption);
  const [error, setError] = useState<string | null>(null);
  const [stage, setStage] = useState<string | null>(null);
  const [pending, start] = useTransition();

  // Published, and split by what they are: binding a web question to a code
  // problem would put a Python starter in three HTML tabs, and the API refuses
  // it -- so the picker never offers it.
  const published = problems.filter((p) => String(p.status) === 'published');
  const usableProblems = published.filter((p) => (p.kind ?? 'code') !== 'web');
  const webProblems = published.filter((p) => p.kind === 'web');
  const set = sets[active] ?? sets[0]!;

  const patchQuestion = (i: number, patch: Partial<Draft>) =>
    setSets((all) => all.map((sx, si) => (si !== active ? sx : {
      questions: sx.questions.map((q, qi) => (qi === i ? { ...q, ...patch } : q)),
    })));
  const setOption = (i: number, oi: number, text: string) =>
    setSets((all) => all.map((sx, si) => (si !== active ? sx : {
      questions: sx.questions.map((q, qi) => (qi !== i ? q : {
        ...q, options: q.options.map((o, k) => (k === oi ? text : o)),
      })),
    })));

  /** A new set starts as a copy of the current one's SHAPE, not its content. */
  const addSet = () => {
    const shape = (sets[active]?.questions ?? []).map((q) => ({
      ...blank(), type: q.type, points: q.points,
    }));
    setSets((all) => [...all, { questions: shape.length ? shape : [blank()] }]);
    setActive(sets.length);
  };

  /**
   * Switching back to one paper KEEPS Set 1 and drops the rest, rather than
   * hiding them and writing them anyway. A set that is not on screen must not
   * end up in the bank.
   */
  const chooseSingle = () => {
    setMulti(false);
    setSets((all) => all.slice(0, 1));
    setActive(0);
  };

  const written = (q: Draft) => q.prompt.trim() !== '';
  const setSize = (sx: SetDraft) => sx.questions.filter(written).length;
  const setMarks = (sx: SetDraft) => sx.questions.filter(written)
    .reduce((n, q) => n + (Number(q.points) || 0), 0);

  /** Every set the same size, which is what makes them parallel. */
  const sizes = [...new Set(sets.map(setSize))];
  const uneven = sizes.length > 1;

  function faultIn(q: Draft, where: string): string | null {
    const short = '“' + q.prompt.slice(0, 40) + '…”';
    if (CHOICE.includes(q.type)) {
      const opts = q.options.filter((o) => o.trim() !== '');
      if (opts.length < 2) return where + ': ' + short + ' needs at least two options.';
      if (!q.manualOnly && q.type === 'single' && !q.correct) {
        return where + ': ' + short + ' — mark which option is correct.';
      }
      if (!q.manualOnly && q.type === 'multiple' && !q.correctMany.length) {
        return where + ': ' + short + ' — tick every option that is correct.';
      }
    }
    if (q.type === 'truefalse' && !q.manualOnly && !q.correct) {
      return where + ': ' + short + ' — say whether it is true or false.';
    }
    if (q.type === 'short' && !q.manualOnly && !q.accepted.trim()) {
      return where + ': ' + short + ' — list at least one accepted answer.';
    }
    if (q.type === 'code') {
      if (!q.problemId) return where + ': ' + short + ' needs a problem to be marked against.';
      if (q.problemId === NEW_PROBLEM) {
        const wrong = problemDraftError(q.problem);
        if (wrong) return where + ': ' + short + ' — ' + wrong;
      }
    }
    if (q.type === 'web') {
      if (!q.webProblemId) return where + ': ' + short + ' needs a page to build from.';
      if (q.webProblemId === NEW_PROBLEM) {
        const wrong = problemDraftError(q.webProblem);
        if (wrong) return where + ': ' + short + ' — ' + wrong;
      }
    }
    return null;
  }

  const submit = () => start(async () => {
    setError(null);
    if (!name.trim()) { setError('The bank needs a name.'); return; }
    if (!courseId) { setError('Pick a course.'); return; }

    /*
     * Everything checked BEFORE anything is written.
     *
     * The first write creates a bank; a refusal halfway through would leave one
     * behind holding half a set, and a setter would have to find and delete it
     * before trying again.
     */
    for (const [si, sx] of sets.entries()) {
      const where = multi ? 'Set ' + (si + 1) : 'This paper';
      const live = sx.questions.filter(written);
      if (!live.length) { setError(where + ' has no questions in it.'); return; }
      for (const q of live) {
        const fault = faultIn(q, where);
        if (fault) { setError(fault); setActive(si); return; }
      }
    }

    const send = async (path: string, body?: unknown, method = 'POST') => {
      const res = await fetch('/api/proxy/' + path, {
        method,
        headers: { 'Content-Type': 'application/json' },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
      return await res.json().catch(() => ({ ok: false })) as
        { ok: boolean; message?: string; data?: Record<string, unknown> };
    };

    /*
     * Problems first, before the bank.
     *
     * A coding question binds to a Code Lab problem, and only a PUBLISHED one
     * can mark anything. Doing them first means a refusal costs nothing: the
     * only rows written by then are problems, which are worth keeping on their
     * own. The reverse order leaves an empty bank behind every failed attempt.
     */
    const authored = new Map<string, number>();
    for (const [si, sx] of sets.entries()) {
      for (const [qi, q] of sx.questions.entries()) {
        const drafting = q.type === 'code'
          ? (q.problemId === NEW_PROBLEM ? q.problem : null)
          : q.type === 'web'
            ? (q.webProblemId === NEW_PROBLEM ? q.webProblem : null)
            : null;
        if (!written(q) || !drafting) continue;
        setStage('Set ' + (si + 1) + ': creating the problem for question ' + (qi + 1) + '…');
        const made = await createProblemFromDraft(send, basePath.replace(/banks$/, 'problems'),
          drafting);
        if ('error' in made) {
          setStage(null);
          setError('Set ' + (si + 1) + ', question ' + (qi + 1) + ': ' + made.error);
          setActive(si);
          return;
        }
        authored.set(si + ':' + qi, made.id);
      }
    }

    setStage('Making the bank…');
    const bank = await send(basePath, { name: name.trim(), course_id: Number(courseId) });
    if (!bank.ok || !bank.data?.id) {
      setStage(null);
      setError(bank.message ?? 'Could not create the bank.');
      return;
    }
    const bankId = Number(bank.data.id);

    for (const [si, sx] of sets.entries()) {
      const live = sx.questions.map((q, qi) => ({ q, qi })).filter((x) => written(x.q));
      for (const [n, { q, qi }] of live.entries()) {
        setStage('Set ' + (si + 1) + ': adding question ' + (n + 1) + ' of ' + live.length + '…');
        const opts = q.options.map((o, oi) => ({ id: OPTION_IDS[oi]!, text: o.trim() }))
          .filter((o) => o.text !== '');
        const base = {
          set_number: si + 1,
          type: q.type,
          prompt: q.prompt.trim(),
          points: Number(q.points) || 1,
        };
        // No key at all when marked by hand: the API leaves such a question for
        // a person rather than grading every answer wrong against a blank key.
        const body = q.type === 'single'
          ? { ...base, options: opts, answer: q.manualOnly ? undefined : q.correct }
          : q.type === 'multiple'
            ? { ...base, options: opts, answer: q.manualOnly ? undefined : q.correctMany }
            : q.type === 'truefalse'
              ? { ...base, answer: q.manualOnly ? undefined : q.correct }
              : q.type === 'short'
                ? {
                  ...base,
                  answer: q.manualOnly ? undefined : q.accepted.split('\n')
                    .map((a) => a.trim()).filter(Boolean),
                }
                : q.type === 'code'
                  ? {
                    ...base,
                    problem_id: authored.get(si + ':' + qi) ?? Number(q.problemId),
                  }
                  : q.type === 'web'
                    ? {
                      ...base,
                      problem_id: authored.get(si + ':' + qi) ?? Number(q.webProblemId),
                    }
                    : base;

        const made = await send(basePath + '/' + bankId + '/questions', body);
        if (!made.ok) {
          setStage(null);
          setError('Set ' + (si + 1) + ', question ' + (n + 1) + ': '
            + (made.message ?? 'could not be added.'));
          setActive(si);
          return;
        }
      }
    }

    setStage(null);
    setOpen(false);
    setName('');
    setSets([{ questions: [blank()] }]);
    setActive(0);
    setMulti(!singleSetOption);
    if (onDone) onDone(bankId);
    else router.refresh();
  });

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className={button}>
        <span className="inline-flex items-center gap-2">
          <Icon name="layers" className="h-4 w-4" />
          Create a question bank
        </span>
      </button>
    );
  }

  return (
    <div className="rounded-2xl border border-line bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-[15px] font-extrabold text-ink">New question bank</h3>
          <p className="mt-0.5 max-w-2xl text-[12.5px] leading-relaxed text-muted">
            {multi ? (
              <>
                A bank holds parallel sets — Set 1, Set 2, and so on — each a whole paper of
                the same shape. When an {noun} is scheduled from this bank, the sets rotate
                down the register: roll 1 sits Set 1, roll 2 sits Set 2, and roll 11 comes
                back round to Set 1, so nobody within reach sits the same paper.
              </>
            ) : (
              <>
                One paper, sat by everybody. Write the questions once and every candidate on
                this {noun} is dealt the same ones, in the order set here.
              </>
            )}
          </p>
        </div>
        <button type="button" onClick={() => setOpen(false)} className={quiet}>Cancel</button>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div>
          <label className={label} htmlFor="bc-name">Bank name</label>
          <input id="bc-name" value={name} maxLength={200} className={field + ' mt-1 w-full'}
            placeholder="Python — mid-term, ten sets"
            onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label className={label} htmlFor="bc-course">Course</label>
          <select id="bc-course" value={courseId} className={field + ' mt-1 w-full'}
            onChange={(e) => setCourseId(e.target.value)}>
            {courses.length === 0 ? <option value="">No courses</option> : null}
            {courses.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        </div>
      </div>

      {/* The choice, where it changes what the rest of the form is. Offered
          only for assessments: an examination is parallel sets by definition. */}
      {singleSetOption ? (
        <fieldset className="mt-4 rounded-xl border border-line p-3">
          <legend className="px-1 text-[12.5px] font-semibold text-slate-700">
            How this bank is sat
          </legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {[
              {
                on: !multi,
                pick: chooseSingle,
                title: 'One paper',
                body: 'Everybody sits the same questions. The usual shape for a class test.',
              },
              {
                on: multi,
                pick: () => setMulti(true),
                title: 'Parallel sets',
                body: 'Set 1, Set 2, … rotate down the register, so neighbours differ.',
              },
            ].map((choice) => (
              <label key={choice.title}
                className={'flex cursor-pointer gap-2.5 rounded-xl border p-2.5 text-left '
                  + (choice.on
                    ? 'border-brand-500 bg-brand-50/60'
                    : 'border-line bg-white hover:bg-slate-50')}>
                <input type="radio" name="bc-shape" checked={choice.on} className="mt-0.5"
                  onChange={choice.pick} />
                <span className="min-w-0">
                  <span className="block text-[13px] font-bold text-ink">{choice.title}</span>
                  <span className="block text-[12px] leading-relaxed text-muted">
                    {choice.body}
                  </span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}

      {/* The sets, as tabs. A setter works one paper at a time. */}
      <div className={'mt-4 flex flex-wrap items-center gap-1.5 border-b border-line pb-2 '
        + (multi ? '' : 'hidden')}>
        {sets.map((sx, si) => (
          <button
            key={si} type="button" onClick={() => setActive(si)}
            aria-current={si === active ? 'true' : undefined}
            className={'rounded-lg px-3 py-1.5 text-[12.5px] font-semibold '
              + (si === active
                ? 'bg-brand-600 text-white'
                : 'border border-line bg-white text-slate-700 hover:bg-brand-50')}
          >
            Set {si + 1}
            <span className={'ml-1.5 tabular-nums '
              + (si === active ? 'text-white/80' : 'text-muted')}>
              {setSize(sx)}
            </span>
          </button>
        ))}
        <button type="button" onClick={addSet} className={quiet + ' ml-1'}>
          + Add a set
        </button>
        {sets.length > 1 ? (
          <button
            type="button"
            className={quiet + ' text-red-700'}
            onClick={() => {
              setSets((all) => all.filter((_, si) => si !== active));
              setActive((a) => Math.max(0, a - 1));
            }}
          >
            Remove Set {active + 1}
          </button>
        ) : null}
      </div>

      {/* Said where it can be acted on. Sets of different sizes are not
          parallel papers, and the candidate on the short one is the one who
          notices. */}
      {uneven ? (
        <p className="mt-2 rounded-xl bg-amber-50 px-3 py-2 text-[12.5px] leading-relaxed
                      text-amber-900">
          These sets are different sizes ({sizes.sort((a, b) => a - b).join(', ')} questions).
          Candidates are dealt one set each, so unequal sets mean unequal papers.
        </p>
      ) : null}

      <div className="mt-3 flex flex-wrap items-baseline justify-between gap-2">
        <h4 className="text-[13.5px] font-bold text-ink">
          {multi ? 'Set ' + (active + 1) : 'Questions'}
        </h4>
        <span className="text-[12px] tabular-nums text-muted">
          {setSize(set)} written · {setMarks(set)} marks
        </span>
      </div>

      <ol className="mt-2 space-y-3">
        {set.questions.map((q, i) => (
          <li key={i} className="rounded-xl border border-line bg-slate-50/60 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-[12px] font-bold text-muted">
                {String(i + 1).padStart(2, '0')}
              </span>
              <select value={q.type} aria-label={'Type for question ' + (i + 1)}
                className={field + ' min-w-0 flex-1 text-xs'}
                onChange={(e) => patchQuestion(i, { type: e.target.value as BankQuestionType })}>
                {TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
              <label className="text-xs font-semibold text-slate-700" htmlFor={'bc-p-' + i}>
                Marks
              </label>
              <input id={'bc-p-' + i} type="number" min={1} max={1000} value={q.points}
                className={field + ' w-20 shrink-0 text-center text-xs tabular-nums'}
                onChange={(e) => patchQuestion(i, { points: e.target.value })} />
              {set.questions.length > 1 ? (
                <button type="button" aria-label={'Remove question ' + (i + 1)}
                  className="rounded-lg border border-line bg-white px-2 py-1 text-[11.5px]
                             font-semibold text-rose-700"
                  onClick={() => setSets((all) => all.map((sx, si) => (si !== active ? sx : {
                    questions: sx.questions.filter((_, qi) => qi !== i),
                  })))}>
                  Remove
                </button>
              ) : null}
            </div>

            <textarea rows={2} value={q.prompt} placeholder={'Question ' + (i + 1)}
              aria-label={'Question ' + (i + 1)}
              className={field + ' mt-2 w-full text-sm'}
              onChange={(e) => patchQuestion(i, { prompt: e.target.value })} />

            {CHOICE.includes(q.type) ? (
              <div className="mt-2 space-y-1.5">
                {OPTION_IDS.map((id, oi) => (
                  <label key={id} className="flex items-center gap-2 text-xs">
                    <input
                      type={q.type === 'single' ? 'radio' : 'checkbox'}
                      name={q.type === 'single' ? 'bc-correct-' + active + '-' + i : undefined}
                      checked={q.type === 'single'
                        ? q.correct === id : q.correctMany.includes(id)}
                      disabled={q.manualOnly}
                      aria-label={'Option ' + id.toUpperCase() + ' is a correct answer'}
                      onChange={() => patchQuestion(i, q.type === 'single'
                        ? { correct: id }
                        : {
                          correctMany: q.correctMany.includes(id)
                            ? q.correctMany.filter((x) => x !== id)
                            : [...q.correctMany, id],
                        })}
                    />
                    <input value={q.options[oi] ?? ''} placeholder={'Option ' + id.toUpperCase()}
                      aria-label={'Option ' + id.toUpperCase()}
                      className={field + ' w-full text-xs'}
                      onChange={(e) => setOption(i, oi, e.target.value)} />
                  </label>
                ))}
                <label className="flex items-center gap-2 text-xs text-slate-700">
                  <input type="checkbox" checked={q.manualOnly}
                    onChange={(e) => patchQuestion(i, {
                      manualOnly: e.target.checked,
                      correct: e.target.checked ? '' : q.correct,
                      correctMany: e.target.checked ? [] : q.correctMany,
                    })} />
                  No key yet — mark this one by hand
                </label>
              </div>
            ) : q.type === 'truefalse' ? (
              <div className="mt-2 flex gap-4">
                {(['true', 'false'] as const).map((v) => (
                  <label key={v} className="flex items-center gap-2 text-xs capitalize">
                    <input type="radio" name={'bc-tf-' + active + '-' + i}
                      checked={q.correct === v} disabled={q.manualOnly}
                      onChange={() => patchQuestion(i, { correct: v })} />
                    {v}
                  </label>
                ))}
              </div>
            ) : q.type === 'short' ? (
              <div className="mt-2">
                <label className={label} htmlFor={'bc-acc-' + i}>
                  Accepted answers, one per line
                </label>
                <textarea id={'bc-acc-' + i} rows={3} value={q.accepted}
                  disabled={q.manualOnly} placeholder={'preorder\npre-order'}
                  className={field + ' mt-1 w-full text-xs'}
                  onChange={(e) => patchQuestion(i, { accepted: e.target.value })} />
                <p className="mt-1 text-[11px] text-muted">
                  Any one of these counts. List the spellings and synonyms you will take.
                </p>
              </div>
            ) : q.type === 'code' ? (
              <div className="mt-2">
                <label className={label} htmlFor={'bc-prob-' + i}>Marked by</label>
                <select id={'bc-prob-' + i} value={q.problemId} className={field + ' mt-1 w-full text-xs'}
                  onChange={(e) => patchQuestion(i, { problemId: e.target.value })}>
                  <option value={NEW_PROBLEM}>Write the problem here</option>
                  {usableProblems.length ? (
                    <optgroup label="Or reuse a published problem">
                      {usableProblems.map((pr) => (
                        <option key={pr.id} value={pr.id}>{pr.title}</option>
                      ))}
                    </optgroup>
                  ) : null}
                </select>
                {q.problemId === NEW_PROBLEM ? (
                  <div className="mt-2">
                    <ProblemDraftFields draft={q.problem}
                      onChange={(patch) => patchQuestion(i, {
                        problem: { ...q.problem, ...patch },
                      })}
                      idPrefix={'bc-code-' + active + '-' + i}
                      inputClass={field + ' text-xs'}
                      labelClass={label} />
                  </div>
                ) : null}
              </div>
            ) : q.type === 'web' ? (
              <div className="mt-2">
                <label className={label} htmlFor={'bc-web-' + i}>Built from</label>
                <select id={'bc-web-' + i} value={q.webProblemId}
                  className={field + ' mt-1 w-full text-xs'}
                  onChange={(e) => patchQuestion(i, { webProblemId: e.target.value })}>
                  <option value={NEW_PROBLEM}>Write the brief and the starter files here</option>
                  {webProblems.length ? (
                    <optgroup label="Or reuse a published web problem">
                      {webProblems.map((pr) => (
                        <option key={pr.id} value={pr.id}>{pr.title}</option>
                      ))}
                    </optgroup>
                  ) : null}
                </select>
                <p className="mt-1 text-[11px] leading-relaxed text-muted">
                  Marked by a person. They see the candidate&apos;s page rendered and can read
                  all three files.
                </p>
                {q.webProblemId === NEW_PROBLEM ? (
                  <div className="mt-2">
                    <ProblemDraftFields draft={q.webProblem}
                      onChange={(patch) => patchQuestion(i, {
                        webProblem: { ...q.webProblem, ...patch },
                      })}
                      idPrefix={'bc-web-draft-' + active + '-' + i}
                      inputClass={field + ' text-xs'}
                      labelClass={label} />
                  </div>
                ) : null}
              </div>
            ) : null}
          </li>
        ))}
      </ol>

      <button type="button" className={quiet + ' mt-3'}
        onClick={() => setSets((all) => all.map((sx, si) => (si !== active ? sx : {
          questions: [...sx.questions, blank()],
        })))}>
        + Add a question to Set {active + 1}
      </button>

      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-3">
        <button type="button" disabled={pending} className={button} onClick={submit}>
          {stage ?? (pending ? 'Working…' : 'Create the bank')}
        </button>
        <button type="button" disabled={pending} onClick={() => setOpen(false)}
          className={quiet}>
          Cancel
        </button>
        <span className="text-[12.5px] text-muted">
          {sets.length} {sets.length === 1 ? 'set' : 'sets'} ·{' '}
          {sets.reduce((n, sx) => n + setSize(sx), 0)} questions in total
        </span>
      </div>

      {error ? <p role="alert" className="mt-2 text-[13px] text-red-700">{error}</p> : null}
    </div>
  );
}
