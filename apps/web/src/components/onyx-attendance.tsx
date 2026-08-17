'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { AttendanceRecord, AttendanceSession } from '@/lib/onyx-learn';
import { Icon, Meter, Pill } from '@/components/onyx-ui';

const STATUSES = ['present', 'late', 'absent', 'excused'] as const;

const field = 'rounded-xl border border-line bg-white px-3 py-2 text-sm '
  + 'focus:border-brand-600 focus:outline-none';

/** The one segmented control this file draws, at the one size. */
const SEG_WRAP = 'inline-flex flex-wrap gap-0.5 rounded-[13px] bg-slate-100 p-[3px]';
const SEG_ITEM = 'cursor-pointer rounded-[10px] px-2.5 py-1.5 text-[12.5px] font-semibold '
  + 'focus-within:ring-2 focus-within:ring-brand-600';

/**
 * LRN-03b -- the rotating code, shown to the room.
 *
 * It refreshes itself a moment before the current one expires, so the code on
 * screen is always the one the server will accept. A countdown is shown for the
 * same reason: a learner who can see the code is about to change knows to scan
 * now rather than photograph it.
 *
 * The panel is drawn at projector size and without a frame of its own -- it is
 * the front of the room, and the page it sits in supplies the card around it.
 */
export function OnyxSessionCode({ sessionId }: { sessionId: number }) {
  const [code, setCode] = useState<string | null>(null);
  const [seconds, setSeconds] = useState(0);
  // The length of the window the server just handed back, kept only so the
  // countdown can be drawn as a bar as well as a number. Nothing new is asked
  // for -- it is the same `expires_in_seconds` the timer already runs on.
  const [windowSeconds, setWindowSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    const pull = async () => {
      const res = await fetch('/api/proxy/onyx/attendance/' + sessionId + '/code');
      const body = await res.json().catch(() => ({}));
      if (cancelled) return;
      if (!body.ok) { setError(body.message ?? 'No code available.'); return; }
      setError(null);
      setCode(body.data.code);
      setSeconds(body.data.expires_in_seconds);
      setWindowSeconds(body.data.expires_in_seconds);
      // Half a second early: a code fetched exactly on the boundary is already
      // the wrong one by the time it is on screen.
      timer = setTimeout(pull, Math.max(1000, body.data.expires_in_seconds * 1000 - 500));
    };
    void pull();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [sessionId]);

  useEffect(() => {
    const tick = setInterval(() => setSeconds((s) => (s > 0 ? s - 1 : 0)), 1000);
    return () => clearInterval(tick);
  }, [code]);

  if (error) {
    return (
      <p role="alert" className="flex items-start gap-2 rounded-2xl border border-red-200
                                 bg-red-50 px-4 py-3 text-sm text-red-900">
        <Icon name="alert" className="mt-0.5 h-[18px] w-[18px] shrink-0" />
        <span className="min-w-0 flex-1">{error}</span>
      </p>
    );
  }

  return (
    <div className="text-center">
      {/* Not everyone can point a camera at a screen from row 14, and some
          phones have no working camera at all -- the typed code is the whole
          check-in here, so it is drawn to be read from the back row. */}
      <div className="text-[10.5px] font-bold uppercase tracking-[.08em] text-muted">
        Check-in code
      </div>
      <div className="mt-1.5 break-all font-mono text-[40px] font-extrabold leading-none
                      tracking-[0.14em] tabular-nums sm:text-[52px]">
        {code ?? '········'}
      </div>

      <div className="mx-auto mt-4 max-w-[280px] text-left">
        <div className="flex items-baseline justify-between gap-2 text-[12.5px]">
          <span className="font-bold">
            {seconds > 0 ? 'Rotates in ' + seconds + ' s' : 'Rotating…'}
          </span>
          <span className="tabular-nums text-muted">
            {windowSeconds > 0 ? 'every ' + windowSeconds + ' s' : ''}
          </span>
        </div>
        <div className="mt-1.5">
          <Meter
            percent={windowSeconds > 0 ? (seconds / windowSeconds) * 100 : 0}
            label="Seconds before this code rotates"
          />
        </div>
        <p className="mt-2 text-[12.5px] text-muted">
          Only the code on screen right now will be accepted.
        </p>
      </div>
    </div>
  );
}

