/**
 * ASS-04 -- results, item analysis and exports.
 *
 * "Score reports, item analysis and cohort benchmarking with exportable results
 * for stakeholders."
 *
 * The statistics are the classical ones, chosen because they are the ones an
 * exams office already knows how to read and because both can be checked by
 * hand -- which is ASS-04a's acceptance criterion.
 *
 *   * **Facility (p-value)** -- the proportion of candidates who got the item
 *     right. 0.9 is easy, 0.2 is hard. A p of 1.0 or 0.0 tells you nothing
 *     about anybody, which is worth flagging.
 *   * **Discrimination (D)** -- how well the item separates strong candidates
 *     from weak ones, by the standard upper/lower 27% rule:
 *     D = (correct in the top group - correct in the bottom group) / group size.
 *     A negative D means the item rewarded the weaker half, which almost always
 *     means the key is wrong.
 *
 * Both are computed only over papers that were actually sat and marked. An
 * item's statistics from a cohort of three mean nothing, so the sample size is
 * always reported beside them rather than hidden.
 */
import type { OnyxDb } from './db.ts';
import { HttpError } from '../http/errors.ts';
import { csvDocument } from '../format/csv.ts';
import { pdfTable } from '../format/pdf.ts';
import { isObjective, type PaperEntry } from './assess.service.ts';

const ATTEMPT_COLUMNS = 'id, tenant_id, assessment_id, user_id, attempt, paper, status, submitted_at, auto_score, manual_score, score, max_score, integrity_flags, integrity_status';
const ANSWER_COLUMNS = 'id, tenant_id, attempt_id, question_id, version, response, auto_points, manual_points';

/** The upper/lower fraction used for the discrimination index. */
export const DISCRIMINATION_GROUP = 0.27;

export interface ItemStatistics {
  question_id: number;
  prompt: string;
  type: string;
  points: number;
  /** How many marked papers included this item. */
  responses: number;
  correct: number;
  /** Proportion correct, 0..1, to three places. */
  facility: number;
  /** -1..1, or null when the cohort is too small to split. */
  discrimination: number | null;
  /** Nobody got it right, or everybody did -- it measured nothing. */
  uninformative: boolean;
  /** The key is probably wrong. */
  suspect_key: boolean;
}

/**
 * The discrimination index, extracted so it can be checked in isolation.
 *
 * `scores` are the candidates' totals; `correct` says whether each got the item
 * right, in the same order.
 */
export function discriminationIndex(
  scores: number[], correct: boolean[], fraction = DISCRIMINATION_GROUP,
): number | null {
  const n = scores.length;
  const group = Math.floor(n * fraction);
  // With fewer than about eight papers the two groups overlap or vanish, and a
  // number computed from them would be worse than none.
  if (group < 1) return null;

  const ranked = scores
    .map((score, i) => ({ score, right: correct[i] === true }))
    .sort((a, b) => b.score - a.score);
  const top = ranked.slice(0, group).filter((r) => r.right).length;
  const bottom = ranked.slice(n - group).filter((r) => r.right).length;
  return Math.round(((top - bottom) / group) * 1000) / 1000;
}

