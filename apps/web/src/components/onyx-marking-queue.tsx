import Link from 'next/link';
import type { MarkingQueueRow } from '@/lib/onyx-assess';
import {
  ActionLink, Card, Empty, Hero, Icon, ListRow, Meter, Pill, RowList, Score, SectionHead, State,
} from '@/components/onyx-ui';

/**
 * The queue body shared by an assessment's own marking page and an exam's --
 * an exam sat online through the CBT engine is marked through the same
 * scripts, the same anonymity rule and the same integrity flags either way.
 * What differs is everything OUTSIDE this component: the title, the
 * breadcrumb and where "see the results" sends you, which is why this is a
 * fragment the caller wraps in its own `OnyxShell`, not a page of its own.
 */

/** "3 days ago" -- a hand-in is a past event, not a deadline you can miss. */
export function since(iso: string | null, now: number): string {
  const t = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(t)) return 'not handed in';
  const mins = Math.max(0, Math.round((now - t) / 60_000));
  if (mins < 60) return mins <= 1 ? 'a minute ago' : mins + ' minutes ago';
  if (mins < 1440) return Math.round(mins / 60) === 1 ? 'an hour ago' : Math.round(mins / 60) + ' hours ago';
  if (mins < 10_080) return Math.round(mins / 1440) === 1 ? 'a day ago' : Math.round(mins / 1440) + ' days ago';
  const weeks = Math.round(mins / 10_080);
  return weeks === 1 ? 'a week ago' : weeks + ' weeks ago';
}

