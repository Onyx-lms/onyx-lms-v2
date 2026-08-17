'use client';

import { useState, useTransition } from 'react';
import { Icon, Pill } from '@/components/onyx-ui';

/** Exactly what `/api/onyx/transcripts/:serial/verify` returns. */
interface Result {
  serial: string;
  issued_at: string;
  revoked_at: string | null;
  gpa: number | null;
  /** The stored payload still hashes to its own checksum. */
  intact: boolean;
  /** What was sealed still equals what the register says today. */
  current: boolean;
  checksum: string;
  lines: number;
}

/**
 * CMP-02c -- does this transcript still reconcile with the marks behind it?
 *
 * The acceptance criterion is "a transcript reconciles with the marks behind
 * it, and generation is audited". The API could answer that from the first day
 * and nothing ever asked it, so the criterion held for the database and was
 * untestable by anybody actually holding a document.
 *
 * Two answers, reported separately, because they mean opposite things:
 *
 *   * **Intact** -- the stored payload still hashes to its checksum. False
 *     means the record was altered. That is an incident, not an admin task.
 *   * **Current** -- what was sealed still equals the register today. False is
 *     *normal* after a remark, and means reissue rather than investigate.
 *
 * Collapsing those into one "valid" light would make a routine remark look like
 * fraud, and fraud look like a remark.
 */
export function VerifyTranscript() {
  const [serial, setSerial] = useState('');
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <div>
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!serial.trim()) return;
          start(async () => {
            setError(null);
            setResult(null);
            const res = await fetch('/api/proxy/onyx/transcripts/'
              + encodeURIComponent(serial.trim()) + '/verify');
            const body = await res.json().catch(() => ({ ok: false }));
            if (!body.ok) {
              setError(body.message ?? 'Nothing is registered under that serial.');
              return;
            }
            setResult(body.data as Result);
          });
        }}
      >
        <div>
          <label htmlFor="serial" className="block text-[13px] font-semibold text-slate-700">
            Transcript serial
          </label>
          <input
            id="serial" value={serial} onChange={(e) => setSerial(e.target.value)}
            placeholder="TR-2026-0001"
            className="mt-1 w-64 rounded-xl border border-slate-300 px-3 py-2 font-mono text-sm
                       focus:border-brand-600 focus:outline-none"
          />
        </div>
        <button type="submit" disabled={pending || !serial.trim()}
          className="min-h-[38px] rounded-2xl bg-brand-600 px-4 text-[13px] font-bold text-white
                     hover:bg-brand-700 disabled:opacity-60">
          {pending ? 'Checking…' : 'Check it'}
        </button>
      </form>

      {error ? (
        <p role="alert" className="mt-3 rounded-2xl border border-line bg-slate-50 px-4 py-3
                                   text-sm text-slate-700">
          {error}
        </p>
      ) : null}

      {result ? (
        <div className="mt-4 space-y-3" aria-live="polite">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[13px] font-bold">{result.serial}</span>
            {result.intact
              ? <Pill tone="good">Seal intact</Pill>
              : <Pill tone="late">Seal broken</Pill>}
            {result.current
              ? <Pill tone="good">Matches the register</Pill>
              : <Pill tone="soon">Register has moved on</Pill>}
            {result.revoked_at ? <Pill tone="late">Revoked</Pill> : null}
          </div>

          <p className="max-w-[70ch] text-sm text-slate-700">
            {!result.intact
              ? 'The stored document no longer hashes to its own checksum. That is not a '
                + 'remark — the record itself has been altered, and it should be escalated '
                + 'rather than reissued.'
              : result.current
                ? 'The sealed document says exactly what the register says today. Whoever is '
                  + 'holding this copy is holding the truth.'
                : 'The seal is good, so this is genuinely the document that was issued — but '
                  + 'a mark has changed since. That is normal after a remark. Issue a fresh '
                  + 'transcript; do not edit this one.'}
          </p>

          <dl className="grid gap-x-6 gap-y-3 rounded-2xl border border-line bg-white p-4
                         text-[13px] shadow-card sm:grid-cols-4">
            <div>
              <dt className="text-[11px] font-bold uppercase tracking-[.08em] text-muted">
                Issued
              </dt>
              <dd className="mt-0.5">
                {new Date(result.issued_at).toLocaleDateString(undefined,
                  { day: 'numeric', month: 'long', year: 'numeric' })}
              </dd>
            </div>
            <div>
              <dt className="text-[11px] font-bold uppercase tracking-[.08em] text-muted">
                Results on it
              </dt>
              <dd className="mt-0.5 tabular-nums">{result.lines}</dd>
            </div>
            <div>
              <dt className="text-[11px] font-bold uppercase tracking-[.08em] text-muted">GPA</dt>
              <dd className="mt-0.5 tabular-nums">{result.gpa ?? '—'}</dd>
            </div>
            <div className="min-w-0">
              <dt className="text-[11px] font-bold uppercase tracking-[.08em] text-muted">
                Checksum
              </dt>
              <dd className="mt-0.5 truncate font-mono text-[12px]" title={result.checksum}>
                {result.checksum}
              </dd>
            </div>
          </dl>
        </div>
      ) : null}

      {!result && !error ? (
        <p className="mt-3 flex items-start gap-2 text-[13px] text-muted">
          <Icon name="shield" className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="max-w-[70ch]">
            A transcript is sealed with a checksum when it is issued. Checking a serial says
            both whether the document is untampered and whether the marks behind it have
            changed since — two different answers, and only one of them is a problem.
          </span>
        </p>
      ) : null}
    </div>
  );
}
