/**
 * Shapes the O06 and O07 pages read, and the few helpers they share.
 *
 * Kept free of next/headers so client components can import it too -- the same
 * reason onyx-nav.ts holds the labels rather than onyx-session.ts.
 */

// ---------------------------------------------------------------------------
// LRN-05 -- progress and nudges
// ---------------------------------------------------------------------------

export interface Nudge {
  kind: string;
  message: string;
  href: string | null;
  urgency: 'low' | 'normal' | 'high';
  /** The signal behind it. Shown, so a nudge is never unexplained. */
  because: string;
}

export interface ProgressSummary {
  courses: { total: number; enrolled: number };
  lessons: { completed: number; total: number; percent: number };
  assignments: { due: number; overdue: number; submitted: number };
  attendance: { attended: number; sessions: number; percent: number };
  practice: { solved: number; attempted: number };
  streak: { current: number; longest: number; active_today: boolean };
  nudges: Nudge[];
}

// ---------------------------------------------------------------------------
// LRN-06 -- discussion and support
// ---------------------------------------------------------------------------

export interface Discussion {
  id: number;
  course_id: number;
  lesson_id: number | null;
  author_id: number;
  title: string;
  body: string;
  status: 'open' | 'resolved' | 'closed';
  answer_post_id: number | null;
  reply_count: number;
  last_post_at: string | null;
  created_at: string;
}

export interface DiscussionPost {
  id: number;
  parent_id: number | null;
  author_id: number;
  author: { id: number; name: string } | null;
  body: string;
  vote_count: number;
  voted: boolean;
  is_answer: boolean;
  created_at: string;
}

export interface DiscussionDetail extends Discussion {
  author: { id: number; name: string } | null;
  posts: DiscussionPost[];
}

export interface Ticket {
  id: number;
  subject: string;
  status: 'open' | 'assigned' | 'answered' | 'resolved' | 'closed';
  priority: 'low' | 'normal' | 'high' | 'urgent';
  owner_id: number | null;
  owner_name: string | null;
  raised_by: number;
  raised_by_name: string | null;
  created_at: string;
  due_at: string;
  age_minutes: number;
  minutes_remaining: number | null;
  breached: boolean;
  first_response_at: string | null;
  resolved_at: string | null;
}

export interface TicketDetail extends Ticket {
  body: string;
  course_id: number | null;
  discussion_id: number | null;
  sla_minutes: number;
  events: {
    id: number; kind: string; note: string | null; actor_id: number | null; created_at: string;
  }[];
}

// ---------------------------------------------------------------------------
// CMP-01 / CMP-02 -- timetable and examinations
// ---------------------------------------------------------------------------

export const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday',
  'Saturday', 'Sunday'];

/** CMP-01a -- who is teaching what, in which term. */
export interface FacultyAllocation {
  id: number; semester_id: number; course_id: number;
  batch_id: number | null; user_id: string;
  kind: 'lead' | 'assistant' | 'lab';
  hours_per_week: number;
}

/** The same allocations rolled up per person: the console's one useful number. */
export interface WorkloadRow {
  user_id: string; name: string | null; courses: number; hours: number;
}

export interface Room {
  id: number; code: string; name: string; capacity: number;
  kind: string; building: string | null;
}

export interface TimetableSlot {
  id: number;
  semester_id: number;
  course_id: number;
  batch_id: number;
  room_id: number;
  faculty_id: number;
  day_of_week: number;
  starts_at: string;
  ends_at: string;
  status: 'draft' | 'published';
}

export interface Exam {
  id: number;
  semester_id: number;
  course_id: number;
  title: string;
  starts_at: string;
  duration_minutes: number;
  max_marks: number;
  pass_marks: number;
  status: 'draft' | 'scheduled' | 'completed' | 'cancelled';
  /** Set only when this exam is sat online rather than on paper -- see the
   *  exam routes' syncExamAssessmentWindow() for what that actually does. */
  assessment_id: number | null;
}

export interface Hall {
  id: number; code: string; name: string;
  row_count: number; col_count: number; capacity: number;
}

export interface SeatingPlan {
  exam_id: number;
  total: number;
  halls: { hall_id: number; hall: string;
    seats: { seat_label: string; user_id: string; name: string | null }[] }[];
}

