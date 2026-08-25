'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { DataTable, EmptyRow, Icon, Pill, Score } from '@/components/onyx-ui';

/** One submission, as every screen that lists them reads it. */
export interface SubmissionRow {
  id: number;
  attempt: number;
  status: string;
  submitted_at: string | null;
  score: number | null;
  max_score: number;
  candidate: string | null;
  roll_number?: string | null;
  section?: string | null;
  integrity_flags?: number;
}

/**
 * Who submitted what, and the way to open or download each one.
 *
 * One component for the lecturer's page, the administrator's and the platform
 * console's, because the client asked for the same table in all three and
 * three copies of it would drift the moment one grew a column. What differs is
 * only where a row opens (`markHref`) and where its script comes from
 * (`scriptHref`), so those arrive as functions.
 *
 * **The filters live here, not in the URL.** A marker narrowing a hundred
 * scripts to one section is doing it for the next thirty seconds, not
 * bookmarking it; a query-string round trip per keystroke would make the
 * search box lag behind the typing. The roll is already on the page — this is
 * a lens over it, not a different question for the server.
 */
export function SubmissionsTable({
  rows, markHref, scriptHref, bundleHref, caption,
}: {
  rows: SubmissionRow[];
  /** Where a row opens to be marked. Omitted where the reader cannot mark. */
  markHref?: (row: SubmissionRow) => string;
  /** Where one script is downloaded from. */
  scriptHref: (row: SubmissionRow) => string;
  /** Where every script is downloaded from, when the reader may have them. */
  bundleHref?: string;
  caption: string;
}) {
  const [q, setQ] = useState('');
  const [section, setSection] = useState('');

  /** Every section present in this set, so the filter offers only real ones. */
  const sections = useMemo(() => [...new Set(rows
    .map((r) => r.section).filter((x): x is string => Boolean(x)))].sort(), [rows]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (section && r.section !== section) return false;
      if (!needle) return true;
      // By roll number as well as name: it is what a marker holding a script
      // is reading from, and searching by the one identifier in front of you
      // and being told nobody matches is a convincing way to conclude
      // somebody did not sit the paper.
      return [r.candidate, r.roll_number, r.section]
        .some((v) => String(v ?? '').toLowerCase().includes(needle));
    });
  }, [rows, q, section]);

  const field = 'rounded-xl border border-line bg-white px-3 py-2 text-[13px] '
    + 'focus:border-brand-500 focus:outline-none';

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <label className="min-w-[14rem] flex-1">
            <span className="sr-only">Search submissions</span>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Name, roll number or section"
              className={field + ' w-full'}
            />
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
          <span className="text-[12.5px] tabular-nums text-muted">
            {shown.length === rows.length
              ? rows.length + (rows.length === 1 ? ' submission' : ' submissions')
              : shown.length + ' of ' + rows.length}
          </span>
        </div>

        {bundleHref ? (
          <a
            href={bundleHref}
            download
            className="inline-flex min-h-[38px] items-center gap-1.5 rounded-xl border
                       border-line bg-white px-3 text-[13px] font-semibold hover:bg-brand-50"
          >
            <Icon name="download" className="h-4 w-4" />
            Download all
          </a>
        ) : null}
      </div>

      <DataTable
        caption={caption}
        head={
          <>
            <th scope="col">Student</th>
            <th scope="col">Roll no.</th>
            <th scope="col">Section</th>
            <th scope="col">Handed in</th>
            <th scope="col">Marks</th>
            <th scope="col">&nbsp;</th>
          </>
        }
      >
        {shown.length === 0 ? (
          <EmptyRow colSpan={6} icon="users">
            {rows.length
              ? 'No submission here matches that.'
              : 'Nobody has handed this in yet.'}
          </EmptyRow>
        ) : shown.map((r) => (
          <tr key={r.id} className="align-top">
            <td>
              {markHref ? (
                <Link href={markHref(r)} className="font-semibold hover:underline">
                  {r.candidate ?? 'Candidate'}
                </Link>
              ) : (
                <span className="font-semibold">{r.candidate ?? 'Candidate'}</span>
              )}
              {r.attempt > 1 ? (
                <div className="text-[12px] text-muted">Attempt {r.attempt}</div>
              ) : null}
            </td>
            <td className="font-mono text-[13px] tabular-nums">
              {r.roll_number ?? <span className="text-muted">—</span>}
            </td>
            <td>
              {r.section
                ? <Pill tone="neutral">{r.section}</Pill>
                : <span className="text-[12.5px] text-muted">—</span>}
            </td>
            <td className="whitespace-nowrap text-[12.5px] text-muted">
              {r.submitted_at
                ? <LocalStamp iso={r.submitted_at} />
                : <span className="italic">still sitting</span>}
            </td>
            <td>
              {/* A dash, never a zero: zero is a mark somebody was given, and
                  printing it for an unmarked script tells a marker the work
                  has been looked at. */}
              {r.score === null
                ? <Pill tone="soon">Not marked</Pill>
                : <Score value={r.score} outOf={r.max_score} />}
            </td>
            <td className="text-right">
              <span className="inline-flex items-center gap-1.5">
                {markHref ? (
                  <Link href={markHref(r)}
                    className="inline-flex min-h-[30px] items-center rounded-lg border
                               border-line px-2.5 text-[12.5px] font-semibold
                               hover:bg-brand-50">
                    {r.score === null ? 'Mark' : 'Edit marks'}
                  </Link>
                ) : null}
                <a
                  href={scriptHref(r)}
                  download
                  aria-label={'Download the script for ' + (r.candidate ?? 'this candidate')}
                  className="inline-flex min-h-[30px] items-center gap-1 rounded-lg border
                             border-line px-2.5 text-[12.5px] font-semibold text-muted
                             hover:bg-brand-50 hover:text-ink"
                >
                  <Icon name="download" className="h-3.5 w-3.5" />
                  PDF
                </a>
              </span>
            </td>
          </tr>
        ))}
      </DataTable>
    </div>
  );
}

/**
 * A timestamp in the institution's zone.
 *
 * Inline rather than imported from the server-side formatter because this is a
 * client component; the zone is fixed, so both produce the same characters.
 */
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
