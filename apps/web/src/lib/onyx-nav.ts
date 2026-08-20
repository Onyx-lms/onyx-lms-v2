import type { Role } from './onyx-session';
import type { IconName } from '@/components/onyx-ui';

/**
 * F-07 -- role-aware navigation.
 *
 * Seven roles, seven different jobs. Rather than one menu with items
 * disabled, each role gets the menu for its own work; the API enforces the
 * same boundaries, so a hidden link is a courtesy and not the control.
 *
 * Two things changed when the design was reworked:
 *
 *   * **Groups.** A flat list of thirteen links is what the admin menu had
 *     become, and it is the thing that most made the product read as an
 *     unfinished internal tool rather than an institutional platform. Every
 *     enterprise console worth copying groups its sidebar; these are grouped
 *     by the job being done, not by the sprint that added them.
 *   * **Tabs.** `tabsFor` is the phone's bottom bar -- at most five
 *     destinations, chosen as the ones a person opens daily. Everything else
 *     stays one tap away behind the header menu, which is what stops a phone
 *     having to scroll past the whole menu to reach any content.
 *
 * This module is imported by client components, so it must stay free of
 * next/headers -- which is why the labels live here and not in onyx-session.
 */

export interface OnyxNavItem { href: string; label: string; icon: IconName }
export interface OnyxNavGroup { label?: string; items: OnyxNavItem[] }

export const ROLE_LABELS: Record<Role, string> = {
  student: 'Student',
  faculty: 'Faculty',
  exams: 'Examinations',
  placement: 'Placement',
  employer: 'Employer',
  admin: 'Administrator',
  guardian: 'Parent or guardian',
};

const I = {
  dashboard: { href: '/onyx/dashboard', label: 'Dashboard', icon: 'home' },
  courses:   { href: '/onyx/courses', label: 'Courses', icon: 'book' },
  practice:  { href: '/onyx/practice', label: 'Practice', icon: 'code' },
  spaces:    { href: '/onyx/workspaces', label: 'Workspaces', icon: 'layers' },
  assess:    { href: '/onyx/assessments', label: 'Assessments', icon: 'edit' },
  results:   { href: '/onyx/results', label: 'Results', icon: 'award' },
  contests:  { href: '/onyx/contests', label: 'Contests', icon: 'trophy' },
  timetable: { href: '/onyx/timetable', label: 'Timetable', icon: 'calendar' },
  fees:      { href: '/onyx/fees', label: 'Fees', icon: 'wallet' },
  finance:   { href: '/onyx/finance', label: 'Finance', icon: 'wallet' },
  support:   { href: '/onyx/support', label: 'Help', icon: 'help' },
  mentor:    { href: '/onyx/support', label: 'Mentor queue', icon: 'help' },
  jobs:      { href: '/onyx/jobs', label: 'Jobs', icon: 'briefcase' },
  posts:     { href: '/onyx/jobs', label: 'Your posts', icon: 'briefcase' },
  interviews:{ href: '/onyx/interviews', label: 'Interviews', icon: 'mic' },
  profile:   { href: '/onyx/profile', label: 'Your profile', icon: 'user' },
  people:    { href: '/onyx/people', label: 'People', icon: 'users' },
  students:  { href: '/onyx/people?role=student', label: 'Students', icon: 'users' },
  facultyList: { href: '/onyx/people?role=faculty', label: 'Faculty', icon: 'user' },
  programs:  { href: '/onyx/programs', label: 'Programmes', icon: 'building' },
  exams:     { href: '/onyx/exams', label: 'Examinations', icon: 'award' },
  invigilate:{ href: '/onyx/invigilate', label: 'Invigilate', icon: 'shield' },
  placement: { href: '/onyx/placement', label: 'Placement', icon: 'chart' },
  audit:     { href: '/onyx/audit', label: 'Audit log', icon: 'flag' },
  family:    { href: '/onyx/family', label: 'Your family', icon: 'users' },
  inbox:     { href: '/onyx/inbox', label: 'Inbox', icon: 'bell' },
  certs:     { href: '/onyx/certificates', label: 'Certificates', icon: 'award' },
  allocate:  { href: '/onyx/allocations', label: 'Teaching load', icon: 'chart' },
  settings:  { href: '/onyx/settings', label: 'Settings', icon: 'settings' },
} satisfies Record<string, OnyxNavItem>;