export interface ExamMark {
  id: number;
  exam_id: number;
  user_id: string;
  raw_marks: number;
  moderation_delta: number;
  final_marks: number;
  grade: string | null;
  grade_points: number | null;
  status: 'entered' | 'moderated' | 'published';
  /**
   * The examination this mark is for, attached by `marksFor`.
   *
   * Optional because `marksForExam` -- the staff-side read, where the paper is
   * already the thing on screen -- does not carry it.
   */
  exam?: {
    id: number; title: string; starts_at: string | null;
    max_marks: number; pass_marks: number; course_id: number | null;
  } | null;
}

export interface Transcript {
  id: number; serial: string; gpa: number | null;
  credits_earned: number; checksum: string; issued_at: string; revoked_at: string | null;
}

// ---------------------------------------------------------------------------
// CMP-03 -- money
// ---------------------------------------------------------------------------

export interface Invoice {
  id: number;
  number: string;
  currency: string;
  total_minor: number;
  paid_minor: number;
  status: 'issued' | 'part_paid' | 'paid' | 'void';
  due_at: string | null;
  issued_at: string;
}

export interface InvoiceDetail extends Invoice {
  lines: { id: number; description: string; amount_minor: number }[];
  payments: {
    id: number; gateway: string; reference: string;
    amount_minor: number; status: string; captured_at: string | null;
  }[];
}

/**
 * Paise to something a person reads.
 *
 * Everything is stored and transmitted in minor units; this is the only place
 * a decimal point appears, which is the point -- a rupee amount that exists in
 * one place cannot drift from the one in another.
 */
export function money(minor: number, currency = 'INR'): string {
  const sign = minor < 0 ? '-' : '';
  const abs = Math.abs(minor);
  return sign + currency + ' '
    + Math.floor(abs / 100).toLocaleString('en-IN') + '.'
    + String(abs % 100).padStart(2, '0');
}

// ---------------------------------------------------------------------------
// CMP-04 -- guardians
// ---------------------------------------------------------------------------

/** CMP-03b -- a gateway a learner can actually pay through. */
export interface PayableGateway {
  identifier: string; title: string; currency: string;
}

/** The same gateway as an administrator configures it. Never the credentials. */
export interface GatewayConfigSummary {
  id: number; identifier: string; title: string; currency: string;
  test_mode: number; status: number; configured_keys: string[];
  /**
   * What the stored key ITSELF is, from its prefix — as opposed to `test_mode`,
   * which is a flag somebody set beside it. `null` where the provider's keys
   * carry no mode marker. See `keyMode` in the checkout service.
   */
  keys_are_live?: boolean | null;
}

export interface GuardianLink {
  id: number;
  guardian_user_id: number;
  student_user_id: number;
  relationship: string;
  can_view_attendance: boolean;
  can_view_results: boolean;
  can_view_fees: boolean;
  verified_at: string | null;
  name: string | null;
  email: string | null;
}

export interface FamilyChild {
  link_id: number;
  student_user_id: number;
  name: string | null;
  relationship: string;
  shares: { attendance: boolean; results: boolean; fees: boolean };
  attendance: { attended: number; total: number; percent: number } | null;
  results: {
    exams: { exam_id: number; title: string; final_marks: number; max_marks: number; grade: string | null }[];
    assessments: { attempt_id: number; assessment_id: number; title: string; score: number; max_score: number; passed: boolean | null }[];
    courses: { course_id: number; code: string; title: string; credits: number }[];
  } | null;
  fees: { invoices: Invoice[]; outstanding_minor: number } | null;
}

/** "3h 20m late" reads better than a negative number of minutes. */
export function humanMinutes(minutes: number): string {
  const abs = Math.abs(Math.round(minutes));
  if (abs < 60) return abs + 'm';
  const hours = Math.floor(abs / 60);
  if (hours < 24) return hours + 'h ' + (abs % 60) + 'm';
  return Math.floor(hours / 24) + 'd ' + (hours % 24) + 'h';
}

/** "09:00:00" off the wire, "09:00" on the page. */
export const hhmm = (time: string) => time.slice(0, 5);
