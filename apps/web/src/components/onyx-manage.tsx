'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Icon } from '@/components/onyx-ui';
import {
  ProblemDraftFields, blankProblemDraft, createProblemFromDraft, problemDraftError,
  type ProblemDraft,
} from '@/components/onyx-code-problem';

/**
 * The management surfaces that take a LIST rather than a record.
 *
 * `CreatePanel` covers "fill in some fields and POST them". These five do
 * not fit that shape: marks are one row per candidate, a fee structure is a
 * set of lines, a problem needs several test cases, seating takes a set of
 * halls. Each is small, but each needs to add and remove rows before it
 * submits, so they live here rather than being bent into the field-spec
 * component.
 */

const input = 'rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm '
  + 'focus:border-brand-600 focus:outline-none';
const btn = 'rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-bold text-white '
  + 'hover:bg-brand-700 disabled:opacity-60';
const ghost = 'rounded-xl border border-line px-3 py-2 text-sm font-semibold';

async function send(path: string, body?: unknown,
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE' = 'POST') {
  const res = await fetch('/api/proxy/onyx/' + path, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return res.json().catch(() => ({ ok: false, message: 'Something went wrong.' }));
}

/**
 * A destructive control on a row, asked once before it fires.
 *
 * Three of these -- taking a lecturer off a course, withdrawing a learner from
 * one, and cutting a verified guardian's link to their child -- went straight
 * through on a single click, in lists where the rows look alike and the next
 * row's button is 40px below the one you meant. Every other destructive act in
 * this file already asked first; these three were simply never given the same
 * treatment.
 *
 * A two-step inline confirm rather than a modal, because that is what the rest
 * of this file uses for row-scoped acts (DeleteExamButton, the question-bank
 * trash, the timetable ✕) and one idiom is worth more than a nicer second one.
 * `subject` names who it is about, so the question is answerable without
 * looking back up at the row.
 */
function ConfirmRowAction({ label, question, subject, onConfirm }: {
  label: string; question: string; subject: string; onConfirm: () => Promise<void>;
}) {
  const [confirming, setConfirming] = useState(false);
  const [pending, start] = useTransition();

  if (!confirming) {
    return (
      <button type="button" onClick={() => setConfirming(true)}
        className="inline-flex min-h-[36px] shrink-0 items-center px-2 text-xs font-semibold
                   text-rose-700 hover:underline">
        {label}
      </button>
    );
  }
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 text-xs">
      <span className="max-w-[12rem] truncate text-muted">{question} {subject}?</span>
      <button type="button" disabled={pending}
        onClick={() => start(async () => { await onConfirm(); setConfirming(false); })}
        className="font-bold text-rose-700 hover:underline disabled:opacity-50">
        {pending ? 'Working…' : 'Yes'}
      </button>
      <button type="button" onClick={() => setConfirming(false)}
        className="text-muted hover:underline">No</button>
    </span>
  );
}

function Shell({ title, open, setOpen, cta, children, onSubmit, pending, error }: {
  title: string; open: boolean; setOpen: (v: boolean) => void; cta: string;
  children: React.ReactNode; onSubmit: () => void; pending: boolean; error: string | null;
}) {
  if (!open) {
    // w-fit/shrink-0/self-start/justify-self-start: without these, a closed
    // trigger sitting in a CSS Grid cell next to a taller sibling (a panel
    // like "Schedule an exam" that stretches the row) stretches to fill the
    // whole cell -- the button was still a button, just the size of a
    // postcard, with its label pinned in a corner. Same fix as CreatePanel's
    // own closed button, which had the identical bug in a different
    // component.
    return (
      <button type="button" onClick={() => setOpen(true)}
        className="inline-flex w-fit shrink-0 items-center gap-2 self-start
                   justify-self-start rounded-xl bg-brand-600 px-3 py-2
                   text-[13px] font-semibold text-white hover:bg-brand-700">
        <Icon name="edit" className="h-4 w-4" />{cta}
      </button>
    );
  }
  return (
    <form className="rounded-2xl border border-line bg-white p-4 shadow-card"
      onSubmit={(e) => { e.preventDefault(); onSubmit(); }}>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-bold">{title}</h3>
        <button type="button" onClick={() => setOpen(false)} aria-label="Cancel"
          className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-line text-muted">
          ✕
        </button>
      </div>
      {children}
      {error ? (
        <p role="alert" className="mt-3 rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </p>
      ) : null}
      <div className="mt-4 flex gap-2">
        <button type="submit" disabled={pending} className={btn}>
          {pending ? 'Saving…' : cta}
        </button>
        <button type="button" onClick={() => setOpen(false)} className={ghost}>Cancel</button>
      </div>
    </form>
  );
}

/* ------------------------------------------------------ CMP-02: seating ---- */

export function AllocateSeating({ examId, halls }: {
  examId: number; halls: { id: number; code: string; name: string; capacity: number }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<number[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <Shell title="Allocate seating" cta="Allocate seating" open={open} setOpen={setOpen}
      pending={pending} error={error}
      onSubmit={() => start(async () => {
        setError(null);
        const res = await send(`exams/${examId}/seating`, { hall_ids: picked });
        if (!res.ok) { setError(res.message ?? 'That did not work.'); return; }
        setOpen(false); router.refresh();
      })}>
      <p className="mb-2 text-xs text-muted">
        Every candidate gets one seat and no seat gets two, enforced by the database.
        Re-running replaces the plan rather than adding to it.
      </p>
      <ul className="space-y-1.5">
        {halls.map((h) => (
          <li key={h.id}>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="h-4 w-4 rounded border-slate-300"
                checked={picked.includes(h.id)}
                onChange={(e) => setPicked((p) =>
                  e.target.checked ? [...p, h.id] : p.filter((x) => x !== h.id))} />
              <span className="font-medium">{h.code}</span>
              <span className="text-muted">{h.name} · {h.capacity} seats</span>
            </label>
          </li>
        ))}
        {halls.length === 0 ? (
          <li className="text-sm text-muted">Add a hall first.</li>
        ) : null}
      </ul>
    </Shell>
  );
}

/* -------------------------------------------------------- CMP-02: marks ---- */

export function EnterMarks({ examId, maxMarks, candidates }: {
  examId: number; maxMarks: number;
  candidates: { user_id: string; name: string; current?: number | null }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [marks, setMarks] = useState<Record<string, string>>(
    Object.fromEntries(candidates.map((c) => [c.user_id,
      c.current === null || c.current === undefined ? '' : String(c.current)])));
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <Shell title="Enter marks" cta="Enter marks" open={open} setOpen={setOpen}
      pending={pending} error={error}
      onSubmit={() => start(async () => {
        setError(null);
        // Only the boxes that were actually filled in -- a blank is "not
        // marked yet", not a zero, and sending it as one would fail a
        // candidate who simply has not been marked.
        const entries = candidates
          .filter((c) => String(marks[c.user_id] ?? '').trim() !== '')
          .map((c) => ({ user_id: c.user_id, raw_marks: Number(marks[c.user_id]) }));
        if (!entries.length) { setError('Nothing to save.'); return; }
        const res = await send(`exams/${examId}/marks`, { entries });
        if (!res.ok) { setError(res.message ?? 'That did not work.'); return; }
        setOpen(false); router.refresh();
      })}>
      <p className="mb-2 text-xs text-muted">
        Out of {maxMarks}. A learner sees nothing until results are published.
      </p>
      <ul className="divide-y divide-line rounded-xl border border-line">
        {candidates.map((c) => (
          <li key={c.user_id} className="flex items-center gap-3 px-3 py-2">
            <span className="min-w-0 flex-1 truncate text-sm">{c.name}</span>
            <label className="sr-only" htmlFor={'mark-' + c.user_id}>
              Marks for {c.name}
            </label>
            <input id={'mark-' + c.user_id} type="number" min={0} max={maxMarks}
              value={marks[c.user_id] ?? ''} className={input + ' w-24 text-right'}
              onChange={(e) => setMarks((m) => ({ ...m, [c.user_id]: e.target.value }))} />
          </li>
        ))}
        {candidates.length === 0 ? (
          <li className="px-3 py-4 text-sm text-muted">Nobody is enrolled in this course.</li>
        ) : null}
      </ul>
    </Shell>
  );
}

/**
 * Editing the exam record itself -- title, timing, marks scheme, status.
 * `PATCH /api/onyx/exams/:id` is open to the examinations office (admin or
 * exams) and, same as scheduling it in the first place, to this exam's own
 * course's faculty (assertCanRunExam) -- not examinations-office only.
 * Deliberately does not re-run the clash check `schedule()` does; see the
 * service for why.
 */
export function ExamEditForm({ examId, exam }: {
  examId: number;
  exam: {
    title: string; starts_at: string; duration_minutes: number;
    max_marks: number; pass_marks: number; status: string;
  };
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // <input type="datetime-local"> wants "YYYY-MM-DDTHH:mm" in local time, not
  // the ISO string the API gives back.
  const localValue = (iso: string) => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
      `T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)}
        className="inline-flex min-h-[38px] items-center gap-2 rounded-2xl border border-line
                   px-3.5 text-[13px] font-bold text-slate-700 hover:bg-brand-50">
        <Icon name="edit" className="h-4 w-4" />Edit exam
      </button>
    );
  }
  return (
    <form
      className="w-full space-y-2.5 rounded-xl border border-line bg-white p-3.5"
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        start(async () => {
          setError(null);
          const startsAt = String(data.get('starts_at') ?? '');
          const res = await send('exams/' + examId, {
            title: String(data.get('title') ?? ''),
            starts_at: startsAt ? new Date(startsAt).toISOString() : null,
            duration_minutes: Number(data.get('duration_minutes') || 0),
            max_marks: Number(data.get('max_marks') || 0),
            pass_marks: Number(data.get('pass_marks') || 0),
            status: String(data.get('status') ?? ''),
          }, 'PATCH');
          if (!res.ok) { setError(res.message ?? 'That did not work.'); return; }
          setOpen(false);
          router.refresh();
        });
      }}
    >
      {error ? <p role="alert" className="text-xs text-rose-700">{error}</p> : null}
      <div>
        <label className="block text-xs font-semibold text-slate-700" htmlFor="ex-title">Title</label>
        <input id="ex-title" name="title" defaultValue={exam.title} required maxLength={255}
          className={input + ' mt-1 w-full'} />
      </div>
      <div className="grid gap-2.5 sm:grid-cols-2">
        <div>
          <label className="block text-xs font-semibold text-slate-700" htmlFor="ex-starts">
            Starts
          </label>
          <input id="ex-starts" name="starts_at" type="datetime-local"
            defaultValue={localValue(exam.starts_at)} className={input + ' mt-1 w-full'} />
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-700" htmlFor="ex-duration">
            Duration (min)
          </label>
          <input id="ex-duration" name="duration_minutes" type="number" min={5} max={600}
            defaultValue={exam.duration_minutes} className={input + ' mt-1 w-full'} />
        </div>
      </div>
      <div className="grid gap-2.5 sm:grid-cols-2">
        <div>
          <label className="block text-xs font-semibold text-slate-700" htmlFor="ex-max">
            Out of
          </label>
          <input id="ex-max" name="max_marks" type="number" min={1} max={1000}
            defaultValue={exam.max_marks} className={input + ' mt-1 w-full'} />
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-700" htmlFor="ex-pass">
            Pass mark
          </label>
          <input id="ex-pass" name="pass_marks" type="number" min={0} max={1000}
            defaultValue={exam.pass_marks} className={input + ' mt-1 w-full'} />
        </div>
      </div>
      <div>
        <label className="block text-xs font-semibold text-slate-700" htmlFor="ex-status">
          Status
        </label>
        <select id="ex-status" name="status" defaultValue={exam.status}
          className={input + ' mt-1 w-full'}>
          <option value="draft">Draft</option>
          <option value="scheduled">Scheduled</option>
          <option value="completed">Completed</option>
          <option value="cancelled">Cancelled</option>
        </select>
      </div>
      <div className="flex gap-2 pt-1">
        <button type="submit" disabled={pending} className={btn}>
          {pending ? 'Saving…' : 'Save'}
        </button>
        <button type="button" onClick={() => setOpen(false)} className={ghost}>Cancel</button>
      </div>
    </form>
  );
}

/**
 * Removing an exam outright -- not the same as `ExamEditForm`'s "Cancelled"
 * status, which keeps the row as a record of what was scheduled and then
 * called off. This is for the case that record shouldn't exist at all: a
 * mis-scheduled paper, a duplicate, a test. Seating and marks go with it
 * (cascaded at the database); the linked assessment, if there is one, does
 * not -- the paper and its bank are the course's, not this one slot's.
 * `DELETE /api/onyx/exams/:id` shares the same guard as editing it
 * (assertCanRunExam), so this is offered wherever `ExamEditForm` is.
 * Navigates back to the exam list on success, since this page stops existing.
 */
export function DeleteExamButton({ examId }: { examId: number }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (!confirming) {
    return (
      <button type="button" onClick={() => setConfirming(true)}
        className="inline-flex min-h-[38px] items-center gap-2 rounded-2xl border
                   border-rose-600 px-3.5 text-[13px] font-bold text-rose-700
                   hover:bg-rose-50">
        <Icon name="trash" className="h-4 w-4" />Delete exam
      </button>
    );
  }
  return (
    <span className="inline-flex items-center gap-2">
      <span className="text-[13px] font-semibold text-rose-700">Delete this exam for good?</span>
      <button type="button" disabled={pending}
        className="rounded-xl bg-rose-600 px-3 py-2 text-[13px] font-bold text-white
                   disabled:opacity-60"
        onClick={() => start(async () => {
          setError(null);
          const res = await send('exams/' + examId, undefined, 'DELETE');
          if (!res.ok) { setError(res.message ?? 'That did not work.'); return; }
          router.push('/onyx/exams');
          router.refresh();
        })}>
        {pending ? 'Deleting…' : 'Delete'}
      </button>
      <button type="button" onClick={() => setConfirming(false)} className={ghost}>Cancel</button>
      {error ? <span role="alert" className="text-[13px] text-rose-700">{error}</span> : null}
    </span>
  );
}

/**
 * Overriding one candidate's mark, in place in the register. Distinct from
 * `EnterMarks` (which fills in blanks, in bulk, before publication) -- this
 * is the dispute-resolution path: it works on a single mark, at any status,
 * including a paper that has already been published. `updateMark()` on the
 * API enforces the same examinations-office-only gate.
 */
export function MarkOverride({ markId, maxMarks, current }: {
  markId: number; maxMarks: number; current: number | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(current === null ? '' : String(current));
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)}
        className="grid min-h-[32px] min-w-[32px] place-items-center rounded-md text-faint
                   hover:bg-brand-50 hover:text-brand-600"
        aria-label="Override this mark">
        <Icon name="edit" className="h-3.5 w-3.5" />
      </button>
    );
  }
  return (
    <span className="inline-flex items-center gap-1">
      <input type="number" min={0} max={maxMarks} value={value} autoFocus
        aria-label="Override mark" className={input + ' w-16 py-1 text-right'}
        onChange={(e) => setValue(e.target.value)} />
      <button type="button" disabled={pending}
        className="rounded-md bg-brand-600 px-1.5 py-1 text-[11px] font-bold text-white
                   disabled:opacity-60"
        onClick={() => start(async () => {
          setError(null);
          if (value.trim() === '') { setError('Enter a mark.'); return; }
          const res = await send('exam-marks/' + markId, { final_marks: Number(value) }, 'PATCH');
          if (!res.ok) { setError(res.message ?? 'That did not work.'); return; }
          setOpen(false); router.refresh();
        })}>
        {pending ? '…' : 'Save'}
      </button>
      <button type="button" onClick={() => setOpen(false)} aria-label="Cancel"
        className="rounded-md p-1 text-faint hover:bg-slate-100">
        <Icon name="x" className="h-3.5 w-3.5" />
      </button>
      {error ? <span role="alert" className="text-[11px] text-rose-700">{error}</span> : null}
    </span>
  );
}

/**
 * Editing the assessment record itself -- title, window, pass mark, duration,
 * status. `PATCH /api/onyx/assessments/:id` is open to the same STAFF set
 * (admin/faculty/exams) that can already create and publish one.
 */
export function AssessmentEditForm({ assessmentId, assessment }: {
  assessmentId: number;
  assessment: {
    title: string; opens_at: string | null; closes_at: string | null;
    pass_mark: number | null; duration_minutes: number; status: string;
  };
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const localValue = (iso: string | null) => {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
      `T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)}
        className="inline-flex min-h-[38px] items-center gap-2 rounded-2xl border border-line
                   px-3.5 text-[13px] font-bold text-slate-700 hover:bg-brand-50">
        <Icon name="edit" className="h-4 w-4" />Edit assessment
      </button>
    );
  }
  return (
    <form
      className="w-full space-y-2.5 rounded-xl border border-line bg-white p-3.5"
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        start(async () => {
          setError(null);
          const opensAt = String(data.get('opens_at') ?? '');
          const closesAt = String(data.get('closes_at') ?? '');
          const passMark = String(data.get('pass_mark') ?? '');
          const res = await send('assessments/' + assessmentId, {
            title: String(data.get('title') ?? ''),
            opens_at: opensAt ? new Date(opensAt).toISOString() : null,
            closes_at: closesAt ? new Date(closesAt).toISOString() : null,
            pass_mark: passMark.trim() === '' ? null : Number(passMark),
            duration_minutes: Number(data.get('duration_minutes') || 0),
            status: String(data.get('status') ?? ''),
          }, 'PATCH');
          if (!res.ok) { setError(res.message ?? 'That did not work.'); return; }
          setOpen(false);
          router.refresh();
        });
      }}
    >
      {error ? <p role="alert" className="text-xs text-rose-700">{error}</p> : null}
      <div>
        <label className="block text-xs font-semibold text-slate-700" htmlFor="as-title">Title</label>
        <input id="as-title" name="title" defaultValue={assessment.title} required maxLength={255}
          className={input + ' mt-1 w-full'} />
      </div>
      <div className="grid gap-2.5 sm:grid-cols-2">
        <div>
          <label className="block text-xs font-semibold text-slate-700" htmlFor="as-opens">
            Opens
          </label>
          <input id="as-opens" name="opens_at" type="datetime-local"
            defaultValue={localValue(assessment.opens_at)} className={input + ' mt-1 w-full'} />
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-700" htmlFor="as-closes">
            Closes
          </label>
          <input id="as-closes" name="closes_at" type="datetime-local"
            defaultValue={localValue(assessment.closes_at)} className={input + ' mt-1 w-full'} />
        </div>
      </div>
      <div className="grid gap-2.5 sm:grid-cols-2">
        <div>
          <label className="block text-xs font-semibold text-slate-700" htmlFor="as-duration">
            Duration (min)
          </label>
          <input id="as-duration" name="duration_minutes" type="number" min={1} max={1440}
            defaultValue={assessment.duration_minutes} className={input + ' mt-1 w-full'} />
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-700" htmlFor="as-pass">
            Pass mark
          </label>
          <input id="as-pass" name="pass_mark" type="number" min={0}
            defaultValue={assessment.pass_mark ?? ''} className={input + ' mt-1 w-full'} />
        </div>
      </div>
      <div>
        <label className="block text-xs font-semibold text-slate-700" htmlFor="as-status">
          Status
        </label>
        {/* "Published" is gone from this list on purpose.
            Selecting it here exposed a paper to every candidate on save, with
            no confirmation and no preview -- while the composer on the same
            page gates the identical act behind a review step and a distinct
            button. Two ways to do one irreversible thing, one of them
            accidental. Draft and Closed are the corrections this form is for;
            publishing goes through the door built for it. */}
        <select id="as-status" name="status" defaultValue={assessment.status}
          className={input + ' mt-1 w-full'}>
          <option value="draft">Draft</option>
          <option value="closed">Closed</option>
          {assessment.status === 'published'
            ? <option value="published">Published</option> : null}
        </select>
        <p className="mt-1 text-xs text-muted">
          {assessment.status === 'draft'
            ? 'Use “Edit the whole paper” to review and publish it.'
            : 'Closing stops new attempts. It does not release results.'}
        </p>
      </div>
      <div className="flex gap-2 pt-1">
        <button type="submit" disabled={pending} className={btn}>
          {pending ? 'Saving…' : 'Save'}
        </button>
        <button type="button" onClick={() => setOpen(false)} className={ghost}>Cancel</button>
      </div>
    </form>
  );
}