const NAV: Record<Role, OnyxNavGroup[]> = {
  student: [
    { items: [I.dashboard, I.courses, I.practice, I.spaces] },
    { label: 'Assessment', items: [I.assess, I.exams, I.results, I.contests] },
    { label: 'Campus', items: [I.timetable, I.fees, I.support] },
    { label: 'Career', items: [I.jobs, I.interviews, I.profile] },
    { items: [I.inbox] },
  ],
  faculty: [
    { items: [I.dashboard, I.courses, I.practice, I.spaces] },
    { label: 'Assessment', items: [I.assess, I.exams, I.invigilate] },
    { label: 'Teaching', items: [I.programs, I.timetable, I.allocate, I.people] },
    { label: 'Support', items: [I.mentor, I.inbox, I.profile] },
  ],
  // Dashboard dropped from both: `/onyx/dashboard` redirects exams and
  // placement straight back to the pages already below (see the dashboard's
  // own REDIRECT map), so a nav link to it was a click that bounced you to
  // a link one row down. Courses dropped too: Practice and Workspaces were
  // the worse version of the same mistake -- an examinations officer opening
  // either got the LEARNER's own screen, "work through problems and get
  // graded" and "your projects", both genuinely empty and genuinely not
  // this role's job. Neither exams nor placement teaches or takes a course,
  // and the one place either actually needs a course (naming it when
  // scheduling a paper, or setting a job's eligibility) already has its own
  // picker on that screen -- browsing the catalogue was never the step.
  exams: [
    { label: 'Examinations', items: [I.assess, I.invigilate, I.exams, I.timetable, I.certs] },
    { items: [I.inbox, I.profile] },
  ],
  placement: [
    { label: 'Placement', items: [I.placement, I.jobs, I.interviews, I.contests, I.certs] },
    { items: [I.inbox, I.profile] },
  ],
  // An employer is an outsider with an account: their own posts and the
  // interviews they are conducting, and nothing that belongs to the institution.
  employer: [{ items: [I.posts, I.interviews, I.inbox, I.profile] }],
  // A guardian has one page of their own (Family) plus the inbox and their own
  // account profile -- everything ELSE they see is derived from links other
  // people control, which is the reason there is nowhere else to navigate to.
  guardian: [{ items: [I.family, I.inbox, I.profile] }],
  admin: [
    // Practice (a learner's own coding drills) dropped from here: it is not
    // a job an administrator does, unlike Workspaces, which stays -- an
    // admin monitors every learner's projects there, rather than keeping
    // their own.
    { items: [I.dashboard, I.courses, I.spaces] },
    // Invigilation and placement are the administrator's too: ASS-03 lets them
    // watch a sitting and CAR-04 makes them keeper of the employer records.
    // Both were reachable only by typing the URL until this line existed.
    { label: 'Assessment', items: [I.assess, I.invigilate, I.exams, I.contests, I.certs] },
    // People split into Students and Faculty -- the two an administrator
    // actually reaches for -- rather than one combined roster that also
    // holds the exams office, placement office, employers and guardians.
    { label: 'Campus', items: [I.programs, I.timetable,
      I.students, I.facultyList, I.finance] },
    { label: 'Career', items: [I.placement, I.jobs] },
    // Three links left this menu, all for the same reason: they were places an
    // administrator arrived at and found nothing of theirs to do.
    //
    //   Mentor queue  — the escalation queue a TEACHER works; an administrator
    //                   opening it sees other people's course discussions.
    //   Inbox         — notifications addressed to this account, which for an
    //                   operator account is almost nothing. It is still routed
    //                   and still linked from the bell in the header, where a
    //                   count actually tells them when it is worth opening.
    //   Teaching load — allocation of teaching hours across faculty, which is
    //                   read off the timetable and belongs with it rather than
    //                   as a peer of it.
    //
    // The routes are untouched. Nothing here is a deletion of a feature; it is
    // a menu that stopped offering an administrator work that is not theirs.
    // Audit log dropped from the menu, and the route left alone -- the same
    // treatment Mentor queue, Inbox and Teaching load got above. It is a
    // forensic screen, opened when something specific is being chased rather
    // than as somewhere to go, and the dashboard's "Full log" links still
    // reach it from where the question actually starts.
    { label: 'Operations', items: [I.settings, I.profile] },
  ],
};

export function navFor(role: Role): OnyxNavGroup[] {
  return NAV[role] ?? NAV.student;
}

/**
 * The phone's bottom bar. Five at most -- past that the targets get too
 * narrow for a thumb, and the sixth item is never the one anyone wanted.
 */
const TABS: Record<Role, OnyxNavItem[]> = {
  student:   [I.dashboard, I.courses, I.practice, I.results, I.timetable],
  faculty:   [I.dashboard, I.courses, I.assess, I.people, I.timetable],
  // No Dashboard tab for either: it would bounce straight to the tab beside
  // it (their own hub is where `/onyx/dashboard` redirects them), which is a
  // thumb's worth of five spent on a redirect rather than a destination.
  exams:     [I.exams, I.assess, I.invigilate, I.timetable, I.inbox],
  placement: [I.placement, I.jobs, I.interviews, I.contests, I.inbox],
  employer:  [I.posts, I.interviews],
  guardian:  [I.family],
  admin:     [I.dashboard, I.courses, I.people, I.finance, I.timetable],
};

export function tabsFor(role: Role): OnyxNavItem[] {
  return (TABS[role] ?? TABS.student).slice(0, 5);
}
