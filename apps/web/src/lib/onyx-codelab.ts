/** Shapes the Code Lab pages read. */

export interface Problem {
  id: number;
  /**
   * What this problem is answered with (0041).
   *
   * `code` is written in one language and run against test cases. `web` is
   * three files -- HTML, CSS and JavaScript -- previewed in a browser and
   * marked by a person. Absent on rows written before the distinction existed,
   * which are all code.
   */
  kind?: 'code' | 'web';
  /** `web` only: the document the preview opens. */
  preview_entry?: string;
  course_id: number | null;
  title: string;
  slug: string;
  statement: string | null;
  difficulty: string;
  topic: string | null;
  tags: string[];
  languages: string[];
  starter_code: Record<string, string>;
  time_limit_ms: number;
  memory_limit_kb: number;
  status: 'draft' | 'published';
  solution_rule: string;
  solution_after_attempts: number | null;
  solution_after: string | null;
}

/**
 * One problem's standing for one learner.
 *
 * `author` is present only on the staff-facing read -- which member of staff
 * set a problem is not a learner's business, so the server omits it rather
 * than the page hiding it.
 */
export interface PracticeResult {
  problem_id: number;
  title: string;
  slug: string;
  difficulty: string;
  topic: string | null;
  course_id: number | null;
  solved: boolean;
  attempts: number;
  best_score: number;
  max_score: number;
  last_attempt_at: string | null;
  last_submission_id: number | null;
  pending: boolean;
  author_id?: string | null;
  author?: string;
}

/** A test case as a learner may see it: a hidden one carries no input at all. */
export interface PublicTest {
  id: number;
  name: string;
  is_hidden: number;
  stdin: string | null;
  expected_stdout: string | null;
}

export interface ProblemDetail extends Problem {
  tests: PublicTest[];
  hints: {
    id: number; sort: number; penalty_percent: number;
    revealed: boolean; body: string | null;
  }[];
  solution: string | null;
  solution_released: boolean;
  solved: boolean;
  attempts: number;
}

export interface Workspace {
  id: number;
  course_id: number | null;
  /** The owner's account id -- a uuid since 0014, not a bigint. */
  user_id: string;
  title: string;
  language: string;
  entry_path: string;
  updated_at: string;
}

export interface WorkspaceDetail extends Workspace {
  files: { id: number; path: string; content: string }[];
  snapshots: { id: number; label: string; created_at: string; file_count: number }[];
  comments: {
    id: number; file_path: string | null; line: number | null; body: string;
    author_id: number | null; resolved_at: string | null; created_at: string;
  }[];
  can_review: boolean;
}

/** One sandbox call against one workspace file -- `POST /workspaces/:id/run`. */
export interface WorkspaceRunResult {
  path: string;
  verdict: 'ok' | 'compile_error' | 'runtime_error' | 'timeout'
    | 'memory_exceeded' | 'output_exceeded' | 'internal_error';
  stdout: string;
  stderr: string;
  compileOutput: string;
  runtimeMs: number;
  memoryKb: number;
}

export const DIFFICULTY_LABELS: Record<string, string> = {
  easy: 'Easy', medium: 'Medium', hard: 'Hard',
};

/**
 * One practice hand-in, as the staff-facing lists read it.
 *
 * The problem's title and the learner's name are resolved by the service
 * rather than by the page: both live on other tables, and every screen that
 * needed them was otherwise going to resolve them again.
 */
export interface CodeSubmissionRow {
  id: number;
  problem_id: number;
  user_id: string;
  language: string;
  mode: 'run' | 'submit';
  /** What the grader writes. 'done' is the success state -- the UI labels it Graded. */
  status: 'queued' | 'running' | 'done' | 'failed';
  score: number;
  max_score: number;
  passed: number;
  total: number;
  error: string | null;
  runtime_ms: number | null;
  memory_kb: number | null;
  queued_at: string;
  graded_at: string | null;
  problem_title: string;
  problem_slug: string | null;
  difficulty: string | null;
  topic: string | null;
  course_id: number | null;
  learner: string;
  roll_number: string | null;
}

/** What `GET /api/onyx/practice/submissions` answers with. */
export interface CodeSubmissionFeed {
  submissions: CodeSubmissionRow[];
  total: number;
  /** True when the limit bit, so a partial list never reads as a whole one. */
  truncated: boolean;
  /** The languages and states actually present, for the filter menus. */
  languages: string[];
  statuses: string[];
}
