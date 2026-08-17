/**
 * Adds a "Role Functionality Map" sheet to Onyx-Tenants-and-Credentials.xlsx
 * -- where each role's functionality actually lives (nav path) and what
 * changed in this session -- without touching the existing Overview,
 * Credentials or Courses sheets beyond bumping the generated date.
 */
import XLSX from 'xlsx';

const FILE = 'Onyx-Tenants-and-Credentials.xlsx';
const wb = XLSX.readFile(FILE);

// --- bump the generated date on Overview, leave everything else on it alone ---
const overview = wb.Sheets['Overview'];
const rows = XLSX.utils.sheet_to_json(overview, { header: 1 });
for (const r of rows) {
  if (r[0] === 'Generated') r[1] = '2026-08-13';
}
rows.push(['', '', '', '']);
rows.push(['See the "Role Functionality Map" sheet for what each role can '
  + 'reach and where, including what changed in this pass.', '', '', '']);
rows.push(['See docs/roles/ in the repository for a full screen-by-screen '
  + 'guide with screenshots, one file per role.', '', '', '']);
const newOverview = XLSX.utils.aoa_to_sheet(rows);
wb.Sheets['Overview'] = newOverview;

// --- the new sheet ---
const HEAD = ['Role', 'Nav group', 'Feature', 'Location (path)', 'Description', 'This session'];

const row = (role, group, feature, path, desc, note = '') =>
  [role, group, feature, path, desc, note];