/** The learner's side: type or scan the code. No user id is sent. */
export function OnyxCheckIn({ sessionId }: { sessionId: number }) {
  const router = useRouter();
  const [notice, setNotice] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);
  const [pending, start] = useTransition();

  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        setNotice(null);
        start(async () => {
          const res = await fetch('/api/proxy/onyx/attendance/' + sessionId + '/check-in', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code: String(data.get('code') ?? '').toUpperCase() }),
          });
          const body = await res.json().catch(() => ({}));
          setNotice(body.ok
            ? { tone: 'ok', text: 'You are marked present.' }
            : { tone: 'bad', text: body.message ?? 'That did not work.' });
          if (body.ok) router.refresh();
        });
      }}
    >
      <input
        name="code" required maxLength={8} autoComplete="off"
        placeholder="Code on screen" aria-label="Check-in code"
        className={field + ' w-40 font-mono text-base uppercase tracking-widest'}
      />
      <button type="submit" disabled={pending}
        className="inline-flex min-h-[42px] items-center rounded-2xl bg-brand-600 px-4
                   text-sm font-bold text-white hover:bg-brand-700 disabled:opacity-50">
        {pending ? 'Checking in…' : 'Check in'}
      </button>
      {/* The answer, as a word and a tone rather than a tone alone. */}
      {notice ? (
        <span role="status"
          className={'inline-flex items-center gap-1.5 text-sm font-semibold '
            + (notice.tone === 'ok' ? 'text-green-700' : 'text-red-700')}>
          <Icon name={notice.tone === 'ok' ? 'check' : 'alert'} className="h-4 w-4" />
          {notice.text}
        </span>
      ) : null}
    </form>
  );
}

/** How a learner's state got there -- "scanned in" and "marked" answer
 *  different questions when somebody disputes an absence six weeks later. */
function provenance(record: AttendanceRecord | null, now: number): string {
  if (!record) return 'Not checked in';
  const verb = record.method === 'qr' ? 'Scanned in' : 'Marked ' + record.status + ' by hand';
  const t = Date.parse(record.marked_at);
  if (!Number.isFinite(t)) return verb;
  const mins = Math.max(0, Math.round((now - t) / 60_000));
  const hours = Math.round(mins / 60);
  const ago = mins < 1 ? 'just now'
    : mins < 60 ? mins + ' min ago'
      : hours + (hours === 1 ? ' hour ago' : ' hours ago');
  return verb + ' ' + ago + (record.method === 'qr' ? ' · code' : '');
}

/**
 * LRN-03a -- faculty walking the roster.
 *
 * A list, not a table: this is marking one person at a time from the front of
 * a room, not comparing ninety down a column. The four states sit on the row
 * as a segmented control so a correction is one tap rather than a dropdown,
 * and the control is a direct child of the row so it wraps under the name at
 * 320px instead of being clipped off the edge of the card.
 */