/**
 * Overriding one candidate's total score, in place in the results table.
 * Distinct from `OnyxMarker`'s per-question marking -- this sets the paper's
 * final score directly, the dispute-resolution path for a result that has
 * already gone through the ordinary marking flow (including a published
 * one). `overrideScore()` on the API enforces the same STAFF-only gate.
 */
export function ScoreOverride({ attemptId, maxScore, current }: {
  attemptId: number; maxScore: number; current: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(String(current));
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)}
        className="grid min-h-[32px] min-w-[32px] place-items-center rounded-md text-faint
                   hover:bg-brand-50 hover:text-brand-600"
        aria-label="Override this score">
        <Icon name="edit" className="h-3.5 w-3.5" />
      </button>
    );
  }
  return (
    <span className="inline-flex items-center gap-1">
      <input type="number" min={0} max={maxScore} value={value} autoFocus
        aria-label="Override score" className={input + ' w-16 py-1 text-right'}
        onChange={(e) => setValue(e.target.value)} />
      <button type="button" disabled={pending}
        className="rounded-md bg-brand-600 px-1.5 py-1 text-[11px] font-bold text-white
                   disabled:opacity-60"
        onClick={() => start(async () => {
          setError(null);
          if (value.trim() === '') { setError('Enter a score.'); return; }
          const res = await send('attempts/' + attemptId + '/score', { score: Number(value) },
            'PATCH');
          if (!res.ok) { setError(res.message ?? 'That did not work.'); return; }
          setOpen(false); router.refresh();
        })}>
        {pending ? '…' : 'Save'}
      </button>
      <button type="button" onClick={() => setOpen(false)} aria-label="Cancel"
        className="rounded-md p-1 text-faint hover:bg-slate-100">
        <Icon name="x" className="h-3.5 w-3.5" />
      </button>
      {error ? <span role="alert" className="text-[11px] text-rose-700">{error}</span> : null}
    </span>
  );
}

/* ----------------------------------------------- CMP-03: fee structures ---- */

export function BuildFeeStructure({ heads }: {
  heads: { id: number; code: string; name: string }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [instalments, setInstalments] = useState('1');
  const [lines, setLines] = useState<{ head_id: string; rupees: string }[]>(
    [{ head_id: '', rupees: '' }]);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <Shell title="New fee structure" cta="Build a fee structure" open={open} setOpen={setOpen}
      pending={pending} error={error}
      onSubmit={() => start(async () => {
        setError(null);
        const clean = lines
          .filter((l) => l.head_id && l.rupees !== '')
          // Money is stored in paise. Entering rupees and multiplying here
          // keeps the decimal out of the database entirely.
          .map((l) => ({
            head_id: Number(l.head_id),
            amount_minor: Math.round(Number(l.rupees) * 100),
          }));
        if (!clean.length) { setError('Add at least one line.'); return; }
        const made = await send('fee-structures',
          { name, instalments: Number(instalments), lines: clean });
        if (!made.ok) { setError(made.message ?? 'That did not work.'); return; }
        const pub = await send(`fee-structures/${made.data.id}/publish`);
        if (!pub.ok) { setError(pub.message ?? 'Created, but not published.'); return; }
        setOpen(false); router.refresh();
      })}>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="block text-[13px] font-semibold text-slate-700" htmlFor="fs-name">
            Name
          </label>
          <input id="fs-name" required value={name} onChange={(e) => setName(e.target.value)}
            placeholder="Term 1 fees" className={input + ' mt-1 w-full'} />
        </div>
        <div>
          <label className="block text-[13px] font-semibold text-slate-700" htmlFor="fs-inst">
            Instalments
          </label>
          <input id="fs-inst" type="number" min={1} max={12} value={instalments}
            onChange={(e) => setInstalments(e.target.value)} className={input + ' mt-1 w-full'} />
        </div>
      </div>

      <div className="mt-3 space-y-2">
        {lines.map((l, i) => (
          <div key={i} className="flex gap-2">
            <label className="sr-only" htmlFor={'fs-head-' + i}>Fee head</label>
            <select id={'fs-head-' + i} value={l.head_id} className={input + ' flex-1'}
              onChange={(e) => setLines((ls) =>
                ls.map((x, j) => (j === i ? { ...x, head_id: e.target.value } : x)))}>
              <option value="">Choose a fee head…</option>
              {heads.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
            </select>
            <label className="sr-only" htmlFor={'fs-amt-' + i}>Amount in rupees</label>
            <input id={'fs-amt-' + i} type="number" min={0} step="0.01" placeholder="Rupees"
              value={l.rupees} className={input + ' w-36'}
              onChange={(e) => setLines((ls) =>
                ls.map((x, j) => (j === i ? { ...x, rupees: e.target.value } : x)))} />
            <button type="button" aria-label={'Remove line ' + (i + 1)} className={ghost}
              onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}>✕</button>
          </div>
        ))}
        <button type="button" className={ghost}
          onClick={() => setLines((ls) => [...ls, { head_id: '', rupees: '' }])}>
          Add a line
        </button>
      </div>
    </Shell>
  );
}

/* -------------------------------------------------- LAB-01: a problem ---- */

const SOLUTION_RULE_LABELS: Record<string, string> = {
  never: 'Never shown',
  after_solve: 'Once they solve it',
  after_attempts: 'After a number of attempts',
  after_date: 'After a date',
};

/**
 * "Add a problem" used to collect three fields (title, statement,
 * difficulty) and stop -- everything the API actually accepts a problem for
 * (topic, tags, time and memory limits, which course it belongs to, the
 * worked solution and when it releases) had no form anywhere, and creating
 * one landed back on the list with no way to find the draft it just made.
 * This collects the whole thing and, on success, goes straight to the new
 * problem's own page -- which is also where TestCases lives, so "set the
 * question up" and "set its cases up" are now one continuous action instead
 * of a create, then a hunt through the list for a row marked Draft.
 */
