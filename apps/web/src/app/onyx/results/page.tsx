import Link from 'next/link';
import type { Metadata } from 'next';
import { OnyxShell } from '@/components/onyx-shell';
import { navFor } from '@/lib/onyx-nav';
import { requireOnyxSession, onyxApi, onyxApiSafe, type Me } from '@/lib/onyx-session';
import type { ExamMark } from '@/lib/onyx-campus';
import type { MyAttempt } from '@/lib/onyx-assess';
import { CreatePanel } from '@/components/onyx-create';
import {
  ActionLink, Card, Empty, Icon, ListRow, percentText, Pill, RowList, Score,
  SectionHead, StatTile,
} from '@/components/onyx-ui';
import { formatDate } from '@/lib/when';

export const metadata: Metadata = { title: 'Results' };

const EXAM_STAFF = ['admin', 'exams'];

/**
 * Which band a mark falls in, read off the grade the examinations office
 * applied rather than guessed from the number.
 *
 * `ExamMark` carries no maximum, so a percentage cannot be computed here and
 * inventing a denominator of 100 would be a lie on any paper marked out of 50.
 * The grade letter is the institution's own banding, and it is shown in words
 * beside the mark -- the colour is never the only signal.
 */
function bandFor(grade: string | null): 'hi' | 'mid' | 'lo' | undefined {
  if (!grade) return undefined;
  const first = grade.trim().charAt(0).toUpperCase();
  if (first === 'A' || first === 'B') return 'hi';
  if (first === 'C' || first === 'D') return 'mid';
  if (first === 'E' || first === 'F') return 'lo';
  return undefined;
}

/**
 * CMP-02c / ASS-04 -- everything that counts, in the two shapes it comes in.
 *
 * A learner arrives here holding one of two questions, and they have different
 * answers from different people:
 *
 *   **Assessments** -- "how did I do on the paper I sat last week?" Class
 *   tests and coursework, marked by the people who teach, scored out of
 *   whatever that paper was worth.
 *
 *   **Grades** -- "what is on my record?" The examinations office's register
 *   and its moderation.
 *
 * They were previously four flat lists stacked in a column -- exam marks,
 * assessment results, a verifier, transcripts -- which read as a pile rather
 * than an answer and put the institutional record above the thing most people
 * came for. Two named sections with their own summaries, and jump links,
 * because on a full record this page runs several screens and nobody should
 * scroll past the half they did not want.
 *
 * Only published figures ever reach here: the API enforces that for anyone not
 * running examinations, so nothing on this page is a draft or a moderated
 * figure open to appeal. The page says so out loud, because the alternative is
 * leaving an absence to be interpreted -- which is the support ticket this
 * screen exists to prevent.
 */
