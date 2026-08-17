import Link from 'next/link';
import { platformApi } from '@/lib/onyx-platform-session';
import { Banner, Icon, Pill, State, relativeDue } from '@/components/onyx-ui';

/**
 * Shared shapes and small presentational pieces for the tenant-scoped
 * platform pages (`/onyx/platform/tenants/[id]/...`). Split out of what used
 * to be one 790-line page so each section -- Students, Courses, Grades,
 * Fees -- can be its own route, reached from its own nav link, instead of one
 * long page an operator scrolled through to find the table they wanted.
 */

// ---------------------------------------------------------------------------
// What the platform API returns. Mirrors PlatformService's shapes.
// ---------------------------------------------------------------------------

export interface TenantDetail {
  id: number; name: string; slug: string; status: number; plan: string | null;
  created_at: string; members_by_role: Record<string, number>; member_count: number;
  counts: {
    courses: number; assessments: number; assignments: number; enrollments: number;
    programmes: number; batches: number; exams: number; exam_marks: number;
    submissions: number; attempts: number;
  };
}

export interface Person {
  membership_id: number; user_id: string; name: string; email: string; phone: string | null;
  role: string; membership_status: number; account_status: number; joined_at: string;
  batch: { id: number; name: string; code: string } | null;
  programme: { id: number; name: string; code: string } | null;
  enrollment_count: number; teaching_count: number;
}
export interface PeoplePayload {
  limit: number; capped: boolean; total: number;
  counts_by_role: Record<string, number>; people: Person[];
}

export interface CourseRow {
  id: number; code: string; title: string; credits: number; status: number;
  self_enroll: boolean; programme: string | null;
  enrollment_count: number; faculty_count: number;
}
export interface AssignmentRow {
  id: number; title: string; course: { code: string; title: string } | null; course_id: number;
  due_at: string | null; total_points: number; status: string;
  submission_count: number; graded_count: number;
}
export interface AssessmentRow {
  id: number; title: string; course: { code: string; title: string } | null;
  course_id: number | null;
  closes_at: string | null; opens_at: string | null; status: string; pass_mark: number | null;
  duration_minutes: number; attempt_count: number; submitted_count: number;
}
export interface ExamRow {
  id: number; title: string; course: { code: string; title: string } | null;
  starts_at: string | null; duration_minutes: number; max_marks: number; pass_marks: number;
  status: string; seats_allocated: number; marks_entered: number; marks_published: number;
}
export interface AcademicsPayload {
  limit: number;
  capped: { courses: boolean; assignments: boolean; assessments: boolean; exams: boolean };
  courses: CourseRow[]; assignments: AssignmentRow[]; assessments: AssessmentRow[]; exams: ExamRow[];
}

export interface Student { id: string; name: string; email: string }
export interface ExamMark {
  id: number; student: Student; exam: { id: number; title: string } | null;
  course: { code: string; title: string } | null;
  raw_marks: number; final_marks: number; max_marks: number | null; pass_marks: number | null;
  grade: string | null; status: string; recorded_at: string;
}
export interface AssessmentGrade {
  id: number; student: Student; assessment: { id: number; title: string } | null;
  course: { code: string; title: string } | null;
  score: number | null; max_score: number; pass_mark: number | null;
  status: string; submitted_at: string | null;
}
export interface GradesPayload {
  limit: number; capped: { exam_marks: boolean; assessment_grades: boolean };
  exam_marks: ExamMark[]; assessment_grades: AssessmentGrade[];
  summary: {
    exams: {
      count: number; mean_percent: number | null; mean_marks: number | null;
      pass_rate: number | null; published: number;
    };
    assessments: { count: number; mean_percent: number | null; pass_rate: number | null };
  };
}

export interface AdminRow {
  id: number; user_id: string; created_at: string;
  user: { id: string; name: string; email: string } | null;
}

