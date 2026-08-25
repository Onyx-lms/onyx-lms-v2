/** Shapes the Assess pages read. */

export interface Assessment {
  id: number;
  course_id: number | null;
  title: string;
  instructions: string | null;
  opens_at: string | null;
  closes_at: string | null;
  duration_minutes: number;
  attempts_allowed: number;
  proctoring: number;
  require_camera: number;
  /** May an invigilator watch this candidate live? Off unless switched on. */
  watch_camera?: boolean;
  /** Hand the mark back at submit, where the paper needs no marker. */
  instant_results?: boolean;
  require_screen: number;
  anonymous_marking: number;
  moderation_required: number;
  // Stored as 0/1, and both were missing here -- which is part of why no
  // screen ever offered them: the type said they did not exist.
  shuffle_questions: number;
  shuffle_options: number;
  pass_mark: number | null;
  status: 'draft' | 'published' | 'closed';
  results_published_at: string | null;
  sections?: { id: string; title: string; bank_id: number; take: number }[];
}

export interface PaperQuestion {
  question_id: number;
  type: 'single' | 'multiple' | 'truefalse' | 'short' | 'essay' | 'code' | 'web';
  prompt: string;
  options: { id: string; text: string }[];
  points: number;
  section_id: string | null;
  response: unknown;
  awarded: number | null;
  /**
   * Was this one right? Null where "right" is not a fact -- an essay, or an
   * MCQ-shaped question nobody set a key on.
   */
  correct?: boolean | null;
  /** The correct answer, once the candidate has no sitting left to spoil. */
  expected?: unknown;
  explanation?: string | null;
  /** What the marker wrote against this answer. Released with the marks. */
  comment?: string | null;
  /** `code` only: what the candidate needs in order to answer. Never the tests. */
  problem?: {
    id: number;
    /** `code` is run against tests; `web` is three files and a preview (0041). */
    kind?: 'code' | 'web';
    title: string; statement: string | null;
    languages: string[];
    /** For `code`, keyed by language. For `web`, keyed by path. */
    starter_code: Record<string, string>;
    /** `web` only: the document the preview opens. */
    preview_entry?: string;
    time_limit_ms: number;
  };
}

export interface CandidateAttempt {
  id: number;
  assessment_id: number;
  attempt: number;
  status: 'in_progress' | 'submitted' | 'expired' | 'graded' | 'moderated' | 'published';
  started_at: string;
  expires_at: string;
  submitted_at: string | null;
  /** The only number the timer should trust. */
  seconds_remaining: number;
  max_score: number;
  score: number | null;
  pass_mark: number | null;
  questions: PaperQuestion[];
}

export interface MarkerQuestion {
  question_id: number;
  version: number;
  type: string;
  prompt: string;
  options: { id: string; text: string }[];
  points: number;
  response: unknown;
  objective: boolean;
  expected: unknown;
  explanation: string | null;
  auto_points: number | null;
  manual_points: number | null;
  marker_comment: string | null;
}

export interface MarkerPaper {
  id: number;
  status: string;
  auto_score: number | null;
  manual_score: number | null;
  score: number | null;
  max_score: number;
  anonymous: boolean;
  user_id: number | null;
  integrity_flags: number;
  questions: MarkerQuestion[];
  grades: { id: number; role: string; marker_id: number | null; manual_score: number }[];
}

export interface MarkingQueueRow {
  id: number;
  attempt: number;
  status: string;
  submitted_at: string | null;
  auto_score: number | null;
  manual_score: number | null;
  score: number | null;
  max_score: number;
  integrity_flags: number;
  integrity_status: string;
  user_id: string | null;
  candidate: string | null;
  /** The institution's own number, and the teaching division. Both withheld
   *  under anonymous marking, with the name. */
  roll_number?: string | null;
  section?: string | null;
}

export interface ResultsReport {
  assessment_id: number;
  title: string;
  published: boolean;
  cohort: {
    sat: number; max_score: number; mean: number; median: number; stdev: number;
    highest: number; lowest: number; passed: number | null; pass_rate: number | null;
    flagged: number;
  };
  candidates: {
    attempt_id: number; user_id: number; score: number; max_score: number;
    percent: number; passed: boolean | null;
    integrity_flags: number; integrity_status: string;
  }[];
}

export interface ItemStat {
  question_id: number; prompt: string; type: string; points: number;
  responses: number; correct: number; facility: number;
  discrimination: number | null; uninformative: boolean; suspect_key: boolean;
}

export interface ProctorEvent {
  id: number; kind: string; weight: number; detail: unknown;
  at: string; client_at: string | null;
  review: string; reviewed_by: number | null; review_note: string | null;
  offset_seconds: number; clock_skew_seconds: number | null;
}

export interface ProctorTimeline {
  attempt_id: number;
  // A Supabase Auth uuid since 0014, not a number. This declaration saying
  // otherwise is how `Number(user_id)` looked reasonable in the service and
  // shipped "Candidate #null" to every row of the invigilation queue.
  user_id: string;
  consented_at: string | null; started_at: string;
  expires_at: string | null; submitted_at: string | null;
  integrity_flags: number; integrity_status: string;
  events: ProctorEvent[];
}

export interface MyAttempt {
  attempt_id: number; assessment_id: number; title: string; attempt: number;
  status: string; submitted_at: string | null;
  max_score: number; score: number | null; pass_mark: number | null;
  passed: boolean | null; results_published: boolean;
}

/** Who runs papers. Faculty teach; exams officers invigilate and publish. */
export const isExamsStaff = (role: string) =>
  role === 'admin' || role === 'faculty' || role === 'exams';

/** Plain English for an event kind, so an invigilator is not reading enums. */
export const EVENT_LABELS: Record<string, string> = {
  consent: 'Consented to monitoring',
  camera_on: 'Camera started',
  camera_off: 'Camera stopped',
  screen_on: 'Screen sharing started',
  screen_off: 'Screen sharing stopped',
  tab_blur: 'Left the tab',
  tab_focus: 'Returned to the tab',
  paste: 'Pasted into the paper',
  copy: 'Copied from the paper',
  fullscreen_exit: 'Left full screen',
  no_face: 'No face visible',
  multiple_faces: 'More than one face visible',
  snapshot: 'Snapshot taken',
};

export function formatClock(seconds: number): string {
  const s = Math.max(0, seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h ? h + ':' + pad(m) + ':' + pad(sec) : pad(m) + ':' + pad(sec);
}