export default async function OnyxResultsPage() {
  await requireOnyxSession();
  const me = await onyxApi<Me>('/api/onyx/me');
  const staff = EXAM_STAFF.includes(me.role);
  /*
   * The roster and the programme list are no longer read here.
   *
   * They existed to fill the "Issue a transcript" form's two pickers, and
   * fetching the whole membership of an institution to populate a dropdown on
   * a page about somebody's own marks was the cost of a feature that has gone.
   */
  const [marks, myAttempts] = await Promise.all([
    onyxApi<ExamMark[]>('/api/onyx/results'),
    onyxApi<MyAttempt[]>('/api/onyx/my/assessments'),
  ]);
  const assessmentResults = myAttempts.filter((a) => a.results_published && a.score !== null);

  const average = marks.length
    ? Math.round(marks.reduce((n, m) => n + m.final_marks, 0) / marks.length)
    : null;
  const moderated = marks.filter((m) => m.moderation_delta !== 0).length;

  // Assessment figures as percentages: papers are marked out of different
  // totals, so a raw mean across them would be arithmetic without meaning.
  const percents = assessmentResults
    .filter((a) => a.max_score > 0)
    .map((a) => (a.score! / a.max_score) * 100);
  const best = percents.length ? Math.max(...percents) : null;
  const mean = percents.length ? percents.reduce((n, p) => n + p, 0) / percents.length : null;

  // Which papers were sat more than once, so a repeat can carry its ordinal
  // and a single sitting is left unlabelled.
  const attemptsPerPaper = new Map<number, number>();
  for (const a of myAttempts) {
    const k = Number(a.assessment_id);
    attemptsPerPaper.set(k, (attemptsPerPaper.get(k) ?? 0) + 1);
  }

  const JUMPS = [
    { id: 'assessments', title: 'Assessments', icon: 'edit' as const, n: assessmentResults.length },
    { id: 'grades', title: 'Grades', icon: 'award' as const, n: marks.length },
  ];

  return (
    <OnyxShell
      me={me}
      nav={navFor(me.role)}
      title="Results"
      subtitle={staff
        ? 'Your own record.'
        : 'Published results only. A mark appears here once it has been released.'}
      /*
       * No "Request a transcript".
       *
       * Transcripts are gone: a sealed GPA document duplicated what the marks
       * on this page and the attempt and result PDFs beside them already say,
       * and it was the half of the feature nobody could finish -- the button
       * linked to the help page, and the help page has no way to raise a
       * ticket. A door to a room that was never built.
       */
    >
      {/* Not decoration: on a full record this page is several screens long,
          and somebody who came for one section should not have to scroll
          through the other to reach it. */}
      <nav aria-label="Sections on this page"
        className="mb-6 flex flex-wrap gap-2 border-b border-line pb-4">
        {JUMPS.map((j) => (
          <a key={j.id} href={'#' + j.id}
            className="inline-flex items-center gap-2 rounded-xl border border-line bg-white
                       px-3.5 py-2 text-[13px] font-bold shadow-card hover:bg-brand-50">
            <Icon name={j.icon} className="h-4 w-4 text-brand-600" />
            {j.title}
            <span className="rounded-full bg-brand-50 px-2 py-0.5 text-[12px]
                             tabular-nums text-brand-700">{j.n}</span>
          </a>
        ))}
      </nav>

      {/* The "Issue a transcript" panel is gone with the feature. What it
          sealed -- a GPA and a serial over the marks below -- is what those
          marks already say, and the attempt and result PDFs beside them print
          the same record with the working shown. */}

      <div className="space-y-10">
        {/* ======================================================= 1 of 2 */}
        <section id="assessments" className="scroll-mt-6">
          <div className="mb-3 border-l-[3px] border-brand-600 pl-3">
            <h2 className="text-[17px] font-extrabold tracking-tight">Assessments</h2>
            <p className="mt-0.5 text-[13px] text-muted">
              Class tests and coursework, marked by the people who teach you. A score
              appears once it has been marked and released.
            </p>
          </div>

          {assessmentResults.length ? (
            <>
              <div className="mb-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
                <StatTile label="Released" value={assessmentResults.length}
                  note={assessmentResults.length === 1 ? 'paper marked' : 'papers marked'} />
                <StatTile label="Passed"
                  value={assessmentResults.filter((a) => a.passed === true).length}
                  note={assessmentResults.some((a) => a.passed === null)
                    ? 'some papers set no pass mark' : 'against the pass mark set'} />
                <StatTile label="Best"
                  value={best === null ? '—' : percentText(best) + '%'}
                  note="highest paper so far" />
                <StatTile label="Average"
                  value={mean === null ? '—' : percentText(mean) + '%'}
                  note="across released papers" />
              </div>

              <RowList label="Your published assessment results">
                {assessmentResults.map((a) => {
                  const pct = a.max_score > 0 ? (a.score! / a.max_score) * 100 : 0;
                  return (
                    <ListRow
                      key={a.attempt_id}
                      icon={a.passed === false ? 'alert' : 'award'}
                      tone={a.passed === false ? 'late' : 'good'}
                      title={a.title}
                      // The ATTEMPT, not the paper. A result row that led to
                      // the paper's front page led to a screen with no score
                      // on it -- the click promised a result and delivered a
                      // Start button.
                      href={'/onyx/attempts/' + a.attempt_id}
                      meta={[
                        a.passed === null ? 'Marked' : a.passed ? 'Passed' : 'Not passed',
                        a.pass_mark !== null ? 'pass mark ' + a.pass_mark : null,
                        // Only where it disambiguates: "attempt 1" on a
                        // one-sitting paper is noise.
                        (attemptsPerPaper.get(Number(a.assessment_id)) ?? 0) > 1
                          ? 'attempt ' + a.attempt : null,
                      ].filter(Boolean).join(' · ')}
                      chips={
                        <Pill tone={a.passed === false ? 'late' : 'good'}>
                          {percentText(pct)}%
                        </Pill>
                      }
                      trailing={<Score value={a.score!} outOf={a.max_score}
                        band={a.passed === false ? 'lo' : undefined} />}
                    />
                  );
                })}
              </RowList>
            </>
          ) : (
            <Card className="p-0">
              <Empty icon="edit">
                Nothing released yet. A paper appears here once it has been marked and
                the result published — sitting it is not enough on its own.
              </Empty>
            </Card>
          )}
        </section>

        {/* ======================================================= 2 of 2 */}
        <section id="grades" className="scroll-mt-6">
          <div className="mb-3 border-l-[3px] border-accent-500 pl-3">
            <h2 className="text-[17px] font-extrabold tracking-tight">Grades</h2>
            <p className="mt-0.5 text-[13px] text-muted">
              Your official record: examination marks as the examinations office released
              them.
            </p>
          </div>

          <div className="mb-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile label="Marks released" value={marks.length} note="on your record" />
            <StatTile label="Average mark" value={average ?? '—'}
              note={marks.length ? 'across every released mark' : 'nothing released yet'} />
            <StatTile label="Moderated" value={moderated}
              note={moderated === 1 ? 'mark was adjusted' : 'marks were adjusted'} />
          </div>

          {/* The mark is what this section exists for, so it is the largest
              element on the row. The band is never the only signal: the number
              sits inside it, and the grade letter repeats it in words for
              anyone the green and the red read the same to. */}
          <RowList label="Your published exam marks">
            {marks.map((m) => (
              <ListRow
                key={m.id}
                icon="award"
                tone="brand"
                // QA F11. The id only where a title genuinely cannot be
                // found -- this is the learner's own official record.
                title={m.exam?.title ?? 'Exam #' + m.exam_id}
                meta={[
                  m.grade ? 'Grade ' + m.grade : 'No grade band was applied',
                  // A mark that moved and does not say it moved is the thing
                  // that generates the appeal.
                  m.moderation_delta
                    ? 'moderated ' + (m.moderation_delta > 0 ? '+' : '') + m.moderation_delta
                    : null,
                ].filter(Boolean).join(' · ')}
                trailing={<Score value={m.final_marks} band={bandFor(m.grade)} />}
              />
            ))}
            {marks.length === 0 ? (
              <li>
                <Empty icon="award">
                  No examination marks have been released yet. A mark appears here only
                  once the examinations office publishes it.
                </Empty>
              </li>
            ) : null}
          </RowList>

        </section>
      </div>
    </OnyxShell>
  );
}
