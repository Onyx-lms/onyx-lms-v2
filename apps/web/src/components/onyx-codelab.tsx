'use client';

import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { OnyxEditor } from './onyx-editor';

/**
 * LAB-01 / LAB-03 -- the run/submit console.
 *
 * Submitting queues work and returns straight away (LAB-02b), so this polls the
 * submission rather than waiting on a response. That is the visible half of the
 * queue: under load the spinner lasts longer, and nothing times out or is lost.
 *
 * The console shows what a learner is entitled to see. A hidden case arrives
 * with `stdout: null` from the API, and this renders pass/fail for it and
 * nothing else -- there is no branch here that could reveal one, because there
 * is nothing to reveal.
 */
export interface PublicCase {
  id: number;
  name: string;
  is_hidden: number;
  passed: number;
  weight: number;
  runtime_ms: number | null;
  stdout: string | null;
  error: string | null;
}

export interface CodeSubmission {
  id: number;
  status: 'queued' | 'running' | 'done' | 'failed';
  mode: 'run' | 'submit';
  score: number;
  max_score: number;
  passed: number;
  total: number;
  compile_output: string | null;
  error: string | null;
  runtime_ms: number | null;
  cases?: PublicCase[];
}

export interface PublicTest {
  id: number; name: string; is_hidden: number;
  stdin: string | null; expected_stdout: string | null;
}

const POLL_MS = 900;
const POLL_LIMIT = 120; // ~two minutes, then stop asking

export function OnyxCodeLab({ problem }: {
  problem: {
    id: number;
    languages: string[];
    starter_code: Record<string, string>;
    tests: PublicTest[];
    hints: { id: number; sort: number; penalty_percent: number; revealed: boolean; body: string | null }[];
    solution: string | null;
    solution_released: boolean;
    attempts: number;
    solved: boolean;
  };
}) {
  const router = useRouter();
  const languages = problem.languages.length ? problem.languages : ['python'];
  const [language, setLanguage] = useState(languages[0]!);
  const [source, setSource] = useState(problem.starter_code?.[languages[0]!] ?? '');
  const [result, setResult] = useState<CodeSubmission | null>(null);
  const [status, setStatus] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const polling = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (polling.current) clearTimeout(polling.current); }, []);

  /** Follows one submission until the worker has finished with it. */
  const follow = useCallback((id: number, attempt = 0) => {
    polling.current = setTimeout(async () => {
      const res = await fetch('/api/proxy/onyx/submissions/code/' + id);
      const body = await res.json().catch(() => ({}));
      if (!body.ok) { setError(body.message ?? 'Lost track of that run.'); setStatus(''); return; }

      const submission = body.data as CodeSubmission;
      setResult(submission);
      if (submission.status === 'done' || submission.status === 'failed') {
        setStatus('');
        router.refresh();
        return;
      }
      if (attempt >= POLL_LIMIT) {
        // Say so rather than spinning forever: the job is durable and will be
        // graded, but this page has stopped watching.
        setStatus('');
        setError('This is taking longer than expected. Your submission is queued '
          + 'and will be graded — reload to see it.');
        return;
      }
      setStatus(submission.status === 'running' ? 'Running…' : 'Queued…');
      follow(id, attempt + 1);
    }, POLL_MS);
  }, [router]);

  const send = (mode: 'run' | 'submit') => {
    setError(null);
    setResult(null);
    setStatus('Queued…');
    start(async () => {
      const res = await fetch('/api/proxy/onyx/problems/' + problem.id + '/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ language, source, mode }),
      });
      const body = await res.json().catch(() => ({}));
      if (!body.ok) {
        setStatus('');
        setError(body.message ?? 'Could not queue that.');
        return;
      }
      follow(Number(body.data.id));
    });
  };

  const visible = problem.tests.filter((t) => !t.is_hidden);
  const hidden = problem.tests.length - visible.length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <label className="sr-only" htmlFor="language">Language</label>
        <select
          id="language"
          value={language}
          onChange={(e) => {
            setLanguage(e.target.value);
            // Only offer the starter for the new language if nothing has been
            // written yet -- silently replacing someone's work would be worse
            // than leaving it in the wrong syntax.
            if (!source.trim()) setSource(problem.starter_code?.[e.target.value] ?? '');
          }}
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
        >
          {languages.map((l) => <option key={l} value={l}>{l}</option>)}
        </select>

        <button
          type="button" disabled={pending || Boolean(status)}
          onClick={() => send('run')}
          className="rounded-lg border border-slate-300 px-4 py-1.5 text-sm text-slate-700
                     hover:bg-slate-50 disabled:opacity-50"
        >
          Run
        </button>
        <button
          type="button" disabled={pending || Boolean(status)}
          onClick={() => send('submit')}
          className="rounded-lg bg-brand-600 px-4 py-1.5 text-sm font-medium text-white
                     hover:bg-brand-700 disabled:opacity-50"
        >
          Submit
        </button>
        <span aria-live="polite" className="text-sm text-muted">{status}</span>
        <span className="ml-auto text-xs text-muted">
          Run checks the {visible.length} visible case{visible.length === 1 ? '' : 's'}.
          {hidden ? ' Submit also checks ' + hidden + ' hidden one' + (hidden === 1 ? '' : 's') + '.' : ''}
        </span>
      </div>

      <OnyxEditor value={source} language={language} onChange={setSource} />

      {error ? <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p> : null}

      {result ? <Console result={result} /> : null}

      <Hints problemId={problem.id} hints={problem.hints} />

      {problem.solution_released && problem.solution ? (
        <details className="rounded-2xl border border-line p-4">
          <summary className="cursor-pointer text-sm font-medium">Worked solution</summary>
          <pre className="mt-3 overflow-x-auto rounded-lg bg-slate-950 p-3 text-xs text-slate-100">
            {problem.solution}
          </pre>
        </details>
      ) : (
        <p className="text-xs text-muted">
          {problem.solved
            ? 'The worked solution is not published for this problem.'
            : 'The worked solution unlocks once you have met this problem’s release rule.'}
        </p>
      )}
    </div>
  );
}