export interface FeeHead {
  id: number; code: string; name: string; category: string; refundable: boolean;
}
export interface FeeStructure {
  id: number; name: string; currency: string; instalments: number; status: string;
  created_at: string; total_minor: number;
}
export interface OutstandingInvoice {
  id: number; user_id: string; number: string; total_minor: number; paid_minor: number;
  balance_minor: number; status: string; due_at: string | null; overdue: boolean;
  student: { id: string; name: string; email: string } | null;
}
export interface FeesPayload {
  tenant: { id: number; name: string; slug: string };
  heads: FeeHead[];
  structures: FeeStructure[];
  outstanding: { total_minor: number; invoices: OutstandingInvoice[] };
}

export interface Semester { id: number; name: string; status: number }

// ---------------------------------------------------------------------------

/**
 * A section that failed to load should cost its own table, not the page. An
 * operator looking at a customer in trouble is the worst moment to replace
 * everything with a stack trace, so each read is caught and the section it
 * feeds says so in words.
 */
export async function attempt<T>(path: string): Promise<T | null> {
  try {
    return await platformApi<T>(path);
  } catch {
    return null;
  }
}

/** A past date in words. relativeDue() answers "when is this due"; this is the other direction. */
export function ago(iso: string | null | undefined): string {
  if (!iso) return 'Unknown';
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return 'Unknown';
  const days = Math.floor((Date.now() - then) / 86_400_000);
  if (days < 0) return relativeDue(iso).text;
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 30) return days + ' days ago';
  if (days < 365) {
    const months = Math.round(days / 30);
    return months === 1 ? 'A month ago' : months + ' months ago';
  }
  const years = Math.round(days / 365);
  return years === 1 ? 'A year ago' : years + ' years ago';
}

export const plural = (n: number, one: string, many = one + 's') => n + ' ' + (n === 1 ? one : many);

/** Never colour alone: the dot has a word beside it and the word carries the meaning. */
export function AccountState({ status }: { status: number }) {
  return status === 1
    ? <State tone="on">Active</State>
    : <State tone="off">Disabled</State>;
}

const WORKFLOW: Record<string, { label: string; tone: 'neutral' | 'good' | 'soon' | 'late' }> = {
  draft: { label: 'Draft', tone: 'neutral' },
  published: { label: 'Published', tone: 'good' },
  closed: { label: 'Closed', tone: 'neutral' },
  entered: { label: 'Entered', tone: 'soon' },
  moderated: { label: 'Moderated', tone: 'soon' },
  cancelled: { label: 'Cancelled', tone: 'late' },
  completed: { label: 'Completed', tone: 'good' },
  scheduled: { label: 'Scheduled', tone: 'neutral' },
  archived: { label: 'Archived', tone: 'neutral' },
};
export function Workflow({ status }: { status: string }) {
  const s = WORKFLOW[status] ?? { label: status, tone: 'neutral' as const };
  return <Pill tone={s.tone}>{s.label}</Pill>;
}

export function DueCell({ at }: { at: string | null }) {
  const due = relativeDue(at);
  return <Pill tone={due.tone}>{due.text}</Pill>;
}

/** A fact in a summary card. Label above, value below. */
export function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-bold uppercase tracking-[.08em] text-muted">{label}</dt>
      <dd className="mt-0.5 break-words text-[13px]">{children}</dd>
    </div>
  );
}

/** One table failed while the rest of the page did not. Say which, and why it is empty. */
export function Unavailable({ what }: { what: string }) {
  return (
    <Banner tone="warn" icon="alert">
      The {what} for this institution could not be loaded just now. Nothing has been
      changed — reload the page to try again.
    </Banner>
  );
}

/**
 * A way back that does not depend on noticing the sidebar. The sidebar nav
 * is always there, but an operator who just finished a task on this page has
 * their eyes and mouse here, not over on the left -- a local "go up one
 * level" link is what browser back does when it works, and a step cheaper
 * when a click along the way changed the URL enough that back does not.
 */
export function TenantBackLink({ tenantId }: { tenantId: number }) {
  return (
    <Link href={'/onyx/platform/tenants/' + tenantId}
      className="inline-flex items-center gap-1 text-[13px] font-semibold text-muted
                 hover:text-brand-700 hover:underline">
      <Icon name="chevron" className="h-3.5 w-3.5 rotate-180" />
      Overview
    </Link>
  );
}

export const SCROLLER = 'min-w-0';

export const money = (minor: number, currency = 'INR') => currency + ' ' + (minor / 100).toFixed(2);
