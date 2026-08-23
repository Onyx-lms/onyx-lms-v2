import { Icon, Pill, Score } from '@/components/onyx-ui';
import type { PaperQuestion } from '@/lib/onyx-assess';

/**
 * One question as the candidate answered it — the review screen every LMS has.
 *
 * A total tells somebody they got 12 out of 20. This tells them which four
 * they lost and what they put instead, which is the only version of a result
 * anybody can learn anything from. All of it was already being computed and
 * served: `response` has been in the candidate payload since the paper was
 * first sat, and nothing had ever rendered it.
 *
 * **What is shown depends on what is knowable.** A single-answer question has
 * a right answer and this says so. An essay does not: it has a mark somebody
 * gave it, and calling that "correct" or "incorrect" would be inventing a
 * verdict nobody reached. `correct` comes back null for those and the row
 * shows marks alone.
 *
 * **The correct answer appears only when there is no sitting left.** Handing
 * over the key while a candidate can still resit makes the resit meaningless,
 * and banks are shared between papers, so a key given away early leaks into
 * other papers drawn from the same bank. The service decides — see
 * `attemptForCandidate` — and this renders whatever it is given.
 */

/** An option id as the candidate would recognise it: the text they clicked. */
function labelFor(q: PaperQuestion, id: unknown): string {
  const found = q.options?.find((o) => o.id === String(id));
  return found ? found.text : String(id ?? '');
}

/**
 * What the candidate put, in the shape the question was asked in.
 *
 * Every type is handled explicitly rather than falling through to
 * `String(response)` — an unhandled type renders "[object Object]" on somebody's
 * result, which is worse than saying nothing.
 */
function answerOf(q: PaperQuestion): { text: string; blank: boolean } {
  const r = q.response;
  if (r === null || r === undefined || r === '') return { text: 'You left this blank', blank: true };

  if (q.type === 'single') return { text: labelFor(q, r), blank: false };
  if (q.type === 'truefalse') {
    return { text: String(r) === 'true' ? 'True' : 'False', blank: false };
  }
  if (q.type === 'multiple') {
    const chosen = Array.isArray(r) ? r : [r];
    if (!chosen.length) return { text: 'You left this blank', blank: true };
    return { text: chosen.map((id) => labelFor(q, id)).join(', '), blank: false };
  }
  if (q.type === 'code') {
    // The submission itself, not a summary. It is what they wrote.
    return { text: String(r), blank: false };
  }
  // short and essay are free text.
  const text = String(r).trim();
  return text ? { text, blank: false } : { text: 'You left this blank', blank: true };
}

/** The key, in the same shape — so the two lines read as a pair. */
function expectedOf(q: PaperQuestion): string | null {
  const e = q.expected;
  if (e === null || e === undefined || e === '') return null;
  if (q.type === 'single') return labelFor(q, e);
  if (q.type === 'truefalse') return String(e) === 'true' ? 'True' : 'False';
  if (q.type === 'multiple') {
    const all = Array.isArray(e) ? e : [e];
    return all.map((id) => labelFor(q, id)).join(', ');
  }
  // A short answer may accept several spellings, and saying so is fairer than
  // printing one of them as though it were the only one.
  if (Array.isArray(e)) return e.map(String).join(' / ');
  return String(e);
}

export function OnyxAttemptReview({ question, index }: {
  question: PaperQuestion;
  index: number;
}) {
  const answer = answerOf(question);
  const expected = expectedOf(question);
  const awarded = question.awarded === null || question.awarded === undefined
    ? null : Number(question.awarded);

  const verdict = question.correct === true ? 'right'
    : question.correct === false ? 'wrong'
      : null;

  return (
    <li className="p-4">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 min-w-[26px] text-[13px] font-bold text-muted tabular-nums">
          {index + 1}.
        </span>
        <div className="min-w-0 flex-1 space-y-2.5">
          <p className="text-[14px] leading-relaxed text-ink">{question.prompt}</p>

          <div className="space-y-1.5">
            <p className="text-[12px] font-semibold uppercase tracking-wide text-muted">
              Your answer
            </p>
            <div className={'rounded-xl px-3 py-2 text-[13.5px] leading-relaxed '
              + (answer.blank ? 'bg-slate-50 italic text-muted'
                : verdict === 'right' ? 'bg-green-50 text-green-900'
                  : verdict === 'wrong' ? 'bg-red-50 text-red-900'
                    : 'bg-slate-50 text-slate-800')}>
              {question.type === 'code' || question.type === 'essay' ? (
                // Kept as written: whitespace is meaningful in code, and
                // paragraphing is meaningful in prose.
                <pre className="overflow-x-auto whitespace-pre-wrap break-words font-mono
                                text-[12.5px]">{answer.text}</pre>
              ) : answer.text}
            </div>
          </div>

          {expected && verdict !== 'right' ? (
            <div className="space-y-1.5">
              <p className="text-[12px] font-semibold uppercase tracking-wide text-muted">
                Correct answer
              </p>
              <div className="rounded-xl bg-green-50 px-3 py-2 text-[13.5px] leading-relaxed
                              text-green-900">
                {expected}
              </div>
            </div>
          ) : null}

          {question.explanation ? (
            <p className="text-[13px] leading-relaxed text-muted">{question.explanation}</p>
          ) : null}
        </div>

        <div className="flex shrink-0 flex-col items-end gap-1.5">
          {awarded === null
            ? <Pill tone="neutral">Not marked</Pill>
            : <Score value={awarded} outOf={Number(question.points)} />}
          {/*
            * The word as well as the colour. Roughly one man in twelve cannot
            * tell the green panel from the red one, and "right" or "wrong" is
            * the entire content of this screen.
            */}
          {verdict ? (
            <span className={'flex items-center gap-1 text-[12px] font-semibold '
              + (verdict === 'right' ? 'text-green-700' : 'text-red-700')}>
              <Icon name={verdict === 'right' ? 'check' : 'alert'} className="h-3.5 w-3.5" />
              {verdict === 'right' ? 'Correct' : 'Incorrect'}
            </span>
          ) : null}
        </div>
      </div>
    </li>
  );
}
