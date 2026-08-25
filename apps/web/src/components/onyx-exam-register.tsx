'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { DataTable, EmptyRow, Icon, Pill, Score } from '@/components/onyx-ui';

/** One candidate's whole sitting, as the register reads it. */
export interface ExamRegisterRow {
  user_id: string;
  name: string;
  roll_number: string | null;
  section: string | null;
  seat_no: string | null;
  attempt_id: number | null;
  status: string | null;
  submitted_at: string | null;
  score: number | null;
  max_score: number | null;
  integrity_flags: number;
  final_marks: number | null;
  grade: string | null;
  result: 'pass' | 'fail' | null;
}

/**
 * Everybody at one sitting, one row each.
 *
 * The client asked for the submissions "according to the student name, section
 * name, roll number, and grade" — which is a register, not three tables. So
 * the attempt sat in the browser, the mark an examiner entered and the seat
 * they were given are joined server-side and shown together, and a candidate
 * who appears in one record and not another is visible as exactly that rather
 * than as an absence you have to notice.
 *
 * The filters are the same three the submissions table carries — search by
 * name or roll number, narrow to one section, and here also narrow to what
 * still needs a marker, because that is the pile somebody is working through.
 * They live in component state rather than the URL for the same reason: this
 * is a lens held for thirty seconds, not a question for the server.
 */
