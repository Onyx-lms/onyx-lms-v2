'use client';

import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Card, Empty, Icon, Pill, Ring } from './onyx-ui';
import type { Assignment, RubricCriterion, Submission } from '@/lib/onyx-learn';

const field = 'w-full rounded-xl border border-slate-300 bg-slate-50/60 px-3.5 py-2.5 text-sm '
  + 'transition-colors focus:border-brand-500 focus:bg-white focus:outline-none '
  + 'focus:ring-2 focus:ring-brand-100';

const AUTOSAVE_MS = 5_000;
const DRAFT_KEY = (id: number) => 'onyx.assignment.' + id + '.draft';

/**
 * LRN-04b / LRN-04c -- writing and handing in.
 *
 * The acceptance criterion is blunt: kill the tab mid-answer, come back, and
 * the draft is there. That needs both halves.
 *
 *   * **Server autosave**, so it survives a different machine. Debounced, and
 *     skipped when nothing changed -- a save every keystroke is a save that
 *     fails under load.
 *   * **localStorage on every keystroke**, so it survives the five seconds
 *     between saves. This is the half that actually covers "the tab died", and
 *     the newer of the two wins on return.
 *
 * The list and detail screens around this already moved onto the shared
 * design system (Card, Pill, Ring); this is the form itself, which had not --
 * a bare textarea and a plain button, the one part of the page someone
 * actually spends their time in.
 */
export function OnyxSubmissionForm({ assignment, submission }: {
  assignment: Assignment;
  submission: Submission | null;
}) {
  const router = useRouter();
  const [body, setBody] = useState(submission?.body ?? '');
  const [status, setStatus] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const lastSaved = useRef(submission?.body ?? '');
  const restored = useRef(false);

  const locked = submission
    ? submission.status !== 'draft' && !assignment.allow_resubmission
    : false;

  // A local draft newer than the server's is the tab that died. Restore it and
  // say so, rather than silently replacing what they last saw.
  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    try {
      const raw = localStorage.getItem(DRAFT_KEY(assignment.id));
      if (!raw) return;
      const local = JSON.parse(raw) as { body: string; at: number };
      const serverAt = submission?.updated_at ? Date.parse(submission.updated_at) : 0;
      if (local.body && local.at > serverAt && local.body !== (submission?.body ?? '')) {
        setBody(local.body);
        setStatus('Restored an unsaved draft from this device.');
      }
    } catch { /* a corrupt local draft is not worth failing over */ }
  }, [assignment.id, submission]);

  const saveDraft = useCallback(async (text: string) => {
    if (text === lastSaved.current) return;
    lastSaved.current = text;
    setStatus('Saving…');
    const res = await fetch('/api/proxy/onyx/assignments/' + assignment.id + '/draft', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: text }),
    });
    const payload = await res.json().catch(() => ({}));
    setStatus(payload.ok ? 'Draft saved' : (payload.message ?? 'Could not save the draft'));
  }, [assignment.id]);

  useEffect(() => {
    if (locked || (submission && submission.status !== 'draft')) return;
    const timer = setTimeout(() => { void saveDraft(body); }, AUTOSAVE_MS);
    return () => clearTimeout(timer);
  }, [body, locked, saveDraft, submission]);

  const onChange = (text: string) => {
    setBody(text);
    // Every keystroke, because this is the copy that survives a crash.
    try {
      localStorage.setItem(DRAFT_KEY(assignment.id), JSON.stringify({ body: text, at: Date.now() }));
    } catch { /* private mode, quota -- the server copy still applies */ }
  };

  if (locked) {
    return (
      <Card className="p-5">
        <Empty icon="check">You have submitted this and it cannot be resubmitted.</Empty>
      </Card>
    );
  }

  const words = body.trim() ? body.trim().split(/\s+/).length : 0;
  const dotTone = status === 'Saving…' ? 'bg-accent-500 animate-pulse'
    : status === 'Submitted' ? 'bg-green-600'
      : status === 'Draft saved' ? 'bg-slate-400' : 'bg-transparent';

  return (
    <Card className="p-4 sm:p-5">
      <form
        className="space-y-3.5"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          start(async () => {
            const res = await fetch('/api/proxy/onyx/assignments/' + assignment.id + '/submit', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ body }),
            });
            const payload = await res.json().catch(() => ({}));
            if (!payload.ok) { setError(payload.message ?? 'Could not submit.'); return; }
            // Handed in: the local copy has done its job.
            try { localStorage.removeItem(DRAFT_KEY(assignment.id)); } catch { /* fine */ }
            setStatus('Submitted');
            router.refresh();
          });
        }}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <label className="text-[11.5px] font-bold uppercase tracking-[.085em] text-muted" htmlFor="answer">
            Your answer
          </label>
          {status ? (
            <span aria-live="polite" className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-muted">
              <span aria-hidden="true" className={'h-1.5 w-1.5 rounded-full ' + dotTone} />
              {status}
            </span>
          ) : null}
        </div>
        <textarea
          id="answer"
          rows={14}
          value={body}
          onChange={(e) => onChange(e.target.value)}
          onBlur={() => { void saveDraft(body); }}
          placeholder="Write your answer here…"
          className={field + ' resize-y leading-relaxed'}
        />
        <div className="text-[12px] text-muted">
          {words ? words + ' word' + (words === 1 ? '' : 's') : 'Nothing written yet'}
        </div>

        {error ? (
          <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{error}</p>
        ) : null}

        <div className="flex flex-wrap items-center gap-3 border-t border-line pt-4">
          <button type="submit" disabled={pending || !body.trim()}
            className="inline-flex items-center gap-1.5 rounded-xl bg-brand-600 px-5 py-2.5
                       text-sm font-bold text-white shadow-sm transition
                       hover:bg-brand-700 disabled:opacity-50">
            <Icon name="check" className="h-4 w-4" />
            {submission && submission.status !== 'draft' ? 'Resubmit' : 'Submit'}
          </button>
          <button type="button" onClick={() => { void saveDraft(body); }}
            className="rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700
                       transition hover:bg-slate-50">
            Save draft
          </button>
        </div>
        {assignment.due_at ? (
          <p className="flex items-center gap-1.5 text-[12.5px] text-muted">
            <Icon name="clock" className="h-3.5 w-3.5" />
            Due {new Date(assignment.due_at).toLocaleString()}
            {assignment.late_policy === 'reject' ? '. Nothing is accepted after this.' : null}
            {assignment.late_policy === 'penalty'
              ? '. Late work loses ' + assignment.late_penalty_percent + '%.'
              : null}
            {assignment.late_policy === 'accept' ? '. Late work is accepted but flagged.' : null}
          </p>
        ) : null}
      </form>
    </Card>
  );
}