const DATA = [
  // ---------------------------------------------------------------- student
  row('Student', '—', 'Dashboard', '/onyx/dashboard',
    'Resume card, due work, per-course progress, readiness score, streak, weekly stats, nudges.'),
  row('Student', '—', 'Readiness score widget', '/onyx/dashboard',
    'Out-of-100 score (attendance, assessments, practice, projects, interviews), linking to the full breakdown.',
    'NEW -- previously only on Your profile'),
  row('Student', '—', 'Cohort attendance context', '/onyx/dashboard',
    'The "Attendance needs attention" banner now states the class average alongside the learner\'s own figure.',
    'NEW -- was computed server-side but discarded before reaching the student'),
  row('Student', '—', 'Courses', '/onyx/courses', 'My courses + full catalogue, self-enrolment where allowed.'),
  row('Student', '—', 'Practice', '/onyx/practice', 'Code Lab problem bank -- editor, hints, worked solutions.'),
  row('Student', '—', 'Workspaces', '/onyx/workspaces', 'Multi-file projects with snapshots and mentor review.'),
  row('Student', 'Assessment', 'Assessments', '/onyx/assessments', 'Sit open papers; see attempt history and scores.'),
  row('Student', 'Assessment', 'Examinations', '/onyx/exams', 'Exam calendar, own seat, and (for online papers) "Sit this exam" during the locked window.'),
  row('Student', 'Assessment', 'Exam result on the exam page', '/onyx/exams/:id', 'Once published, the score/grade/pass now shows on the exam page itself, not only on Results.', 'NEW'),
  row('Student', 'Assessment', 'Results', '/onyx/results', 'Exam marks AND assessment results, transcripts.'),
  row('Student', 'Assessment', 'Assessment results section', '/onyx/results', 'Faculty-marked coursework scores now appear alongside exam marks on the same page.', 'NEW -- previously only on the Assessments list'),
  row('Student', 'Assessment', 'Contests', '/onyx/contests', 'Live/upcoming/past contests, leaderboards, team formation.'),
  row('Student', 'Campus', 'Timetable', '/onyx/timetable', 'My timetable / everyone\'s timetable toggle.'),
  row('Student', 'Campus', 'Fees', '/onyx/fees', 'Outstanding balance, pay online, receipts.'),
  row('Student', 'Campus', 'Help', '/onyx/support', 'Own support tickets; steer toward course discussion first.'),
  row('Student', 'Career', 'Jobs', '/onyx/jobs', 'Eligible roles, application pipeline.'),
  row('Student', 'Career', 'Interviews', '/onyx/interviews', 'Upcoming/past interviews, released feedback.'),
  row('Student', 'Career', 'Your profile', '/onyx/profile', 'Skills passport, credentials, readiness breakdown, guardian consent controls.'),
  row('Student', '—', 'Inbox', '/onyx/inbox', 'Read-only notifications.'),

  // ---------------------------------------------------------------- faculty
  row('Faculty', '—', 'Dashboard', '/onyx/dashboard', 'Today\'s classes, marking queue, recent activity on taught courses.'),
  row('Faculty', '—', 'Courses', '/onyx/courses', 'My courses (taught) + all courses; can now create a course of their own.'),
  row('Faculty', '—', 'Practice', '/onyx/practice', 'Author problems, edit/unpublish test cases.'),
  row('Faculty', '—', 'Workspaces', '/onyx/workspaces', 'Every workspace on courses this faculty member teaches (scoped).'),
  row('Faculty', 'Assessment', 'Assessments', '/onyx/assessments', 'Build papers, mark anonymously, publish results (course-scoped).'),
  row('Faculty', 'Assessment', 'Examinations', '/onyx/exams', 'Schedule, edit, moderate and publish an exam for a course taught.', 'NEW -- was examinations-office-only'),
  row('Faculty', 'Assessment', 'Pull marks from online paper', '/onyx/exams/:id', 'Reads a linked CBT paper\'s graded scores into the exam\'s own marks register.', 'NEW'),
  row('Faculty', 'Assessment', 'Invigilate', '/onyx/invigilate', 'Flags/reports scoped to courses this faculty member teaches.', 'CHANGED -- was institution-wide, unscoped'),
  row('Faculty', 'Teaching', 'Programmes', '/onyx/programs', 'Read-only view of programme/semester/batch structure.'),
  row('Faculty', 'Teaching', 'Timetable', '/onyx/timetable', 'Own teaching slots and the wider room schedule.'),
  row('Faculty', 'Teaching', 'Teaching load', '/onyx/allocations', 'Read-only view of who teaches what, and the hours.'),
  row('Faculty', 'Teaching', 'People', '/onyx/people', 'Roster for courses taught.'),
  row('Faculty', 'Support', 'Mentor queue', '/onyx/support', 'Escalated tickets, claim and resolve.'),
  row('Faculty', 'Support', 'Inbox', '/onyx/inbox', 'Read-only notifications.'),

  // ------------------------------------------------------------ examinations
  row('Examinations', 'Examinations', 'Assessments', '/onyx/assessments', 'Institution-wide question banks, papers, marking, publishing.'),
  row('Examinations', 'Examinations', 'Invigilate', '/onyx/invigilate', 'Full, unscoped console -- every attempt across the institution.'),
  row('Examinations', 'Examinations', 'Examinations', '/onyx/exams', 'Schedule/seat/mark/moderate/publish any exam, any course.'),
  row('Examinations', 'Examinations', 'Timetable', '/onyx/timetable', 'Read-only view of the published timetable.'),
  row('Examinations', 'Examinations', 'Certificates', '/onyx/certificates', 'Issue/revoke verifiable credentials.'),
  row('Examinations', '—', 'Inbox', '/onyx/inbox', 'Read-only notifications.'),

  // --------------------------------------------------------------- placement
  row('Placement', 'Placement', 'Placement', '/onyx/placement', 'Employer register, drives, outcomes.'),
  row('Placement', 'Placement', 'Jobs', '/onyx/jobs', 'Every job post across every employer.'),
  row('Placement', 'Placement', 'Interviews', '/onyx/interviews', 'Structured feedback, release control.'),
  row('Placement', 'Placement', 'Contests', '/onyx/contests', 'Host hackathons/contests.'),
  row('Placement', 'Placement', 'Certificates', '/onyx/certificates', 'Issue/revoke verifiable credentials.'),
  row('Placement', '—', 'Inbox', '/onyx/inbox', 'Read-only notifications.'),

  // ---------------------------------------------------------------- employer
  row('Employer', '—', 'Your posts', '/onyx/jobs', 'Own job postings and their applicant pipelines only.'),
  row('Employer', '—', 'Interviews', '/onyx/interviews', 'Interviews this employer is conducting.'),
  row('Employer', '—', 'Inbox', '/onyx/inbox', 'Read-only notifications.'),

  // --------------------------------------------------------------- guardian
  row('Guardian', '—', 'Your family', '/onyx/family', 'Attendance, fees, results -- only what the linked learner shares.'),
  row('Guardian', '—', 'Inbox', '/onyx/inbox', 'Read-only notifications (consent changes).'),

  // ------------------------------------------------------------------ admin
  row('Administrator', '—', 'Dashboard', '/onyx/dashboard', 'Institution-wide headcount, operations, job pipeline, activity feed.'),
  row('Administrator', '—', 'Courses', '/onyx/courses', 'Full catalogue, create/manage any course.'),
  row('Administrator', '—', 'Workspaces', '/onyx/workspaces', 'Every learner\'s project, institution-wide.'),
  row('Administrator', 'Assessment', 'Assessments', '/onyx/assessments', 'Institution-wide question banks, papers, marking, publishing.'),
  row('Administrator', 'Assessment', 'Invigilate', '/onyx/invigilate', 'Full, unscoped console.'),
  row('Administrator', 'Assessment', 'Examinations', '/onyx/exams', 'Full lifecycle for any exam, any course.'),
  row('Administrator', 'Assessment', 'Contests', '/onyx/contests', 'Host/run any contest.'),
  row('Administrator', 'Assessment', 'Certificates', '/onyx/certificates', 'Issue/revoke any credential.'),
  row('Administrator', 'Campus', 'Programmes', '/onyx/programs', 'Build programme/semester/batch structure.'),
  row('Administrator', 'Campus', 'Timetable', '/onyx/timetable', 'Schedule rooms/classes, publish the semester.'),
  row('Administrator', 'Campus', 'Teaching load', '/onyx/allocations', 'Allocate courses to faculty, with hours.'),
  row('Administrator', 'Campus', 'Students', '/onyx/people?role=student', 'Full student roster.'),
  row('Administrator', 'Campus', 'Faculty', '/onyx/people?role=faculty', 'Full faculty roster.'),
  row('Administrator', 'Campus', 'Finance', '/onyx/finance', 'Fee heads, structures, invoices, payment gateway config.'),
  row('Administrator', 'Career', 'Placement', '/onyx/placement', 'Act as the placement office.'),
  row('Administrator', 'Career', 'Jobs', '/onyx/jobs', 'Every job post, institution-wide.'),
  row('Administrator', 'Operations', 'Mentor queue', '/onyx/support', 'Every escalated support ticket.'),
  row('Administrator', 'Operations', 'Inbox', '/onyx/inbox', 'Read-only notifications.'),
  row('Administrator', 'Operations', 'Audit log', '/onyx/audit', 'Every recorded action, this institution only.'),
  row('Administrator', 'Operations', 'Role-change audit entries', '/onyx/audit', 'A role change now writes its own membership.role_changed entry instead of a generic "updated" one.', 'NEW -- was indistinguishable from a status edit'),

  // --------------------------------------------------------------- platform
  row('Platform super admin', '—', 'Institutions', '/onyx/platform', 'Every institution on the platform; create/suspend/activate.'),
  row('Platform super admin', '—', 'Institution detail', '/onyx/platform/tenants/:id', 'People, academics, timetable, grades, fees for one institution.'),
  row('Platform super admin', '—', 'Platform admins', '/onyx/platform/admins', 'Roster of platform-wide accounts.'),
  row('Platform super admin', '—', 'Platform audit log', '/onyx/platform/audit', 'Every platform-level action, separate from any tenant\'s own log.'),
];

const sheetRows = [HEAD, ...DATA];
const roleMap = XLSX.utils.aoa_to_sheet(sheetRows);
roleMap['!cols'] = [
  { wch: 14 }, { wch: 12 }, { wch: 26 }, { wch: 28 }, { wch: 70 }, { wch: 46 },
];
roleMap['!autofilter'] = { ref: 'A1:F' + sheetRows.length };

wb.SheetNames.push('Role Functionality Map');
wb.Sheets['Role Functionality Map'] = roleMap;

XLSX.writeFile(wb, FILE);
console.log('Updated', FILE, '-- sheets now:', wb.SheetNames.join(', '));
console.log('Role Functionality Map:', DATA.length, 'rows');
