# Administrator

DOC-05. What a tenant administrator sees and can do in Onyx, screen by
screen, with what each one actually looks like. Screenshots are from the
demo institution (**ABC Institution**), captured live against a running
build.

## Who this is

Runs one institution end to end: people, academic structure, money, and
oversight of everything below — plus everything a faculty member,
examinations officer or placement officer can do, since none of their
boundaries apply to the person who runs the whole institution. Distinct
from the platform **super admin** (see [platform.md](platform.md)), whose
account operates *across* institutions rather than inside one.

## Signing in

![Sign in](screenshots/login-tenant.png)

| | |
| --- | --- |
| URL | `/onyx/login` |
| Email | `admin@demo.onyx` |
| Password | `Demo#2026!` |
| Institution | ABC Institution |

## Navigation

| Group | Items |
| --- | --- |
| — | Dashboard, Courses, Workspaces |
| Assessment | Assessments, Invigilate, Examinations, Contests, Certificates |
| Campus | Programmes, Timetable, Teaching load, Students, Faculty, Finance |
| Career | Placement, Jobs |
| Operations | Mentor queue, Inbox, Audit log |

Phone bottom bar: Dashboard, Courses, People, Finance, Timetable.

*(Practice is deliberately absent — coding drills are a learner's own work,
not an administrator's job, unlike Workspaces, which stays so every
learner's project can be monitored.)*

---

## Dashboard

![Dashboard](screenshots/admin/dashboard.png)

The institution in a few numbers, then the one breakdown behind each:
headcount by role (all seven, including guardians), operations tiles, a
job-pipeline chart, and a recent-activity feed — with routine account
churn filtered out, so the feed reads as things that happened, not test
noise. Nothing invented: every figure here has a real endpoint behind it.

## Courses

![Courses](screenshots/admin/courses.png)

The full catalogue, administrator-owned — create a course (self-enrol or
administrator-enrolled), and every management surface a course carries:
settings, roster, **Set work**, and attendance sessions, for every course
in the institution, not just ones taught personally.

## Workspaces

![Workspaces](screenshots/admin/workspaces.png)

Every learner's project across the whole institution, in one table —
oversight, not participation; an administrator monitors, doesn't keep a
project of their own.

## Assessments

![Assessments](screenshots/admin/assessments.png)

The full staff surface: question banks, building papers, marking, and
publishing — institution-wide, the same view the examinations office and
faculty get, without the course-scoping either of them has.

## Invigilate

![Invigilate](screenshots/admin/invigilate.png)

The unscoped console — every flagged or in-progress attempt across the
institution, with the same live device-state table, review queue, and
distinct "examinations with flags" section the examinations office sees.

## Examinations

![Examinations](screenshots/admin/exams.png)

Schedule, edit, seat, mark, moderate and publish any exam for any course —
the same full lifecycle the examinations office has, plus the courses
faculty schedule for themselves; an administrator's reach is a superset of
every other role's.

## Contests

![Contests](screenshots/admin/contests.png)

Host and run hackathons/contests institution-wide, the same page placement
uses.

## Certificates

![Certificates](screenshots/admin/certificates.png)

Issue and revoke any credential — course certificates, contest wins,
placement-readiness — with the same PDF, credential ID and public
verification link every issuer gets.

## Programmes

![Programmes](screenshots/admin/programs.png)

Build the academic structure: programmes → semesters → batches. This is
where a term is set up before anything else (courses, timetables, exams)
can reference it.

## Timetable

![Timetable](screenshots/admin/timetable.png)

Add rooms, schedule classes, and **publish the semester** — nothing is
visible to a learner or faculty member until this step. A clash (room,
teacher, or batch) is refused over HTTP with a 409 naming exactly what it
collided with, before the mistake reaches a learner's phone.

## Teaching load

![Teaching load](screenshots/admin/allocations.png)

Allocate each course to whoever teaches it, with the hours it carries —
the load-distribution chart flags who is over, on-target, light, or
carrying nothing at all this term. A faculty member with no allocation
cannot mark that course's work, so this step is load-bearing, not just
bookkeeping.

## Students

![Students](screenshots/admin/people-students.png)

The full student roster with role/status filters. `People` split into
**Students** and **Faculty** on purpose — the two an administrator actually
reaches for, rather than one list that also mixes in the exams office,
placement office, employers and guardians.

## Faculty

![Faculty](screenshots/admin/people-faculty.png)

The faculty roster, same filtering as Students.

## Finance

![Finance](screenshots/admin/finance.png)

Fee heads → fee structures → invoices → payments, ageing breakdown,
largest overdue, and the online-payment gateway configuration (or a note
that none is set up, so learners cannot pay online until it is). The one
area faculty have no access to in either direction.

## Placement

![Placement](screenshots/admin/placement.png)

The same placement-office hub — employer register, drives, outcomes — an
administrator can act in that role too, not only view it.

## Jobs

![Jobs](screenshots/admin/jobs.png)

Every job post across every employer, institution-wide.

## Mentor queue

![Mentor queue](screenshots/admin/mentor-queue.png)

Every escalated support ticket, SLA-breach banner first, claimable by
anyone who owns the queue.

## Inbox

![Inbox](screenshots/admin/inbox.png)

The same one-way, read-only notification centre every role gets.

## Audit log

![Audit log](screenshots/admin/audit.png)

Every recorded action at this institution — who, what, when, and the
before/after values — scoped strictly to this tenant; nothing from another
institution can appear here even to an administrator. **New this
session**: a role change (promotion or demotion) now writes its own
`membership.role_changed` entry instead of a generic "updated," so who
changed whose role is actually findable in this log rather than
indistinguishable from a routine status edit.

---

## What an administrator cannot do

Cannot act on another institution — every screen here is scoped to ABC
Institution alone, enforced at the database (row-level security), not just
the API. Creating, suspending or deleting an *institution itself* is the
platform super admin's job; see [platform.md](platform.md).
