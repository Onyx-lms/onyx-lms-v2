'use client';

import { useMemo, useState } from 'react';
import { money } from '@/lib/onyx-campus';
import { DataTable, EmptyRow, Icon, Pill, StatTile } from '@/components/onyx-ui';

export interface Receipt {
  kind: 'fee' | 'course';
  id: string;
  at: string;
  learner: { id: string; name: string | null; email: string | null; roll_number: string | null };
  what: string;
  reference: string;
  gateway_reference: string | null;
  invoice_id: number | null;
  course: { id: number; code: string; title: string } | null;
  amount_minor: number;
  currency: string;
  method: string;
  status: string;
}

export interface ReceiptsPayload {
  rows: Receipt[];
  summary: {
    count: number; collected_minor: number; from_fees_minor: number;
    from_courses_minor: number; learners: number;
  };
}

/**
 * What the institution has been paid, and by whom.
 *
 * Researched against how payment consoles actually present this (Stripe's
 * Transactions, Deel's Payment history, Whop's Payments). Three things they all
 * do, and this does:
 *
 *   * The money is stated before the table. A list of rows is a ledger; the
 *     figure somebody came for is the total, and it belongs above the rows
 *     rather than at the bottom of a column they have to scroll.
 *   * Tabs across the top are FILTERS with counts, not sections. "Course
 *     purchases 12" answers a question on its own, before it is clicked.
 *   * Every row carries the string somebody quotes on the phone -- an invoice
 *     number for a fee, the gateway's reference for a purchase. That is the
 *     column that turns a report into an answer.
 *
 * The search is deliberately over the learner, the reference AND what was paid
 * for: an administrator arrives holding one of those three and does not care
 * which field it lives in.
 */