export class AssessAnalyticsService {
  #db: OnyxDb;
  constructor(db: OnyxDb) { this.#db = db; }

  /**
   * The score report for one assessment.
   *
   * Candidates are identified by id; naming them is the caller's job, because
   * the same numbers are used for the anonymous view.
   */
  async results(tenantId: number, assessmentId: number) {
    const attempts = await this.#marked(tenantId, assessmentId);
    const { data: assessment } = await this.#db.from('onyx_assessments')
      .select('id, title, pass_mark, results_published_at')
      .eq('tenant_id', tenantId).eq('id', assessmentId).maybeSingle();
    if (!assessment) throw new HttpError(404, 'Assessment not found.');

    const scores = attempts.map((a) => Number(a.score ?? 0));
    const max = attempts.length ? Number(attempts[0]!.max_score) : 0;
    const pass = assessment.pass_mark;

    return {
      assessment_id: assessmentId,
      title: assessment.title,
      published: Boolean(assessment.results_published_at),
      cohort: {
        sat: attempts.length,
        max_score: max,
        mean: round(mean(scores)),
        median: round(median(scores)),
        // Population standard deviation: this is the whole cohort, not a sample
        // drawn from one.
        stdev: round(stdev(scores)),
        highest: scores.length ? Math.max(...scores) : 0,
        lowest: scores.length ? Math.min(...scores) : 0,
        passed: pass === null || pass === undefined
          ? null
          : scores.filter((s) => s >= Number(pass)).length,
        pass_rate: pass === null || pass === undefined || !scores.length
          ? null
          : round((scores.filter((s) => s >= Number(pass)).length / scores.length) * 100),
        flagged: attempts.filter((a) => Number(a.integrity_flags) > 0).length,
      },
      candidates: attempts.map((a) => ({
        attempt_id: Number(a.id),
        user_id: String(a.user_id),
        score: Number(a.score ?? 0),
        max_score: Number(a.max_score),
        percent: Number(a.max_score) > 0
          ? round((Number(a.score ?? 0) / Number(a.max_score)) * 100)
          : 0,
        passed: pass === null || pass === undefined ? null : Number(a.score ?? 0) >= Number(pass),
        integrity_flags: Number(a.integrity_flags),
        integrity_status: a.integrity_status,
      })),
    };
  }

  /**
   * ASS-04a -- per-item statistics.
   *
   * Objective items only. "Correct" on an essay is a marker's judgement rather
   * than a fact, so a facility computed from it would be measuring the marker.
   */
  async itemAnalysis(tenantId: number, assessmentId: number): Promise<{
    sat: number; items: ItemStatistics[];
  }> {
    // Checked before the early return: an assessment id from another
    // institution must 404 rather than answer "nobody has sat it", which would
    // confirm the id is real.
    const { data: assessment } = await this.#db.from('onyx_assessments')
      .select('id').eq('tenant_id', tenantId).eq('id', assessmentId).maybeSingle();
    if (!assessment) throw new HttpError(404, 'Assessment not found.');

    const attempts = await this.#marked(tenantId, assessmentId);
    if (!attempts.length) return { sat: 0, items: [] };

    const { data } = await this.#db.from('onyx_assessment_answers')
      .select(ANSWER_COLUMNS).eq('tenant_id', tenantId)
      .in('attempt_id', attempts.map((a) => Number(a.id)));
    const answers = data ?? [];

    // Every item that appeared on any paper, with the wording it was sat under.
    const items = new Map<number, PaperEntry>();
    for (const a of attempts) {
      for (const q of (a.paper ?? []) as unknown as PaperEntry[]) {
        if (isObjective(q.type) && !items.has(q.question_id)) items.set(q.question_id, q);
      }
    }

    const byAttempt = new Map(attempts.map((a) => [Number(a.id), Number(a.score ?? 0)]));
    const out: ItemStatistics[] = [];

    for (const [questionId, item] of items) {
      const rows = answers.filter((r) => Number(r.question_id) === questionId);
      if (!rows.length) continue;

      // Full marks on the item is the definition of correct; partial credit is
      // not offered on objective types, so this is unambiguous.
      const correct = rows.map((r) => Number(r.auto_points ?? 0) >= item.points);
      const scores = rows.map((r) => byAttempt.get(Number(r.attempt_id)) ?? 0);
      const right = correct.filter(Boolean).length;
      const facility = round(right / rows.length, 3);
      const d = discriminationIndex(scores, correct);

      out.push({
        question_id: questionId,
        prompt: item.prompt,
        type: item.type,
        points: item.points,
        responses: rows.length,
        correct: right,
        facility,
        discrimination: d,
        // An item everybody or nobody got right separated nobody from anybody.
        uninformative: facility === 1 || facility === 0,
        // A negative index means the item rewarded the weaker half, which is
        // nearly always a wrong key rather than a hard question.
        suspect_key: d !== null && d < 0,
      });
    }

    return { sat: attempts.length, items: out.sort((a, b) => a.question_id - b.question_id) };
  }

  /**
   * Cohort benchmarking: how this assessment sits against the others on its
   * course. Comparing raw marks across different papers would be meaningless,
   * so everything is a percentage.
   */
  async benchmark(tenantId: number, courseId: number) {
    // Same reason as everywhere else: a course id from another institution is a
    // 404, not an empty comparison.
    const { data: course } = await this.#db.from('onyx_courses')
      .select('id').eq('tenant_id', tenantId).eq('id', courseId).maybeSingle();
    if (!course) throw new HttpError(404, 'Course not found.');

    const { data: assessments } = await this.#db.from('onyx_assessments')
      .select('id, title, pass_mark')
      .eq('tenant_id', tenantId).eq('course_id', courseId).order('id');

    const out = [];
    for (const a of assessments ?? []) {
      const attempts = await this.#marked(tenantId, Number(a.id));
      if (!attempts.length) continue;
      const percents = attempts.map((x) => (Number(x.max_score) > 0
        ? (Number(x.score ?? 0) / Number(x.max_score)) * 100 : 0));
      out.push({
        assessment_id: Number(a.id),
        title: a.title,
        sat: attempts.length,
        mean_percent: round(mean(percents)),
        median_percent: round(median(percents)),
        stdev_percent: round(stdev(percents)),
      });
    }
    return out;
  }

  /**
   * ASS-04b -- a CSV of the results.
   *
   * Generated as a string rather than streamed: an institutional cohort is
   * thousands of rows, not millions, and a string that is correct beats a
   * stream that is complicated. The acceptance criterion is that a large cohort
   * completes, so the query is one pass over attempts and one over answers
   * rather than a query per candidate.
   */
  async exportCsv(tenantId: number, assessmentId: number, opts: {
    names?: Map<string, { name: string; email: string }>;
  } = {}): Promise<string> {
    const report = await this.results(tenantId, assessmentId);
    const header = [
      'attempt_id', 'user_id', 'name', 'email', 'score', 'max_score', 'percent',
      'passed', 'integrity_flags', 'integrity_status',
    ];
    const rows = report.candidates.map((c) => {
      const who = opts.names?.get(c.user_id);
      return [
        c.attempt_id, c.user_id, who?.name ?? '', who?.email ?? '',
        c.score, c.max_score, c.percent,
        c.passed === null ? '' : (c.passed ? 'yes' : 'no'),
        c.integrity_flags, c.integrity_status,
      ];
    });
    return csvDocument(header, rows);
  }

  /**
   * The same report as a document somebody can print, sign and file.
   *
   * ASS-04b asks for CSV *and* PDF, and they are not the same deliverable: the
   * CSV is for the person who is going to do arithmetic on it, this is for the
   * board paper. So it carries the cohort statistics the CSV does not -- a
   * result sheet whose reader has to compute the mean themselves is a
   * spreadsheet with a header.
   */
  async exportPdf(tenantId: number, assessmentId: number, opts: {
    names?: Map<string, { name: string; email: string }>;
    issuer?: string | null;
    issuedAt?: number;
  } = {}): Promise<Buffer> {
    const report = await this.results(tenantId, assessmentId);
    const c = report.cohort;

    const meta = [
      'Sat by ' + c.sat + (c.sat === 1 ? ' candidate' : ' candidates')
        + ' · highest ' + c.highest + ', lowest ' + c.lowest + ' of ' + c.max_score,
      'Mean ' + c.mean + ' · median ' + c.median + ' · standard deviation ' + c.stdev,
      c.pass_rate === null
        ? 'No pass mark is set for this assessment.'
        : 'Passed ' + c.passed + ' of ' + c.sat + ' (' + c.pass_rate + '%)',
      // Stated on the page, because a printed result sheet outlives the screen
      // that said whether the results were published.
      report.published
        ? 'Results are published to candidates.'
        : 'PROVISIONAL — results are not yet published to candidates.',
    ];

    return pdfTable({
      title: report.title,
      subtitle: 'Results and item performance',
      meta,
      columns: [
        { header: 'Candidate', width: 230 },
        { header: 'Email', width: 220 },
        { header: 'Score', width: 70, align: 'right' },
        { header: 'Percent', width: 70, align: 'right' },
        { header: 'Passed', width: 60 },
        { header: 'Integrity', width: 120 },
      ],
      rows: report.candidates.map((cand) => {
        const who = opts.names?.get(cand.user_id);
        return [
          who?.name ?? 'User ' + cand.user_id,
          who?.email ?? '',
          cand.score + ' of ' + cand.max_score,
          cand.percent + '%',
          cand.passed === null ? '—' : (cand.passed ? 'Yes' : 'No'),
          cand.integrity_flags === 0
            ? 'Clear'
            : cand.integrity_flags + ' flags · ' + cand.integrity_status,
        ];
      }),
      // This service holds no clock -- it computes statistics from rows and
      // nothing else. The stamp is the caller's, defaulted here rather than
      // threading a clock through a class that has no other use for one.
      footer: (opts.issuer ?? 'Onyx LMS')
        + ' · generated ' + new Date(opts.issuedAt ?? Date.now()).toISOString().slice(0, 10),
    });
  }

  /** Attempts that have been sat and marked. In-progress papers are not data. */
  async #marked(tenantId: number, assessmentId: number) {
    const { data } = await this.#db.from('onyx_assessment_attempts')
      .select(ATTEMPT_COLUMNS)
      .eq('tenant_id', tenantId).eq('assessment_id', assessmentId)
      .neq('status', 'in_progress')
      .order('id');
    return (data ?? []).filter((a) => a.score !== null);
  }
}

// ---------------------------------------------------------------------------
// Arithmetic, kept plain so it can be checked by hand.
// ---------------------------------------------------------------------------

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((t, x) => t + x, 0) / xs.length : 0;
}

function median(xs: number[]): number {
  if (!xs.length) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Population standard deviation: the cohort IS the population. */
function stdev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((t, x) => t + (x - m) ** 2, 0) / xs.length);
}

function round(n: number, places = 2): number {
  const f = 10 ** places;
  return Math.round(n * f) / f;
}