/** How much of a criterion's marks were awarded, mapped to the shared `Pill`
 *  tones -- `good` for a strong mark, `brand` for a middling one, `neutral`
 *  for a weak one. Never `late`: that tone means lateness everywhere else in
 *  the product, and reusing it for "a low score" would make it stop meaning
 *  one thing. */
function scoreTone(points: number, max: number): 'good' | 'brand' | 'neutral' {
  if (max <= 0) return 'neutral';
  const ratio = points / max;
  if (ratio >= 0.8) return 'good';
  if (ratio >= 0.4) return 'brand';
  return 'neutral';
}

/** What a learner sees once their work has been returned, and not before. */
export function OnyxReturnedWork({ assignment, submission }: {
  assignment: Assignment; submission: Submission;
}) {
  if (!submission.returned_at) return null;
  const byId = new Map((assignment.rubric ?? []).map((c) => [c.id, c]));
  const pct = assignment.total_points > 0
    ? ((submission.score ?? 0) / assignment.total_points) * 100 : 0;

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-center gap-5">
        <Ring percent={pct} size={64} label={'Scored ' + Math.round(pct) + ' percent'} />
        <div>
          {/* Literal text "Result" is asserted by o02-web.e2e.ts as the marker
              that a grade has actually been returned -- nothing before that
              point should match it. Don't reword this without checking there. */}
          <div className="text-[11.5px] font-bold uppercase tracking-[.085em] text-muted">Result</div>
          <div className="text-[28px] font-extrabold leading-none tabular-nums">
            {submission.score}
            <span className="text-base font-semibold text-muted"> / {assignment.total_points}</span>
          </div>
          {submission.is_late ? (
            <div className="mt-2">
              <Pill tone="late">
                Submitted late
                {assignment.late_policy === 'penalty'
                  ? ' — ' + assignment.late_penalty_percent + '% deducted' : ''}
              </Pill>
            </div>
          ) : null}
        </div>
      </div>

      {submission.rubric_scores?.length ? (
        <div className="mt-5 space-y-2 border-t border-line pt-4">
          <div className="text-[11.5px] font-bold uppercase tracking-[.085em] text-muted">Breakdown</div>
          {submission.rubric_scores.map((s) => {
            const criterion = byId.get(s.criterion_id);
            return (
              <div key={s.criterion_id}
                className="flex items-start justify-between gap-3 rounded-xl bg-slate-50 px-3.5 py-3">
                <div className="min-w-0">
                  <div className="text-[14px] font-semibold">{criterion?.title ?? 'Criterion'}</div>
                  {s.comment ? (
                    <div className="mt-0.5 text-[13px] leading-relaxed text-muted">{s.comment}</div>
                  ) : null}
                </div>
                <Pill tone={scoreTone(s.points, criterion?.points ?? 0)}>
                  {s.points} / {criterion?.points ?? '—'}
                </Pill>
              </div>
            );
          })}
        </div>
      ) : null}

      {submission.feedback ? (
        <div className="mt-5 rounded-xl border border-brand-100 bg-brand-50/60 p-4">
          <div className="flex items-center gap-1.5 text-[11.5px] font-bold uppercase tracking-[.085em] text-brand-700">
            <Icon name="edit" className="h-3.5 w-3.5" />
            Feedback
          </div>
          <p className="mt-1.5 whitespace-pre-wrap text-[14px] leading-relaxed text-slate-700">
            {submission.feedback}
          </p>
        </div>
      ) : null}
    </Card>
  );
}

