'use client';

import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  formatClock, type Assessment, type CandidateAttempt, type PaperQuestion,
} from '@/lib/onyx-assess';
import { ProctorMedia, ProctorPreflight, type DeviceState } from '@/components/onyx-proctor';
import { CandidateCamera } from '@/components/onyx-proctor-live';

/**
 * ASS-01b/c + ASS-02a -- sitting a paper.
 *
 * The timer counts down locally so it does not need a request per second, but
 * it is **corrected from the server on every save**. A candidate who winds the
 * system clock back sees the same number as before, and the server refuses the
 * save the moment its own clock says time is up -- the display is a
 * convenience, never the authority.
 *
 * Proctoring is observed here because only the browser can see a tab lose
 * focus. Every observation is posted to the server, which timestamps it; the
 * client's own time is sent alongside rather than instead, so a divergence is
 * itself visible to an invigilator.
 */
const SAVE_DEBOUNCE_MS = 800;
const RESYNC_EVERY_MS = 30_000;

export function OnyxSitPaper({ assessment, attempt }: {
  assessment: Assessment;
  attempt: CandidateAttempt;
}) {
  const router = useRouter();
  const [responses, setResponses] = useState<Record<number, unknown>>(
    () => Object.fromEntries(attempt.questions.map((q) => [q.question_id, q.response])));
  const [remaining, setRemaining] = useState(attempt.seconds_remaining);
  const [saved, setSaved] = useState<Record<number, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const timers = useRef<Record<number, ReturnType<typeof setTimeout>>>({});
  const submitting = useRef(false);

  // ASS-02a. How many times this candidate has left the paper, whether they are
  // being told about it right now, and what their devices are actually doing.
  const departures = useRef(0);
  const [departureCount, setDepartures] = useState(0);
  const [warnAway, setWarnAway] = useState(false);
  const [media, setMedia] = useState({ camera: false, screen: false });

  // Required devices that are not running right now. While this is non-empty
  // the paper is covered: a requirement you can ignore is not a requirement.
  const missing: string[] = [];
  if (assessment.proctoring) {
    if (assessment.require_camera && !media.camera) missing.push('your camera');
    if (assessment.require_screen && !media.screen) missing.push('your screen');
  }

  // ---- the clock ----

  const submit = useCallback((automatic = false) => {
    if (submitting.current) return;
    submitting.current = true;
    start(async () => {
      const res = await fetch('/api/proxy/onyx/attempts/' + attempt.id + '/submit',
        { method: 'POST' });
      const body = await res.json().catch(() => ({}));
      if (!body.ok && !automatic) {
        submitting.current = false;
        setError(body.message ?? 'Could not hand that in.');
        return;
      }
      // The attempt, not the paper's front page. This is where the result is,
      // and on a paper that marks itself it is there the moment they arrive --
      // the front page shows no score and never did, so handing in used to
      // land a candidate somewhere that could not tell them anything.
      router.push('/onyx/attempts/' + attempt.id);
      router.refresh();
    });
  }, [attempt.id, router]);

  /*
   * What the server said about leaving the paper.
   *
   * `breach` is the sentence to show; `stopped` is whether the paper is over.
   * Both come from the server and neither is computed here, because the
   * warning a candidate is shown and the count that stopped them have to be
   * the same fact -- a message assembled in the browser eventually says
   * "warning 3 of 2".
   */
  const [breach, setBreach] = useState<{ text: string; stopped: boolean } | null>(null);
  const [stopped, setStopped] = useState(false);

  useEffect(() => {
    // A stopped paper's clock stops with it. Counting down to an automatic
    // hand-in on a paper that has already been handed in would submit it a
    // second time and, worse, tell the candidate their time ran out when it
    // did not.
    if (stopped) return undefined;
    const tick = setInterval(() => {
      setRemaining((s) => {
        if (s <= 1) {
          // Hand in rather than sit on a finished paper: the answers are
          // already saved, so this only closes it tidily. The server would
          // expire it anyway.
          submit(true);
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(tick);
  }, [submit, stopped]);

  // A local countdown drifts, and a wound-back clock would drift on purpose.
  useEffect(() => {
    const resync = setInterval(async () => {
      const res = await fetch('/api/proxy/onyx/attempts/' + attempt.id);
      const body = await res.json().catch(() => ({}));
      if (body.ok) setRemaining(body.data.seconds_remaining);
    }, RESYNC_EVERY_MS);
    return () => clearInterval(resync);
  }, [attempt.id]);

  // ---- autosave ----

  const save = useCallback((questionId: number, response: unknown) => {
    clearTimeout(timers.current[questionId]);
    timers.current[questionId] = setTimeout(async () => {
      const res = await fetch('/api/proxy/onyx/attempts/' + attempt.id + '/answer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question_id: questionId, response }),
      });
      const body = await res.json().catch(() => ({}));
      if (!body.ok) { setError(body.message ?? 'That answer did not save.'); return; }
      setError(null);
      setSaved((s) => ({ ...s, [questionId]: 'Saved' }));
      // The authoritative clock, corrected on every save.
      if (typeof body.data?.seconds_remaining === 'number') {
        setRemaining(body.data.seconds_remaining);
      }
    }, SAVE_DEBOUNCE_MS);
  }, [attempt.id]);

  const answer = (questionId: number, response: unknown) => {
    setResponses((r) => ({ ...r, [questionId]: response }));
    setSaved((s) => ({ ...s, [questionId]: 'Saving…' }));
    save(questionId, response);
  };

  // ---- ASS-02a: what only the browser can see ----

  useEffect(() => {
    if (!assessment.proctoring) return;
    /*
     * The reply matters now, so it is read.
     *
     * This used to fire and forget, which was right when proctoring only
     * recorded. It decides things now: the server counts the departures, and
     * answers with the warning to show or the news that the paper has been
     * stopped. The count is NOT kept in the browser -- a rule a candidate can
     * reset with a refresh is not a rule.
     */
    const send = async (kind: string, detail?: unknown) => {
      try {
        const res = await fetch('/api/proxy/onyx/attempts/' + attempt.id + '/proctor', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ kind, detail, client_at: new Date().toISOString() }),
        });
        const body = await res.json().catch(() => ({}));
        const said = body?.data ?? {};
        if (said.warning) setBreach({ text: String(said.warning), stopped: Boolean(said.terminated) });
        if (said.terminated) setStopped(true);
      } catch {
        // A dropped request must not take the paper down with it. The server
        // is the authority on the count; a missed event is a missed count, not
        // a broken sitting.
      }
    };

    // Switching tabs fires BOTH `visibilitychange` and `blur`, so the old code
    // recorded two tab_blur events -- weight 2 -- for one switch, and a
    // candidate reached the review threshold in half the switches the weights
    // were written for. `away` collapses them: one departure, one event.
    let away = false;
    const leave = (how: string) => {
      if (away) return;
      away = true;
      departures.current += 1;
      setDepartures(departures.current);
      void send('tab_blur', { how, count: departures.current });
    };
    const arrive = () => {
      if (!away) return;
      away = false;
      void send('tab_focus');
      // Told on return rather than on leaving: a warning drawn while the tab is
      // hidden is a warning nobody reads.
      setWarnAway(true);
    };

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') leave('tab_hidden'); else arrive();
    };
    const onBlur = () => leave('window_blur');
    const onFocus = () => { if (document.visibilityState === 'visible') arrive(); };
    const onPaste = (e: ClipboardEvent) =>
      void send('paste', { length: e.clipboardData?.getData('text')?.length ?? 0 });
    const onCopy = () => void send('copy');
    const onFullscreen = () => { if (!document.fullscreenElement) void send('fullscreen_exit'); };

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('blur', onBlur);
    window.addEventListener('focus', onFocus);
    document.addEventListener('paste', onPaste);
    document.addEventListener('copy', onCopy);
    document.addEventListener('fullscreenchange', onFullscreen);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('paste', onPaste);
      document.removeEventListener('copy', onCopy);
      document.removeEventListener('fullscreenchange', onFullscreen);
    };
  }, [assessment.proctoring, attempt.id]);

  const answered = attempt.questions.filter((q) => {
    const r = responses[q.question_id];
    return r !== null && r !== undefined && r !== '' && !(Array.isArray(r) && !r.length);
  }).length;
  const low = remaining <= 300;

  return (
    <div className="space-y-6">
      {/* ASS-02a. Above the paper rather than tucked beside it: a candidate
          being watched should not have to look for the thing telling them so. */}
      {assessment.proctoring ? (
        <ProctorMedia
          attemptId={attempt.id}
          requireCamera={Boolean(assessment.require_camera)}
          requireScreen={Boolean(assessment.require_screen)}
          onState={setMedia}
        />
      ) : null}

      {/* ASS-02b. Renders nothing until an invigilator actually opens this
          candidate, and then says so where they cannot miss it. The camera is
          not held open in the meantime. */}
      {assessment.proctoring ? (
        <CandidateCamera
          attemptId={attempt.id}
          enabled={Boolean(assessment.watch_camera)}
        />
      ) : null}

      {/*
        * THE RULE, in the candidate's own words, at the moment it applies.
        *
        * This is what makes it a rule rather than a trap: they are told they
        * left, told how many that makes, and told exactly what happens if they
        * do it again -- before it happens, not afterwards. The sentence comes
        * from the server, which is also the thing counting, so the two cannot
        * disagree.
        *
        * Not dismissable on the last warning. "I understand" is fine for a
        * note; it is not fine for the sentence that says the next one ends
        * your examination.
        */}
      {breach ? (
        <div role="alert"
          className={'flex flex-wrap items-center gap-3 rounded-xl border p-3 text-sm '
            + (breach.stopped
              ? 'border-rose-400 bg-rose-50 text-rose-900'
              : 'border-amber-400 bg-amber-50 text-amber-900')}>
          <span className="min-w-0 flex-1 font-semibold">{breach.text}</span>
          {breach.stopped ? null : (
            <button type="button" onClick={() => setBreach(null)}
              className="rounded-lg border border-amber-400 bg-white px-3 py-1 text-xs
                         font-semibold hover:bg-amber-100">
              I understand
            </button>
          )}
        </div>
      ) : null}

      {/*
        * Stopped, and what happens next.
        *
        * The paper is gone from under them, so the screen says so plainly and
        * says the one thing they will want to know: somebody can put them
        * back. Not a promise that somebody will -- an invigilator decides --
        * but the difference between "your exam is over" and "your exam is
        * over and nothing can be done" is the difference between a rule and a
        * disaster.
        */}
      {stopped ? (
        <div role="alert" className="rounded-2xl border border-rose-400 bg-rose-50 p-4">
          <h2 className="text-[16px] font-bold text-rose-900">
            Your paper has been handed in.
          </h2>
          <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-rose-900">
            You left the examination more times than this paper allows, so it was handed in
            automatically. Everything you had answered has been kept.
          </p>
          <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-rose-900">
            Your invigilator can see what happened and can let you carry on from exactly
            where you were, with the time you had left. Speak to them before leaving the
            room.
          </p>
        </div>
      ) : null}

      {/* You left the paper, and the invigilator knows.
          Said plainly and once per departure, with the running count, because a
          candidate who does not know a switch was recorded cannot choose to
          stop -- and a flag nobody was warned about is a trap rather than a
          rule. Dismissable: it is a warning, not a punishment. */}
      {warnAway && !breach ? (
        <div role="alert"
          className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-400
                     bg-amber-50 p-3 text-sm text-amber-900">
          <span className="font-semibold">You left the paper.</span>
          <span className="min-w-0 flex-1">
            This was recorded and your invigilator can see it
            {departureCount > 1 ? ' — ' + departureCount + ' times so far' : ''}. Stay on this
            tab until you hand in.
          </span>
          <button type="button" onClick={() => setWarnAway(false)}
            className="rounded-lg border border-amber-400 bg-white px-3 py-1 text-xs
                       font-semibold hover:bg-amber-100">
            I understand
          </button>
        </div>
      ) : null}

      <div className={'sticky top-0 z-10 flex flex-wrap items-center gap-4 rounded-xl border p-3 '
        + (low ? 'border-rose-300 bg-rose-50' : 'border-line bg-white')}>
        <div>
          <div className="text-xs uppercase tracking-wide text-muted" id="time-remaining">
            Time remaining
          </div>
          {/*
            Announced politely, and only when it matters. A timer that spoke
            every second would make the paper unusable with a screen reader, so
            the live region turns on for the last five minutes.
          */}
          <div
            className={'font-mono text-2xl tabular-nums ' + (low ? 'text-rose-700' : '')}
            aria-labelledby="time-remaining"
            aria-live={low ? 'polite' : 'off'}
            aria-atomic="true"
          >
            {stopped ? '—' : formatClock(remaining)}
          </div>
        </div>
        <div className="text-sm text-muted">
          {answered} of {attempt.questions.length} answered
        </div>
        {assessment.proctoring ? (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800">
            Monitored
          </span>
        ) : null}
        <button
          type="button"
          disabled={pending || stopped}
          onClick={() => {
            if (window.confirm('Hand in now? You cannot change your answers afterwards.')) {
              submit();
            }
          }}
          className="ml-auto rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white
                     hover:bg-brand-700 disabled:opacity-50"
        >
          Hand in
        </button>
      </div>

      {error ? (
        <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>
      ) : null}

      {/* The paper is withheld while a required device is off.
          Not merely dimmed: the questions are removed from the document, so
          there is nothing to read through a translucent overlay and nothing for
          a screen reader to reach either. The clock keeps running -- the server
          owns it and pausing on demand would be a way to buy thinking time --
          which is why the panel above stays interactive so the candidate can
          fix it immediately. */}
      {stopped ? null : missing.length ? (
        <div role="alert"
          className="rounded-2xl border-2 border-rose-300 bg-rose-50 p-6 text-center">
          <p className="text-base font-bold text-rose-900">
            The paper is hidden until {missing.join(' and ')} {missing.length > 1 ? 'are' : 'is'} on
          </p>
          <p className="mx-auto mt-2 max-w-[52ch] text-sm text-rose-900">
            This assessment is monitored and cannot be sat without
            {' ' + missing.join(' and ')}. Use the panel above to turn
            {missing.length > 1 ? ' them ' : ' it '}back on — your answers are saved and the
            clock is still running.
          </p>
        </div>
      ) : (
        <ol className="space-y-6">
          {attempt.questions.map((q, i) => (
            <li key={q.question_id} className="rounded-2xl border border-line p-4">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-xs uppercase tracking-wide text-muted">
                  Question {i + 1}
                </span>
                <span className="text-xs text-muted">
                  {q.points} mark{q.points === 1 ? '' : 's'}
                  {saved[q.question_id]
                    ? <span className="ml-2 text-muted">{saved[q.question_id]}</span>
                    : null}
                </span>
              </div>
              <p className="mt-2 whitespace-pre-wrap break-words text-sm text-slate-800">{q.prompt}</p>
              <div className="mt-3">
                <QuestionInput
                  question={q}
                  value={responses[q.question_id]}
                  onChange={(v) => answer(q.question_id, v)}
                />
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function QuestionInput({ question, value, onChange }: {
  question: PaperQuestion;
  value: unknown;
  onChange: (next: unknown) => void;
}) {
  const field = 'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm '
    + 'focus:border-slate-900 focus:outline-none';

  if (question.type === 'single' || question.type === 'truefalse') {
    const options = question.type === 'truefalse'
      ? [{ id: 'true', text: 'True' }, { id: 'false', text: 'False' }]
      : question.options;
    return (
      <fieldset className="space-y-2">
        <legend className="sr-only">{question.prompt}</legend>
        {options.map((o) => (
          <label key={o.id} className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name={'q' + question.question_id}
              value={o.id}
              checked={String(value ?? '') === o.id}
              onChange={() => onChange(o.id)}
            />
            {o.text}
          </label>
        ))}
      </fieldset>
    );
  }

  if (question.type === 'multiple') {
    const chosen = new Set((Array.isArray(value) ? value : []).map(String));
    return (
      <fieldset className="space-y-2">
        <legend className="sr-only">{question.prompt}</legend>
        {question.options.map((o) => (
          <label key={o.id} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={chosen.has(o.id)}
              onChange={() => {
                const next = new Set(chosen);
                if (next.has(o.id)) next.delete(o.id); else next.add(o.id);
                onChange([...next]);
              }}
            />
            {o.text}
          </label>
        ))}
        <p className="text-xs text-muted">
          Select every correct option. Partial credit is not given.
        </p>
      </fieldset>
    );
  }

  // ASS-01 -- a coding question. The statement, a language picker and an
  // editor; the answer is source, and it is marked by running the linked
  // problem's tests when the paper is handed in.
  //
  // Deliberately no Run button. Practice has one; an exam does not, because
  // "run against the visible cases" during a timed paper is a different
  // assessment from the one being set, and the hidden cases are the point.
  if (question.type === 'code') {
    const answer = (value ?? {}) as { language?: string; source?: string };
    const languages = question.problem?.languages?.length
      ? question.problem.languages : ['python'];
    const language = answer.language ?? languages[0]!;
    const starter = question.problem?.starter_code?.[language] ?? '';
    return (
      <div className="space-y-2.5">
        {question.problem?.statement ? (
          <div className="whitespace-pre-wrap rounded-xl border border-line bg-canvas p-3
                          text-[13px] leading-relaxed">
            {question.problem.statement}
          </div>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-[12.5px] font-semibold" htmlFor={'lang' + question.question_id}>
            Language
          </label>
          <select
            id={'lang' + question.question_id}
            className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-[13px]"
            value={language}
            onChange={(e) => onChange({
              language: e.target.value,
              // Keep whatever they have written; switching language must not
              // silently delete an answer.
              source: answer.source ?? '',
            })}
          >
            {languages.map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
          {question.problem?.time_limit_ms ? (
            <span className="text-[12px] text-muted">
              {Math.round(question.problem.time_limit_ms / 100) / 10}s per test
            </span>
          ) : null}
        </div>
        <textarea
          aria-label={'Your code for: ' + question.prompt}
          rows={14}
          spellCheck={false}
          value={answer.source ?? starter}
          onChange={(e) => onChange({ language, source: e.target.value })}
          className={field + ' font-mono text-[13px] leading-relaxed'}
        />
        <p className="text-xs text-muted">
          Marked by running it against the problem&apos;s tests, including ones you
          cannot see. Read input from standard input and print to standard output.
        </p>
      </div>
    );
  }

  if (question.type === 'short') {
    return (
      <input
        aria-label={question.prompt}
        value={String(value ?? '')}
        onChange={(e) => onChange(e.target.value)}
        className={field}
      />
    );
  }

  return (
    <textarea
      aria-label={question.prompt}
      rows={8}
      value={String(value ?? '')}
      onChange={(e) => onChange(e.target.value)}
      className={field}
    />
  );
}

/** ASS-02 -- consent, asked before the paper is dealt and never after. */
export function OnyxStartAssessment({ assessment }: { assessment: Assessment }) {
  const router = useRouter();
  const [consented, setConsented] = useState(false);
  // Every device the paper requires has been proved to work. Starts ok so an
  // unproctored paper is not gated on a check it never runs.
  const [devices, setDevices] = useState<DeviceState>(
    { camera: false, screen: false, ok: true });
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <div className="space-y-4 rounded-2xl border border-line p-4">
      <div className="text-sm text-slate-700">
        <p>
          {assessment.duration_minutes} minutes once you start. The timer runs on the server,
          so closing the tab does not stop it.
        </p>
        {assessment.attempts_allowed > 1 ? (
          <p className="mt-1">You may attempt this {assessment.attempts_allowed} times.</p>
        ) : <p className="mt-1">You get one attempt.</p>}
      </div>

      {assessment.proctoring ? (
        <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
          <p className="font-medium">This assessment is monitored.</p>
          <ul className="mt-1 list-disc pl-5 text-xs">
            <li>Leaving the tab, pasting and copying are recorded.</li>
            {assessment.require_camera ? <li>Your camera must stay on.</li> : null}
            {assessment.require_screen ? <li>Your screen is shared with the invigilator.</li> : null}
            {/*
              * This said "no video is recorded or uploaded" for every paper,
              * and live invigilation makes that false for the papers that use
              * it. Consent has to be informed and specific, so the sentence
              * now depends on what this particular paper actually does rather
              * than on what was true before the feature existed.
              *
              * Nothing is recorded either way -- that half was and remains
              * true, and is worth keeping because it is the thing people are
              * most afraid of.
              */}
            {assessment.watch_camera ? (
              <li>
                <strong>An invigilator may watch your camera live during this attempt.</strong>{' '}
                You will be told on this screen whenever somebody is watching. Nothing is
                recorded or kept.
              </li>
            ) : assessment.require_camera || assessment.require_screen ? (
              <li>
                No video is recorded, uploaded or watched — only when your camera and
                screen started and stopped.
              </li>
            ) : null}
            <li>An invigilator reviews anything flagged. A flag is not an accusation.</li>
          </ul>
          <label className="mt-3 flex items-center gap-2 text-sm">
            <input type="checkbox" checked={consented}
              onChange={(e) => setConsented(e.target.checked)} />
            I understand and agree to be monitored for this attempt.
          </label>
          {/* Proving the camera works belongs here, not ninety seconds into a
              timed paper. `ready` is what gates Start. */}
          <ProctorPreflight
            requireCamera={Boolean(assessment.require_camera)}
            requireScreen={Boolean(assessment.require_screen)}
            onReady={setDevices}
          />
        </div>
      ) : null}

      {error ? <p role="alert" className="text-sm text-rose-600">{error}</p> : null}

      <button
        type="button"
        disabled={pending || (Boolean(assessment.proctoring) && (!consented || !devices.ok))}
        onClick={() => start(async () => {
          setError(null);
          const res = await fetch('/api/proxy/onyx/assessments/' + assessment.id + '/start', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            // The server checks these against require_camera / require_screen
            // and withholds the paper if one is missing, so a disabled button
            // is no longer the only thing standing in the way.
            body: JSON.stringify({
              consent: consented,
              devices: { camera: devices.camera, screen: devices.screen },
            }),
          });
          const body = await res.json().catch(() => ({}));
          if (!body.ok) { setError(body.message ?? 'Could not start.'); return; }
          router.push('/onyx/attempts/' + body.data.id);
          router.refresh();
        })}
        className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white
                   hover:bg-brand-700 disabled:opacity-50"
      >
        Start
      </button>
    </div>
  );
}
