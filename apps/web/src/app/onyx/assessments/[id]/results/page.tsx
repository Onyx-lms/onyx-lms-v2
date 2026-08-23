import Link from 'next/link';
import type { Metadata } from 'next';
import { OnyxShell } from '@/components/onyx-shell';
import { navFor } from '@/lib/onyx-nav';
import { requireOnyxPageRole, onyxApi, onyxApiSafe, type Me } from '@/lib/onyx-session';
import type { Assessment, ItemStat, ResultsReport } from '@/lib/onyx-assess';
import {
  ActionLink, Banner, Buckets, Card, CardGrid, DataTable, EmptyRow, Icon, Meter, Pill,
  Score, SectionHead, StackBar, State, StatTile,
} from '@/components/onyx-ui';
import { ScoreOverride } from '@/components/onyx-manage';

export const metadata: Metadata = { title: 'Results' };

/** A label/value line, at the one size the rail uses everywhere. */
function Fact({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-line py-2
                    first:pt-0 last:border-0 last:pb-0">
      <dt className="text-[13px] text-muted">{k}</dt>
      <dd className="text-right text-[13.5px] font-semibold tabular-nums">{v}</dd>
    </div>
  );
}

const BANDS = ['0–39%', '40–49%', '50–59%', '60–69%', '70–79%', '80–100%'] as const;
const bandOf = (p: number) =>
  p < 40 ? 0 : p < 50 ? 1 : p < 60 ? 2 : p < 70 ? 3 : p < 80 ? 4 : 5;

/**
 * ASS-04 -- the score report and the item analysis.
 *
 * Facility and discrimination are shown with the sample size beside them,
 * because a discrimination index from six papers is a number rather than a
 * finding, and hiding that is how a good item gets thrown away.
 */
/** One paper on the course, as `benchmark` reports it. */
interface BenchmarkRow {
  assessment_id: number;
  title: string;
  sat: number;
  mean_percent: number;
  median_percent: number;
  stdev_percent: number;
}

