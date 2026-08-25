/**
 * Onyx database types.
 *
 * Hand-written rather than generated: the Onyx schema is designed here rather
 * than derived from a Laravel source, so there is nothing to generate FROM.
 * Keep it in step with supabase/onyx/migrations/.
 */

/**
 * A role WITHIN one institution, held on the membership.
 *
 * `employer` arrived with O05: the placement portal needs an outsider with an
 * account, scoped to their own company and nothing else. It is deliberately not
 * a kind of staff -- every staff check names the roles it allows rather than
 * excluding the ones it does not.
 *
 * `guardian` arrived with O07 and is the same idea again: an outsider whose
 * whole view is derived from a link somebody else consented to. A guardian is
 * not a weaker student -- they have no courses, no submissions and no profile
 * of their own, only children and the categories those children have shared.
 */
export type Role =
  | 'student' | 'faculty' | 'exams' | 'placement' | 'employer' | 'admin' | 'guardian';

export interface TenantRow {
  id: number;
  name: string;
  slug: string;
  status: number;
  plan: string | null;
  created_at: string;
  updated_at: string;
}

export interface OnyxUserRow {
  id: number;
  email: string;
  name: string;
  password: string | null;
  phone: string | null;
  photo: string | null;
  status: number;
  email_verified_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface MembershipRow {
  id: number;
  tenant_id: number;
  user_id: number;
  role: Role;
  status: number;
  /**
   * The teaching division this person is in.
   *
   * Null for staff, who have no section, and for anybody not assigned yet —
   * including every membership that existed before sections did.
   */
  section_id: number | null;
  created_at: string;
  updated_at: string;
}

/**
 * A teaching division within an institution: Alpha, Beta, Gamma; Section A, B, C.
 *
 * Not a batch. `BatchRow` is a programme cohort keyed to a programme and a
 * year — "B.Tech CSE 2024" — and a learner joins it through a join table. A
 * section is a division WITHIN that cohort, a learner is in exactly one at a
 * time, and it is what a timetable and an examination are actually organised
 * by. See migration 0038 for why the two are separate tables.
 */
export interface SectionRow {
  id: number;
  tenant_id: number;
  /** What it is called on screen: "Alpha", "Section A". */
  name: string;
  /** The short form a hall ticket prints. Lower-cased, unique per institution. */
  code: string;
  /** Teaching order, so Alpha/Beta/Gamma read in that order. */
  sort: number;
  /** 1 live, 0 retired. Retired rather than deleted — see 0038. */
  status: number;
  created_at: string;
  updated_at: string;
}

export interface AuditLogRow {
  id: number;
  tenant_id: number;
  actor_id: number | null;
  action: string;
  entity_type: string;
  entity_id: number | null;
  before: unknown;
  after: unknown;
  ip: string | null;
  created_at: string;
}

type Table<Row, Insert = Partial<Row>, Update = Partial<Row>> = {
  Row: Row;
  Insert: Insert;
  Update: Update;
  Relationships: [];
};

/**
 * Onyx tables share `public` with the Laravel port's 61 ported tables, kept
 * apart by the `onyx_` prefix. See docs/ADR-006-onyx-foundation.md.
 */
export interface OnyxDatabase {
  public: {
    Tables: {
      onyx_tenants: Table<TenantRow>;
      onyx_users: Table<OnyxUserRow>;
      onyx_memberships: Table<MembershipRow>;
      onyx_sections: Table<SectionRow>;
      onyx_audit_logs: Table<AuditLogRow>;
      onyx_programs: Table<ProgramRow>;
      onyx_semesters: Table<SemesterRow>;
      onyx_batches: Table<BatchRow>;
      onyx_batch_members: Table<BatchMemberRow>;
      onyx_courses: Table<OnyxCourseRow>;
      onyx_course_faculty: Table<CourseFacultyRow>;
      onyx_enrollments: Table<OnyxEnrollmentRow>;
      onyx_modules: Table<ModuleRow>;
      onyx_lessons: Table<OnyxLessonRow>;
      onyx_lesson_progress: Table<LessonProgressRow>;
      onyx_resources: Table<ResourceRow>;
      onyx_attendance_sessions: Table<AttendanceSessionRow>;
      onyx_attendance_records: Table<AttendanceRecordRow>;
      onyx_assignments: Table<AssignmentRow>;
      onyx_rubric_criteria: Table<RubricCriterionRow>;
      onyx_assignment_submissions: Table<SubmissionRow>;
      onyx_submission_scores: Table<SubmissionScoreRow>;
      onyx_jobs: Table<JobRow>;
      onyx_problems: Table<ProblemRow>;
      onyx_problem_tests: Table<ProblemTestRow>;
      onyx_hints: Table<HintRow>;
      onyx_hint_reveals: Table<HintRevealRow>;
      onyx_code_submissions: Table<CodeSubmissionRow>;
      onyx_submission_cases: Table<SubmissionCaseRow>;
      onyx_workspaces: Table<WorkspaceRow>;
      onyx_workspace_files: Table<WorkspaceFileRow>;
      onyx_workspace_snapshots: Table<WorkspaceSnapshotRow>;
      onyx_workspace_comments: Table<WorkspaceCommentRow>;
      onyx_question_banks: Table<QuestionBankRow>;
      onyx_questions: Table<QuestionRow>;
      onyx_question_versions: Table<QuestionVersionRow>;
      onyx_assessments: Table<AssessmentRow>;
      onyx_assessment_attempts: Table<AttemptRow>;
      onyx_assessment_answers: Table<AssessmentAnswerRow>;
      onyx_proctor_events: Table<ProctorEventRow>;
      onyx_assessment_grades: Table<AssessmentGradeRow>;
      onyx_certificates: Table<CertificateRow>;
      onyx_skills: Table<SkillRow>;
      onyx_learner_skills: Table<LearnerSkillRow>;
      onyx_readiness_scores: Table<ReadinessScoreRow>;
      onyx_employers: Table<EmployerRow>;
      onyx_jobs_posted: Table<JobPostRow>;
      onyx_job_applications: Table<JobApplicationRow>;
      onyx_drives: Table<DriveRow>;
      onyx_drive_rounds: Table<DriveRoundRow>;
      onyx_drive_results: Table<DriveResultRow>;
      onyx_contests: Table<ContestRow>;
      onyx_contest_teams: Table<ContestTeamRow>;
      onyx_contest_members: Table<ContestMemberRow>;
      onyx_contest_submissions: Table<ContestSubmissionRow>;
      onyx_mock_interviews: Table<MockInterviewRow>;
      onyx_discussions: Table<DiscussionRow>;
      onyx_discussion_posts: Table<DiscussionPostRow>;
      onyx_discussion_mentions: Table<DiscussionMentionRow>;
      onyx_tickets: Table<TicketRow>;
      onyx_ticket_events: Table<TicketEventRow>;
      onyx_faculty_allocations: Table<FacultyAllocationRow>;
      onyx_rooms: Table<RoomRow>;
      onyx_timetable_slots: Table<TimetableSlotRow>;
      onyx_exams: Table<ExamRow>;
      onyx_halls: Table<HallRow>;
      onyx_seat_allocations: Table<SeatAllocationRow>;
      onyx_exam_marks: Table<ExamMarkRow>;
      onyx_transcripts: Table<TranscriptRow>;
      onyx_fee_heads: Table<FeeHeadRow>;
      onyx_fee_structures: Table<FeeStructureRow>;
      onyx_fee_structure_lines: Table<FeeStructureLineRow>;
      onyx_invoices: Table<InvoiceRow>;
      onyx_invoice_lines: Table<InvoiceLineRow>;
      onyx_payments: Table<PaymentRow>;
      onyx_guardians: Table<GuardianRow>;
      onyx_platform_admins: Table<PlatformAdminRow>;
      onyx_platform_audit_logs: Table<PlatformAuditLogRow>;
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}

// ---------------------------------------------------------------------------
// O02 -- Onyx Learn
// ---------------------------------------------------------------------------

/**
 * `document` covers PDFs, slide decks and word-processor files -- one type
 * rather than one per extension, because what changes between them is the
 * viewer, not the lesson. `image` is separate from `document` because a
 * diagram or a scanned worksheet is displayed inline rather than downloaded.
 * `link` is the only type whose `path` is not a storage key.
 */
export type LessonType = 'video' | 'document' | 'image' | 'text' | 'link';
export type AttendanceStatus = 'present' | 'absent' | 'late' | 'excused';
export type AttendanceMethod = 'manual' | 'qr';
export type LatePolicy = 'reject' | 'accept' | 'penalty';
export type SubmissionStatus = 'draft' | 'submitted' | 'graded' | 'returned';

export interface ProgramRow {
  id: number; tenant_id: number; name: string; code: string;
  description: string | null; duration_semesters: number; status: number;
  created_at: string; updated_at: string;
}

export interface SemesterRow {
  id: number; tenant_id: number; program_id: number; name: string; number: number;
  starts_on: string | null; ends_on: string | null; status: number;
  created_at: string; updated_at: string;
}

export interface BatchRow {
  id: number; tenant_id: number; program_id: number; name: string; code: string;
  year: number | null; status: number; created_at: string; updated_at: string;
}

export interface BatchMemberRow {
  id: number; tenant_id: number; batch_id: number; user_id: number; created_at: string;
}

export interface OnyxCourseRow {
  id: number; tenant_id: number; program_id: number | null; semester_id: number | null;
  code: string; title: string; slug: string; description: string | null;
  credits: number; self_enroll: number; status: number; created_by: number | null;
  created_at: string; updated_at: string;
}

export interface CourseFacultyRow {
  id: number; tenant_id: number; course_id: number; user_id: number; created_at: string;
}

export interface OnyxEnrollmentRow {
  id: number; tenant_id: number; course_id: number; user_id: number;
  batch_id: number | null; status: number; enrolled_by: number | null;
  created_at: string; updated_at: string;
}

export interface ModuleRow {
  id: number; tenant_id: number; course_id: number; title: string;
  summary: string | null; sort: number; created_at: string; updated_at: string;
}

export interface OnyxLessonRow {
  id: number; tenant_id: number; course_id: number; module_id: number;
  title: string; type: LessonType; path: string | null; body: string | null;
  duration_seconds: number; sort: number; is_preview: number;
  created_at: string; updated_at: string;
}

export interface LessonProgressRow {
  id: number; tenant_id: number; course_id: number; lesson_id: number; user_id: number;
  position_seconds: number; completed_at: string | null;
  created_at: string; updated_at: string;
}

export interface ResourceRow {
  id: number; tenant_id: number; course_id: number; lesson_id: number | null;
  title: string; path: string; mime: string | null; size_bytes: number | null;
  created_by: number | null; created_at: string;
}

export interface AttendanceSessionRow {
  id: number; tenant_id: number; course_id: number; title: string;
  scheduled_at: string; duration_minutes: number; status: string;
  qr_secret: string | null; qr_window_seconds: number;
  created_by: number | null; created_at: string; updated_at: string;
}

export interface AttendanceRecordRow {
  id: number; tenant_id: number; session_id: number; user_id: number;
  status: AttendanceStatus; method: AttendanceMethod; note: string | null;
  marked_by: number | null; marked_at: string;
}

export interface AssignmentRow {
  id: number; tenant_id: number; course_id: number; title: string;
  instructions: string | null; attachment_path: string | null; due_at: string | null;
  total_points: number; late_policy: LatePolicy; late_penalty_percent: number;
  allow_resubmission: number; status: string; created_by: number | null;
  created_at: string; updated_at: string;
}

export interface RubricCriterionRow {
  id: number; tenant_id: number; assignment_id: number; title: string;
  description: string | null; points: number; sort: number; created_at: string;
}

export interface SubmissionRow {
  id: number; tenant_id: number; assignment_id: number; user_id: number;
  body: string | null; file_path: string | null; status: SubmissionStatus;
  attempt: number; submitted_at: string | null; is_late: number;
  score: number | null; feedback: string | null; graded_by: number | null;
  graded_at: string | null; returned_at: string | null;
  created_at: string; updated_at: string;
}

export interface SubmissionScoreRow {
  id: number; tenant_id: number; submission_id: number; criterion_id: number;
  points: number; comment: string | null; created_at: string;
}

// ---------------------------------------------------------------------------
// O03 -- Onyx Code Lab
// ---------------------------------------------------------------------------

export type JobStatus = 'queued' | 'running' | 'done' | 'failed';
export type SubmissionMode = 'run' | 'submit';

export interface JobRow {
  id: number; tenant_id: number; kind: string; payload: unknown;
  status: JobStatus; attempts: number; max_attempts: number;
  run_after: string; locked_at: string | null; locked_by: string | null;
  last_error: string | null; created_at: string; updated_at: string;
}

export interface ProblemRow {
  id: number; tenant_id: number; course_id: number | null;
  title: string; slug: string; statement: string | null;
  difficulty: string; topic: string | null; tags: unknown; languages: unknown;
  starter_code: unknown; time_limit_ms: number; memory_limit_kb: number;
  solution: string | null; solution_rule: string;
  solution_after_attempts: number; solution_after: string | null;
  status: string; created_by: number | null;
  created_at: string; updated_at: string;
}

export interface ProblemTestRow {
  id: number; tenant_id: number; problem_id: number; name: string;
  stdin: string | null; expected_stdout: string | null;
  is_hidden: number; weight: number; sort: number; created_at: string;
}

export interface HintRow {
  id: number; tenant_id: number; problem_id: number; body: string;
  sort: number; penalty_percent: number; created_at: string;
}

export interface HintRevealRow {
  id: number; tenant_id: number; hint_id: number; problem_id: number;
  user_id: number; created_at: string;
}

export interface CodeSubmissionRow {
  id: number; tenant_id: number; problem_id: number; user_id: number;
  language: string; source: string; mode: SubmissionMode; status: JobStatus;
  score: number; max_score: number; passed: number; total: number;
  compile_output: string | null; error: string | null;
  runtime_ms: number | null; memory_kb: number | null;
  queued_at: string; graded_at: string | null;
}

export interface SubmissionCaseRow {
  id: number; tenant_id: number; submission_id: number; test_id: number | null;
  name: string; is_hidden: number; passed: number; weight: number;
  runtime_ms: number | null; memory_kb: number | null;
  stdout: string | null; error: string | null; created_at: string;
}

export interface WorkspaceRow {
  id: number; tenant_id: number; course_id: number | null; user_id: number;
  title: string; language: string; entry_path: string;
  created_at: string; updated_at: string;
}

export interface WorkspaceFileRow {
  id: number; tenant_id: number; workspace_id: number;
  path: string; content: string; updated_at: string;
}

export interface WorkspaceSnapshotRow {
  id: number; tenant_id: number; workspace_id: number; label: string;
  files: unknown; created_by: number | null; created_at: string;
}

export interface WorkspaceCommentRow {
  id: number; tenant_id: number; workspace_id: number;
  snapshot_id: number | null; file_path: string | null; line: number | null;
  body: string; author_id: number | null;
  resolved_at: string | null; created_at: string;
}

// ---------------------------------------------------------------------------
// O04 -- Onyx Assess
// ---------------------------------------------------------------------------

export type AttemptStatus =
  | 'in_progress' | 'submitted' | 'expired' | 'graded' | 'moderated' | 'published'
  /**
   * Stopped by the departure rule (0040), not handed in by the candidate.
   *
   * Deliberately NOT one of the statuses the release rule accepts: a stopped
   * paper is scored so an invigilator can see where the candidate had got to,
   * and shown to the candidate only as "stopped" -- handing them the mark
   * would give away the marking of a paper they may be about to carry on
   * sitting.
   */
  | 'terminated';
export type IntegrityStatus = 'clean' | 'review' | 'flagged' | 'cleared' | 'upheld';

export interface QuestionBankRow {
  id: number; tenant_id: number; course_id: number | null;
  name: string; description: string | null;
  created_by: number | null; created_at: string; updated_at: string;
}

export interface QuestionRow {
  id: number; tenant_id: number; bank_id: number; type: string; prompt: string;
  options: unknown; answer: unknown; explanation: string | null;
  points: number; difficulty: string; tags: unknown;
  version: number; status: string; created_by: number | null;
  created_at: string; updated_at: string;
  /** Which parallel set of the bank this belongs to. 1 for everything
   *  written before sets existed. See migration 0039. */
  set_number: number;
}

export interface QuestionVersionRow {
  id: number; tenant_id: number; question_id: number; version: number;
  type: string; prompt: string; options: unknown; answer: unknown;
  explanation: string | null; points: number; created_at: string;
}

export interface AssessmentRow {
  id: number; tenant_id: number; course_id: number | null;
  /** The section this paper is set for. Null means every section. */
  section_id: number | null;
  title: string; instructions: string | null;
  opens_at: string | null; closes_at: string | null;
  duration_minutes: number; attempts_allowed: number; sections: unknown;
  shuffle_questions: number; shuffle_options: number;
  proctoring: number; require_camera: number; require_screen: number;
  anonymous_marking: number; moderation_required: number;
  /** Departures allowed before the paper is handed in. Zero is off (0040). */
  breach_limit: number;
  pass_mark: number | null; status: string;
  results_published_at: string | null; created_by: number | null;
  created_at: string; updated_at: string;
}

export interface AttemptRow {
  id: number; tenant_id: number; assessment_id: number; user_id: number;
  attempt: number; paper: unknown; status: AttemptStatus;
  started_at: string; expires_at: string; submitted_at: string | null;
  auto_score: number | null; manual_score: number | null;
  score: number | null; max_score: number;
  consented_at: string | null;
  integrity_flags: number; integrity_status: IntegrityStatus;
  /**
   * The departure rule (0040): how many times this candidate left the paper,
   * when it was stopped for it, and what was left on their clock at that
   * moment. `remaining_ms` is what makes "carry on from where you were"
   * possible -- `expires_at` is an absolute instant and keeps running while
   * an invigilator decides.
   */
  breach_count: number;
  terminated_at: string | null;
  terminated_reason: string | null;
  remaining_ms: number | null;
  reinstated_at: string | null;
  reinstated_by: string | null;
  created_at: string; updated_at: string;
}

export interface AssessmentAnswerRow {
  id: number; tenant_id: number; attempt_id: number; question_id: number;
  version: number; response: unknown;
  auto_points: number | null; manual_points: number | null;
  marker_comment: string | null; flagged_for_review: number;
  answered_at: string; updated_at: string;
}

export interface ProctorEventRow {
  id: number; tenant_id: number; attempt_id: number; kind: string;
  weight: number; detail: unknown; media_path: string | null;
  at: string; client_at: string | null;
  review: string; reviewed_by: number | null;
  reviewed_at: string | null; review_note: string | null;
}

export interface AssessmentGradeRow {
  id: number; tenant_id: number; attempt_id: number; role: string;
  marker_id: number | null; manual_score: number; comment: string | null;
  created_at: string;
}

// ---------------------------------------------------------------------------
// O05 -- Onyx Career
// ---------------------------------------------------------------------------

export interface CertificateRow {
  id: number; tenant_id: number; user_id: number; kind: string;
  course_id: number | null; assessment_id: number | null;
  title: string; credential_id: string;
  issued_at: string; expires_at: string | null;
  revoked_at: string | null; revoked_reason: string | null;
  issued_by: number | null; detail: unknown; created_at: string;
}

export interface SkillRow {
  id: number; tenant_id: number; name: string; slug: string;
  category: string | null; created_at: string;
}

export interface LearnerSkillRow {
  id: number; tenant_id: number; user_id: number; skill_id: number;
  source_type: string; source_id: number | null;
  strength: number; evidence: unknown; earned_at: string;
}

export interface ReadinessScoreRow {
  id: number; tenant_id: number; user_id: number; score: number;
  breakdown: unknown; formula: unknown; computed_at: string;
}

export interface EmployerRow {
  id: number; tenant_id: number; name: string;
  website: string | null; about: string | null;
  contact_name: string | null; contact_email: string | null;
  user_id: number | null; status: number;
  created_by: number | null; created_at: string; updated_at: string;
}

export interface JobPostRow {
  id: number; tenant_id: number; employer_id: number;
  title: string; description: string | null; location: string | null;
  compensation: string | null; openings: number;
  min_readiness: number | null; min_attendance: number | null;
  required_skills: unknown; program_ids: unknown; batch_ids: unknown;
  closes_at: string | null; status: string;
  created_by: number | null; created_at: string; updated_at: string;
}

export interface JobApplicationRow {
  id: number; tenant_id: number; job_id: number; user_id: number;
  status: string; note: string | null; readiness_at_apply: number | null;
  decided_by: number | null; decided_at: string | null;
  created_at: string; updated_at: string;
}

export interface DriveRow {
  id: number; tenant_id: number; employer_id: number; job_id: number | null;
  title: string; scheduled_at: string | null; venue: string | null;
  status: string; created_by: number | null; created_at: string; updated_at: string;
}

export interface DriveRoundRow {
  id: number; tenant_id: number; drive_id: number; name: string;
  sort: number; scheduled_at: string | null; created_at: string;
}

export interface DriveResultRow {
  id: number; tenant_id: number; round_id: number; drive_id: number;
  user_id: number; outcome: string; note: string | null;
  recorded_by: number | null; recorded_at: string;
}

export interface ContestRow {
  id: number; tenant_id: number; title: string; description: string | null;
  starts_at: string; ends_at: string; problems: unknown;
  team_size: number; penalty_minutes: number; status: string;
  freeze_minutes: number; created_by: number | null;
  created_at: string; updated_at: string;
}

export interface ContestTeamRow {
  id: number; tenant_id: number; contest_id: number; name: string;
  created_by: number | null; created_at: string;
}

export interface ContestMemberRow {
  id: number; tenant_id: number; team_id: number; contest_id: number;
  user_id: number; created_at: string;
}

export interface ContestSubmissionRow {
  id: number; tenant_id: number; contest_id: number; team_id: number;
  user_id: number; problem_id: number; submission_id: number | null;
  solved: number; points: number; at_minute: number; created_at: string;
}

export interface MockInterviewRow {
  id: number; tenant_id: number; user_id: number; interviewer_id: number | null;
  title: string; scheduled_at: string; duration_minutes: number;
  join_url: string | null; status: string;
  feedback: unknown; overall: number | null; notes: string | null;
  recording_path: string | null; recording_consented_at: string | null;
  released_at: string | null; created_at: string; updated_at: string;
}

// ---------------------------------------------------------------------------
// O06: engagement -- discussion, mentions, escalation
// ---------------------------------------------------------------------------

export type DiscussionStatus = 'open' | 'resolved' | 'closed';

export interface DiscussionRow {
  id: number;
  tenant_id: number;
  course_id: number;
  lesson_id: number | null;
  author_id: number;
  title: string;
  body: string;
  status: DiscussionStatus;
  resolved_at: string | null;
  resolved_by: number | null;
  answer_post_id: number | null;
  reply_count: number;
  last_post_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface DiscussionPostRow {
  id: number;
  tenant_id: number;
  discussion_id: number;
  parent_id: number | null;
  author_id: number;
  body: string;
  /** Who voted, not how many -- a counter lets one account click forever. */
  votes: number[];
  is_answer: boolean;
  edited_at: string | null;
  created_at: string;
}

export interface DiscussionMentionRow {
  id: number;
  tenant_id: number;
  discussion_id: number;
  post_id: number | null;
  user_id: number;
  read_at: string | null;
  created_at: string;
}

export type TicketPriority = 'low' | 'normal' | 'high' | 'urgent';
export type TicketStatus = 'open' | 'assigned' | 'answered' | 'resolved' | 'closed';

export interface TicketRow {
  id: number;
  tenant_id: number;
  discussion_id: number | null;
  course_id: number | null;
  raised_by: number;
  owner_id: number | null;
  subject: string;
  body: string;
  priority: TicketPriority;
  status: TicketStatus;
  sla_minutes: number;
  due_at: string;
  first_response_at: string | null;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
}

export type TicketEventKind =
  | 'raised' | 'assigned' | 'responded' | 'escalated' | 'resolved' | 'reopened' | 'commented';

export interface TicketEventRow {
  id: number;
  tenant_id: number;
  ticket_id: number;
  actor_id: number | null;
  kind: TicketEventKind;
  note: string | null;
  detail: unknown;
  created_at: string;
}

// ---------------------------------------------------------------------------
// O07: campus operations
// ---------------------------------------------------------------------------

export interface FacultyAllocationRow {
  id: number;
  tenant_id: number;
  semester_id: number;
  course_id: number;
  batch_id: number | null;
  user_id: number;
  kind: 'lead' | 'assistant' | 'lab';
  hours_per_week: number;
  created_at: string;
}

export interface RoomRow {
  id: number;
  tenant_id: number;
  code: string;
  name: string;
  capacity: number;
  kind: 'lecture' | 'lab' | 'seminar' | 'hall';
  building: string | null;
  status: number;
  created_at: string;
}

export interface TimetableSlotRow {
  id: number;
  tenant_id: number;
  semester_id: number;
  course_id: number;
  batch_id: number;
  room_id: number;
  faculty_id: number;
  /** ISO weekday: 1 = Monday .. 7 = Sunday. */
  day_of_week: number;
  /** Local wall-clock time, "HH:MM:SS". A timetable is read off a wall. */
  starts_at: string;
  ends_at: string;
  status: 'draft' | 'published';
  created_at: string;
}

export interface ExamRow {
  id: number;
  tenant_id: number;
  semester_id: number;
  course_id: number;
  /** The section this sitting is for. Null means every section. */
  section_id: number | null;
  assessment_id: number | null;
  title: string;
  starts_at: string;
  duration_minutes: number;
  max_marks: number;
  pass_marks: number;
  status: 'draft' | 'scheduled' | 'completed' | 'cancelled';
  created_by: number | null;
  created_at: string;
  updated_at: string;
}

export interface HallRow {
  id: number;
  tenant_id: number;
  code: string;
  name: string;
  row_count: number;
  col_count: number;
  capacity: number;
  status: number;
  created_at: string;
}

export interface SeatAllocationRow {
  id: number;
  tenant_id: number;
  exam_id: number;
  hall_id: number;
  user_id: number;
  seat_label: string;
  created_at: string;
}

export type MarkStatus = 'entered' | 'moderated' | 'published';

export interface ExamMarkRow {
  id: number;
  tenant_id: number;
  exam_id: number;
  user_id: number;
  raw_marks: number;
  moderation_delta: number;
  final_marks: number;
  grade: string | null;
  grade_points: number | null;
  status: MarkStatus;
  entered_by: number | null;
  moderated_by: number | null;
  moderated_at: string | null;
  published_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface TranscriptRow {
  id: number;
  tenant_id: number;
  user_id: number;
  program_id: number | null;
  serial: string;
  payload: unknown;
  gpa: number | null;
  credits_earned: number;
  /** SHA-256 over the canonicalised payload. */
  checksum: string;
  issued_by: number | null;
  issued_at: string;
  revoked_at: string | null;
}

export interface FeeHeadRow {
  id: number;
  tenant_id: number;
  code: string;
  name: string;
  category: 'tuition' | 'exam' | 'hostel' | 'transport' | 'library' | 'misc';
  refundable: boolean;
  created_at: string;
}

export interface FeeStructureRow {
  id: number;
  tenant_id: number;
  program_id: number | null;
  semester_id: number | null;
  name: string;
  currency: string;
  instalments: number;
  status: 'draft' | 'published';
  created_at: string;
  updated_at: string;
}

export interface FeeStructureLineRow {
  id: number;
  tenant_id: number;
  structure_id: number;
  head_id: number;
  /** Minor units (paise). Money in a float is a rounding error with a delay. */
  amount_minor: number;
  created_at: string;
}

export type InvoiceStatus = 'issued' | 'part_paid' | 'paid' | 'void';

export interface InvoiceRow {
  id: number;
  tenant_id: number;
  user_id: number;
  structure_id: number | null;
  number: string;
  instalment_no: number;
  currency: string;
  total_minor: number;
  paid_minor: number;
  status: InvoiceStatus;
  due_at: string | null;
  issued_at: string;
  created_at: string;
  updated_at: string;
}

export interface InvoiceLineRow {
  id: number;
  tenant_id: number;
  invoice_id: number;
  head_id: number | null;
  description: string;
  amount_minor: number;
  created_at: string;
}

export interface PaymentRow {
  id: number;
  tenant_id: number;
  invoice_id: number;
  user_id: number;
  gateway: string;
  /** The gateway's id. Unique per tenant -- this is what makes a replay a no-op. */
  reference: string;
  amount_minor: number;
  currency: string;
  status: 'pending' | 'captured' | 'failed' | 'refunded';
  method: string | null;
  raw: unknown;
  captured_at: string | null;
  created_at: string;
}

export interface GuardianRow {
  id: number;
  tenant_id: number;
  guardian_user_id: number;
  student_user_id: number;
  relationship: string;
  can_view_attendance: boolean;
  can_view_results: boolean;
  can_view_fees: boolean;
  verified_at: string | null;
  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// The platform layer -- above every tenant, not inside one.
// ---------------------------------------------------------------------------

export interface PlatformAdminRow {
  id: number;
  user_id: number;
  granted_by: number | null;
  created_at: string;
}

export interface PlatformAuditLogRow {
  id: number;
  actor_id: number | null;
  action: string;
  entity_type: string;
  entity_id: number | null;
  before: unknown;
  after: unknown;
  ip: string | null;
  created_at: string;
}
