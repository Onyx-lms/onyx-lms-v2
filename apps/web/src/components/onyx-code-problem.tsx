'use client';

/**
 * Authoring a coding problem from inside a question paper.
 *
 * Both paper builders -- the institution's own (`AddQuestion`, on a question
 * bank) and the console's (`ConsoleCreatePaper`) -- could only ever POINT a
 * code question at a problem somebody had already published. That is the right
 * default and the wrong only option: setting a paper is exactly the moment the
 * question is being thought of, and being told "author one in Practice, give
 * it test cases, publish it, then come back" is being sent away mid-sentence
 * to a different screen to do the thing you were already doing.
 *
 * So the picker gains a second mode rather than being replaced. Reusing an
 * existing problem stays the first choice on the menu, because a problem that
 * is already practised and already trusted is better than a new one.
 *
 * What this module deliberately does NOT do is write a second creation path.
 * A problem made here is made by the same three calls the Practice screen and
 * the console make, in the same order the API insists on:
 *
 *   1. POST   …/problems            -- created as a draft
 *   2. PUT    …/problems/:id/tests  -- the answer key
 *   3. POST   …/problems/:id/publish
 *
 * All three, because a code question can only be bound to a PUBLISHED problem
 * -- an unpublished one has no promise that its tests are finished, and its
 * tests are what mark the question.
 *
 * `send` is passed in rather than imported: the two callers talk to different
 * base paths through different proxies (a tenant session vs the platform one),
 * and that is the only thing that differs between them.
 */

export interface ProblemDraft {
  title: string;
  statement: string;
  difficulty: string;
  topic: string;
  languages: string[];
  timeLimit: string;
  memoryLimit: string;
  cases: { name: string; stdin: string; expected: string; hidden: boolean }[];
}

export const PROBLEM_LANGUAGES =
  ['python', 'javascript', 'typescript', 'java', 'c', 'cpp', 'go', 'rust'];

/**
 * A starting point that is already valid.
 *
 * One visible case and one hidden one, because that is the smallest usable
 * key: the API refuses a problem with no cases and refuses to publish one with
 * no VISIBLE case, and starting from a shape that satisfies both is kinder
 * than discovering each rule from an error.
 */
export function blankProblemDraft(): ProblemDraft {
  return {
    title: '', statement: '', difficulty: 'easy', topic: '',
    languages: ['python'], timeLimit: '5', memoryLimit: '256',
    cases: [
      { name: 'Example', stdin: '', expected: '', hidden: false },
      { name: 'Hidden', stdin: '', expected: '', hidden: true },
    ],
  };
}

/** What is wrong with this draft, said the way the API would say it. */
export function problemDraftError(draft: ProblemDraft): string | null {
  if (!draft.title.trim()) return 'The new problem needs a title.';
  if (!draft.languages.length) return 'The new problem needs at least one language.';
  const filled = draft.cases.filter((c) => c.expected.trim() !== '' || c.stdin.trim() !== '');
  if (!filled.length) return 'The new problem needs at least one test case.';
  if (!filled.some((c) => !c.hidden)) {
    return 'At least one test case has to be visible — without one a learner cannot tell '
      + 'what the problem wants, only that they got it wrong.';
  }
  return null;
}

type Send = (path: string, body?: unknown, method?: 'POST' | 'PUT' | 'PATCH' | 'DELETE')
=> Promise<{ ok?: boolean; message?: string; data?: { id?: number } }>;

/**
 * Creates, keys and publishes the drafted problem, and answers with its id.
 *
 * Errors name WHICH of the three steps failed. A half-made problem is a real
 * outcome -- the row exists as a draft with no cases, or with cases and
 * unpublished -- and "that did not work" would leave somebody re-typing a
 * problem that is already sitting in the bank.
 */