/**
 * LRN-04b -- marking against the rubric.
 *
 * The total is computed from the criteria as they are typed, so a marker sees
 * the number the learner will see rather than discovering it on save. Each
 * criterion is its own card rather than a table row, with three one-click
 * point presets beside the input -- most marks given in a real queue are
 * "full, half or nothing", and asking for those three keystrokes each time is
 * the difference between marking thirty papers and marking thirty papers
 * quickly.
 */
export function OnyxGrader({ submission, rubric, totalPoints }: {
  submission: Submission; rubric: RubricCriterion[]; totalPoints: number;
}) {
  const router = useRouter();
  const [points, setPoints] = useState<Record<number, string>>(
    () => Object.fromEntries(rubric.map((c) => {
      const prior = submission.rubric_scores?.find((s) => s.criterion_id === c.id);
      return [c.id, prior ? String(prior.points) : ''];
    })));
  const [comments, setComments] = useState<Record<number, string>>(
    () => Object.fromEntries(rubric.map((c) => {
      const prior = submission.rubric_scores?.find((s) => s.criterion_id === c.id);
      return [c.id, prior?.comment ?? ''];
    })));
  const [feedback, setFeedback] = useState(submission.feedback ?? '');
  const [score, setScore] = useState(submission.score !== null ? String(submission.score) : '');
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const running = rubric.length
    ? rubric.reduce((t, c) => t + (Number(points[c.id]) || 0), 0)
    : Number(score) || 0;
  const pct = totalPoints > 0 ? (running / totalPoints) * 100 : 0;

  const send = (path: string, body?: unknown) => start(async () => {
    const res = await fetch('/api/proxy/onyx/submissions/' + submission.id + '/' + path, {
      method: 'POST',
      ...(body === undefined ? {} : {
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    });
    const payload = await res.json().catch(() => ({}));
    setNotice(payload.ok ? null : (payload.message ?? 'That did not work.'));
    if (payload.ok) router.refresh();
  });

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center gap-4 border-b border-line bg-slate-50 px-4 py-3.5">
        <Ring percent={pct} size={44} label={'Running total ' + Math.round(pct) + ' percent'} />
        <div>
          <div className="text-[11px] font-bold uppercase tracking-[.08em] text-muted">Running total</div>
          <div className="text-xl font-extrabold leading-none tabular-nums">
            {running}<span className="text-sm font-semibold text-muted"> / {totalPoints}</span>
          </div>
        </div>
        {submission.returned_at ? (
          <span className="ml-auto"><Pill tone="good">Returned</Pill></span>
        ) : submission.status === 'graded' ? (
          <span className="ml-auto"><Pill tone="brand">Graded, not yet visible</Pill></span>
        ) : null}
      </div>

      <div className="space-y-3 p-4">
        {rubric.length ? rubric.map((c) => {
          const presets = [0, c.points / 2, c.points];
          const current = points[c.id] ?? '';
          return (
            <div key={c.id} className="rounded-xl border border-line p-3.5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[14px] font-semibold">{c.title}</div>
                  {c.description ? (
                    <div className="mt-0.5 text-[12.5px] leading-relaxed text-muted">{c.description}</div>
                  ) : null}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {presets.map((v, i) => (
                    <button
                      key={i} type="button"
                      onClick={() => setPoints((p) => ({ ...p, [c.id]: String(v) }))}
                      aria-label={'Give ' + v + ' of ' + c.points + ' for ' + c.title}
                      className={'rounded-lg border px-2 py-1 text-[11.5px] font-bold transition-colors '
                        + (current === String(v)
                          ? 'border-brand-500 bg-brand-50 text-brand-700'
                          : 'border-slate-300 text-slate-600 hover:border-brand-300 hover:text-brand-700')}
                    >
                      {v}
                    </button>
                  ))}
                  <input
                    type="number" min={0} max={c.points} step="0.5"
                    aria-label={c.title + ' points, out of ' + c.points}
                    value={current}
                    onChange={(e) => setPoints((p) => ({ ...p, [c.id]: e.target.value }))}
                    className="w-16 rounded-lg border border-slate-300 px-2 py-1.5 text-center text-sm
                               font-bold focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100"
                  />
                  <span className="text-xs font-semibold text-muted">/ {c.points}</span>
                </div>
              </div>
              <input
                aria-label={'Comment on ' + c.title}
                placeholder="Comment (optional)"
                value={comments[c.id] ?? ''}
                onChange={(e) => setComments((m) => ({ ...m, [c.id]: e.target.value }))}
                className="mt-2.5 w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5
                           text-[13px] transition-colors focus:border-brand-400 focus:bg-white focus:outline-none"
              />
            </div>
          );
        }) : (
          <div>
            <label className="block text-[11.5px] font-bold uppercase tracking-[.085em] text-muted" htmlFor="score">
              Score out of {totalPoints}
            </label>
            <input id="score" type="number" min={0} max={totalPoints} step="0.5"
              value={score} onChange={(e) => setScore(e.target.value)}
              className="mt-1.5 w-28 rounded-xl border border-slate-300 px-3 py-2 text-lg font-bold
                         focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100" />
          </div>
        )}

        <div>
          <label className="block text-[11.5px] font-bold uppercase tracking-[.085em] text-muted" htmlFor="feedback">
            Feedback
          </label>
          <textarea id="feedback" rows={4} value={feedback}
            onChange={(e) => setFeedback(e.target.value)} className={field + ' mt-1.5'} />
        </div>

        {notice ? (
          <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{notice}</p>
        ) : null}

        <div className="flex flex-wrap items-center gap-3 border-t border-line pt-4">
          <button
            type="button" disabled={pending}
            onClick={() => send('grade', rubric.length
              ? {
                feedback,
                scores: rubric.map((c) => ({
                  criterion_id: c.id, points: Number(points[c.id]) || 0,
                  comment: comments[c.id] || null,
                })),
              }
              : { feedback, score: Number(score) })}
            className="inline-flex items-center gap-1.5 rounded-xl bg-brand-600 px-4 py-2.5 text-sm
                       font-bold text-white shadow-sm transition hover:bg-brand-700 disabled:opacity-50"
          >
            <Icon name="save" className="h-4 w-4" />
            Save grade
          </button>
          <button
            type="button"
            disabled={pending || submission.status !== 'graded'}
            onClick={() => send('return')}
            className="inline-flex items-center gap-1.5 rounded-xl bg-green-600 px-4 py-2.5 text-sm
                       font-bold text-white shadow-sm transition hover:bg-green-700
                       disabled:bg-slate-200 disabled:text-slate-400 disabled:shadow-none"
          >
            <Icon name="check" className="h-4 w-4" />
            Return to learner
          </button>
          <span className="text-xs text-muted">
            {submission.returned_at
              ? 'Returned — the learner can see this.'
              : 'Nothing is visible to the learner until it is returned.'}
          </span>
        </div>
      </div>
    </Card>
  );
}