export function ReceiptsReport({ data, showLearner = true, emptyNote }: {
  data: ReceiptsPayload;
  /** A learner reading their own receipts does not need their own name on every row. */
  showLearner?: boolean;
  emptyNote?: string;
}) {
  const [kind, setKind] = useState<'all' | 'fee' | 'course'>('all');
  const [needle, setNeedle] = useState('');

  const counts = useMemo(() => ({
    all: data.rows.length,
    fee: data.rows.filter((r) => r.kind === 'fee').length,
    course: data.rows.filter((r) => r.kind === 'course').length,
  }), [data.rows]);

  const shown = useMemo(() => {
    const q = needle.trim().toLowerCase();
    return data.rows
      .filter((r) => kind === 'all' || r.kind === kind)
      .filter((r) => !q
        || (r.learner.name ?? '').toLowerCase().includes(q)
        || (r.learner.email ?? '').toLowerCase().includes(q)
        || (r.learner.roll_number ?? '').toLowerCase().includes(q)
        || r.reference.toLowerCase().includes(q)
        || r.what.toLowerCase().includes(q));
  }, [data.rows, kind, needle]);

  const shownTotal = shown
    .filter((r) => r.status === 'captured' || r.status === 'paid')
    .reduce((n, r) => n + r.amount_minor, 0);

  const TABS: { key: 'all' | 'fee' | 'course'; label: string }[] = [
    { key: 'all', label: 'Everything' },
    { key: 'fee', label: 'Fee payments' },
    { key: 'course', label: 'Course purchases' },
  ];

  return (
    <div className="space-y-4">
      {/* Three tiles for a learner, four for staff. "Payers: 1 distinct
          learner" on somebody's own receipts is counting them, which is a
          number nobody needs about themselves. */}
      <div className={'grid gap-3 ' + (showLearner
        ? 'grid-cols-2 lg:grid-cols-4' : 'grid-cols-1 sm:grid-cols-3')}>
        <StatTile label={showLearner ? 'Collected' : 'Paid'}
          value={money(data.summary.collected_minor)}
          note={showLearner ? 'settled payments' : 'in total'} />
        <StatTile label={showLearner ? 'From fees' : 'Institution fees'}
          value={money(data.summary.from_fees_minor)}
          note="invoices settled" />
        <StatTile label={showLearner ? 'From courses' : 'Courses bought'}
          value={money(data.summary.from_courses_minor)}
          note={showLearner ? 'locked courses bought' : 'paid for directly'} />
        {showLearner ? (
          <StatTile label="Payers" value={data.summary.learners} note="distinct learners" />
        ) : null}
      </div>

      {/* Filter first, then find. The tabs answer "how much of this is course
          sales" without typing anything. */}
      <div className="flex flex-wrap items-center gap-2">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setKind(t.key)}
            aria-pressed={kind === t.key}
            className={'min-h-[38px] rounded-xl px-3.5 text-[13px] font-semibold transition '
              + (kind === t.key
                ? 'bg-brand-600 text-white'
                : 'border border-line bg-white hover:border-brand-300 hover:text-brand-700')}
          >
            {t.label}
            <span className={'ml-1.5 tabular-nums '
              + (kind === t.key ? 'text-white/80' : 'text-muted')}>
              {counts[t.key]}
            </span>
          </button>
        ))}

        <div className="relative ml-auto min-w-[220px] flex-1 sm:w-[19rem] sm:flex-none">
          <Icon name="search"
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2
                       text-faint" />
          <input
            value={needle}
            onChange={(e) => setNeedle(e.target.value)}
            placeholder={showLearner ? 'Name, roll number or reference' : 'Course or reference'}
            aria-label="Search payments"
            className="min-h-[38px] w-full rounded-xl border border-line bg-white pl-9 pr-3
                       text-[14px] focus:border-brand-500 focus:outline-none"
          />
        </div>
      </div>

      {needle || kind !== 'all' ? (
        <p className="text-[12.5px] text-muted">
          {shown.length} of {data.rows.length} payments · {money(shownTotal)} in this view
        </p>
      ) : null}

      <DataTable
        caption="Payments received by this institution"
        head={
          <>
            <th scope="col">Paid</th>
            {showLearner ? <th scope="col">Learner</th> : null}
            <th scope="col">For</th>
            <th scope="col">Reference</th>
            <th scope="col" className="hidden sm:table-cell">Method</th>
            <th scope="col">Amount</th>
            <th scope="col">Status</th>
          </>
        }
      >
        {shown.map((r) => (
          <tr key={r.id}>
            {/* `undefined` locale means "whatever this runtime defaults to",
                and the two runtimes disagree: Node renders this in the
                server's locale and timezone, the browser in the reader's. The
                dates differ, React tears the subtree down and logs a
                hydration failure (#418) on every load of the fees page.
                Suppressed rather than pinned, so a reader still gets their own
                format -- the same call this file's siblings already make
                (onyx-workspace's `since`, onyx-marking's consent line). */}
            <td className="whitespace-nowrap text-muted" suppressHydrationWarning>
              {new Date(r.at).toLocaleDateString(undefined,
                { day: 'numeric', month: 'short', year: 'numeric' })}
            </td>
            {showLearner ? (
              <td>
                <div className="font-semibold">{r.learner.name ?? '—'}</div>
                <div className="text-[12px] text-muted">
                  {r.learner.roll_number ? r.learner.roll_number + ' · ' : ''}
                  {r.learner.email ?? ''}
                </div>
              </td>
            ) : null}
            <td>
              <div className="flex items-center gap-2">
                <Pill tone={r.kind === 'course' ? 'brand' : 'neutral'}>
                  {r.kind === 'course' ? 'Course' : 'Fee'}
                </Pill>
                <span className="min-w-0 truncate">{r.what}</span>
              </div>
            </td>
            {/* The string somebody rings up quoting. */}
            <td className="whitespace-nowrap font-mono text-[12px]">{r.reference || '—'}</td>
            <td className="hidden capitalize text-muted sm:table-cell">
              {r.method.replace(/_/g, ' ') || '—'}
            </td>
            <td className="whitespace-nowrap font-semibold tabular-nums">
              {money(r.amount_minor, r.currency)}
            </td>
            <td>
              <Pill tone={r.status === 'captured' || r.status === 'paid' ? 'good'
                : r.status === 'failed' ? 'late' : 'soon'}>
                {r.status === 'captured' ? 'Paid' : r.status}
              </Pill>
            </td>
          </tr>
        ))}
        {shown.length === 0 ? (
          <EmptyRow colSpan={showLearner ? 7 : 6} icon="wallet">
            {data.rows.length === 0
              ? (emptyNote ?? 'Nothing has been paid yet.')
              : 'No payment matches that.'}
          </EmptyRow>
        ) : null}
      </DataTable>
    </div>
  );
}