export async function createProblemFromDraft(
  send: Send, base: string, draft: ProblemDraft,
): Promise<{ id: number } | { error: string }> {
  const invalid = problemDraftError(draft);
  if (invalid) return { error: invalid };

  const made = await send(base, {
    title: draft.title.trim(),
    statement: draft.statement.trim() || null,
    difficulty: draft.difficulty,
    topic: draft.topic.trim() || null,
    languages: draft.languages,
    // Seconds and megabytes on the form, milliseconds and kilobytes on the
    // wire -- the same conversion the standalone authoring forms make.
    time_limit_ms: Math.round((Number(draft.timeLimit) || 5) * 1000),
    memory_limit_kb: Math.round((Number(draft.memoryLimit) || 256) * 1024),
    // Never released to a learner from here: nothing on this form is a worked
    // solution, and 'after_solve' with no solution to show is a rule about
    // nothing.
    solution_rule: 'never',
  });
  if (!made.ok || !made.data?.id) {
    return { error: made.message ?? 'The problem could not be created.' };
  }
  const id = Number(made.data.id);

  const keyed = await send(base + '/' + id + '/tests', {
    tests: draft.cases
      .filter((c) => c.expected.trim() !== '' || c.stdin.trim() !== '')
      .map((c, i) => ({
        name: c.name.trim() || 'Case ' + (i + 1),
        stdin: c.stdin,
        expected_stdout: c.expected,
        is_hidden: c.hidden,
        weight: 1,
      })),
  }, 'PUT');
  if (!keyed.ok) {
    return { error: 'The problem was created but its test cases were refused: '
      + (keyed.message ?? 'unknown reason') + ' It is saved as a draft.' };
  }

  const live = await send(base + '/' + id + '/publish');
  if (!live.ok) {
    return { error: 'The problem and its test cases were saved, but publishing was refused: '
      + (live.message ?? 'unknown reason') };
  }
  return { id };
}

/**
 * The fields, controlled by whoever is holding the draft.
 *
 * Presentational on purpose: the two callers have different input classes and
 * different layouts around them, so the styles come in as props rather than
 * this component picking one and looking foreign in the other builder.
 */