export function CreateProblem({ courses }: { courses: { id: number; label: string }[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [statement, setStatement] = useState('');
  const [difficulty, setDifficulty] = useState('easy');
  const [topic, setTopic] = useState('');
  const [tags, setTags] = useState('');
  const [timeLimit, setTimeLimit] = useState('5');
  const [memoryLimit, setMemoryLimit] = useState('256');
  const [courseId, setCourseId] = useState('');
  const [solution, setSolution] = useState('');
  const [solutionRule, setSolutionRule] = useState('never');
  const [afterAttempts, setAfterAttempts] = useState('3');
  const [afterDate, setAfterDate] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <Shell title="New problem" cta="Add a problem" open={open} setOpen={setOpen}
      pending={pending} error={error}
      onSubmit={() => start(async () => {
        setError(null);
        const made = await send('problems', {
          title,
          statement: statement || null,
          difficulty,
          topic: topic.trim() || null,
          tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
          time_limit_ms: Math.round((Number(timeLimit) || 5) * 1000),
          memory_limit_kb: Math.round((Number(memoryLimit) || 256) * 1024),
          course_id: courseId ? Number(courseId) : null,
          solution: solution.trim() || null,
          solution_rule: solutionRule,
          solution_after_attempts: solutionRule === 'after_attempts'
            ? Number(afterAttempts) || 3 : undefined,
          solution_after: solutionRule === 'after_date' && afterDate
            ? new Date(afterDate).toISOString() : null,
        });
        if (!made.ok) { setError(made.message ?? 'That did not work.'); return; }
        // Left as a draft on creation -- the API refuses to publish a
        // problem with no test cases, so the next screen (this problem's
        // own page) is where that actually gets finished, not here.
        setOpen(false);
        router.push('/onyx/practice/' + made.data.id);
      })}>
      <p className="mb-2 text-xs text-muted">
        Created as a draft. The next screen sets its test cases, which the problem
        cannot be published without.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className="block text-[13px] font-semibold text-slate-700" htmlFor="pr-title">
            Problem
          </label>
          <input id="pr-title" name="title" required value={title} onChange={(e) => setTitle(e.target.value)}
            placeholder="Two Sum" className={input + ' mt-1 w-full'} />
        </div>
        <div className="sm:col-span-2">
          <label className="block text-[13px] font-semibold text-slate-700" htmlFor="pr-stmt">
            Statement
          </label>
          <textarea id="pr-stmt" name="statement" required rows={4} value={statement}
            onChange={(e) => setStatement(e.target.value)}
            className={input + ' mt-1 w-full'} />
        </div>
        <div>
          <label className="block text-[13px] font-semibold text-slate-700" htmlFor="pr-diff">
            Difficulty
          </label>
          <select id="pr-diff" name="difficulty" value={difficulty} onChange={(e) => setDifficulty(e.target.value)}
            className={input + ' mt-1 w-full'}>
            {['easy', 'medium', 'hard'].map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-[13px] font-semibold text-slate-700" htmlFor="pr-topic">
            Topic
          </label>
          <input id="pr-topic" name="topic" value={topic} onChange={(e) => setTopic(e.target.value)}
            placeholder="Loops" className={input + ' mt-1 w-full'} />
        </div>
        <div className="sm:col-span-2">
          <label className="block text-[13px] font-semibold text-slate-700" htmlFor="pr-tags">
            Tags
          </label>
          <input id="pr-tags" name="tags" value={tags} onChange={(e) => setTags(e.target.value)}
            placeholder="arrays, easy" className={input + ' mt-1 w-full'} />
          <p className="mt-1 text-xs text-muted">Comma-separated.</p>
        </div>
        <div>
          <label className="block text-[13px] font-semibold text-slate-700" htmlFor="pr-time">
            Time per case (s)
          </label>
          <input id="pr-time" name="time_limit" type="number" min={0.1} max={30} step="0.1" value={timeLimit}
            onChange={(e) => setTimeLimit(e.target.value)} className={input + ' mt-1 w-full'} />
        </div>
        <div>
          <label className="block text-[13px] font-semibold text-slate-700" htmlFor="pr-mem">
            Memory per case (MB)
          </label>
          <input id="pr-mem" name="memory_limit" type="number" min={16} max={1024} value={memoryLimit}
            onChange={(e) => setMemoryLimit(e.target.value)} className={input + ' mt-1 w-full'} />
        </div>
        <div className="sm:col-span-2">
          <label className="block text-[13px] font-semibold text-slate-700" htmlFor="pr-course">
            Course
          </label>
          <select id="pr-course" name="course_id" value={courseId} onChange={(e) => setCourseId(e.target.value)}
            className={input + ' mt-1 w-full'}>
            <option value="">Not tied to a course</option>
            {courses.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        </div>

        <fieldset className="sm:col-span-2 rounded-xl border border-line p-3">
          <legend className="px-1 text-[13px] font-semibold text-slate-700">
            Worked solution
          </legend>
          <label className="block text-xs font-semibold text-slate-700" htmlFor="pr-sol">
            Solution (optional)
          </label>
          <textarea id="pr-sol" name="solution" rows={3} value={solution}
            onChange={(e) => setSolution(e.target.value)}
            className={input + ' mt-1 w-full font-mono text-xs'} />
          <label className="mt-2 block text-xs font-semibold text-slate-700" htmlFor="pr-rule">
            Release it to a learner
          </label>
          <select id="pr-rule" name="solution_rule" value={solutionRule}
            onChange={(e) => setSolutionRule(e.target.value)} className={input + ' mt-1 w-full'}>
            {Object.entries(SOLUTION_RULE_LABELS).map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
          {solutionRule === 'after_attempts' ? (
            <div className="mt-2">
              <label className="block text-xs font-semibold text-slate-700" htmlFor="pr-attempts">
                After this many attempts
              </label>
              <input id="pr-attempts" name="after_attempts" type="number" min={1} max={100} value={afterAttempts}
                onChange={(e) => setAfterAttempts(e.target.value)}
                className={input + ' mt-1 w-full'} />
            </div>
          ) : null}
          {solutionRule === 'after_date' ? (
            <div className="mt-2">
              <label className="block text-xs font-semibold text-slate-700" htmlFor="pr-after">
                From
              </label>
              <input id="pr-after" name="after_date" type="datetime-local" value={afterDate}
                onChange={(e) => setAfterDate(e.target.value)}
                className={input + ' mt-1 w-full'} />
            </div>
          ) : null}
        </fieldset>
      </div>
    </Shell>
  );
}

/* ------------------------------------------------- LAB-03: test cases ---- */


export function TestCases({ problemId, initial, published }: {
  problemId: number;
  /** The problem's existing cases, staff-visible (hidden ones included) --
   *  see CodeLabService#problem()'s own comment on why staff get the
   *  unredacted list. Missing or empty means "nothing set yet". */
  initial?: { name?: string; stdin: string | null; expected_stdout: string | null; is_hidden: number | boolean }[];
  published?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [unpublishing, startUnpublish] = useTransition();
  const [unpublishError, setUnpublishError] = useState<string | null>(null);
  const seed = (initial ?? []).length
    ? initial!.map((t) => ({
      name: t.name ?? '', stdin: t.stdin ?? '', expected_stdout: t.expected_stdout ?? '',
      is_hidden: Boolean(t.is_hidden),
    }))
    : [
      { name: '', stdin: '', expected_stdout: '', is_hidden: false },
      { name: '', stdin: '', expected_stdout: '', is_hidden: true },
    ];
  const [cases, setCases] = useState(seed);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  // A published problem's cases are fixed -- see setTests()'s own comment:
  // changing them under submissions already graded would regrade those
  // silently. The only door back to editing them is here, deliberate and
  // separate, not something opening this panel does for you.
  if (published) {
    return (
      <div className="rounded-2xl border border-line bg-white p-4">
        <p className="text-[13px] text-muted">
          This problem is published, so its test cases are fixed — changing them under
          submissions already marked would regrade those silently. Unpublish it to edit
          them; it stops accepting new submissions until you publish it again.
        </p>
        {unpublishError ? (
          <p role="alert" className="mt-2 text-xs text-rose-700">{unpublishError}</p>
        ) : null}
        <button type="button" disabled={unpublishing}
          className={ghost + ' mt-3 disabled:opacity-60'}
          onClick={() => startUnpublish(async () => {
            setUnpublishError(null);
            const res = await send(`problems/${problemId}/unpublish`);
            if (!res.ok) { setUnpublishError(res.message ?? 'That did not work.'); return; }
            router.refresh();
          })}>
          {unpublishing ? 'Unpublishing…' : 'Unpublish to edit'}
        </button>
      </div>
    );
  }

  return (
    <Shell title="Test cases" cta={(initial ?? []).length ? 'Edit test cases' : 'Set test cases and publish'}
      open={open} setOpen={setOpen}
      pending={pending} error={error}
      onSubmit={() => start(async () => {
        setError(null);
        const clean = cases.filter((c) => c.expected_stdout.trim() !== '');
        if (!clean.length) { setError('A test needs expected output.'); return; }
        if (!clean.some((c) => !c.is_hidden)) {
          setError('At least one case has to be visible — otherwise a learner '
            + 'only learns that they were wrong.');
          return;
        }
        const saved = await send(`problems/${problemId}/tests`,
          { tests: clean.map((c) => ({ ...c, name: c.name.trim() || undefined })) }, 'PUT');
        if (!saved.ok) { setError(saved.message ?? 'That did not work.'); return; }
        // Already published once, being edited after an unpublish: leave it
        // as the draft it now is rather than re-publishing behind their
        // back -- publishing is its own decision, made from this same page.
        if (!(initial ?? []).length) {
          const pub = await send(`problems/${problemId}/publish`);
          if (!pub.ok) { setError(pub.message ?? 'Saved, but not published.'); return; }
        }
        setOpen(false); router.refresh();
      })}>
      <p className="mb-2 text-xs text-muted">
        A hidden case stops the answer being read off the examples. At least one has to
        be visible, and the problem cannot be published without them.
      </p>
      <div className="space-y-3">
        {cases.map((c, i) => (
          <div key={i} className="rounded-xl border border-line p-3">
            <label className="block text-xs font-semibold" htmlFor={'tc-name-' + i}>
              Name (optional)
            </label>
            <input id={'tc-name-' + i} value={c.name} placeholder={'Case ' + (i + 1)}
              className={input + ' mt-1 w-full text-xs'}
              onChange={(e) => setCases((cs) =>
                cs.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-semibold" htmlFor={'tc-in-' + i}>Input</label>
                <textarea id={'tc-in-' + i} rows={2} value={c.stdin}
                  className={input + ' mt-1 w-full font-mono text-xs'}
                  onChange={(e) => setCases((cs) =>
                    cs.map((x, j) => (j === i ? { ...x, stdin: e.target.value } : x)))} />
              </div>
              <div>
                <label className="block text-xs font-semibold" htmlFor={'tc-out-' + i}>
                  Expected output
                </label>
                <textarea id={'tc-out-' + i} rows={2} value={c.expected_stdout}
                  className={input + ' mt-1 w-full font-mono text-xs'}
                  onChange={(e) => setCases((cs) =>
                    cs.map((x, j) => (j === i ? { ...x, expected_stdout: e.target.value } : x)))} />
              </div>
            </div>
            <div className="mt-2 flex items-center justify-between gap-2">
              <label className="flex items-center gap-2 text-xs font-semibold">
                <input type="checkbox" checked={c.is_hidden}
                  className="h-4 w-4 rounded border-slate-300"
                  onChange={(e) => setCases((cs) =>
                    cs.map((x, j) => (j === i ? { ...x, is_hidden: e.target.checked } : x)))} />
                Hidden from the learner
              </label>
              {cases.length > 1 ? (
                <button type="button" aria-label={'Remove ' + (c.name || 'case ' + (i + 1))}
                  className="inline-flex min-h-[36px] items-center px-2 text-xs font-semibold
                             text-rose-700 hover:underline"
                  onClick={() => setCases((cs) => cs.filter((_, j) => j !== i))}>
                  Remove
                </button>
              ) : null}
            </div>
          </div>
        ))}
        <button type="button" className={ghost}
          onClick={() => setCases((cs) =>
            [...cs, { name: '', stdin: '', expected_stdout: '', is_hidden: true }])}>
          Add a case
        </button>
      </div>
    </Shell>
  );
}

/**
 * Editing a problem's own settings after it exists -- title, statement,
 * topic, tags, limits, which course it belongs to, the worked solution and
 * when it releases. `PATCH /problems/:id` stays open regardless of publish
 * status (see the route's own comment), unlike test cases just above, so
 * this is reachable whether the problem is a draft or already live.
 */
export function ProblemSettingsForm({ problemId, problem, courses }: {
  problemId: number;
  problem: {
    title: string; statement: string | null; difficulty: string;
    topic: string | null; tags: string[]; course_id: number | null;
    time_limit_ms: number; memory_limit_kb: number;
    solution: string | null; solution_rule: string;
    solution_after_attempts: number | null; solution_after: string | null;
  };
  courses: { id: number; label: string }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(problem.title);
  const [statement, setStatement] = useState(problem.statement ?? '');
  const [difficulty, setDifficulty] = useState(problem.difficulty);
  const [topic, setTopic] = useState(problem.topic ?? '');
  const [tags, setTags] = useState((problem.tags ?? []).join(', '));
  const [timeLimit, setTimeLimit] = useState(String(problem.time_limit_ms / 1000));
  const [memoryLimit, setMemoryLimit] = useState(String(Math.round(problem.memory_limit_kb / 1024)));
  const [courseId, setCourseId] = useState(problem.course_id ? String(problem.course_id) : '');
  const [solution, setSolution] = useState(problem.solution ?? '');
  const [solutionRule, setSolutionRule] = useState(problem.solution_rule);
  const [afterAttempts, setAfterAttempts] = useState(String(problem.solution_after_attempts ?? 3));
  const [afterDate, setAfterDate] = useState(problem.solution_after
    ? problem.solution_after.slice(0, 16) : '');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 rounded-xl border border-line px-3 py-2
                   text-[13px] font-semibold text-slate-700 hover:bg-brand-50">
        <Icon name="edit" className="h-4 w-4" />Edit problem settings
      </button>
    );
  }
  return (
    <form
      className="space-y-2.5 rounded-xl border border-line bg-white p-3.5"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          setError(null);
          const res = await send('problems/' + problemId, {
            title, statement: statement || null, difficulty,
            topic: topic.trim() || null,
            tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
            time_limit_ms: Math.round((Number(timeLimit) || 5) * 1000),
            memory_limit_kb: Math.round((Number(memoryLimit) || 256) * 1024),
            course_id: courseId ? Number(courseId) : null,
            solution: solution.trim() || null,
            solution_rule: solutionRule,
            solution_after_attempts: solutionRule === 'after_attempts'
              ? Number(afterAttempts) || 3 : undefined,
            solution_after: solutionRule === 'after_date' && afterDate
              ? new Date(afterDate).toISOString() : null,
          }, 'PATCH');
          if (!res.ok) { setError(res.message ?? 'That did not work.'); return; }
          setOpen(false);
          router.refresh();
        });
      }}
    >
      {error ? <p role="alert" className="text-xs text-rose-700">{error}</p> : null}
      <div>
        <label className="block text-xs font-semibold text-slate-700" htmlFor="ps-title">Title</label>
        <input id="ps-title" value={title} required maxLength={255}
          onChange={(e) => setTitle(e.target.value)} className={input + ' mt-1 w-full'} />
      </div>
      <div>
        <label className="block text-xs font-semibold text-slate-700" htmlFor="ps-stmt">
          Statement
        </label>
        <textarea id="ps-stmt" rows={4} value={statement}
          onChange={(e) => setStatement(e.target.value)} className={input + ' mt-1 w-full'} />
      </div>
      <div className="grid gap-2.5 sm:grid-cols-2">
        <div>
          <label className="block text-xs font-semibold text-slate-700" htmlFor="ps-diff">
            Difficulty
          </label>
          <select id="ps-diff" value={difficulty} onChange={(e) => setDifficulty(e.target.value)}
            className={input + ' mt-1 w-full'}>
            {['easy', 'medium', 'hard'].map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-700" htmlFor="ps-topic">
            Topic
          </label>
          <input id="ps-topic" value={topic} onChange={(e) => setTopic(e.target.value)}
            className={input + ' mt-1 w-full'} />
        </div>
      </div>
      <div>
        <label className="block text-xs font-semibold text-slate-700" htmlFor="ps-tags">Tags</label>
        <input id="ps-tags" value={tags} onChange={(e) => setTags(e.target.value)}
          placeholder="arrays, easy" className={input + ' mt-1 w-full'} />
      </div>
      <div className="grid gap-2.5 sm:grid-cols-2">
        <div>
          <label className="block text-xs font-semibold text-slate-700" htmlFor="ps-time">
            Time per case (s)
          </label>
          <input id="ps-time" type="number" min={0.1} max={30} step="0.1" value={timeLimit}
            onChange={(e) => setTimeLimit(e.target.value)} className={input + ' mt-1 w-full'} />
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-700" htmlFor="ps-mem">
            Memory per case (MB)
          </label>
          <input id="ps-mem" type="number" min={16} max={1024} value={memoryLimit}
            onChange={(e) => setMemoryLimit(e.target.value)} className={input + ' mt-1 w-full'} />
        </div>
      </div>
      <div>
        <label className="block text-xs font-semibold text-slate-700" htmlFor="ps-course">
          Course
        </label>
        <select id="ps-course" value={courseId} onChange={(e) => setCourseId(e.target.value)}
          className={input + ' mt-1 w-full'}>
          <option value="">Not tied to a course</option>
          {courses.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
        </select>
      </div>

      <fieldset className="rounded-xl border border-line p-3">
        <legend className="px-1 text-xs font-semibold text-slate-700">Worked solution</legend>
        <label className="block text-xs font-semibold text-slate-700" htmlFor="ps-sol">
          Solution (optional)
        </label>
        <textarea id="ps-sol" rows={3} value={solution}
          onChange={(e) => setSolution(e.target.value)}
          className={input + ' mt-1 w-full font-mono text-xs'} />
        <label className="mt-2 block text-xs font-semibold text-slate-700" htmlFor="ps-rule">
          Release it to a learner
        </label>
        <select id="ps-rule" value={solutionRule} onChange={(e) => setSolutionRule(e.target.value)}
          className={input + ' mt-1 w-full'}>
          {Object.entries(SOLUTION_RULE_LABELS).map(([v, l]) => (
            <option key={v} value={v}>{l}</option>
          ))}
        </select>
        {solutionRule === 'after_attempts' ? (
          <div className="mt-2">
            <label className="block text-xs font-semibold text-slate-700" htmlFor="ps-attempts">
              After this many attempts
            </label>
            <input id="ps-attempts" type="number" min={1} max={100} value={afterAttempts}
              onChange={(e) => setAfterAttempts(e.target.value)}
              className={input + ' mt-1 w-full'} />
          </div>
        ) : null}
        {solutionRule === 'after_date' ? (
          <div className="mt-2">
            <label className="block text-xs font-semibold text-slate-700" htmlFor="ps-after">
              From
            </label>
            <input id="ps-after" type="datetime-local" value={afterDate}
              onChange={(e) => setAfterDate(e.target.value)}
              className={input + ' mt-1 w-full'} />
          </div>
        ) : null}
      </fieldset>

      <div className="flex gap-2 pt-1">
        <button type="submit" disabled={pending} className={btn}>
          {pending ? 'Saving…' : 'Save'}
        </button>
        <button type="button" onClick={() => setOpen(false)} className={ghost}>Cancel</button>
      </div>
    </form>
  );
}

/* -------------------------------------------- ASS-01a: bank questions ---- */

const QUESTION_TYPES = [
  { value: 'single', label: 'One correct answer' },
  { value: 'multiple', label: 'Several correct answers' },
  { value: 'truefalse', label: 'True or false' },
  { value: 'short', label: 'Short answer' },
  { value: 'essay', label: 'Essay (marked by hand)' },
  // Marked by running the linked problem's tests, hidden cases included --
  // the same grader Code Lab practice uses, so a paper and the practice for
  // it cannot disagree about the same submission.
  { value: 'code', label: 'Write code (marked by tests)' },
] as const;

/**
 * One question, into one bank.
 *
 * The answer key is part of the same form as the options because the API
 * refuses a choice question whose answer is not one of its own options -- a
 * rule worth meeting at the point of typing rather than discovering on save.
 * An essay carries no key at all: it is marked by a person.
 */
/**
 * "Write the problem here", which is what a coding question starts as.
 *
 * A sentinel rather than a separate toggle, because the question being asked
 * is one question -- which problem marks this? -- and its answer is either one
 * that exists or one that does not yet. A checkbox beside the menu would let
 * both be set at once, and something would have to decide which wins.
 *
 * It is the DEFAULT: somebody adding a coding question is thinking of the
 * question, and the problem behind it usually does not exist yet. Opening on a
 * list of stock problems made the common case the one that took an extra
 * decision.
 */
const NEW_PROBLEM = '__new__';

export function AddQuestion({ bankId, problems = [] }: {
  bankId: number;
  /** Published Code Lab problems a `code` question can point at. */
  problems?: { id: number; title: string; difficulty: string }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<string>('single');
  const [prompt, setPrompt] = useState('');
  const [points, setPoints] = useState('1');
  const [options, setOptions] = useState([
    { id: 'a', text: '' }, { id: 'b', text: '' },
  ]);
  const [correct, setCorrect] = useState<string[]>([]);
  const [answer, setAnswer] = useState('false');
  // A coding question starts as one you write; the picker underneath is for
  // reusing something the bank already has.
  const [problemId, setProblemId] = useState(NEW_PROBLEM);
  const [draft, setDraft] = useState<ProblemDraft>(blankProblemDraft);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const choice = type === 'single' || type === 'multiple';
  const authoring = problemId === NEW_PROBLEM;

  return (
    <Shell title="New question" cta="Add a question" open={open} setOpen={setOpen}
      pending={pending} error={error}
      onSubmit={() => start(async () => {
        setError(null);
        const body: Record<string, unknown> = { type, prompt, points: Number(points) || 1 };
        if (choice) {
          const clean = options.filter((o) => o.text.trim());
          if (clean.length < 2) { setError('A choice question needs two options.'); return; }
          body.options = clean;
          const picked = correct.filter((id) => clean.some((o) => o.id === id));
          if (!picked.length) { setError('Mark which option is correct.'); return; }
          body.answer = type === 'multiple' ? picked : picked[0];
        } else if (type === 'truefalse') {
          body.answer = answer === 'true' ? 'true' : 'false';
        } else if (type === 'short') {
          const accepted = answer.split('\n').map((a) => a.trim()).filter(Boolean);
          if (!accepted.length) { setError('Give at least one accepted answer.'); return; }
          body.answer = accepted;
        } else if (type === 'code') {
          /*
           * The branch that was missing.
           *
           * The picker below has always been rendered, and always been filled
           * in, and its value never left this component -- there was a case
           * here for every question type except this one. So a code question
           * posted `{ type, prompt, points }` with no problem attached, and the
           * service refused it: "A code question needs a problem." From the
           * outside that reads as coding questions simply not working, which is
           * exactly how it was reported.
           */
          if (!problemId) {
            setError('Choose the problem this question is answered against, or write a new one.');
            return;
          }
          if (authoring) {
            /*
             * Made, keyed and published before the question is posted.
             *
             * In that order and not the other way round: a question cannot be
             * bound to a problem that does not exist yet, and a code question
             * whose problem is still a draft cannot be marked. If any of the
             * three steps is refused the question is NOT posted -- leaving a
             * question pointing at a half-finished problem is worse than
             * leaving the form open with the reason on it.
             */
            const made = await createProblemFromDraft(send, 'problems', draft);
            if ('error' in made) { setError(made.error); return; }
            body.problem_id = made.id;
          } else {
            body.problem_id = Number(problemId);
          }
        }
        const res = await send('banks/' + bankId + '/questions', body);
        if (!res.ok) { setError(res.message ?? 'That did not work.'); return; }
        setPrompt('');
        setOptions([{ id: 'a', text: '' }, { id: 'b', text: '' }]);
        setCorrect([]);
        setAnswer('false');
        setProblemId(NEW_PROBLEM);
        setDraft(blankProblemDraft());
        setOpen(false);
        router.refresh();
      })}>
      <div className="grid gap-3">
        <div>
          <label className="block text-[13px] font-semibold text-slate-700" htmlFor="q-prompt">
            Question
          </label>
          <textarea id="q-prompt" required rows={3} value={prompt}
            onChange={(e) => setPrompt(e.target.value)} className={input + ' mt-1 w-full'} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="block text-[13px] font-semibold text-slate-700" htmlFor="q-type">
              Type
            </label>
            <select id="q-type" value={type} onChange={(e) => setType(e.target.value)}
              className={input + ' mt-1 w-full'}>
              {QUESTION_TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[13px] font-semibold text-slate-700" htmlFor="q-points">
              Marks
            </label>
            <input id="q-points" type="number" min={1} max={1000} value={points}
              onChange={(e) => setPoints(e.target.value)} className={input + ' mt-1 w-full'} />
          </div>
        </div>

        {choice ? (
          <fieldset>
            <legend className="text-[13px] font-semibold text-slate-700">
              Options — tick the correct {type === 'multiple' ? 'ones' : 'one'}
            </legend>
            <ul className="mt-2 space-y-2">
              {options.map((o, i) => (
                <li key={o.id} className="flex items-center gap-2">
                  <input
                    type={type === 'multiple' ? 'checkbox' : 'radio'}
                    name="q-correct" className="h-4 w-4"
                    aria-label={'Option ' + o.id.toUpperCase() + ' is correct'}
                    checked={correct.includes(o.id)}
                    onChange={(e) => setCorrect(type === 'multiple'
                      ? (e.target.checked ? [...correct, o.id] : correct.filter((c) => c !== o.id))
                      : [o.id])} />
                  <input value={o.text} className={input + ' flex-1'}
                    aria-label={'Option ' + o.id.toUpperCase()}
                    placeholder={'Option ' + o.id.toUpperCase()}
                    onChange={(e) => setOptions(options.map((x, j) =>
                      j === i ? { ...x, text: e.target.value } : x))} />
                </li>
              ))}
            </ul>
            <button type="button" className={ghost + ' mt-2'}
              onClick={() => setOptions([...options,
                { id: String.fromCharCode(97 + options.length), text: '' }])}>
              Add an option
            </button>
          </fieldset>
        ) : type === 'truefalse' ? (
          <div>
            <label className="block text-[13px] font-semibold text-slate-700" htmlFor="q-tf">
              Correct answer
            </label>
            <select id="q-tf" value={answer} onChange={(e) => setAnswer(e.target.value)}
              className={input + ' mt-1 w-full'}>
              <option value="false">False</option>
              <option value="true">True</option>
            </select>
          </div>
        ) : type === 'short' ? (
          <div>
            <label className="block text-[13px] font-semibold text-slate-700" htmlFor="q-short">
              Accepted answers
            </label>
            <textarea id="q-short" rows={3} value={answer}
              onChange={(e) => setAnswer(e.target.value)} className={input + ' mt-1 w-full'} />
            <p className="mt-1 text-xs text-muted">One per line. Any of them scores the mark.</p>
          </div>
        ) : type === 'code' ? (
          <div>
            <label className="block text-[13px] font-semibold text-slate-700" htmlFor="q-problem">
              Problem to solve
            </label>
            <select id="q-problem" value={problemId}
              onChange={(e) => setProblemId(e.target.value)}
              className={input + ' mt-1 w-full'}>
              {/* First, and selected. Reuse sits underneath: it is the better
                  answer whenever the bank already has the problem -- practised,
                  trusted, and the learner's history with it stays in one place
                  -- but it is not what somebody writing a new question needs
                  first. */}
              <option value={NEW_PROBLEM}>Write the problem here</option>
              {problems.length ? (
                <optgroup label="Or reuse a published problem">
                  {problems.map((p) => (
                    <option key={p.id} value={p.id}>{p.title} ({p.difficulty})</option>
                  ))}
                </optgroup>
              ) : null}
            </select>
            <p className="mt-1 text-xs text-muted">
              {authoring
                ? 'Write the problem below. It is created, given its test cases and '
                  + 'published when you save this question — all three, because a code '
                  + 'question can only be marked by a published problem.'
                : 'Its test cases mark the answer, hidden ones included — there is no key '
                  + 'to type here, because the tests are the key.'}
            </p>
            {authoring ? (
              <div className="mt-3">
                <ProblemDraftFields draft={draft}
                  onChange={(patch) => setDraft((d) => ({ ...d, ...patch }))}
                  inputClass={input} labelClass="block text-[13px] font-semibold text-slate-700" />
              </div>
            ) : null}
          </div>
        ) : (
          <p className="text-xs text-muted">
            An essay carries no answer key — it is marked by hand after the paper closes.
          </p>
        )}
      </div>
    </Shell>
  );
}

/**
 * Editing a question already in a bank -- same fields as adding one, with the
 * current type, prompt, options and answer key pre-filled. `PATCH
 * /api/onyx/questions/:id` writes a new version rather than overwriting the
 * old one, so a paper already sat still marks against the wording it was
 * sat with; this form does not need to know that, it just sends the change.
 */
export function EditQuestionForm({ questionId, question }: {
  questionId: number;
  question: {
    type: string; prompt: string; points: number;
    options: { id: string; text: string }[] | null;
    answer: unknown;
  };
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [type, setType] = useState(question.type);
  const [prompt, setPrompt] = useState(question.prompt);
  const [points, setPoints] = useState(String(question.points));
  const [options, setOptions] = useState(
    question.options && question.options.length
      ? question.options
      : [{ id: 'a', text: '' }, { id: 'b', text: '' }]);
  const [correct, setCorrect] = useState<string[]>(() => {
    if (question.type !== 'single' && question.type !== 'multiple') return [];
    return Array.isArray(question.answer)
      ? question.answer as string[]
      : question.answer !== undefined && question.answer !== null ? [String(question.answer)] : [];
  });
  const [answer, setAnswer] = useState(() => {
    if (question.type === 'truefalse') {
      return question.answer === true || question.answer === 'true' ? 'true' : 'false';
    }
    if (question.type === 'short') {
      return Array.isArray(question.answer) ? (question.answer as string[]).join('\n') : '';
    }
    return 'false';
  });
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const choice = type === 'single' || type === 'multiple';

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} aria-label="Edit this question"
        className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-faint
                   hover:bg-brand-50 hover:text-brand-600">
        <Icon name="edit" className="h-4 w-4" />
      </button>
    );
  }
  return (
    <form
      className="mt-2 grid gap-3 rounded-xl border border-line bg-white p-3.5 text-left"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          setError(null);
          const body: Record<string, unknown> = { type, prompt, points: Number(points) || 1 };
          if (choice) {
            const clean = options.filter((o) => o.text.trim());
            if (clean.length < 2) { setError('A choice question needs two options.'); return; }
            body.options = clean;
            const picked = correct.filter((id) => clean.some((o) => o.id === id));
            if (!picked.length) { setError('Mark which option is correct.'); return; }
            body.answer = type === 'multiple' ? picked : picked[0];
          } else if (type === 'truefalse') {
            body.answer = answer === 'true' ? 'true' : 'false';
          } else if (type === 'short') {
            const accepted = answer.split('\n').map((a) => a.trim()).filter(Boolean);
            if (!accepted.length) { setError('Give at least one accepted answer.'); return; }
            body.answer = accepted;
          }
          const res = await send('questions/' + questionId, body, 'PATCH');
          if (!res.ok) { setError(res.message ?? 'That did not work.'); return; }
          setOpen(false);
          router.refresh();
        });
      }}
    >
      {error ? <p role="alert" className="text-xs text-rose-700">{error}</p> : null}
      <div>
        <label className="block text-[13px] font-semibold text-slate-700" htmlFor={'eq-prompt-' + questionId}>
          Question
        </label>
        <textarea id={'eq-prompt-' + questionId} required rows={3} value={prompt}
          onChange={(e) => setPrompt(e.target.value)} className={input + ' mt-1 w-full'} />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="block text-[13px] font-semibold text-slate-700" htmlFor={'eq-type-' + questionId}>
            Type
          </label>
          <select id={'eq-type-' + questionId} value={type} onChange={(e) => setType(e.target.value)}
            className={input + ' mt-1 w-full'}>
            {QUESTION_TYPES.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-[13px] font-semibold text-slate-700" htmlFor={'eq-points-' + questionId}>
            Marks
          </label>
          <input id={'eq-points-' + questionId} type="number" min={1} max={1000} value={points}
            onChange={(e) => setPoints(e.target.value)} className={input + ' mt-1 w-full'} />
        </div>
      </div>

      {choice ? (
        <fieldset>
          <legend className="text-[13px] font-semibold text-slate-700">
            Options — tick the correct {type === 'multiple' ? 'ones' : 'one'}
          </legend>
          <ul className="mt-2 space-y-2">
            {options.map((o, i) => (
              <li key={o.id} className="flex items-center gap-2">
                <input
                  type={type === 'multiple' ? 'checkbox' : 'radio'}
                  name={'eq-correct-' + questionId} className="h-4 w-4"
                  aria-label={'Option ' + o.id.toUpperCase() + ' is correct'}
                  checked={correct.includes(o.id)}
                  onChange={(e) => setCorrect(type === 'multiple'
                    ? (e.target.checked ? [...correct, o.id] : correct.filter((c) => c !== o.id))
                    : [o.id])} />
                <input value={o.text} className={input + ' flex-1'}
                  aria-label={'Option ' + o.id.toUpperCase()}
                  placeholder={'Option ' + o.id.toUpperCase()}
                  onChange={(e) => setOptions(options.map((x, j) =>
                    j === i ? { ...x, text: e.target.value } : x))} />
              </li>
            ))}
          </ul>
          <button type="button" className={ghost + ' mt-2'}
            onClick={() => setOptions([...options,
              { id: String.fromCharCode(97 + options.length), text: '' }])}>
            Add an option
          </button>
        </fieldset>
      ) : type === 'truefalse' ? (
        <div>
          <label className="block text-[13px] font-semibold text-slate-700" htmlFor={'eq-tf-' + questionId}>
            Correct answer
          </label>
          <select id={'eq-tf-' + questionId} value={answer} onChange={(e) => setAnswer(e.target.value)}
            className={input + ' mt-1 w-full'}>
            <option value="false">False</option>
            <option value="true">True</option>
          </select>
        </div>
      ) : type === 'short' ? (
        <div>
          <label className="block text-[13px] font-semibold text-slate-700" htmlFor={'eq-short-' + questionId}>
            Accepted answers
          </label>
          <textarea id={'eq-short-' + questionId} rows={3} value={answer}
            onChange={(e) => setAnswer(e.target.value)} className={input + ' mt-1 w-full'} />
          <p className="mt-1 text-xs text-muted">One per line. Any of them scores the mark.</p>
        </div>
      ) : (
        <p className="text-xs text-muted">
          An essay carries no answer key — it is marked by hand after the paper closes.
        </p>
      )}

      <div className="flex gap-2 pt-1">
        <button type="submit" disabled={pending} className={btn}>
          {pending ? 'Saving…' : 'Save'}
        </button>
        <button type="button" onClick={() => setOpen(false)} className={ghost}>Cancel</button>
      </div>
    </form>
  );
}

/**
 * Retiring a question out of a bank -- not a hard delete: an old paper may
 * already reference it by id, so the row stays, marked `retired`, and simply
 * stops being offered to any new paper drawn from this bank. `DELETE
 * /api/onyx/questions/:id` on the API does exactly this, not a real DELETE.
 */
export function RetireQuestionButton({ questionId }: { questionId: number }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (!confirming) {
    return (
      <button type="button" onClick={() => setConfirming(true)} aria-label="Retire this question"
        className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-faint
                   hover:bg-rose-50 hover:text-rose-700">
        <Icon name="trash" className="h-4 w-4" />
      </button>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="text-[11px] text-muted">Retire?</span>
      <button type="button" disabled={pending}
        className="rounded-md bg-rose-600 px-1.5 py-1 text-[11px] font-bold text-white
                   disabled:opacity-60"
        onClick={() => start(async () => {
          setError(null);
          const res = await send('questions/' + questionId, undefined, 'DELETE');
          if (!res.ok) { setError(res.message ?? 'That did not work.'); return; }
          setConfirming(false); router.refresh();
        })}>
        {pending ? '…' : 'Retire'}
      </button>
      <button type="button" onClick={() => setConfirming(false)} aria-label="Cancel"
        className="rounded-md p-1 text-faint hover:bg-slate-100">
        <Icon name="x" className="h-3.5 w-3.5" />
      </button>
      {error ? <span role="alert" className="text-[11px] text-rose-700">{error}</span> : null}
    </span>
  );
}

/* --------------------------------------------- ASS-01b: paper assembly ---- */

/**
 * A paper, assembled from banks.
 *
 * Each section draws `take` questions from one bank, so two candidates sit
 * different papers of the same shape. That is the point of a bank, and it is
 * why the sections are a list rather than a fixed field.
 */
export function BuildAssessment({ banks, courses }: {
  banks: { id: number; name: string }[];
  courses: { id: number; title: string }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [courseId, setCourseId] = useState('');
  const [duration, setDuration] = useState('60');
  const [opensAt, setOpensAt] = useState('');
  const [closesAt, setClosesAt] = useState('');
  const [proctoring, setProctoring] = useState(false);
  const [requireCamera, setRequireCamera] = useState(false);
  const [requireScreen, setRequireScreen] = useState(false);
  const [sections, setSections] = useState([{ bank_id: '', take: '5' }]);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <Shell title="New assessment" cta="Set a paper" open={open} setOpen={setOpen}
      pending={pending} error={error}
      onSubmit={() => start(async () => {
        setError(null);
        const clean = sections
          .filter((s) => s.bank_id && Number(s.take) > 0)
          .map((s, i) => ({
            id: 's' + (i + 1),
            title: 'Section ' + (i + 1),
            bank_id: Number(s.bank_id),
            take: Number(s.take),
          }));
        if (!clean.length) { setError('A paper needs at least one section.'); return; }
        const made = await send('assessments', {
          title,
          course_id: courseId ? Number(courseId) : null,
          duration_minutes: Number(duration) || 60,
          opens_at: opensAt ? new Date(opensAt).toISOString() : null,
          closes_at: closesAt ? new Date(closesAt).toISOString() : null,
          proctoring,
          // Only meaningful with monitoring on, and sending them otherwise
          // would leave a paper claiming a requirement it never enforces.
          require_camera: proctoring && requireCamera,
          require_screen: proctoring && requireScreen,
          sections: clean,
        });
        if (!made.ok) { setError(made.message ?? 'That did not work.'); return; }
        const pub = await send('assessments/' + made.data.id + '/publish');
        if (!pub.ok) { setError(pub.message ?? 'Created, but not published.'); return; }
        setOpen(false);
        router.refresh();
      })}>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className="block text-[13px] font-semibold text-slate-700" htmlFor="as-title">
            Title
          </label>
          <input id="as-title" required value={title} onChange={(e) => setTitle(e.target.value)}
            placeholder="Mid-term test" className={input + ' mt-1 w-full'} />
        </div>
        <div>
          <label className="block text-[13px] font-semibold text-slate-700" htmlFor="as-course">
            Course
          </label>
          <select id="as-course" value={courseId} onChange={(e) => setCourseId(e.target.value)}
            className={input + ' mt-1 w-full'}>
            <option value="">Not tied to a course</option>
            {courses.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-[13px] font-semibold text-slate-700" htmlFor="as-dur">
            Minutes
          </label>
          <input id="as-dur" type="number" min={1} max={1440} value={duration}
            onChange={(e) => setDuration(e.target.value)} className={input + ' mt-1 w-full'} />
        </div>
        <div>
          <label className="block text-[13px] font-semibold text-slate-700" htmlFor="as-open">
            Opens
          </label>
          <input id="as-open" type="datetime-local" value={opensAt}
            onChange={(e) => setOpensAt(e.target.value)} className={input + ' mt-1 w-full'} />
        </div>
        <div>
          <label className="block text-[13px] font-semibold text-slate-700" htmlFor="as-close">
            Closes
          </label>
          <input id="as-close" type="datetime-local" value={closesAt}
            onChange={(e) => setClosesAt(e.target.value)} className={input + ' mt-1 w-full'} />
        </div>
        <label className="flex items-center gap-2 text-[13px] font-semibold text-slate-700
                          sm:col-span-2">
          <input type="checkbox" checked={proctoring} className="h-4 w-4"
            onChange={(e) => setProctoring(e.target.checked)} />
          Monitor this paper
        </label>
        {/* Nested under monitoring because they mean nothing without it, and a
            candidate who is told their camera must stay on is refused the paper
            without one -- so this is a real decision, not a preference. */}
        {proctoring ? (
          <fieldset className="sm:col-span-2 rounded-xl border border-line p-3">
            <legend className="px-1 text-[13px] font-semibold text-slate-700">
              What candidates must share
            </legend>
            <label className="flex items-center gap-2 text-[13px] text-slate-700">
              <input type="checkbox" checked={requireCamera} className="h-4 w-4"
                onChange={(e) => setRequireCamera(e.target.checked)} />
              Camera on for the whole paper
            </label>
            <label className="mt-2 flex items-center gap-2 text-[13px] text-slate-700">
              <input type="checkbox" checked={requireScreen} className="h-4 w-4"
                onChange={(e) => setRequireScreen(e.target.checked)} />
              Screen shared with the invigilator
            </label>
            <p className="mt-2 text-xs text-muted">
              No video is recorded or uploaded. What is stored is when each one started
              and stopped, and a candidate who refuses cannot start the paper.
            </p>
          </fieldset>
        ) : null}

        <fieldset className="sm:col-span-2">
          <legend className="text-[13px] font-semibold text-slate-700">Sections</legend>
          <ul className="mt-2 space-y-2">
            {sections.map((s, i) => (
              <li key={i} className="flex flex-wrap items-center gap-2">
                <select value={s.bank_id} className={input + ' flex-1'}
                  aria-label={'Bank for section ' + (i + 1)}
                  onChange={(e) => setSections(sections.map((x, j) =>
                    j === i ? { ...x, bank_id: e.target.value } : x))}>
                  <option value="">Pick a bank</option>
                  {banks.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
                <input type="number" min={1} max={500} value={s.take} className={input + ' w-24'}
                  aria-label={'Questions drawn for section ' + (i + 1)}
                  onChange={(e) => setSections(sections.map((x, j) =>
                    j === i ? { ...x, take: e.target.value } : x))} />
                <span className="text-xs text-muted">questions</span>
              </li>
            ))}
          </ul>
          <button type="button" className={ghost + ' mt-2'}
            onClick={() => setSections([...sections, { bank_id: '', take: '5' }])}>
            Add a section
          </button>
        </fieldset>
      </div>
    </Shell>
  );
}

/* --------------------------------------------- CAR-04c: drive rounds ---- */

const ROUND_OUTCOMES = [
  { value: 'attended', label: 'Attended' },
  { value: 'absent', label: 'Absent' },
  { value: 'passed', label: 'Passed' },
  { value: 'failed', label: 'Failed' },
] as const;

/**
 * What happened in one round of a drive.
 *
 * The candidate list is the shortlist for the post the drive runs against,
 * not the institution's roster: a company that came to interview six people
 * has no business being handed everyone's name.
 */
export function RecordRound({ roundId, roundName, candidates }: {
  roundId: number; roundName: string;
  candidates: { user_id: string; name: string; current?: string | null }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [outcomes, setOutcomes] = useState<Record<string, string>>(
    Object.fromEntries(candidates.map((c) => [c.user_id, c.current ?? ''])));
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <Shell title={'Record ' + roundName} cta={'Record ' + roundName}
      open={open} setOpen={setOpen} pending={pending} error={error}
      onSubmit={() => start(async () => {
        setError(null);
        const entries = candidates
          .filter((c) => outcomes[c.user_id])
          .map((c) => ({ user_id: c.user_id, outcome: outcomes[c.user_id] }));
        if (!entries.length) { setError('Nothing to record.'); return; }
        const res = await send('rounds/' + roundId + '/results', { entries });
        if (!res.ok) { setError(res.message ?? 'That did not work.'); return; }
        setOpen(false);
        router.refresh();
      })}>
      <p className="mb-2 text-xs text-muted">
        Leave somebody blank and they are simply not recorded for this round.
      </p>
      <ul className="divide-y divide-line rounded-xl border border-line">
        {candidates.map((c) => (
          <li key={c.user_id} className="flex items-center gap-3 px-3 py-2">
            <span className="min-w-0 flex-1 truncate text-sm">{c.name}</span>
            <label className="sr-only" htmlFor={'rd-' + roundId + '-' + c.user_id}>
              Outcome for {c.name}
            </label>
            <select id={'rd-' + roundId + '-' + c.user_id} className={input + ' w-40'}
              value={outcomes[c.user_id] ?? ''}
              onChange={(e) => setOutcomes((o) => ({ ...o, [c.user_id]: e.target.value }))}>
              <option value="">Not recorded</option>
              {ROUND_OUTCOMES.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </li>
        ))}
        {candidates.length === 0 ? (
          <li className="px-3 py-4 text-sm text-muted">
            Nobody has been shortlisted for the post this drive runs against.
          </li>
        ) : null}
      </ul>
    </Shell>
  );
}

/* ------------------------------------------------ CAR-04c: new drive ---- */

/**
 * A campus drive, with its rounds named up front.
 *
 * The rounds are part of creating it rather than a later step, because a
 * drive with no rounds cannot record anything, and that is exactly the state
 * a two-step flow leaves behind when the second step is forgotten.
 */
export function BuildDrive({ employers, jobs }: {
  employers: { id: number; name: string }[];
  jobs: { id: number; title: string }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [employerId, setEmployerId] = useState('');
  const [jobId, setJobId] = useState('');
  const [title, setTitle] = useState('');
  const [venue, setVenue] = useState('');
  const [scheduledAt, setScheduledAt] = useState('');
  const [rounds, setRounds] = useState(['Aptitude test', 'Technical interview']);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <Shell title="New drive" cta="Schedule a drive" open={open} setOpen={setOpen}
      pending={pending} error={error}
      onSubmit={() => start(async () => {
        setError(null);
        if (!employerId) { setError('Pick the employer coming to campus.'); return; }
        const named = rounds.map((r) => r.trim()).filter(Boolean);
        if (!named.length) { setError('A drive needs at least one round.'); return; }
        const res = await send('drives', {
          employer_id: Number(employerId),
          job_id: jobId ? Number(jobId) : null,
          title,
          venue: venue || null,
          scheduled_at: scheduledAt ? new Date(scheduledAt).toISOString() : null,
          rounds: named.map((name) => ({ name })),
        });
        if (!res.ok) { setError(res.message ?? 'That did not work.'); return; }
        setOpen(false);
        router.refresh();
      })}>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className="block text-[13px] font-semibold text-slate-700" htmlFor="dr-title">
            Title
          </label>
          <input id="dr-title" required value={title} onChange={(e) => setTitle(e.target.value)}
            placeholder="Acme campus drive" className={input + ' mt-1 w-full'} />
        </div>
        <div>
          <label className="block text-[13px] font-semibold text-slate-700" htmlFor="dr-emp">
            Employer
          </label>
          <select id="dr-emp" value={employerId} className={input + ' mt-1 w-full'}
            onChange={(e) => setEmployerId(e.target.value)}>
            <option value="">Pick an employer</option>
            {employers.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-[13px] font-semibold text-slate-700" htmlFor="dr-job">
            Against which post
          </label>
          <select id="dr-job" value={jobId} className={input + ' mt-1 w-full'}
            onChange={(e) => setJobId(e.target.value)}>
            <option value="">Not tied to a post</option>
            {jobs.map((j) => <option key={j.id} value={j.id}>{j.title}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-[13px] font-semibold text-slate-700" htmlFor="dr-when">
            When
          </label>
          <input id="dr-when" type="datetime-local" value={scheduledAt}
            onChange={(e) => setScheduledAt(e.target.value)} className={input + ' mt-1 w-full'} />
        </div>
        <div>
          <label className="block text-[13px] font-semibold text-slate-700" htmlFor="dr-venue">
            Where
          </label>
          <input id="dr-venue" value={venue} onChange={(e) => setVenue(e.target.value)}
            placeholder="Auditorium" className={input + ' mt-1 w-full'} />
        </div>

        <fieldset className="sm:col-span-2">
          <legend className="text-[13px] font-semibold text-slate-700">Rounds, in order</legend>
          <ul className="mt-2 space-y-2">
            {rounds.map((r, i) => (
              <li key={i} className="flex items-center gap-2">
                <input value={r} className={input + ' flex-1'}
                  aria-label={'Round ' + (i + 1)}
                  onChange={(e) => setRounds(rounds.map((x, j) => (j === i ? e.target.value : x)))} />
                <button type="button" className={ghost} aria-label={'Remove round ' + (i + 1)}
                  onClick={() => setRounds(rounds.filter((_, j) => j !== i))}>✕</button>
              </li>
            ))}
          </ul>
          <button type="button" className={ghost + ' mt-2'}
            onClick={() => setRounds([...rounds, ''])}>
            Add a round
          </button>
        </fieldset>
      </div>
    </Shell>
  );
}

/**
 * CAR-04a -- linking an employer record to its contact's own login.
 *
 * A company added before its contact had a login (or before anyone thought
 * to connect the two) sits with no `user_id` forever otherwise: the contact
 * can see the jobs board like any employer, but cannot post to it or see who
 * applied, because every employer-facing route checks that link, not the
 * name on the company. The placement page's own "needs the office" queue
 * already named this as a problem with nothing anyone could click to fix --
 * this is that fix, offered only the accounts that actually hold the
 * employer role and are not already linked to a different company.
 */
export function LinkEmployerAccount({ employerId, candidates }: {
  employerId: number; candidates: { user_id: string; name: string }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [userId, setUserId] = useState(candidates[0]?.user_id ?? '');
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (!candidates.length) {
    return <span className="text-[12px] text-muted">No unlinked employer accounts</span>;
  }
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)}
        className="text-[12.5px] font-semibold text-brand-600 hover:underline">
        Link an account
      </button>
    );
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <select value={userId} aria-label="Account to link"
        onChange={(e) => setUserId(e.target.value)}
        className={input + ' py-1 text-[12.5px]'}>
        {candidates.map((c) => <option key={c.user_id} value={c.user_id}>{c.name}</option>)}
      </select>
      <button type="button" disabled={pending}
        className="rounded-md bg-brand-600 px-2 py-1 text-[11px] font-bold text-white
                   disabled:opacity-60"
        onClick={() => start(async () => {
          setError(null);
          const res = await send('employers/' + employerId, { user_id: userId }, 'PATCH');
          if (!res.ok) { setError(res.message ?? 'That did not work.'); return; }
          setOpen(false); router.refresh();
        })}>
        {pending ? '…' : 'Link'}
      </button>
      <button type="button" onClick={() => setOpen(false)}
        className="inline-flex min-h-[36px] items-center px-2 text-[11px] font-semibold
                   text-muted hover:text-slate-600">
        Cancel
      </button>
      {error ? <span role="alert" className="text-[11px] text-rose-700">{error}</span> : null}
    </span>
  );
}

/* ------------------------------------------- CMP-04: guardian consent ---- */

const SCOPES = [
  { key: 'can_view_attendance', scope: 'attendance', label: 'Attendance' },
  { key: 'can_view_results', scope: 'results', label: 'Courses, marks & assessments' },
  { key: 'can_view_fees', scope: 'fees', label: 'Fees' },
] as const;

/**
 * The learner's side of a guardian link.
 *
 * An administrator can propose the link; only the learner can accept it, and
 * each category is off until they turn it on. That rule lives in the API, and
 * without this component there was no way to exercise it from a browser --
 * a link could be created and then never accepted, so `/onyx/family` stayed
 * permanently empty and the consent model was unreachable rather than strict.
 */
export function GuardianConsent({ links }: {
  links: {
    id: number; relationship: string; name: string | null; verified_at: string | null;
    can_view_attendance: boolean; can_view_results: boolean; can_view_fees: boolean;
  }[];
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const act = (path: string, body?: unknown, method: 'POST' | 'DELETE' = 'POST') =>
    start(async () => {
      setError(null);
      const res = await send(path, body, method as 'POST');
      if (!res.ok) { setError(res.message ?? 'That did not work.'); return; }
      router.refresh();
    });

  if (!links.length) {
    return (
      <p className="text-sm text-muted">
        Nobody has asked to follow your progress.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {error ? <p role="alert" className="text-sm text-rose-700">{error}</p> : null}
      <ul className="space-y-3">
        {links.map((l) => (
          <li key={l.id} className="rounded-2xl border border-line p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <div className="text-sm font-bold">{l.name ?? 'A guardian'}</div>
                <div className="text-xs capitalize text-muted">{l.relationship}</div>
              </div>
              {l.verified_at ? (
                <ConfirmRowAction label="Remove" question="Cut the link to"
                  subject={l.name ?? 'this guardian'}
                  onConfirm={async () => { act('guardians/' + l.id, undefined, 'DELETE'); }} />
              ) : (
                <button type="button" disabled={pending}
                  onClick={() => act('guardians/' + l.id + '/accept')}
                  className="rounded-xl bg-brand-600 px-3 py-2 text-[13px] font-semibold
                             text-white hover:bg-brand-700 disabled:opacity-60">
                  Accept
                </button>
              )}
            </div>

            {l.verified_at ? (
              <fieldset className="mt-3">
                <legend className="text-[13px] font-semibold text-slate-700">
                  What they may see
                </legend>
                <ul className="mt-2 flex flex-wrap gap-4">
                  {SCOPES.map((s) => (
                    <li key={s.scope}>
                      <label className="flex items-center gap-2 text-sm">
                        <input type="checkbox" className="h-4 w-4 rounded border-slate-300"
                          disabled={pending} checked={l[s.key]}
                          onChange={(e) => act('guardians/' + l.id + '/consent',
                            { scope: s.scope, allowed: e.target.checked })} />
                        {s.label}
                      </label>
                    </li>
                  ))}
                </ul>
              </fieldset>
            ) : (
              <p className="mt-2 text-xs text-muted">
                Until you accept, they see nothing at all.
              </p>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * CMP-01a -- which term the allocation screen is showing.
 *
 * In the query string rather than in component state, so the page a head of
 * department is looking at is the page they can send to somebody else, and a
 * refresh does not silently drop them back into the newest term.
 */
export function SemesterPicker({ semesters, selected }: {
  semesters: { id: number; name: string }[];
  selected: number;
}) {
  const router = useRouter();
  return (
    <div className="flex flex-wrap items-end gap-3">
      <div>
        <label htmlFor="semester" className="block text-xs font-medium text-muted">
          Semester
        </label>
        <select
          id="semester" value={String(selected)}
          onChange={(e) => router.push('/onyx/allocations?semester=' + e.target.value)}
          className="mt-1 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm
                     focus:border-brand-600 focus:outline-none"
        >
          {semesters.map((s) => (
            <option key={s.id} value={String(s.id)}>{s.name}</option>
          ))}
        </select>
      </div>
    </div>
  );
}

/* ------------------------------------------------ course: who teaches it --- */

/**
 * A course is run by one or two people, not a crowd -- the cap is enforced
 * server-side (AcademicsService.assignFaculty()), this just shows the reason
 * rather than letting a submit fail with no explanation. Read-only for
 * co-faculty (they can see who else teaches with them); assign/remove is
 * an administrator's call.
 */
export function CourseFacultyManager({ courseId, current, options, canManage }: {
  courseId: number;
  current: { user_id: string; name: string }[];
  options: { id: string; name: string }[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [userId, setUserId] = useState('');
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const remaining = options.filter((o) => !current.some((c) => c.user_id === o.id));
  const atCap = current.length >= 2;

  return (
    <div className="space-y-2.5">
      {current.length === 0 ? (
        <p className="text-sm text-muted">Nobody is assigned to teach this course yet.</p>
      ) : (
        <ul className="space-y-1.5">
          {current.map((f) => (
            <li key={f.user_id}
              className="flex items-center justify-between gap-2 rounded-xl border border-line
                         bg-white px-3 py-2 text-sm">
              <span className="min-w-0 truncate font-semibold">{f.name}</span>
              {canManage ? (
                <ConfirmRowAction label="Remove" question="Take this course off" subject={f.name}
                  onConfirm={async () => {
                    setError(null);
                    const res = await send(
                      'courses/' + courseId + '/faculty/' + f.user_id, undefined, 'DELETE');
                    if (!res.ok) { setError(res.message ?? 'That did not work.'); return; }
                    router.refresh();
                  }} />
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {error ? <p role="alert" className="text-xs text-rose-700">{error}</p> : null}

      {!canManage ? null : atCap ? (
        <p className="text-xs text-muted">
          This course already has two faculty -- remove one before assigning another.
        </p>
      ) : open ? (
        <form
          className="space-y-2 rounded-xl border border-line bg-white p-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!userId) return;
            start(async () => {
              setError(null);
              const res = await send(
                'courses/' + courseId + '/faculty', { user_id: userId });
              if (!res.ok) { setError(res.message ?? 'That did not work.'); return; }
              setOpen(false); setUserId('');
              router.refresh();
            });
          }}
        >
          <select name="user_id" value={userId} onChange={(e) => setUserId(e.target.value)}
            required aria-label="Faculty member to assign to this course"
            className={input + ' w-full'}>
            <option value="">Choose a faculty member</option>
            {remaining.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
          <div className="flex gap-2">
            <button type="submit" disabled={pending || !remaining.length} className={btn}>
              {pending ? 'Assigning…' : 'Assign'}
            </button>
            <button type="button" onClick={() => setOpen(false)} className={ghost}>Cancel</button>
          </div>
        </form>
      ) : (
        <button type="button" onClick={() => setOpen(true)} disabled={!remaining.length}
          className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-3 py-2 text-[13px]
                     font-semibold text-white hover:bg-brand-700 disabled:opacity-50">
          <Icon name="users" className="h-4 w-4" />
          {remaining.length ? 'Assign a teacher' : 'No other faculty to assign'}
        </button>
      )}
    </div>
  );
}

/* --------------------------------------------------- course: who is on it --- */

/**
 * The roster, with a way to change it. Enrolling a student here is an
 * administrator's act OR this specific course's own faculty -- the same
 * boundary the API enforces (learn.routes.ts's requireCourseManager), not a
 * tenant-wide "any faculty" hole.
 */
export function CourseRosterManager({ courseId, roster, options, canManage }: {
  courseId: number;
  roster: { user_id: string; name: string; email: string }[];
  options: { id: string; name: string }[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [userId, setUserId] = useState('');
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const remaining = options.filter((o) => !roster.some((r) => r.user_id === o.id));

  return (
    <div className="space-y-2.5">
      {roster.length === 0 ? (
        <p className="text-sm text-muted">Nobody is enrolled in this course yet.</p>
      ) : (
        <ul className="max-h-72 space-y-1.5 overflow-y-auto">
          {roster.map((r) => (
            <li key={r.user_id}
              className="flex items-center justify-between gap-2 rounded-xl border border-line
                         bg-white px-3 py-2 text-sm">
              <span className="min-w-0">
                <span className="block truncate font-semibold">{r.name}</span>
                <span className="block truncate text-xs text-muted">{r.email}</span>
              </span>
              {canManage ? (
                <ConfirmRowAction label="Withdraw" question="Withdraw" subject={r.name}
                  onConfirm={async () => {
                    setError(null);
                    const res = await send(
                      'courses/' + courseId + '/enroll/' + r.user_id, undefined, 'DELETE');
                    if (!res.ok) { setError(res.message ?? 'That did not work.'); return; }
                    router.refresh();
                  }} />
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {error ? <p role="alert" className="text-xs text-rose-700">{error}</p> : null}

      {!canManage ? null : open ? (
        <form
          className="space-y-2 rounded-xl border border-line bg-white p-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!userId) return;
            start(async () => {
              setError(null);
              const res = await send('courses/' + courseId + '/enroll', { user_id: userId });
              if (!res.ok) { setError(res.message ?? 'That did not work.'); return; }
              setOpen(false); setUserId('');
              router.refresh();
            });
          }}
        >
          <select name="user_id" value={userId} onChange={(e) => setUserId(e.target.value)}
            required aria-label="Student to enrol on this course"
            className={input + ' w-full'}>
            <option value="">Choose a student</option>
            {remaining.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
          <div className="flex gap-2">
            <button type="submit" disabled={pending || !remaining.length} className={btn}>
              {pending ? 'Enrolling…' : 'Enrol'}
            </button>
            <button type="button" onClick={() => setOpen(false)} className={ghost}>Cancel</button>
          </div>
        </form>
      ) : (
        <button type="button" onClick={() => setOpen(true)} disabled={!remaining.length}
          className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-3 py-2 text-[13px]
                     font-semibold text-white hover:bg-brand-700 disabled:opacity-50">
          <Icon name="users" className="h-4 w-4" />
          {remaining.length ? 'Enrol a student' : 'Every student is already enrolled'}
        </button>
      )}
    </div>
  );
}

/* --------------------------------------------------------- timetable slot --- */

/**
 * `DELETE /api/onyx/timetable/:id` has always existed; nothing on the grid
 * called it, so a wrongly-scheduled class was permanent -- fixable only by
 * publishing over it with a correction that left the original still sitting
 * there, unpublished but never gone.
 */
export function TimetableSlotDelete({ slotId }: { slotId: number }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [confirming, setConfirming] = useState(false);

  if (!confirming) {
    return (
      <button type="button" onClick={() => setConfirming(true)}
        className="absolute right-0.5 top-0.5 grid min-h-[32px] min-w-[32px] place-items-center
                   rounded-md text-current opacity-60 hover:bg-white/60 hover:opacity-100"
        aria-label="Remove this session">
        <Icon name="x" className="h-3 w-3" />
      </button>
    );
  }
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => start(async () => {
        const res = await send('timetable/' + slotId, undefined, 'DELETE');
        if (!res.ok) { setConfirming(false); return; }
        router.refresh();
      })}
      className="absolute right-1 top-1 rounded-md bg-rose-600 px-1.5 py-0.5 text-[10px]
                 font-bold text-white disabled:opacity-60"
    >
      {pending ? '…' : 'Sure?'}
    </button>
  );
}

/* --------------------------------------------------- course: its own facts --- */

/**
 * Editing a course's own fields. `PATCH /api/onyx/courses/:id` has always
 * existed -- it was wired into the platform console's operator view months
 * before it was wired in here, which meant an institution's own admin had no
 * way to fix a course's title or credits without asking a platform operator
 * to do it from outside. Same endpoint, same validation, this is its first
 * tenant-side door.
 */
export function CourseSettingsForm({ courseId, course }: {
  courseId: number;
  course: {
    title: string; code: string; credits: number; description: string | null;
    self_enroll: number;
    access?: 'batch' | 'open' | 'locked';
    price_minor?: number;
  };
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 rounded-xl border border-line px-3 py-2
                   text-[13px] font-semibold text-slate-700 hover:bg-brand-50">
        <Icon name="edit" className="h-4 w-4" />Edit course details
      </button>
    );
  }
  return (
    <form
      className="space-y-2.5 rounded-xl border border-line bg-white p-3.5"
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        start(async () => {
          setError(null);
          const access = String(data.get('access') ?? 'batch');
          const res = await send('courses/' + courseId, {
            title: String(data.get('title') ?? ''),
            code: String(data.get('code') ?? ''),
            credits: Number(data.get('credits') || 0),
            description: String(data.get('description') ?? '') || null,
            // `access`, not `self_enroll`. The two are derived from one another
            // on the server, and sending the old checkbox alone set one without
            // the other -- which is how a course came to say "open" in the
            // catalogue and refuse the learner who clicked it.
            access,
            ...(access === 'locked'
              ? { price_minor: Number(data.get('price_minor') || 0) }
              : {}),
          }, 'PATCH');
          if (!res.ok) { setError(res.message ?? 'That did not work.'); return; }
          setOpen(false);
          router.refresh();
        });
      }}
    >
      {error ? <p role="alert" className="text-xs text-rose-700">{error}</p> : null}
      <div>
        <label className="block text-xs font-semibold text-slate-700" htmlFor="cs-title">Title</label>
        <input id="cs-title" name="title" defaultValue={course.title} required maxLength={255}
          className={input + ' mt-1 w-full'} />
      </div>
      <div className="grid gap-2.5 sm:grid-cols-2">
        <div>
          <label className="block text-xs font-semibold text-slate-700" htmlFor="cs-code">Code</label>
          <input id="cs-code" name="code" defaultValue={course.code} required maxLength={50}
            className={input + ' mt-1 w-full'} />
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-700" htmlFor="cs-credits">
            Credits
          </label>
          <input id="cs-credits" name="credits" type="number" min={0}
            defaultValue={course.credits} className={input + ' mt-1 w-full'} />
        </div>
      </div>
      <div>
        <label className="block text-xs font-semibold text-slate-700" htmlFor="cs-description">
          Description
        </label>
        <textarea id="cs-description" name="description" rows={3}
          defaultValue={course.description ?? ''} className={input + ' mt-1 w-full'} />
      </div>
      {/*
        * How learners get on, and what it costs -- the same question the create
        * form asks, in the same words.
        *
        * This was a lone "Students can enrol themselves" checkbox: the create
        * form had already moved to open/locked/price and the edit form was left
        * behind, so a course could be given a price when it was made and never
        * afterwards. That is the whole reason the public catalogue was almost
        * empty -- every course made since is `batch`, and nothing in the product
        * could change one.
        */}
      <div className="grid gap-2.5 sm:grid-cols-2">
        <div>
          <label className="block text-xs font-semibold text-slate-700" htmlFor="cs-access">
            How learners get on
          </label>
          <select id="cs-access" name="access" defaultValue={course.access ?? 'batch'}
            className={input + ' mt-1 w-full'}>
            <option value="batch">The institution enrols them</option>
            <option value="open">Open — anyone here may start it, free</option>
            <option value="locked">Locked — they buy it first</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-700" htmlFor="cs-price">
            Price in paise
          </label>
          <input id="cs-price" name="price_minor" type="number" min={0}
            defaultValue={course.price_minor ?? 0} className={input + ' mt-1 w-full'} />
          <p className="mt-1 text-[11px] text-muted">
            149900 is ₹1,499.00. Only used for a locked course.
          </p>
        </div>
      </div>
      <div className="flex gap-2 pt-1">
        <button type="submit" disabled={pending} className={btn}>
          {pending ? 'Saving…' : 'Save'}
        </button>
        <button type="button" onClick={() => setOpen(false)} className={ghost}>Cancel</button>
      </div>
    </form>
  );
}

/**
 * Removes a course outright -- everything on it (modules, lessons,
 * enrolments, assignments, attendance, exams and their marks) cascades at
 * the database; see AcademicsService.remove()'s own comment for the full
 * table list and for what deliberately survives instead (a bank, an
 * assessment, a problem, a certificate). `DELETE /api/onyx/courses/:id`
 * shares the same guard as editing one -- an administrator, or this
 * course's own faculty -- not a separately restricted action.
 */
export function DeleteCourseButton({ courseId }: { courseId: number }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (!confirming) {
    return (
      <button type="button" onClick={() => setConfirming(true)}
        className="inline-flex min-h-[38px] items-center gap-2 rounded-2xl border
                   border-rose-600 px-3.5 text-[13px] font-bold text-rose-700
                   hover:bg-rose-50">
        <Icon name="trash" className="h-4 w-4" />Delete course
      </button>
    );
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <span className="text-[13px] font-semibold text-rose-700">
        Delete this course, and everything on it, for good?
      </span>
      <button type="button" disabled={pending}
        className="rounded-xl bg-rose-600 px-3 py-2 text-[13px] font-bold text-white
                   disabled:opacity-60"
        onClick={() => start(async () => {
          setError(null);
          const res = await send('courses/' + courseId, undefined, 'DELETE');
          if (!res.ok) { setError(res.message ?? 'That did not work.'); return; }
          router.push('/onyx/courses');
          router.refresh();
        })}>
        {pending ? 'Deleting…' : 'Delete'}
      </button>
      <button type="button" onClick={() => setConfirming(false)} className={ghost}>Cancel</button>
      {error ? <span role="alert" className="text-[13px] text-rose-700">{error}</span> : null}
    </span>
  );
}

/* -------------------------------------------------- CMP-02: exam papers ---- */

const OPTION_IDS = ['a', 'b', 'c', 'd'] as const;

/**
 * Every type a question bank can hold, not two of them.
 *
 * This composer offered "Multiple choice" and "Descriptive" only, while the
 * bank editor beside it and the platform console both offered six. So a
 * lecturer building a paper here could not set a true/false, a short answer, or
 * a coding question — the engine has marked all three since the beginning, and
 * the only thing missing was somewhere to type them.
 */
type PaperQuestionType = 'single' | 'multiple' | 'truefalse' | 'short' | 'essay' | 'code';

interface PaperQuestion {
  type: PaperQuestionType;
  prompt: string;
  points: string;
  options: string[]; // four slots, blank ones dropped on submit
  /** For 'single': one OPTION_ID. For 'truefalse': 'true' or 'false'. '' = unset. */
  correct: string;
  /** For 'multiple': the OPTION_IDs that are correct. */
  correctMany: string[];
  /** For 'short': the accepted answers, one per line. */
  accepted: string;
  /**
   * For 'code': the Code Lab problem whose tests mark it — an existing
   * published one, or NEW_PAPER_PROBLEM to write one as part of saving the
   * paper.
   */
  problemId: string;
  /** `code` only, and only when problemId is NEW_PAPER_PROBLEM. */
  draft: ProblemDraft;
  manualOnly: boolean; // a keyed type with no key -- marked by hand, not auto-graded
}

/** What each type is called, and what it needs from the person setting it. */
const PAPER_QUESTION_TYPES: { value: PaperQuestionType; label: string }[] = [
  { value: 'single', label: 'Multiple choice — one answer' },
  { value: 'multiple', label: 'Multiple choice — several answers' },
  { value: 'truefalse', label: 'True or false' },
  { value: 'short', label: 'Short answer (matched against a list)' },
  { value: 'essay', label: 'Descriptive (marked manually)' },
  { value: 'code', label: 'Write code (marked by running tests)' },
];

/** The types that carry a list of options to choose between. */
const CHOICE_TYPES: PaperQuestionType[] = ['single', 'multiple'];

/**
 * "Write the problem here", as a problemId.
 *
 * A picker of published problems was the only way to set a coding question, and
 * it is the wrong front door: the person most likely to need a coding problem
 * is the one writing a paper that does not have one yet, and an institution
 * that has never published one saw an empty dropdown and a dead end. Writing
 * one on this form is the way out of exactly that, so it leads and is chosen by
 * default; reuse stays underneath, which is the better answer whenever the bank
 * already has the problem — it has been practised, its tests are trusted, and a
 * candidate's history with it stays in one place.
 */
const NEW_PAPER_PROBLEM = '__new__';

// correct starts blank, not 'a' -- option A used to come pre-checked on the
// wire before anyone had looked at the question, so typing four options and
// never touching the radios still silently locked in "A is correct". Now
// nothing is correct until someone says so.
const blankQuestion = (): PaperQuestion => ({
  type: 'single', prompt: '', points: '10', options: ['', '', '', ''],
  correct: '', correctMany: [], accepted: '',
  // The picker is the fallback, not the front door.
  problemId: NEW_PAPER_PROBLEM, draft: blankProblemDraft(), manualOnly: false,
});

/**
 * Authors a whole online paper -- bank, questions and the assessment that
 * draws every one of them -- in one form, then publishes it.
 *
 * Building a paper used to mean leaving Examinations for Assessments,
 * building a question bank there, coming back, and picking it from a
 * dropdown. This is that whole path collapsed into the one screen someone
 * scheduling an exam is already on: pick any question type the engine can mark
 * -- multiple choice, several answers, true or false, short answer, descriptive
 * or a coding question run against a Code Lab problem's tests -- right here,
 * and the paper that comes out the other end is published and ready to link the
 * moment this closes.
 */
export function CreatePaper({ courses, problems = [] }: {
  courses: { id: number; label: string }[];
  /** Published Code Lab problems a `code` question can be marked by. */
  problems?: { id: number; title: string; status: string }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [courseId, setCourseId] = useState(courses[0] ? String(courses[0].id) : '');
  const [duration, setDuration] = useState('60');
  const [passMark, setPassMark] = useState('');
  // Only published ones: a draft problem has no tests a candidate's submission
  // could be run against, so offering it would deal an unmarkable question.
  const usableProblems = problems.filter((x) => String(x.status) === 'published');
  const [proctoring, setProctoring] = useState(true);
  const [requireCamera, setRequireCamera] = useState(true);
  // Every other formal exam already in this institution requires both --
  // camera-only was this component's own default, not a real paper's, and it
  // is exactly why a candidate starting a paper made here was only ever
  // asked for a camera. A proctored EXAM (as opposed to a lower-stakes
  // assessment, which keeps its own separate, everything-off-by-default
  // form) is monitored on both by default; still one click to turn off.
  const [requireScreen, setRequireScreen] = useState(true);
  const [questions, setQuestions] = useState<PaperQuestion[]>([blankQuestion()]);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const setQuestion = (i: number, patch: Partial<PaperQuestion>) =>
    setQuestions((qs) => qs.map((q, j) => (j === i ? { ...q, ...patch } : q)));
  const setOption = (i: number, oi: number, text: string) =>
    setQuestions((qs) => qs.map((q, j) => (j === i
      ? { ...q, options: q.options.map((o, k) => (k === oi ? text : o)) } : q)));

  return (
    <Shell title="Create a paper" cta="Create a paper" open={open} setOpen={setOpen}
      pending={pending} error={error}
      onSubmit={() => start(async () => {
        setError(null);
        if (!courseId) { setError('Pick a course.'); return; }
        const clean = questions
          .map((q) => ({ ...q, prompt: q.prompt.trim() }))
          .filter((q) => q.prompt !== '');
        if (!clean.length) { setError('Add at least one question.'); return; }
        // Everything checked BEFORE anything is written: the first write here
        // creates a question bank, and a refusal halfway through would leave
        // one behind with a paper that never got made.
        for (const q of clean) {
          const short = '"' + q.prompt.slice(0, 40) + '…"';
          if (CHOICE_TYPES.includes(q.type)) {
            const opts = q.options.map((o, i) => ({ id: OPTION_IDS[i]!, text: o.trim() }))
              .filter((o) => o.text !== '');
            if (opts.length < 2) {
              setError(short + ' needs at least two options.');
              return;
            }
            if (!q.manualOnly && q.type === 'single' && !opts.some((o) => o.id === q.correct)) {
              setError(short + ' — mark which option is correct, or mark it for manual grading.');
              return;
            }
            if (!q.manualOnly && q.type === 'multiple'
              && !q.correctMany.some((id) => opts.some((o) => o.id === id))) {
              setError(short + ' — tick every option that is correct, or mark it for '
                + 'manual grading.');
              return;
            }
          }
          if (q.type === 'truefalse' && !q.manualOnly && q.correct !== 'true'
            && q.correct !== 'false') {
            setError(short + ' — say whether it is true or false.');
            return;
          }
          if (q.type === 'short' && !q.manualOnly && !q.accepted.trim()) {
            setError(short + ' — list at least one accepted answer, one per line, or mark it '
              + 'for manual grading.');
            return;
          }
          if (q.type === 'code' && !q.problemId) {
            // A code question is marked by running a problem's tests. Without
            // one there is nothing to run, and the paper would deal a question
            // no machine and no marker could score.
            setError(short + ' needs a problem to be marked against — pick one, or write '
              + 'a new one.');
            return;
          }
          // A drafted problem is checked here with everything else, before the
          // first request goes out. The point of this pre-flight is that a
          // paper is never left half-made: a problem drafted on question three
          // that turns out to have no visible test case must not be discovered
          // after the bank and two questions already exist.
          if (q.type === 'code' && q.problemId === NEW_PAPER_PROBLEM) {
            const wrong = problemDraftError(q.draft);
            if (wrong) { setError(short + ': ' + wrong); return; }
          }
        }

        /*
         * 0. Any problem written on this form is made FIRST, before the bank.
         *
         * It has to be: a code question cannot be bound to a problem that does
         * not exist, and only a PUBLISHED problem can mark one -- so each
         * drafted problem is created, given its test cases and published, and
         * the id it comes back with is what the question carries.
         *
         * Before the bank rather than alongside the questions, so a refusal
         * here costs nothing: the only rows written by then are problems,
         * which are worth keeping even if the paper is abandoned. The reverse
         * order would leave an empty question bank behind every failed attempt.
         */
        const authored = new Map<number, number>();
        for (const [i, q] of clean.entries()) {
          if (q.type !== 'code' || q.problemId !== NEW_PAPER_PROBLEM) continue;
          const made = await createProblemFromDraft(send, 'problems', q.draft);
          if ('error' in made) {
            setError('Question ' + (i + 1) + ': ' + made.error);
            return;
          }
          authored.set(i, made.id);
        }

        // 1. A bank to hold this paper's questions -- one per paper, so
        // editing one exam's questions never touches another's.
        const bank = await send('banks', { name: title.trim() + ' — question bank', course_id: Number(courseId) });
        if (!bank.ok) { setError(bank.message ?? 'Could not create the question bank.'); return; }
        const bankId = bank.data.id as number;

        // 2. Every question, in order.
        for (const [qi, q] of clean.entries()) {
          const base = {
            type: q.type, prompt: q.prompt, points: Number(q.points) || 10,
          };
          const opts = q.options.map((o, i) => ({ id: OPTION_IDS[i]!, text: o.trim() }))
            .filter((o) => o.text !== '');
          /*
           * No key at all when marked manual-only.
           *
           * The API leaves a keyless question for a person rather than grading
           * every answer wrong against a blank key -- which is the difference
           * between "nobody has marked this yet" and "everybody failed".
           */
          const body = q.type === 'single'
            ? { ...base, options: opts, answer: q.manualOnly ? undefined : q.correct }
            : q.type === 'multiple'
              ? { ...base, options: opts, answer: q.manualOnly ? undefined : q.correctMany }
              : q.type === 'truefalse'
                ? { ...base, answer: q.manualOnly ? undefined : q.correct }
                : q.type === 'short'
                  ? {
                    ...base,
                    // One accepted answer per line, so a marker can list the
                    // spellings and synonyms they will take.
                    answer: q.manualOnly ? undefined : q.accepted.split('\n')
                      .map((a) => a.trim()).filter(Boolean),
                  }
                  : q.type === 'code'
                    ? {
                      ...base,
                      // The problem just written, or the one picked.
                      problem_id: authored.get(qi) ?? Number(q.problemId),
                    }
                    : base;
          const made = await send(`banks/${bankId}/questions`, body);
          if (!made.ok) { setError(made.message ?? 'Could not add a question.'); return; }
        }

        // 3. The paper itself, drawing every question just added, then
        // published -- left as a draft would mean nobody scheduling an exam
        // sees it in the "online paper" picker a moment later.
        const assessment = await send('assessments', {
          title: title.trim(), course_id: Number(courseId),
          duration_minutes: Number(duration) || 60,
          pass_mark: passMark.trim() ? Number(passMark) : undefined,
          proctoring, require_camera: proctoring && requireCamera,
          require_screen: proctoring && requireScreen,
          sections: [{ id: 's1', title: 'All questions', bank_id: bankId, take: clean.length }],
        });
        if (!assessment.ok) { setError(assessment.message ?? 'Could not create the paper.'); return; }
        const published = await send(`assessments/${assessment.data.id}/publish`);
        if (!published.ok) {
          setError('Paper created but not published: ' + (published.message ?? 'try publishing it from Assessments.'));
          return;
        }
        setOpen(false); router.refresh();
      })}>
      <p className="mb-3 text-xs text-muted">
        Builds a question bank and a published paper in one go, ready to pick as this
        exam's online paper below.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className="block text-[13px] font-semibold text-slate-700" htmlFor="pp-title">
            Paper title
          </label>
          <input id="pp-title" required value={title} onChange={(e) => setTitle(e.target.value)}
            placeholder="CS101 Midterm" className={input + ' mt-1 w-full'} />
        </div>
        <div>
          <label className="block text-[13px] font-semibold text-slate-700" htmlFor="pp-course">
            Course
          </label>
          <select id="pp-course" required value={courseId}
            onChange={(e) => setCourseId(e.target.value)} className={input + ' mt-1 w-full'}>
            {courses.length === 0 ? <option value="">No courses</option> : null}
            {courses.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-[13px] font-semibold text-slate-700" htmlFor="pp-duration">
            Minutes
          </label>
          <input id="pp-duration" type="number" min={5} max={600} value={duration}
            onChange={(e) => setDuration(e.target.value)} className={input + ' mt-1 w-full'} />
        </div>
        <div>
          <label className="block text-[13px] font-semibold text-slate-700" htmlFor="pp-pass">
            Pass mark (optional)
          </label>
          <input id="pp-pass" type="number" min={0} value={passMark}
            onChange={(e) => setPassMark(e.target.value)} className={input + ' mt-1 w-full'} />
        </div>
        <div className="flex items-end">
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={proctoring}
              onChange={(e) => setProctoring(e.target.checked)} />
            Proctored (camera/screen, tab-switch detection)
          </label>
        </div>
        {proctoring ? (
          <div className="sm:col-span-2 flex flex-wrap gap-4">
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={requireCamera}
                onChange={(e) => setRequireCamera(e.target.checked)} />
              Require the camera
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={requireScreen}
                onChange={(e) => setRequireScreen(e.target.checked)} />
              Require screen sharing
            </label>
          </div>
        ) : null}
      </div>

      <div className="mt-4 space-y-3">
        {/* The running total beside the heading, because "how many marks is
            this paper" is the question a setter asks constantly and used to be
            answerable only by adding up the boxes by eye. */}
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h4 className="text-[13px] font-bold text-slate-700">Questions</h4>
          <span className="text-[12px] tabular-nums text-muted">
            {questions.filter((q) => q.prompt.trim()).length} written
            {' · '}
            {questions.filter((q) => q.prompt.trim())
              .reduce((n, q) => n + (Number(q.points) || 0), 0)} marks
          </span>
        </div>
        {questions.map((q, i) => (
          <div key={i} className="rounded-xl border border-line bg-slate-50/60 p-3">
            <div className="flex flex-wrap items-center gap-2">
              {/* The number first and always, so a validation message naming
                  "question 3" can be found without counting. */}
              <span className="font-mono text-[12px] font-bold text-muted">
                {String(i + 1).padStart(2, '0')}
              </span>
              <select value={q.type} className={input + ' min-w-0 flex-1 text-xs'}
                aria-label={'Type for question ' + (i + 1)}
                onChange={(e) => setQuestion(i, { type: e.target.value as PaperQuestionType })}>
                {PAPER_QUESTION_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
              <label className="text-xs font-semibold text-slate-700" htmlFor={'pp-pts-' + i}>
                Marks
              </label>
              <input id={'pp-pts-' + i} type="number" min={1} value={q.points}
                className={input + ' w-16 text-xs'}
                onChange={(e) => setQuestion(i, { points: e.target.value })} />
              {questions.length > 1 ? (
                <button type="button" aria-label={'Remove question ' + (i + 1)}
                  className="rounded-lg border border-line bg-white px-2 py-1 text-[11.5px]
                             font-semibold text-rose-700"
                  onClick={() => setQuestions((qs) => qs.filter((_, j) => j !== i))}>
                  Remove
                </button>
              ) : null}
            </div>
            <label className="mt-2 block text-xs font-semibold sr-only" htmlFor={'pp-q-' + i}>
              Question {i + 1}
            </label>
            <textarea id={'pp-q-' + i} rows={2} value={q.prompt}
              placeholder={'Question ' + (i + 1)}
              className={input + ' mt-2 w-full bg-white text-sm'}
              onChange={(e) => setQuestion(i, { prompt: e.target.value })} />
            {CHOICE_TYPES.includes(q.type) ? (
              <div className="mt-2 space-y-1.5">
                {OPTION_IDS.map((id, oi) => (
                  <label key={id} className="flex items-center gap-2 text-xs">
                    {/* A radio for one answer, a checkbox for several. The
                        control has to say which it is: a radio group that
                        silently accepted two answers would be a paper whose
                        key nobody could enter. */}
                    <input
                      type={q.type === 'single' ? 'radio' : 'checkbox'}
                      name={q.type === 'single' ? 'pp-correct-' + i : undefined}
                      checked={q.type === 'single'
                        ? q.correct === id : q.correctMany.includes(id)}
                      disabled={q.manualOnly}
                      aria-label={'Option ' + id.toUpperCase() + ' is a correct answer'}
                      onChange={() => setQuestion(i, q.type === 'single'
                        ? { correct: id }
                        : {
                          correctMany: q.correctMany.includes(id)
                            ? q.correctMany.filter((x) => x !== id)
                            : [...q.correctMany, id],
                        })}
                    />
                    <input value={q.options[oi] ?? ''} placeholder={'Option ' + id.toUpperCase()}
                      aria-label={'Option ' + id.toUpperCase()}
                      className={input + ' flex-1 text-xs'}
                      onChange={(e) => setOption(i, oi, e.target.value)} />
                  </label>
                ))}
                <label className="flex items-center gap-2 text-xs text-slate-700">
                  <input type="checkbox" checked={q.manualOnly}
                    onChange={(e) => setQuestion(i, {
                      manualOnly: e.target.checked,
                      // Unchecking the radios along with the box: leaving a
                      // stale 'correct' behind would silently re-enable
                      // auto-grading against a choice nobody just re-affirmed.
                      correct: e.target.checked ? '' : q.correct,
                      correctMany: e.target.checked ? [] : q.correctMany,
                    })} />
                  I don't have the correct answer yet -- mark this one by hand
                </label>
                <p className="text-[11px] text-muted">
                  {q.manualOnly
                    ? 'No key is set. This is marked by hand in the marking queue, same as an essay.'
                    : q.type === 'single'
                      ? 'The selected radio button is the correct option, auto-graded on submission.'
                      : 'Every ticked option must be chosen for full marks, auto-graded on '
                        + 'submission.'}
                </p>
              </div>
            ) : q.type === 'truefalse' ? (
              <div className="mt-2 space-y-1.5">
                <div className="flex gap-4">
                  {(['true', 'false'] as const).map((v) => (
                    <label key={v} className="flex items-center gap-2 text-xs capitalize">
                      <input type="radio" name={'pp-tf-' + i} checked={q.correct === v}
                        disabled={q.manualOnly}
                        onChange={() => setQuestion(i, { correct: v })} />
                      {v}
                    </label>
                  ))}
                </div>
                <p className="text-[11px] text-muted">
                  {q.manualOnly ? 'No key is set — marked by hand.'
                    : 'Auto-graded on submission.'}
                </p>
              </div>
            ) : q.type === 'short' ? (
              <div className="mt-2 space-y-1.5">
                <label className="block text-xs font-semibold" htmlFor={'pp-acc-' + i}>
                  Accepted answers, one per line
                </label>
                <textarea id={'pp-acc-' + i} rows={3} value={q.accepted}
                  disabled={q.manualOnly}
                  placeholder={'preorder\npre-order'}
                  className={input + ' w-full text-xs'}
                  onChange={(e) => setQuestion(i, { accepted: e.target.value })} />
                <p className="text-[11px] text-muted">
                  {/* Said plainly, because a marker listing one spelling and
                      getting a hundred scripts marked wrong is the failure
                      this question type has. */}
                  Any one of these counts as correct. List the spellings and synonyms you
                  will take.
                </p>
                <label className="flex items-center gap-2 text-xs text-slate-700">
                  <input type="checkbox" checked={q.manualOnly}
                    onChange={(e) => setQuestion(i, { manualOnly: e.target.checked })} />
                  I don't have the answers yet -- mark this one by hand
                </label>
              </div>
            ) : q.type === 'code' ? (
              <div className="mt-2 space-y-1.5">
                <label className="block text-xs font-semibold" htmlFor={'pp-prob-' + i}>
                  Marked by
                </label>
                <select id={'pp-prob-' + i} value={q.problemId}
                  className={input + ' w-full text-xs'}
                  onChange={(e) => setQuestion(i, { problemId: e.target.value })}>
                  {/* First, and the default: the problem for a question being
                      written now usually does not exist yet, and an institution
                      that has never published one used to meet an empty
                      dropdown and a dead end. */}
                  <option value={NEW_PAPER_PROBLEM}>Write the problem here</option>
                  {usableProblems.length ? (
                    <optgroup label="Or reuse a published problem">
                      {usableProblems.map((pr) => (
                        <option key={pr.id} value={pr.id}>{pr.title}</option>
                      ))}
                    </optgroup>
                  ) : null}
                </select>
                {q.problemId === NEW_PAPER_PROBLEM ? (
                  <div className="mt-2">
                    <ProblemDraftFields draft={q.draft}
                      onChange={(patch) => setQuestion(i, { draft: { ...q.draft, ...patch } })}
                      inputClass={input + ' text-xs'}
                      labelClass="block text-xs font-semibold text-slate-700" />
                  </div>
                ) : null}
                <p className="text-[11px] text-muted">
                  Marked by running that problem's tests, hidden cases included — the same
                  grader Code Lab practice uses, so a paper and the practice for it cannot
                  disagree about the same submission.
                </p>
              </div>
            ) : (
              <p className="mt-2 text-[11px] text-muted">
                Marked by hand in the assessment's marking queue once submitted.
              </p>
            )}
          </div>
        ))}
        <button type="button" className={ghost}
          onClick={() => setQuestions((qs) => [...qs, blankQuestion()])}>
          Add a question
        </button>
      </div>
    </Shell>
  );
}
