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
  /** The institution's own number for them. Searchable; see matchesPerson. */
  roll_number: string | null;
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
  /** What the paper draws. Empty means nobody can sit it. */
  sections?: { id: string; title: string; bank_id: number; take: number }[] | null;
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

/**
 * A date whose meaning depends on whether the thing has happened yet.
 *
 * `DueCell` is a DEADLINE: it counts down, and once the date passes it says
 * "26 days late" in red, which is exactly right for an assignment nobody has
 * handed in. It was also being used for an exam's sitting date and an
 * assessment's closing date, where it was exactly wrong -- the console showed
 * "Completed · 26 days late" for an exam that was sat a month ago and marked,
 * and "Closed · in 2 weeks" for an assessment that had already closed.
 *
 * Once a record has reached a terminal state the date behind it is history,
 * not a deadline, so it is read backwards: "26 days ago", in neutral ink.
 * Anything still open keeps the countdown, because for those the deadline
 * still means something.
 */
const SETTLED = new Set(['completed', 'closed', 'cancelled', 'archived', 'published', 'graded']);

export function WhenCell({ at, status }: { at: string | null; status: string }) {
  if (!at) return <Pill tone="neutral">Not set</Pill>;
  if (SETTLED.has(status)) {
    // A settled record whose date is still in the future is a contradiction --
    // an assessment marked closed that "closes in 2 weeks". Neither reading is
    // safe to assert, so state the date itself and let the operator judge.
    const future = Date.parse(at) > Date.now();
    return (
      <Pill tone="neutral">
        {future
          ? new Date(at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
          : ago(at)}
      </Pill>
    );
  }
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

/*
 * TenantBackLink used to live here -- a "‹ Overview" link at the top of every
 * section. The layout's breadcrumb (Institutions / ABC Institution / Students)
 * now does that job, in the place a person looks for it, and does it better:
 * it goes up two levels, not one, and it names where each step lands.
 */

/**
 * The strip above a roster table: what the table holds on the left, the one
 * action that adds to it on the right.
 *
 * Adding a person used to live only in the sidebar's "Create a profile",
 * which asked which of eight kinds to create -- a question the operator had
 * already answered by opening the Students tab. The control now sits directly
 * above the table it changes, says what it will add, and asks nothing that the
 * tab has already settled. Same idea on all three People tabs, so moving
 * between them does not mean learning a different screen.
 *
 * The count is here rather than in a stat tile because it is the caption for
 * the table underneath, and it tells an operator whether the row they just
 * added actually arrived.
 */
export function RosterHeader({ count, noun, plural: many, action, aside }: {
  count: number; noun: string; plural?: string; action?: React.ReactNode;
  /** Anything between the count and the action -- a search box, usually. */
  aside?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <p className="text-[13px] font-semibold text-muted">
        {plural(count, noun, many)} at this institution
      </p>
      <span className="flex-1" />
      {aside}
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

/**
 * Search within a roster.
 *
 * A GET form rather than a client-side filter, for the same reasons the
 * institutions directory uses one: the query lives in the URL so it survives a
 * reload and can be sent to a colleague, and the page stays a server
 * component. It narrows the rows the console already holds -- the API caps a
 * roster at 200 -- which is the same set the table was showing anyway.
 *
 * It exists because the rosters had no search at all. Twelve rows is fine;
 * four hundred is a page you scroll looking for one name, which is what an
 * operator opening a customer's roll is almost always doing.
 */
export function RosterSearch({ q, placeholder }: { q?: string; placeholder: string }) {
  return (
    <form method="get" className="flex min-w-0 items-center gap-2">
      <label className="sr-only" htmlFor="roster-q">Search this roster</label>
      <div className="relative min-w-0">
        <Icon name="search"
          className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2
                     text-faint" />
        <input id="roster-q" name="q" defaultValue={q ?? ''} placeholder={placeholder}
          className="block min-h-[38px] w-[17rem] max-w-full rounded-xl border border-line
                     bg-white pl-8 pr-2.5 text-[13.5px] focus:border-slate-500
                     focus:outline-none focus:ring-2 focus:ring-ink/20" />
      </div>
      {q ? (
        <a href="?" className="text-[12.5px] font-semibold text-muted hover:text-brand-700
                               hover:underline">Clear</a>
      ) : null}
    </form>
  );
}

/** Does this person match what was typed? Name, email, roll, batch, programme. */
export function matchesPerson(p: Person, q: string): boolean {
  if (!q) return true;
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  // Roll number included, and it is the reason this function was wrong: staff
  // search by the identifier they are holding, which is far more often a roll
  // number off a register than an email address.
  return [p.name, p.email, p.roll_number, p.role,
    p.batch?.code, p.batch?.name, p.programme?.name]
    .some((v) => typeof v === 'string' && v.toLowerCase().includes(needle));
}

export const SCROLLER = 'min-w-0';

// The shared one, so the console does not print "INR 300.00" while every
// other screen in the product says "₹300.00".
export { money } from '@/lib/onyx-money';