function Console({ result }: { result: CodeSubmission }) {
  const failed = result.status === 'failed';
  return (
    <section className="rounded-2xl border border-line">
      <header className="flex flex-wrap items-baseline gap-3 border-b border-line px-4 py-3">
        <span className="text-sm font-medium">
          {failed ? 'Could not run' : result.passed + ' of ' + result.total + ' cases passed'}
        </span>
        {!failed && result.max_score > 0 ? (
          <span className="text-sm tabular-nums text-muted">
            {result.score} / {result.max_score}
          </span>
        ) : null}
        {result.runtime_ms !== null && !failed ? (
          <span className="text-xs text-muted">{result.runtime_ms}ms</span>
        ) : null}
      </header>

      {result.compile_output ? (
        <pre className="overflow-x-auto border-b border-line bg-amber-50 p-3 text-xs text-amber-900">
          {result.compile_output}
        </pre>
      ) : null}
      {failed && result.error ? (
        <p className="px-4 py-3 text-sm text-rose-700">{result.error}</p>
      ) : null}

      <ul className="divide-y divide-line">
        {(result.cases ?? []).map((c) => (
          <li key={c.id} className="px-4 py-3 text-sm">
            <div className="flex items-center gap-2">
              <span className={c.passed ? 'text-emerald-700' : 'text-rose-700'}>
                {c.passed ? 'passed' : 'failed'}
              </span>
              <span className="text-slate-700">{c.name}</span>
              {c.is_hidden ? <span className="text-xs text-muted">hidden</span> : null}
              {c.runtime_ms !== null
                ? <span className="ml-auto text-xs text-muted">{c.runtime_ms}ms</span>
                : null}
            </div>
            {/* A hidden case arrives with no output at all -- there is nothing
                here that could print one. */}
            {!c.is_hidden && c.stdout ? (
              <pre className="mt-2 overflow-x-auto rounded-lg bg-slate-950 p-2 text-xs text-slate-100">
                {c.stdout}
              </pre>
            ) : null}
            {!c.is_hidden && c.error ? (
              <pre className="mt-2 overflow-x-auto rounded-lg bg-rose-50 p-2 text-xs text-rose-800">
                {c.error}
              </pre>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** LAB-04 -- one hint at a time, and the cost is stated before it is paid. */
function Hints({ problemId, hints }: {
  problemId: number;
  hints: { id: number; sort: number; penalty_percent: number; revealed: boolean; body: string | null }[];
}) {
  const router = useRouter();
  const [revealed, setRevealed] = useState(hints);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (!hints.length) return null;
  const next = revealed.find((h) => !h.revealed);

  return (
    <section className="rounded-2xl border border-line p-4">
      <h2 className="text-sm font-medium uppercase tracking-wide text-muted">Hints</h2>
      <ol className="mt-2 space-y-2 text-sm">
        {revealed.filter((h) => h.revealed).map((h) => (
          <li key={h.id} className="text-slate-700">{h.body}</li>
        ))}
      </ol>
      {next ? (
        <button
          type="button" disabled={pending}
          onClick={() => start(async () => {
            setError(null);
            const res = await fetch('/api/proxy/onyx/problems/' + problemId + '/hint',
              { method: 'POST' });
            const body = await res.json().catch(() => ({}));
            if (!body.ok) { setError(body.message ?? 'No more hints.'); return; }
            setRevealed((list) => list.map((h) => (h.id === body.data.id
              ? { ...h, revealed: true, body: body.data.body } : h)));
            router.refresh();
          })}
          className="mt-3 rounded-lg border border-slate-300 px-3 py-1.5 text-xs text-slate-700
                     hover:bg-slate-50 disabled:opacity-50"
        >
          Show the next hint
          {next.penalty_percent ? ' (costs ' + next.penalty_percent + '%)' : ''}
        </button>
      ) : (
        <p className="mt-3 text-xs text-muted">You have seen every hint.</p>
      )}
      {error ? <p className="mt-2 text-xs text-rose-600">{error}</p> : null}
    </section>
  );
}
