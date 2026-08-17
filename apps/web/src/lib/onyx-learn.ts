/**
 * Shapes the Onyx Learn pages read. Kept together so a page and the component
 * it renders cannot drift apart about what a lesson is.
 */
import type { Role } from './onyx-session';

export interface Program {
  id: number; name: string; code: string; description: string | null;
  duration_semesters: number; status: number;
}

export interface Semester {
  id: number; program_id: number; name: string; number: number;
  starts_on: string | null; ends_on: string | null;
}

export interface Batch {
  id: number; program_id: number; name: string; code: string; year: number | null;
}

export interface Course {
  id: number; program_id: number | null; semester_id: number | null;
  code: string; title: string; slug: string; description: string | null;
  credits: number; self_enroll: number; status: number;
  /** Present on the catalogue list (GET /courses); absent on a single course. */
  enrollment_count?: number;
  /** `name` is only present on the catalogue list -- GET /courses/:id's own
   *  faculty list (see CourseDetail in the dashboard) carries the id alone. */
  faculty?: { user_id: number; name?: string }[];
}

export interface Lesson {
  id: number; module_id: number; title: string;
  type: 'video' | 'document' | 'text' | 'link';
  path: string | null; body: string | null; duration_seconds: number;
  is_preview: number; locked: boolean;
  position_seconds: number; completed_at: string | null;
}

export interface CourseModule {
  id: number; title: string; summary: string | null; sort: number; lessons: Lesson[];
}

export interface Outline {
  course: Course;
  enrolled: boolean;
  modules: CourseModule[];
  progress: { total: number; completed: number; percent: number };
}

export interface LessonDetail extends Lesson {
  course_id: number;
  url: string | null;
  resources: Resource[];
}

export interface Resource {
  id: number; course_id: number; lesson_id: number | null;
  title: string; mime: string | null; size_bytes: number | null;
}

export interface AttendanceSession {
  id: number; course_id: number; title: string; scheduled_at: string;
  duration_minutes: number; status: string; qr_window_seconds: number;
}

export interface AttendanceRecord {
  id: number; session_id: number; user_id: number;
  status: 'present' | 'absent' | 'late' | 'excused';
  method: 'manual' | 'qr'; note: string | null; marked_at: string;
}

export interface AttendanceAnalytics {
  sessions: number;
  threshold: number;
  learners: {
    user_id: string; held: number; attended: number; excused: number;
    absent: number; percent: number; below_threshold: boolean;
  }[];
  cohort: { held: number; percent: number; below: number };
}

export interface RubricCriterion {
  id: number; assignment_id: number; title: string;
  description: string | null; points: number; sort: number;
}

export interface Submission {
  id: number; assignment_id: number; user_id: string;
  body: string | null; file_path: string | null;
  status: 'draft' | 'submitted' | 'graded' | 'returned';
  attempt: number; submitted_at: string | null; is_late: number;
  score: number | null; feedback: string | null; returned_at: string | null;
  updated_at: string;
  rubric_scores?: { criterion_id: number; points: number; comment: string | null }[];
}

export interface Assignment {
  id: number; course_id: number; title: string; instructions: string | null;
  due_at: string | null; total_points: number;
  late_policy: 'reject' | 'accept' | 'penalty'; late_penalty_percent: number;
  allow_resubmission: number; status: 'draft' | 'published';
  rubric?: RubricCriterion[];
  submissions?: Submission[];
  my_submission?: Submission | null;
}

/** Course content is visible without enrolment only to these two. */
export const isStaff = (role: Role) => role === 'admin' || role === 'faculty';

export function formatDuration(seconds: number): string {
  if (!seconds) return '';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m + ':' + String(s).padStart(2, '0');
}