export function OnyxRosterMarking({ session, roster }: {
  session: AttendanceSession;
  roster: { user_id: string; name: string; email: string; record: AttendanceRecord | null }[];
}) {
  const router = useRouter();
  const [marks, setMarks] = useState<Record<string, string>>(
    () => Object.fromEntries(roster.map((r) => [r.user_id, r.record?.status ?? 'present'])));
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const now = Date.now();

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[12.5px] font-bold uppercase tracking-[.08em] text-muted">
          Mark everyone
        </span>
        {STATUSES.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setMarks(Object.fromEntries(roster.map((r) => [r.user_id, s])))}
            className="min-h-[34px] rounded-2xl border border-line px-3 text-[12.5px]
                       font-semibold capitalize text-slate-700 hover:bg-brand-50"
          >
            {s}
          </button>
        ))}
      </div>

      <ul aria-label={'Register for ' + session.title}
        className="divide-y divide-line overflow-hidden rounded-2xl border border-line
                   bg-white shadow-card">
        {roster.map((r) => {
          const chosen = marks[r.user_id] ?? 'present';
          return (
            <li key={r.user_id}
              className="flex flex-wrap items-center gap-x-4 gap-y-2.5 px-4 py-3.5">
              <div className="min-w-0 flex-1 basis-[180px]">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="truncate text-[15px] font-semibold">{r.name}</span>
                  {!r.record && session.status === 'open'
                    ? <Pill tone="neutral">Not yet</Pill> : null}
                </div>
                <div className="mt-0.5 text-[13px] text-muted">
                  {provenance(r.record, now)}
                  {r.email ? ' · ' + r.email : ''}
                </div>
              </div>

              <fieldset className={SEG_WRAP}>
                <legend className="sr-only">Attendance for {r.name}</legend>
                {STATUSES.map((s) => (
                  <label key={s}
                    className={SEG_ITEM + ' ' + (chosen === s
                      ? 'bg-white text-ink shadow-card'
                      : 'text-muted hover:text-ink')}>
                    <input
                      type="radio" className="sr-only"
                      name={'mark-' + r.user_id} value={s}
                      checked={chosen === s}
                      onChange={() => setMarks((m) => ({ ...m, [r.user_id]: s }))}
                    />
                    <span className="capitalize">{s}</span>
                  </label>
                ))}
              </fieldset>
            </li>
          );
        })}
        {roster.length === 0 ? (
          <li className="px-4 py-8 text-center text-sm text-muted">
            Nobody is enrolled in this course yet, so there is no register to mark.
          </li>
        ) : null}
      </ul>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={pending || session.status !== 'open' || roster.length === 0}
          onClick={() => start(async () => {
            const res = await fetch('/api/proxy/onyx/attendance/' + session.id + '/mark', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                entries: roster.map((r) => ({
                  user_id: r.user_id, status: marks[r.user_id] ?? 'present',
                })),
              }),
            });
            const body = await res.json().catch(() => ({}));
            setNotice(body.ok ? 'Attendance recorded.' : (body.message ?? 'That did not work.'));
            if (body.ok) router.refresh();
          })}
          className="inline-flex min-h-[42px] items-center rounded-2xl bg-brand-600 px-4
                     text-sm font-bold text-white hover:bg-brand-700 disabled:opacity-50"
        >
          {pending ? 'Saving…' : 'Save attendance'}
        </button>
        {session.status !== 'open'
          ? <span className="text-sm text-muted">This session is closed.</span>
          : <span className="text-sm text-muted">
            Anyone still unmarked is recorded absent when the register closes.
          </span>}
        {notice ? <span role="status" className="text-sm font-semibold">{notice}</span> : null}
      </div>
    </div>
  );
}

/**
 * LRN-03c -- the shortfall threshold.
 *
 * A number rather than a policy switch, because the number is not ours: a
 * university with a 75% rule and one with an 85% rule are both looking at the
 * same records. It lives in the query string so a registrar can send somebody
 * the exact report they are reading, and so a reload does not lose it.
 */
export function ThresholdForm({ courseId, threshold }: {
  courseId: number; threshold: number;
}) {
  const router = useRouter();
  const [value, setValue] = useState(String(threshold));

  return (
    <form
      className="flex flex-wrap items-end gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        const n = Number(value);
        if (!Number.isFinite(n) || n < 0 || n > 100) return;
        router.push('/onyx/courses/' + courseId + '/attendance?threshold=' + n);
      }}
    >
      <div>
        <label htmlFor="threshold"
          className="block text-[10.5px] font-bold uppercase tracking-[.08em] text-muted">
          Shortfall below
        </label>
        <input
          id="threshold" name="threshold" type="number" min={0} max={100} step={1}
          value={value} onChange={(e) => setValue(e.target.value)}
          className={field + ' mt-1 w-24 tabular-nums'}
        />
      </div>
      <button
        type="submit"
        className="min-h-[42px] rounded-2xl border border-line px-4 text-sm font-bold
                   text-slate-700 hover:bg-brand-50"
      >
        Apply
      </button>
      <p className="basis-full text-xs text-muted">
        Percent attendance a learner must reach before they are flagged.
      </p>
    </form>
  );
}
