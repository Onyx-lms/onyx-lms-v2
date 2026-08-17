/** Shapes the Code Lab pages read. */

export interface Problem {
  id: number;
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
  user_id: number;
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