export default async function OnyxResultsPage({ params }: { params: Promise<{ id: string }> }) {
  await requireOnyxPageRole('admin', 'faculty', 'exams');
  const { id } = await params;
  const [me, assessment, report, items] = await Promise.all([
    onyxApi<Me>('/api/onyx/me'),
    onyxApi<Assessment>('/api/onyx/assessments/' + id),
    onyxApi<ResultsReport>('/api/onyx/assessments/' + id + '/results'),
    onyxApi<{ sat: number; items: ItemStat[] }>('/api/onyx/assessments/' + id + '/items'),
  ]);

  /*
   * How this paper compares with the others on its course.
   *
   * `GET /api/onyx/courses/:id/benchmark` has existed since assessment
   * analytics did and no screen ever called it, so the one question a marking
   * meeting asks that this page could not answer -- "was this paper harder
   * than the last one, or was it the cohort?" -- had a service behind it and
   * nowhere to appear.
   *
   * Safe rather than fatal, and skipped for a paper on no course: the rest of
   * this page is about THIS paper and should not vanish because a comparison
   * could not be drawn.
   */
  const benchmark = assessment.course_id
    ? await onyxApiSafe<BenchmarkRow[]>(
      '/api/onyx/courses/' + assessment.course_id + '/benchmark')
    : null;
  // One paper is not a comparison; it is this paper twice.
  const peers = (benchmark ?? []).length > 1 ? benchmark! : null;
  const mine = peers?.find((b) => b.assessment_id === Number(id)) ?? null;

  // The distribution is counted off the candidate rows already returned. Bars
  // rather than a curve, because the questions a marking meeting asks -- how
  // many failed, is the middle where we expected -- are length comparisons,
  // and every bar carries its own count so nothing rests on the colour.
  const rows = report.candidates;
  // Each band carries its own count, rather than a parallel array read back by
  // position further down the page. `bandOf` cannot return an out-of-range
  // index, but an indexed read cannot say so -- and had one ever missed,
  // `histogram[i] += 1` would have made the whole chart NaN rather than failing.
  const bands = BANDS.map((label, band) => ({
    label,
    count: rows.filter((c) => bandOf(c.percent) === band).length,
  }));
  const tallest = Math.max(1, ...bands.map((b) => b.count));

  const failed = rows.filter((c) => c.passed === false).length;
  const notFailed = rows.filter((c) => c.passed !== false);
  const strong = notFailed.filter((c) => c.percent >= 70).length;
  const middling = notFailed.length - strong;
  const share = (n: number) => rows.length ? Math.round((n / rows.length) * 100) + '%' : '0%';

  // The two verdicts item analysis hands back, and the one item that earns
  // its place. Both are already in the payload; nothing new is fetched.
  const suspect = items.items.filter((i) => i.suspect_key);
  const flat = items.items.filter((i) => i.uninformative && !i.suspect_key);
  const best = items.items
    .filter((i) => i.discrimination !== null && i.discrimination >= 0.3 && !i.suspect_key)
    .sort((a, b) => (b.discrimination ?? 0) - (a.discrimination ?? 0))
    .slice(0, 2);

  return (
    <OnyxShell
      me={me}
      nav={navFor(me.role)}
      title={'Results: ' + assessment.title}
      subtitle={report.published
        ? 'Published to candidates.'
        : 'Not published — candidates cannot see any of this yet.'}
    >
      <nav aria-label="Breadcrumb"
        className="mb-3 flex flex-wrap items-center gap-1.5 text-sm text-muted">
        <Link href="/onyx/assessments" className="font-semibold text-brand-600 hover:underline">
          Assessments
        </Link>
        <Icon name="chevron" className="h-3.5 w-3.5 text-faint" />
        <Link href={'/onyx/assessments/' + id}
          className="truncate font-semibold text-brand-600 hover:underline">
          {assessment.title}
        </Link>
        <Icon name="chevron" className="h-3.5 w-3.5 text-faint" />
        <span>Results</span>
      </nav>

      {/* Two formats because they are two jobs. The CSV is for whoever is
          going to do arithmetic on it; the PDF carries the cohort statistics
          and prints, which is what gets filed. */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Link href={'/onyx/assessments/' + id + '/marking'}
          className="inline-flex min-h-[38px] items-center gap-1.5 rounded-2xl bg-brand-600 px-3.5
                     text-[13px] font-bold text-white hover:bg-brand-700">
          <Icon name="edit" className="h-4 w-4" /> Marking queue
        </Link>
        <span className="flex-1" />
        <a href={'/api/proxy/onyx/assessments/' + id + '/results.csv'} download
          className="inline-flex min-h-[38px] items-center gap-1.5 rounded-2xl border border-line
                     bg-white px-3.5 text-[13px] font-bold text-slate-700 hover:bg-brand-50">
          <Icon name="download" className="h-4 w-4" /> Export CSV
        </a>
        <a href={'/api/proxy/onyx/assessments/' + id + '/results.pdf'} download
          className="inline-flex min-h-[38px] items-center gap-1.5 rounded-2xl border border-line
                     bg-white px-3.5 text-[13px] font-bold text-slate-700 hover:bg-brand-50">
          <Icon name="file" className="h-4 w-4" /> Export PDF
        </a>
      </div>

      {/* Said once, at the top, in words. */}
      <Banner tone={report.published ? 'good' : 'warn'}
        icon={report.published ? 'eye' : 'lock'}>
        {report.published ? (
          <>
            <span className="font-bold">Published.</span> Every candidate can see their score,
            their rubric comments and whether they passed.
          </>
        ) : (
          <>
            <span className="font-bold">Not published.</span> No candidate can see any of this
            yet. Releasing closes marking for good and cannot be undone.
          </>
        )}
      </Banner>

      <div className="mt-4 grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
        <div className="min-w-0 space-y-6">
          <CardGrid min="11rem">
            <StatTile label="Sat" value={report.cohort.sat} note="candidates" />
            <StatTile label="Mean" value={report.cohort.mean}
              note={'out of ' + report.cohort.max_score} />
            <StatTile label="Median" value={report.cohort.median}
              note={'out of ' + report.cohort.max_score} />
            {report.cohort.pass_rate !== null ? (
              <StatTile label="Pass rate" value={report.cohort.pass_rate + '%'}
                note={(report.cohort.passed ?? 0) + ' of ' + report.cohort.sat + ' passed'} />
            ) : (
              <StatTile label="Spread" value={report.cohort.stdev} note="standard deviation" />
            )}
          </CardGrid>

          <section>
            <SectionHead title="Grade distribution" />
            <Card className="p-4">
              {rows.length === 0 ? (
                <p className="text-sm text-muted">
                  Nothing is marked yet, so there is no distribution to draw.
                </p>
              ) : (
                <>
                  <ul className="space-y-3">
                    {bands.map(({ label, count }, i) => (
                      <li key={label}>
                        <div className="flex items-baseline justify-between gap-3">
                          <span className="text-[13px] font-bold">
                            {label}
                            {i === 0 ? (
                              <span className="ml-1.5 font-normal text-muted">
                                · below the pass mark
                              </span>
                            ) : null}
                          </span>
                          <span className="text-[13px] tabular-nums text-muted">
                            {count}
                          </span>
                        </div>
                        <div className="mt-1.5">
                          <Meter percent={(count / tallest) * 100}
                            label={count + ' candidates scored ' + label} />
                        </div>
                      </li>
                    ))}
                  </ul>

                  {/* The same cohort as one bar, split at the pass mark. The
                      histogram answers "what shape"; this answers "how many
                      are in trouble", which is the number that leaves the
                      room. Each row carries its count and its share. */}
                  <div className="mt-5 border-t border-line pt-4">
                    <StackBar parts={[
                      { value: failed, className: 'bg-red-600' },
                      { value: middling, className: 'bg-accent-500' },
                      { value: strong, className: 'bg-green-600' },
                    ]} />
                    <Buckets rows={[
                      { label: 'Did not pass', dotClass: 'bg-red-600',
                        count: failed, amount: share(failed) },
                      { label: 'Passed, under 70%', dotClass: 'bg-accent-500',
                        count: middling, amount: share(middling) },
                      { label: '70% and above — strong', dotClass: 'bg-green-600',
                        count: strong, amount: share(strong) },
                    ]} />
                  </div>
                </>
              )}
            </Card>
          </section>

          <section>
            <SectionHead title="Item analysis" />
            <p className="mb-2.5 text-[13px] text-muted">
              Facility is the proportion who got it right. Discrimination compares the strongest
              and weakest 27% &mdash; a negative value usually means the answer key is wrong,
              not that the question was hard. Drawn from {items.sat}{' '}
              {items.sat === 1 ? 'paper' : 'papers'}.
            </p>
            <DataTable
              caption="Item analysis: facility and discrimination for every objective question"
              head={<>
                <th scope="col">Question</th>
                <th scope="col">Answered</th>
                <th scope="col">Correct</th>
                <th scope="col">Facility</th>
                <th scope="col">Discrimination</th>
              </>}
            >
              {items.items.map((i) => (
                <tr key={i.question_id} className="align-top">
                  <td>
                    <span className="line-clamp-2">{i.prompt}</span>
                    {i.suspect_key ? (
                      <span className="mt-1.5 flex items-center gap-1.5">
                        <Pill tone="late">Check the key</Pill>
                        <span className="text-[12.5px] text-muted">
                          weaker candidates did better
                        </span>
                      </span>
                    ) : null}
                    {i.uninformative ? (
                      <span className="mt-1.5 flex items-center gap-1.5">
                        <Pill tone="soon">Tells you nothing</Pill>
                        <span className="text-[12.5px] text-muted">
                          {i.facility === 1 ? 'everybody' : 'nobody'} got this right
                        </span>
                      </span>
                    ) : null}
                  </td>
                  <td className="tabular-nums">{i.responses}</td>
                  <td className="tabular-nums">{i.correct}</td>
                  <td className="tabular-nums">{i.facility}</td>
                  <td className="tabular-nums">
                    {i.discrimination === null
                      ? <span className="text-muted">too few papers</span>
                      : i.discrimination}
                  </td>
                </tr>
              ))}
              {items.items.length === 0 ? (
                <EmptyRow colSpan={5} icon="chart">
                  No objective questions have been answered yet.
                </EmptyRow>
              ) : null}
            </DataTable>
          </section>

          <section>
            <SectionHead title="Candidates" />
            <DataTable
              caption={'Per-candidate results for ' + assessment.title}
              head={<>
                <th scope="col">Attempt</th>
                <th scope="col">Score</th>
                <th scope="col">Percent</th>
                <th scope="col">Outcome</th>
                <th scope="col">Integrity</th>
              </>}
            >
              {rows.map((c) => (
                <tr key={c.attempt_id}>
                  <td>
                    <Link href={'/onyx/attempts/' + c.attempt_id + '/mark'}
                      className="font-semibold tabular-nums hover:underline">
                      {c.attempt_id}
                    </Link>
                  </td>
                  {/* The band is never the only signal: the number lives
                      inside the chip, so the chip is emphasis and not
                      information anyone can be locked out of. */}
                  <td>
                    <span className="inline-flex items-center gap-1">
                      <Score value={c.score} outOf={c.max_score}
                        band={c.passed === false ? 'lo' : undefined} />
                      <ScoreOverride attemptId={c.attempt_id} maxScore={c.max_score}
                        current={c.score} />
                    </span>
                  </td>
                  <td className="tabular-nums">{c.percent}%</td>
                  <td>
                    {c.passed === null
                      ? <State tone="idle">Not decided</State>
                      : <State tone={c.passed ? 'on' : 'off'}>
                        {c.passed ? 'Passed' : 'Not passed'}
                      </State>}
                  </td>
                  <td>
                    {c.integrity_flags > 0 ? (
                      <Link href={'/onyx/attempts/' + c.attempt_id + '/integrity'}
                        className="inline-flex items-center gap-1.5 whitespace-nowrap text-[13px]
                                   font-semibold text-brand-600 hover:underline">
                        <Icon name="shield" className="h-3.5 w-3.5" />
                        {c.integrity_flags} · {c.integrity_status}
                      </Link>
                    ) : <span className="text-muted">Clean</span>}
                  </td>
                </tr>
              ))}
              {rows.length === 0 ? (
                <EmptyRow colSpan={5} icon="users">
                  Nothing is marked yet, so there are no results to show.
                </EmptyRow>
              ) : null}
            </DataTable>
          </section>
        </div>

        <aside className="min-w-0 space-y-6">
          <section>
            <SectionHead title="Release" />
            <Card className="p-4">
              <p className="text-[13px] leading-relaxed text-muted">
                {report.published
                  ? 'These marks are out. Re-marking a published paper is an appeal, not an edit.'
                  : 'Publishing shows every candidate their score, their rubric comments and '
                    + 'whether they passed. Marking closes at the same moment.'}
              </p>
              <p className="mt-3">
                <State tone={report.published ? 'on' : 'idle'}>
                  {report.published ? 'Released' : 'Not released'}
                </State>
              </p>
              {!report.published ? (
                <div className="mt-3">
                  <ActionLink href={'/onyx/assessments/' + id} label="Go to release" tone="quiet" />
                </div>
              ) : null}
            </Card>
          </section>

          <section>
            <SectionHead title="Cohort" />
            <Card className="p-4">
              <dl>
                <Fact k="Sat the paper" v={report.cohort.sat} />
                <Fact k="Spread (σ)" v={report.cohort.stdev} />
                <Fact k="Highest"
                  v={report.cohort.highest + ' / ' + report.cohort.max_score} />
                <Fact k="Lowest"
                  v={report.cohort.lowest + ' / ' + report.cohort.max_score} />
                {report.cohort.passed !== null
                  ? <Fact k="Passed" v={report.cohort.passed} /> : null}
                <Fact k="Flagged for integrity" v={report.cohort.flagged} />
              </dl>
            </Card>
          </section>

          {peers ? (
            <section>
              <SectionHead title="Against the other papers" />
              <Card className="p-0">
                {/*
                  * The question a marking meeting asks that the numbers above
                  * cannot answer: was THIS paper hard, or was it the cohort?
                  * A mean of 54 means one thing beside a course that usually
                  * averages 52 and quite another beside one that averages 71.
                  *
                  * Only the papers with attempts appear -- the service leaves
                  * out anything nobody has sat, because a row of zeroes for an
                  * unattempted paper reads as a catastrophe.
                  */}
                <ul className="divide-y divide-line">
                  {peers.map((b) => {
                    const here = b.assessment_id === Number(id);
                    return (
                      <li key={b.assessment_id}
                        className={'flex items-baseline justify-between gap-3 px-4 py-2.5 '
                          + (here ? 'bg-brand-50' : '')}>
                        <span className="min-w-0 text-[13.5px]">
                          <span className={here ? 'font-bold text-ink' : 'text-ink'}>
                            {b.title}
                          </span>
                          {here ? (
                            <span className="ml-1.5 text-[12px] font-semibold text-brand-700">
                              this paper
                            </span>
                          ) : null}
                          <span className="block text-[12px] text-muted">
                            {b.sat} sat · spread σ {b.stdev_percent}
                          </span>
                        </span>
                        <span className="shrink-0 text-right">
                          <span className="block text-[15px] font-bold tabular-nums">
                            {b.mean_percent}%
                          </span>
                          <span className="block text-[12px] text-muted tabular-nums">
                            median {b.median_percent}%
                          </span>
                        </span>
                      </li>
                    );
                  })}
                </ul>
                {mine ? (
                  <p className="border-t border-line px-4 py-2.5 text-[12.5px] text-muted">
                    {(() => {
                      const others = peers.filter((b) => b.assessment_id !== Number(id));
                      const avg = others.reduce((t, b) => t + b.mean_percent, 0) / others.length;
                      const gap = Math.round((mine.mean_percent - avg) * 10) / 10;
                      if (Math.abs(gap) < 3) {
                        return 'In line with the rest of the course.';
                      }
                      return gap < 0
                        ? Math.abs(gap) + ' points below the course average — harder than '
                          + 'the others, or a cohort that struggled.'
                        : gap + ' points above the course average.';
                    })()}
                  </p>
                ) : null}
              </Card>
            </section>
          ) : null}

          {suspect.length || flat.length || best.length ? (
            <section>
              <SectionHead title="Questions worth a look" />
              <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line
                             bg-white shadow-card">
                {suspect.slice(0, 3).map((i) => (
                  <li key={'s' + i.question_id} className="flex items-start gap-3 px-3.5 py-3">
                    <div className="min-w-0 flex-1">
                      <div className="line-clamp-2 text-[13.5px] font-semibold">{i.prompt}</div>
                      <div className="mt-0.5 text-[12.5px] tabular-nums text-muted">
                        Facility {i.facility} · weaker candidates did better
                      </div>
                    </div>
                    <Pill tone="late">Suspect</Pill>
                  </li>
                ))}
                {flat.slice(0, 2).map((i) => (
                  <li key={'f' + i.question_id} className="flex items-start gap-3 px-3.5 py-3">
                    <div className="min-w-0 flex-1">
                      <div className="line-clamp-2 text-[13.5px] font-semibold">{i.prompt}</div>
                      <div className="mt-0.5 text-[12.5px] tabular-nums text-muted">
                        Facility {i.facility} ·{' '}
                        {i.facility === 1 ? 'everybody' : 'nobody'} got it right
                      </div>
                    </div>
                    <Pill tone="soon">Tells you nothing</Pill>
                  </li>
                ))}
                {best.map((i) => (
                  <li key={'b' + i.question_id} className="flex items-start gap-3 px-3.5 py-3">
                    <div className="min-w-0 flex-1">
                      <div className="line-clamp-2 text-[13.5px] font-semibold">{i.prompt}</div>
                      <div className="mt-0.5 text-[12.5px] tabular-nums text-muted">
                        Discrimination {i.discrimination} · separates the cohort cleanly
                      </div>
                    </div>
                    <Pill tone="good">Keep</Pill>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </aside>
      </div>
    </OnyxShell>
  );
}