export function MarkingQueue({ queue, resultsHref, assessmentId }: {
  queue: MarkingQueueRow[];
  /** Where "see the results" goes once nothing is left to mark -- an
   *  assessment's own results page, or the exam page that shows its marks. */
  resultsHref: string;
  /**
   * The paper these scripts belong to, for the download-all.
   *
   * Optional because an exam page renders this queue too and reaches its
   * scripts through the sitting rather than the paper; where it is absent the
   * bundle is simply not offered rather than pointing at nothing.
   */
  assessmentId?: number;
}) {
  const now = Date.now();

  // A queue's job is to answer "how much is left and where do I start" before
  // it answers anything else, and every one of these comes off the rows the
  // endpoint already returned.
  const marked = queue.filter((a) => a.score !== null);
  const todo = queue.filter((a) => a.score === null);
  const flagged = queue.filter((a) => a.integrity_flags > 0);
  const percent = queue.length ? (marked.length / queue.length) * 100 : 0;

  // Oldest hand-in first, so nobody waits longer than they have to.
  const byAge = (a: MarkingQueueRow, b: MarkingQueueRow) =>
    (a.submitted_at ? Date.parse(a.submitted_at) : Infinity)
    - (b.submitted_at ? Date.parse(b.submitted_at) : Infinity);
  const ordered = [...todo].sort(byAge).concat([...marked].sort(byAge));
  const next = [...todo].sort(byAge)[0];

  const nameOf = (a: MarkingQueueRow) =>
    a.candidate ?? (a.user_id === null ? 'Attempt ' + a.id : 'Candidate ' + a.user_id);

  return (
    <>
      <Hero
        eyebrow="Marking"
        title={todo.length === 0
          ? 'Every script is marked'
          : todo.length + (todo.length === 1 ? ' script left' : ' scripts left')}
        sub={marked.length + ' of ' + queue.length + ' marked'
          + (flagged.length ? ' · ' + flagged.length + ' carry integrity flags' : '')}
        actions={(
          <span className="flex flex-wrap items-center gap-2">
            {next ? (
              <Link href={'/onyx/attempts/' + next.id + '/mark'}
                className="inline-flex min-h-[42px] items-center gap-2 rounded-2xl bg-white px-4
                           text-[14px] font-bold text-brand-700 hover:bg-brand-50">
                Mark next script
                <Icon name="arrow" className="h-4 w-4" />
              </Link>
            ) : (
              <ActionLink href={resultsHref} label="See the results" />
            )}
            {assessmentId ? (
              <>
            {/*
              * Every script in one document, whether or not marking is
              * finished. A marker wanting the scripts before they are all
              * marked is the ordinary case -- moderation, a query, a printed
              * set to work from -- so this is not conditional on being done.
              *
              * One file rather than an archive: a zip needs a compressor this
              * project does not carry, and it hands a marker forty files to
              * open one at a time. Each script starts on a fresh sheet, so the
              * bundle prints exactly as the individual reports do.
              */}
            <a
              href={'/api/proxy/onyx/assessments/' + assessmentId + '/scripts.pdf'}
              download
              className="inline-flex min-h-[42px] items-center gap-1.5 rounded-2xl border
                         border-white/40 px-3.5 text-[13px] font-bold text-white
                         hover:bg-white/10"
            >
              <Icon name="download" className="h-4 w-4" />
              Download every script
            </a>
              </>
            ) : null}
          </span>
        )}
      >
        <Meter percent={percent} tone="light"
          label={'Marking progress: ' + Math.round(percent) + ' percent'} />
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px]">
          <span className="font-bold tabular-nums">{Math.round(percent)}% marked</span>
          <span className="text-white/75">
            {queue.length} handed in · {flagged.length} flagged · {marked.length} done
          </span>
        </div>
      </Hero>

      {/* Row list, not a table: the marker is choosing one script to open, and
          the only comparison that matters -- who has waited longest -- is
          already the sort order. */}
      <section className="mt-6">
        <SectionHead title="The queue" />
        {queue.length === 0 ? (
          <Card className="p-0">
            <Empty icon="edit">Nothing handed in yet.</Empty>
          </Card>
        ) : (
          <RowList label="Scripts to mark">
            {ordered.map((a) => {
              const done = a.score !== null;
              const expired = a.status === 'expired';
              return (
                <ListRow
                  key={a.id}
                  icon={expired ? 'alert' : done ? 'check' : 'clock'}
                  tone={expired ? 'late' : done ? 'good' : 'neutral'}
                  title={nameOf(a)}
                  href={'/onyx/attempts/' + a.id + '/mark'}
                  chips={
                    <>
                      {expired ? <Pill tone="late">Ran out of time</Pill> : null}
                      {!done && !expired ? <Pill tone="neutral">Not marked</Pill> : null}
                    </>
                  }
                  meta={
                    <span className="flex flex-wrap items-center gap-x-3">
                      <span>Handed in {since(a.submitted_at, now)}</span>
                      <span>Attempt {a.attempt}</span>
                      {a.auto_score !== null ? (
                        <span className="tabular-nums">Auto {a.auto_score}</span>
                      ) : null}
                    </span>
                  }
                  trailing={
                    <div className="flex items-center justify-end gap-2">
                      {a.integrity_flags > 0 ? (
                        // The flag is a link, not an ornament: marking a
                        // flagged script without reading the timeline first is
                        // how a wrong call gets made.
                        <Link href={'/onyx/attempts/' + a.id + '/integrity'}
                          className="inline-flex min-h-[30px] shrink-0 items-center gap-1.5
                                     whitespace-nowrap rounded-full bg-red-50 px-2.5
                                     text-[12.5px] font-bold text-red-700 hover:underline">
                          <Icon name="shield" className="h-3.5 w-3.5" />
                          {a.integrity_flags} {a.integrity_flags === 1 ? 'point' : 'points'}
                        </Link>
                      ) : null}
                      {/*
                        * This candidate's script, as a document.
                        *
                        * On the row because "give me that one back" is asked
                        * about a specific person, and a marker holding a query
                        * about one script should not have to open it, find a
                        * menu and come back. Not destructive, so the rule that
                        * keeps deletes off list rows does not apply.
                        */}
                      {/*
                        * No `onClick` here, and that is the fix rather than an
                        * omission.
                        *
                        * This carried `onClick={(e) => e.stopPropagation()}`,
                        * guarding against a row-wide click that does not
                        * exist: `Row` has no overlay and no handler -- this
                        * anchor is a SIBLING of the row's title link, not
                        * nested inside one. The `.rows-linked` overlay it was
                        * written for lives on DataTable, and that rule already
                        * lifts controls above the overlay in CSS.
                        *
                        * What the handler did instead was break the page. This
                        * module is a Server Component, `meta` is handed to a
                        * Client Component, and React cannot serialise a
                        * function across that boundary -- so every marking
                        * screen in the product answered 500 ("Event handlers
                        * cannot be passed to Client Component props") and no
                        * lecturer could see a single submission.
                        */}
                      <a
                        href={'/api/proxy/onyx/attempts/' + a.id + '/marker-script.pdf'}
                        download
                        aria-label={'Download the script for ' + nameOf(a)}
                        className="inline-flex min-h-[30px] shrink-0 items-center gap-1
                                   rounded-full border border-line px-2.5 text-[12.5px]
                                   font-semibold text-muted hover:bg-brand-50 hover:text-ink"
                      >
                        <Icon name="download" className="h-3.5 w-3.5" />
                        PDF
                      </a>
                      {done ? <Score value={a.score!} outOf={a.max_score} /> : null}
                    </div>
                  }
                  action={{ href: '/onyx/attempts/' + a.id + '/mark',
                    label: done ? 'Review' : 'Mark' }}
                />
              );
            })}
          </RowList>
        )}
        {queue.length ? (
          <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-[13px] text-muted">
            <span>Unmarked first, oldest hand-in at the top.</span>
            <State tone={todo.length ? 'idle' : 'on'}>
              {todo.length ? todo.length + ' still to mark' : 'Queue clear'}
            </State>
          </p>
        ) : null}
      </section>
    </>
  );
}
