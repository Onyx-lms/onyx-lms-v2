# Running an institution on Onyx

DOC-01. For the person who administers Onyx at a college, not for the people who
built it. It assumes you can sign in and nothing else.

Everything here is done from the product. If a step in this guide cannot be
completed from a browser, that is a bug — say so.

---

## Before a term starts

The order matters. Each step needs the one above it to exist.

### 1. Set the institution up

You already have an administrator account; whoever created the institution got
one. Add everybody else from **People**.

Roles, and what each is for:

| Role | What it is for |
| --- | --- |
| **Student** | Takes courses. Sees only their own work. |
| **Faculty** | Teaches courses they are allocated to. Marks work. |
| **Examinations** | Owns the exam calendar, halls, moderation and publishing results. |
| **Placement** | Owns employers, job posts and drives. |
| **Employer** | An outsider. Sees their own posts and candidates, nothing else. |
| **Parent or guardian** | Sees one learner's attendance, results or fees — only what that learner has switched on. |
| **Administrator** | Everything above, plus money and the audit log. |

A person keeps one account across institutions. Adding an email that already
exists attaches that person here rather than creating a second identity.

Everyone you add is notified — in their Onyx inbox, and by email if SMTP is
configured (Settings, on the port side).

### 2. Build the academic structure

**Programmes → Semesters → Batches**, from **Programmes**.

- A **programme** is what somebody graduates from — "Computer Science".
- A **semester** is a term inside it — "Term 1 2026".
- A **batch** is a cohort — "Batch A 2026". Learners belong to batches; batches
  are what you enrol in bulk.

### 3. Create courses

From **Courses**. Administrators only — a course is the institution's, not a
lecturer's.

Tick **learners may enrol themselves** for anything open; leave it off for
anything you allocate. Either way you can enrol a whole batch in one act from
the course page.

### 4. Allocate teaching

From **Teaching load**. Pick the term, then allocate each course to the person
teaching it with the hours it carries.

Do this even when it seems obvious: a faculty member who is not allocated to a
course cannot mark its work, and the page's whole purpose is showing you who is
carrying twenty hours and who is carrying four.

### 5. Build the timetable

From **Timetable**. Add rooms first, then schedule classes.

A clash — the room, the teacher or the batch — is refused and named. The form
tells you *before* you submit, so you can change the answer rather than start
again.

Nothing is visible to learners until you **publish the semester**. A draft
timetable on a learner's phone is a room they turn up to and nobody else does.

### 6. Set fees

From **Finance**. Fee heads → a structure per programme → publish it → raise
invoices.

To let learners pay online, configure a gateway on the same page. Credentials
are write-only: Onyx will tell you which keys are set and can never show you
what they are. Point the gateway's webhook at the URL the form gives you.

---

## During the term

### Attendance

Open a session from the course page. Mark the roster, or put the rotating code
on the projector and let learners check themselves in.

The code changes every 15 seconds and is dead 30 seconds after it appeared. A
photograph of the screen is worth very little and is not worth nothing — treat
it as a deterrent, not proof of presence.

**Attendance** on a course shows percentages, and flags anybody below your
threshold. Present and late both count as attended; an excused session leaves
the denominator; a session nobody marked counts as an absence.

### Assignments and assessments

Faculty set work from the course page. Marking happens per submission; when a
batch is marked, **return all** releases them together — a score is invisible to
the learner until it is returned.

For a paper: build a question bank, then set an assessment drawing from it.
Turn on monitoring if you need it, and say whether a camera and screen share are
required. No video is ever recorded or uploaded; what is stored is when each
started and stopped, plus tab switches, pasting and copying.

**Invigilate** is the review queue. A flag is not an accusation and nothing
auto-fails anybody.

### Examinations

The examinations office schedules exams, allocates halls and seats, enters and
moderates marks, then publishes. Learners see nothing until publication.

Print the seating plan and attendance sheet from the exam page — it comes out as
a PDF with a column for invigilators to sign.

### Support

Learners ask questions on a course. Anything unresolved can be escalated, which
creates a ticket with a deadline. **Mentor queue** shows unowned tickets first
and anything past its deadline above everything else.

---

## At the end

1. **Enter and publish marks** — Examinations.
2. **Issue transcripts** — Results. Each is sealed with a checksum; you can check
   any serial later and be told both whether the document was tampered with and
   whether the marks behind it have changed since.
3. **Issue certificates** — Certificates. Each gets a public verification page
   anybody can check without an account, and a PDF the graduate can attach to an
   application.

---

## Things worth knowing

**The audit log records who changed what.** Grade changes, role changes, fee
edits, result publication, gateway configuration. Administrators only, and only
ever this institution's.

**A guardian sees nothing by default.** They request a link, the learner accepts
it, and then the learner switches on attendance, results or fees individually.
Revoking is immediate.

**Suspending an institution is a platform operation**, not something an
institution can do to itself.

**Backups.** `node tools/db/backup.mjs --tenant <slug>` exports everything for
one institution and `--verify` reads it back and checks it. See
[the recovery runbook](RUNBOOK.md).

---

## When something is wrong

| What you see | What it means |
| --- | --- |
| "Code Lab is not configured" / running code returns an error | No sandbox is deployed. See `deploy/judge0/README.md`. |
| A learner says they cannot pay | No gateway is enabled, or its credentials are wrong. Finance → Online payment. |
| A learner says they never got an invitation | Check their Onyx inbox — the notification is always there even when email is not configured. |
| A paper is stuck "in progress" | It is swept closed within a minute of its time running out. If it persists, tell whoever runs the platform. |
| Faculty cannot mark a course | They are not allocated to it. Teaching load. |