export function ProblemDraftFields({ draft, onChange, inputClass, labelClass }: {
  draft: ProblemDraft;
  onChange: (patch: Partial<ProblemDraft>) => void;
  inputClass: string;
  labelClass: string;
}) {
  const setCase = (i: number, patch: Partial<ProblemDraft['cases'][number]>) =>
    onChange({ cases: draft.cases.map((c, j) => (j === i ? { ...c, ...patch } : c)) });

  return (
    <div className="grid gap-3 rounded-xl border border-line bg-slate-50/60 p-3">
      <p className="text-[12px] text-muted">
        Created and published as part of saving this question. Its test cases are what mark
        the answer — there is no separate key to type.
      </p>

      <div>
        <label className={labelClass} htmlFor="np-title">Problem title</label>
        <input id="np-title" value={draft.title} placeholder="Two Sum"
          onChange={(e) => onChange({ title: e.target.value })}
          className={inputClass + ' mt-1 w-full'} />
      </div>

      <div>
        <label className={labelClass} htmlFor="np-statement">Description</label>
        <textarea id="np-statement" rows={4} value={draft.statement}
          placeholder="What the program must do, the shape of its input and its output."
          onChange={(e) => onChange({ statement: e.target.value })}
          className={inputClass + ' mt-1 w-full'} />
        <p className="mt-1 text-[12px] text-muted">
          Optional. Left blank, the candidate reads the question above and the visible test
          cases, which is often enough for a short problem.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className={labelClass} htmlFor="np-difficulty">Difficulty</label>
          <select id="np-difficulty" value={draft.difficulty}
            onChange={(e) => onChange({ difficulty: e.target.value })}
            className={inputClass + ' mt-1 w-full'}>
            <option value="easy">easy</option>
            <option value="medium">medium</option>
            <option value="hard">hard</option>
          </select>
        </div>
        <div>
          <label className={labelClass} htmlFor="np-topic">Topic</label>
          <input id="np-topic" value={draft.topic} placeholder="Arrays"
            onChange={(e) => onChange({ topic: e.target.value })}
            className={inputClass + ' mt-1 w-full'} />
        </div>
        <div>
          <label className={labelClass} htmlFor="np-time">Time per case (s)</label>
          <input id="np-time" type="number" min={0.1} max={30} step="0.1" value={draft.timeLimit}
            onChange={(e) => onChange({ timeLimit: e.target.value })}
            className={inputClass + ' mt-1 w-full'} />
        </div>
        <div>
          <label className={labelClass} htmlFor="np-memory">Memory per case (MB)</label>
          <input id="np-memory" type="number" min={16} max={1024} value={draft.memoryLimit}
            onChange={(e) => onChange({ memoryLimit: e.target.value })}
            className={inputClass + ' mt-1 w-full'} />
        </div>
      </div>

      <fieldset>
        <legend className={labelClass}>Languages it may be answered in</legend>
        <div className="mt-1 flex flex-wrap gap-1.5">
          {PROBLEM_LANGUAGES.map((lang) => {
            const on = draft.languages.includes(lang);
            return (
              <button key={lang} type="button" aria-pressed={on}
                onClick={() => onChange({
                  languages: on
                    ? draft.languages.filter((l) => l !== lang)
                    : [...draft.languages, lang],
                })}
                className={'rounded-lg px-2.5 py-1 text-[12.5px] font-semibold '
                  + (on
                    ? 'bg-brand-600 text-white'
                    : 'border border-slate-300 bg-white text-slate-700 hover:bg-brand-50')}>
                {lang}
              </button>
            );
          })}
        </div>
      </fieldset>

      <fieldset>
        <legend className={labelClass}>Test cases</legend>
        <p className="mb-2 mt-1 text-[12px] text-muted">
          A hidden case is the answer key: its input, its expected output and whatever a
          candidate&rsquo;s program printed for it are never shown. At least one case has to be
          visible.
        </p>
        <div className="space-y-2">
          {draft.cases.map((c, i) => (
            <div key={i} className="rounded-lg border border-line bg-white p-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <input value={c.name} placeholder={'Case ' + (i + 1)}
                  aria-label={'Name of case ' + (i + 1)}
                  onChange={(e) => setCase(i, { name: e.target.value })}
                  className={inputClass + ' max-w-[12rem]'} />
                <label className="flex items-center gap-1.5 text-[12.5px] font-semibold">
                  <input type="checkbox" checked={c.hidden}
                    onChange={(e) => setCase(i, { hidden: e.target.checked })} />
                  Hidden
                </label>
                <span className="flex-1" />
                {draft.cases.length > 1 ? (
                  <button type="button"
                    onClick={() => onChange({ cases: draft.cases.filter((_, j) => j !== i) })}
                    className="text-[12px] font-semibold text-rose-700 hover:underline">
                    Remove
                  </button>
                ) : null}
              </div>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <textarea rows={2} value={c.stdin} placeholder="Input (stdin)"
                  aria-label={'Input for case ' + (i + 1)}
                  onChange={(e) => setCase(i, { stdin: e.target.value })}
                  className={inputClass + ' w-full font-mono text-[12.5px]'} />
                <textarea rows={2} value={c.expected} placeholder="Expected output"
                  aria-label={'Expected output for case ' + (i + 1)}
                  onChange={(e) => setCase(i, { expected: e.target.value })}
                  className={inputClass + ' w-full font-mono text-[12.5px]'} />
              </div>
            </div>
          ))}
        </div>
        <button type="button"
          onClick={() => onChange({
            cases: [...draft.cases,
              { name: '', stdin: '', expected: '', hidden: true }],
          })}
          className="mt-2 rounded-lg border border-line bg-white px-2.5 py-1.5 text-[12.5px]
                     font-semibold">
          Add another case
        </button>
      </fieldset>
    </div>
  );
}