export function ExamRegister({ rows, attemptHref, scriptHref, outOf }: {
  rows: ExamRegisterRow[];
  /** Where a candidate's script opens to be read and marked. */
  attemptHref: (row: ExamRegisterRow) => string;
  scriptHref: (row: ExamRegisterRow) => string;
  /** The sitting's total, for rows marked by hand rather than by the engine. */
  outOf: number | null;
}) {
  const [q, setQ] = useState('');
  const [section, setSection] = useState('');
  const [only, setOnly] = useState<'' | 'unmarked' | 'sitting' | 'flagged'>('');

  const sections = useMemo(() => [...new Set(rows
    .map((r) => r.section).filter((x): x is string => Boolean(x)))].sort(), [rows]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (section && r.section !== section) return false;
      if (only === 'unmarked' && !(r.score === null && r.final_marks === null)) return false;
      if (only === 'sitting' && r.status !== 'in_progress') return false;
      if (only === 'flagged' && !(r.integrity_flags > 0)) return false;
      if (!needle) return true;
      return [r.name, r.roll_number, r.section, r.seat_no]
        .some((v) => String(v ?? '').toLowerCase().includes(needle));
    });
  }, [rows, q, section, only]);

  const field = 'rounded-xl border border-line bg-white px-3 py-2 text-[13px] '
    + 'focus:border-brand-500 focus:outline-none';

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <label className="min-w-[15rem] flex-1">
          <span className="sr-only">Search candidates</span>
          <input value={q} onChange={(e) => setQ(e.target.value)}
            placeholder="Name, roll number, section or seat" className={field + ' w-full'} />
        </label>
        {sections.length ? (
          <label className="flex items-center gap-2">
            <span className="text-[12.5px] font-semibold text-slate-700">Section</span>
            <select value={section} onChange={(e) => setSection(e.target.value)}
              aria-label="Filter by section" className={field}>
              <option value="">Every section</option>
              {sections.map((sx) => <option key={sx} value={sx}>{sx}</option>)}
            </select>
          </label>
        ) : null}
        <label className="flex items-center gap-2">
          <span className="text-[12.5px] font-semibold text-slate-700">Show</span>
          <select value={only} onChange={(e) => setOnly(e.target.value as typeof only)}
            aria-label="Filter by state" className={field}>
            <option value="">Everybody</option>
            <option value="unmarked">Still to be marked</option>
            <option value="sitting">Still sitting</option>
            <option value="flagged">Flagged by invigilation</option>
          </select>
        </label>
        <span className="text-[12.5px] tabular-nums text-muted">
          {shown.length === rows.length
            ? rows.length + (rows.length === 1 ? ' candidate' : ' candidates')
            : shown.length + ' of ' + rows.length}
        </span>
      </div>

      <DataTable
        caption="Everybody at this sitting, with what they sat and what they were given."
        head={
          <>
            <th scope="col">Student</th>
            <th scope="col">Roll no.</th>
            <th scope="col">Section</th>
            <th scope="col">Sat</th>
            <th scope="col">Marks</th>
            <th scope="col">Grade</th>
            <th scope="col">Result</th>
            <th scope="col">&nbsp;</th>
          </>
        }
      >
        {shown.length === 0 ? (
          <EmptyRow colSpan={8} icon="users">
            {rows.length
              ? 'No candidate here matches that.'
              : 'Nobody is on this sitting yet — no attempt, no mark and no seat.'}
          </EmptyRow>
        ) : shown.map((r) => (
          <tr key={r.user_id} className="align-top">
            <td>
              {r.attempt_id ? (
                <Link href={attemptHref(r)} className="font-semibold hover:underline">
                  {r.name}
                </Link>
              ) : <span className="font-semibold">{r.name}</span>}
              {r.seat_no ? (
                <div className="text-[12px] text-muted">Seat {r.seat_no}</div>
              ) : null}
            </td>
            <td className="font-mono text-[13px] tabular-nums">
              {r.roll_number ?? <span className="font-sans text-muted">—</span>}
            </td>
            <td>
              {r.section
                ? <Pill tone="neutral">{r.section}</Pill>
                : <span className="text-[12.5px] text-muted">—</span>}
            </td>
            <td className="whitespace-nowrap text-[12.5px]">
              {/* Three genuinely different states, said in words. "—" for all
                  three is what made a candidate who sat in a hall look like a
                  candidate who did not turn up. */}
              {r.status === 'in_progress'
                ? <Pill tone="late">Still sitting</Pill>
                : r.submitted_at
                  ? <LocalStamp iso={r.submitted_at} />
                  : <span className="text-muted">In the hall</span>}
              {r.integrity_flags > 0 ? (
                <div className="mt-0.5">
                  <Pill tone="late">{r.integrity_flags} flag
                    {r.integrity_flags === 1 ? '' : 's'}</Pill>
                </div>
              ) : null}
            </td>
            <td>
              {/* The engine's score where the paper was sat online, the
                  examiner's entry where it was not, and never a zero standing
                  in for "nobody has looked at it". */}
              {r.score !== null
                ? <Score value={r.score} outOf={r.max_score ?? 0} />
                : r.final_marks !== null
                  ? <Score value={r.final_marks} outOf={outOf ?? 0} />
                  : <Pill tone="soon">Not marked</Pill>}
            </td>
            <td>
              {r.grade
                ? <Pill tone="brand">{r.grade}</Pill>
                : <span className="text-[12.5px] text-muted">—</span>}
            </td>
            <td>
              {r.result === 'pass' ? <Pill tone="good">Pass</Pill>
                : r.result === 'fail' ? <Pill tone="late">Fail</Pill>
                  : <span className="text-[12.5px] text-muted">—</span>}
            </td>
            <td className="text-right">
              {r.attempt_id ? (
                <span className="inline-flex items-center gap-1.5">
                  <Link href={attemptHref(r)}
                    className="inline-flex min-h-[30px] items-center rounded-lg border
                               border-line px-2.5 text-[12.5px] font-semibold
                               hover:bg-brand-50">
                    {r.score === null ? 'Mark' : 'Edit marks'}
                  </Link>
                  <a href={scriptHref(r)} download
                    aria-label={'Download the script for ' + r.name}
                    className="inline-flex min-h-[30px] items-center gap-1 rounded-lg border
                               border-line px-2.5 text-[12.5px] font-semibold text-muted
                               hover:bg-brand-50 hover:text-ink">
                    <Icon name="download" className="h-3.5 w-3.5" />
                    PDF
                  </a>
                </span>
              ) : <span className="text-[12.5px] text-muted">No script</span>}
            </td>
          </tr>
        ))}
      </DataTable>
    </div>
  );
}

/** A timestamp in the institution's zone. Inline: this is a client component. */
function LocalStamp({ iso }: { iso: string }) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return <span>—</span>;
  return (
    <time dateTime={iso}>
      {d.toLocaleString('en-IN', {
        timeZone: 'Asia/Kolkata',
        day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit',
      })}
    </time>
  );
}
