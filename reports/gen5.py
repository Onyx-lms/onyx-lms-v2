# -*- coding: utf-8 -*-
"""
The showcase deck: the same true finding as report2 and report4, designed to
be *looked at*.

report4 is the plain-language conformance report -- tables, compact cards,
built to be read. This one is built to be shown: a dark cover, one numbered
feature at a time, every screenshot dressed in a browser frame so it reads as
a product tour rather than an audit appendix. Same 25 features, same 9 extras,
same real screenshots from client-shots/ -- nothing here is a mockup, and
nothing claims more than report2 already verified.

    python gen5.py && node topdf.mjs report5.html Onyx-LMS-Showcase.pdf
"""
import io

MODULES = [
 ("LRN", "Onyx Learn", "Everyday learning", "#2563eb", "#1d4ed8",
  "Courses, lessons, attendance and homework &mdash; the part every learner touches daily."),
 ("LAB", "Onyx Code Lab", "Learning to code", "#7c3aed", "#6d28d9",
  "A real editor, real execution and instant marking, with nothing to install."),
 ("ASS", "Onyx Assess", "Tests and exams", "#0891b2", "#0e7490",
  "Scheduled papers, watched exams, marking that a human still owns."),
 ("CAR", "Onyx Career", "Getting a job", "#c2410c", "#9a3412",
  "Contests, interviews, verifiable certificates and the employers on the other side."),
 ("CMP", "Onyx Campus", "Running the institution", "#059669", "#047857",
  "Programmes, examinations, money, parents and the security under all of it."),
]

# module, title, description, [(image, browser path, caption), ...]
FEATURES = [
 ("LRN", "Browse and join courses",
  "Every course the institution offers, in one place. Depending on how a course is "
  "set up a learner joins it instantly, pays to unlock it, or is added by the "
  "institution &mdash; all three routes were used during this check.",
  [("01-catalogue.png", "/onyx/courses", "What a learner sees: their courses, and the full catalogue")]),

 ("LRN", "Video, reading and document lessons",
  "A course can mix video, documents, images, links and written pages. Every kind of "
  "lesson &mdash; not just video &mdash; remembers exactly where a learner stopped, so "
  "moving from a phone to a laptop carries on from the same line.",
  [("02-content.png", "/onyx/courses/626/lessons/466", "A real lesson, part-finished, with progress kept automatically")]),

 ("LRN", "Attendance, by QR code or by hand",
  "The teacher opens a session and a code goes on the projector. Learners scan it "
  "with their own phone &mdash; no app. The code redraws itself every 15 seconds, so a "
  "photograph sent to a friend outside the room is dead within half a minute. The "
  "register can also be marked by hand, and every learner carries a running percentage.",
  [("03-attendance.png", "/onyx/courses/593/attendance/601", "A live session: rotating code on the left, the register filling on the right")]),

 ("LRN", "Homework: set it, mark it, hand it back",
  "Work is set with its marking guide attached, handed in online, and comes back with "
  "a score and written feedback. Late work is handled by the institution's own rule "
  "rather than by the teacher remembering it.",
  [("04-assignments.png", "/onyx/assignments/119", "Real work, handed in, marked against real criteria")]),

 ("LRN", "One screen: what to do next",
  "The learner's home screen answers one question &mdash; what should I do right now. "
  "The course they were last in, the work that is due, a streak counted from real "
  "activity, and a readiness score that says out loud which single thing would raise "
  "it fastest.",
  [("05-progress.png", "/onyx/dashboard", "A learner's own dashboard, with its reasoning on show")]),

 ("LRN", "Ask a question, get a real answer",
  "Questions are asked on the course itself, where the people teaching it can see "
  "them. If one goes unanswered it becomes a support ticket with a clock on it, so a "
  "real problem is never left sitting in a thread.",
  [("06-discussion.png", "/onyx/support", "The help queue, and how the product explains its own process")]),

 ("LAB", "Write and run real code, in the browser",
  "Nothing to install. A learner writes code in the same kind of editor a professional "
  "developer uses, presses Run, and sees what their program actually printed.",
  [("07-editor.png", "/onyx/practice/125", "The editor, open on a real problem, with its constraints and examples")]),

 ("LAB", "Code runs safely, every time",
  "Every run happens inside a locked-down space that cannot reach the internet, cannot "
  "take more than its share of the machine, and cannot touch anybody else's work. "
  "Confirmed the only way worth confirming it: by attacking it.",
  [("09-autograder.png", "/onyx/practice/125", "Real code, really executed, with the real answer coming back")]),

 ("LAB", "Marked automatically, the instant it runs",
  "Work is checked against prepared cases &mdash; some shown to the learner, some kept "
  "hidden &mdash; with partial credit for partly right, and feedback that names what "
  "happened rather than just passing or failing.",
  [("09-autograder.png", "/onyx/practice/125", "One of one cases passed, in 11 milliseconds")]),

 ("LAB", "A library of practice problems",
  "Organised by difficulty and by topic, with hints that cost something to reveal and "
  "worked solutions that stay locked until a learner has earned them.",
  [("10-problem-bank.png", "/onyx/practice", "The bank, filtered by difficulty and by topic")]),

 ("LAB", "Real, multi-file coding projects",
  "Past single exercises: a project with several files, a save-point button so an "
  "earlier state is never lost, and the option to hand it to the teacher of that "
  "course for review.",
  [("11-workspaces.png", "/onyx/workspaces", "A learner's own project space")]),

 ("ASS", "Scheduled, timed online tests",
  "Papers open and close on the server's clock, not the learner's, and are drawn from "
  "randomised banks so a room full of people does not sit one identical paper.",
  [("12-tests.png", "/onyx/assessments", "A learner's papers: open now, closed, or still being marked")]),

 ("ASS", "Exam integrity, watched and then judged by a person",
  "Where an exam calls for it, camera and screen are watched and anything odd is "
  "flagged. The console orders attempts worst-first &mdash; and a flag is evidence for "
  "a human to weigh, never an automatic fail.",
  [("13-proctoring.png", "/onyx/invigilate", "The invigilation console, saying plainly what a flag is and is not")]),

 ("ASS", "Marking: automatic where it can be, by hand where it matters",
  "Objective questions are marked the moment they are submitted. Written answers go to "
  "a person with the marking guide in front of them, with a second pair of eyes "
  "available before anything is published.",
  [("14-marking.png", "/onyx/assessments", "A marking queue, with real papers waiting on a real person")]),

 ("ASS", "Results, the moment they are released",
  "A learner sees their score, their grade and how the cohort did, in one place "
  "&mdash; and sees none of it until the institution releases it, however long the "
  "marking takes.",
  [("15-results.png", "/onyx/results", "One learner's released results, and nothing that is not released")]),

 ("CAR", "Live coding contests",
  "A timed contest with a leaderboard, teams, penalty minutes and a frozen board near "
  "the finish &mdash; judged by the same sandbox that marks everyday practice.",
  [("16-contests.png", "/onyx/contests", "A contest running live, with the board judging as it goes")]),

 ("CAR", "Practice job interviews",
  "Booked through the placement office, scored against written criteria, recorded only "
  "with the learner's consent. The learner sees the score and the comments; the "
  "interviewer's private notes stay private.",
  [("17a-interviews-student.png", "/onyx/interviews", "The learner's side"),
   ("17b-interviews-employer.png", "/onyx/interviews", "The same feature, from the employer's side")]),

 ("CAR", "Certificates an employer can check for themselves",
  "Every credential carries its own id. Anyone holding that id can open a public page "
  "&mdash; no account, no login &mdash; and see whether it is genuine, who issued it, "
  "and whether it was ever withdrawn.",
  [("18a-certificates.png", "/onyx/certificates", "The institution's register, one certificate freshly issued"),
   ("18b-verify-public.png", "/onyx/verify/BB173F56F69D8F039AB1678787ACC09C", "The same credential, seen by a stranger with no account")]),

 ("CAR", "Jobs, applications and employers",
  "Employers post roles, learners apply against stated eligibility rules, and the "
  "placement office runs the pipeline. Each employer sees exactly their own applicants "
  "&mdash; and no other company's.",
  [("19a-jobs-student.png", "/onyx/jobs", "A learner's applications"),
   ("19b-jobs-employer.png", "/onyx/jobs", "The employer's own posts")]),

 ("CAR", "A profile built to be sent to an employer",
  "A shareable profile where every skill traces back to real evidence, plus a resume "
  "builder that assembles an A4 PDF from the learner's record at the moment they press "
  "the button &mdash; so it can never be out of date.",
  [("20a-profile.png", "/onyx/profile", "The profile, and what it says is still missing"),
   ("20b-resume.png", "/onyx/resume", "The resume it builds, from the record itself")]),

 ("CMP", "Programmes, terms and timetables",
  "Programmes, terms, cohorts, who teaches what and when &mdash; set up and published "
  "from one console, with a double-booked room or teacher refused before it ever "
  "reaches a learner's timetable.",
  [("21a-programs.png", "/onyx/programs", "A programme with its term and its cohort, set up live during this check")]),

 ("CMP", "Examinations, start to finish",
  "Scheduling, seating, marks entry, moderation and publication &mdash; with the "
  "candidate's script and the marker's copy both downloadable as PDFs.",
  [("22-exams.png", "/onyx/exams", "The examinations office's own calendar, mid-term")]),

 ("CMP", "Fees, payments and receipts",
  "Fee structures, invoices, online payment, receipts and who still owes what "
  "&mdash; with course and live-class income tracked apart from fee income so the "
  "books never blur.",
  [("23-finance.png", "/onyx/finance", "Real payments, against real learners, split by what they paid for")]),

 ("CMP", "Parents, only where the learner says so",
  "A guardian signs in and sees attendance, results and fees &mdash; but only after "
  "the learner invites them, and only the parts the learner switched on. The learner "
  "can withdraw any of it at any time.",
  [("24-guardian.png", "/onyx/family", "What a linked guardian sees, and what they are told they cannot")]),

 ("CMP", "Secure by design, not by promise",
  "One institution's data is unreachable from another's. Every role sees only what it "
  "is allowed to, written in plain words rather than buried in a config file. Every "
  "consequential action is written to a record nobody can edit afterwards. 140 "
  "deliberate attempts to read another institution's data &mdash; none succeeded.",
  [("25a-permissions.png", "/onyx/permissions", "What each role may do, editable per institution"),
   ("25b-audit.png", "/onyx/audit", "The permanent record: who, what, when, and from where")]),
]

# category, title, description, shots (None = table row only)
EXTRAS = [
 ("Platform", "A whole tier above your institution",
  "A separate operator console that can create, suspend or remove an entire "
  "institution &mdash; and, when a customer wants it, run theirs for them without "
  "them ever signing in. Seven institutions live on it today.",
  [("b1-operator.png", "/onyx/platform", "Every institution on the platform"),
   ("b2-operator-manage.png", "/onyx/platform/tenants/798", "One institution, run from above")]),
 ("Platform", "Each institution runs its own front desk",
  "Whether learners may sign themselves up, which email domains are accepted, the "
  "community link on the jobs page &mdash; the institution changes these itself "
  "instead of raising a ticket with us.",
  [("b4-settings.png", "/onyx/settings", "An institution's own settings, in its own hands")]),
 ("Platform", "A second, platform-wide paper trail",
  "Separate from each institution's own log, everything a platform operator does "
  "across every institution is recorded &mdash; including simply opening somebody's "
  "grades.",
  [("b3-platform-audit.png", "/onyx/platform/audit", "The operator's own record, kept apart from any institution's")]),
 ("Commerce", "A storefront, not just fee collection",
  "Courses and live-class programmes sold directly, a public marketing site with its "
  "own catalogue, cart, checkout, coupons and invoices &mdash; revenue tracked apart "
  "from institutional fees.", None),
 ("Engineering", "A build that fails on the mistake this product made most",
  "The commonest defect found was a screen quietly showing a wrong number once an "
  "institution grew &mdash; 20 enrolments displayed where there were 1,441. That exact "
  "shape of mistake now breaks the build the moment anyone writes it again.", None),
 ("Engineering", "A technical reference that cannot lie about itself",
  "The document listing every endpoint and whether it is protected is generated from "
  "the code itself. A guard it cannot read fails the build rather than being published "
  "as safe.", None),
 ("Engineering", "339 checks that run against the deployed product",
  "Twenty-one suites signing in as operator, administrator, examinations officer, "
  "lecturer, placement officer, employer, guardian and student, exercising real "
  "journeys against the live site &mdash; not a mock of it.", None),
 ("Design", "Accessibility checked with tools, not opinions",
  "Every core screen swept with axe-core for contrast, control names, headings and "
  "keyboard reach &mdash; in light mode and again in dark mode, which returned no "
  "violations at all.", None),
 ("Design", "A dark theme across the entire product", None, None),
]

nFeat = len(FEATURES)
nExtra = len(EXTRAS)
nShots = len({s[0] for _, _, _, sh in FEATURES for s in sh}
             | {s[0] for _, _, _, sh in EXTRAS if sh for s in sh})

CSS = """
@page { size: A4; margin: 0; }
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:"Segoe UI",Inter,system-ui,-apple-system,sans-serif;color:#0b1220;
     font-size:9.8pt;line-height:1.55;-webkit-print-color-adjust:exact;print-color-adjust:exact}
h1,h2,h3,h4{line-height:1.15;letter-spacing:-.02em}
.page{page-break-after:always;padding:16mm 15mm 14mm;min-height:297mm;position:relative}
.page:last-child{page-break-after:auto}
.avoid{page-break-inside:avoid;break-inside:avoid}

/* ---------------------------------------------------------------- cover */
.cover{page-break-after:always;min-height:297mm;padding:26mm 16mm 16mm;color:#fff;position:relative;overflow:hidden;
  background:
   radial-gradient(60% 45% at 82% 8%, rgba(192,38,211,.55) 0%, rgba(192,38,211,0) 60%),
   radial-gradient(55% 40% at 10% 92%, rgba(5,150,105,.5) 0%, rgba(5,150,105,0) 62%),
   linear-gradient(150deg,#0b1220 0%,#1e1b4b 38%,#312e81 66%,#4c1d95 100%)}
.cover .rule{width:26mm;height:1.4mm;background:linear-gradient(90deg,#38bdf8,#c026d3);border-radius:2mm}
.cover .eyebrow{margin-top:6mm;font-size:8.6pt;letter-spacing:.3em;text-transform:uppercase;font-weight:800;color:#c7d2fe}
.cover h1{font-size:44pt;font-weight:900;margin:7mm 0 0;letter-spacing:-.035em}
.cover h1 em{font-style:normal;display:block;
  background:linear-gradient(90deg,#67e8f9,#a78bfa 45%,#f0abfc);-webkit-background-clip:text;background-clip:text;color:transparent}
.cover p.sub{margin-top:7mm;max-width:128mm;font-size:12pt;line-height:1.65;color:#dbeafe}
.cover .stats{display:flex;gap:5mm;margin-top:12mm}
.cover .stat{flex:1;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.18);
  border-radius:4mm;padding:5mm 5mm 4.5mm;backdrop-filter:blur(3px)}
.cover .stat b{display:block;font-size:24pt;font-weight:900;letter-spacing:-.03em;line-height:1}
.cover .stat span{display:block;margin-top:2mm;font-size:7.4pt;letter-spacing:.14em;text-transform:uppercase;color:#c7d2fe;font-weight:700}
.collage{position:absolute;left:16mm;right:16mm;bottom:14mm;display:flex;gap:4mm}
.collage div{flex:1;border-radius:2.5mm;overflow:hidden;border:1px solid rgba(255,255,255,.25);
  box-shadow:0 8mm 18mm rgba(0,0,0,.45)}
.collage img{width:100%;display:block}
.cover .foot{position:absolute;left:16mm;bottom:7mm;font-size:7.6pt;color:#a5b4fc;letter-spacing:.05em}

/* ------------------------------------------------------------- headings */
h2.sec{font-size:20pt;font-weight:900;margin:0 0 2mm}
h2.sec .kicker{display:block;font-size:8pt;letter-spacing:.24em;text-transform:uppercase;
  color:#7c3aed;font-weight:800;margin-bottom:2.5mm}
p.lead{font-size:11pt;line-height:1.7;color:#334155;max-width:165mm;margin-bottom:7mm}
.hr{height:.5mm;background:linear-gradient(90deg,#4338ca,#c026d3 40%,rgba(192,38,211,0));margin:0 0 7mm;border-radius:1mm}

/* ----------------------------------------------------------- stat tiles */
.tiles{display:flex;gap:4mm;margin-bottom:8mm}
.tile{flex:1;border:1px solid #e6ebf3;border-radius:3.5mm;padding:5mm 4.5mm;background:
  linear-gradient(160deg,#ffffff,#f8fafc)}
.tile b{display:block;font-size:23pt;font-weight:900;letter-spacing:-.03em;line-height:1;color:#1e1b4b}
.tile span{display:block;margin-top:2.4mm;font-size:7.2pt;letter-spacing:.13em;text-transform:uppercase;color:#64748b;font-weight:800}
.tile p{margin-top:2.8mm;font-size:8.3pt;color:#475569;line-height:1.5}

/* ------------------------------------------------------- module legend */
.legend{display:flex;flex-direction:column;gap:2.6mm}
.lrow{display:flex;align-items:center;gap:4mm;border:1px solid #e6ebf3;border-left:4mm solid;
  border-radius:3mm;padding:3.4mm 4.5mm}
.lrow b{font-size:11pt;font-weight:800;width:38mm;flex-shrink:0}
.lrow p{font-size:8.6pt;color:#64748b;flex:1}
.lrow em{font-style:normal;font-size:7.4pt;font-weight:800;letter-spacing:.1em;text-transform:uppercase;
  color:#fff;padding:1.4mm 3mm;border-radius:99px;white-space:nowrap}

/* --------------------------------------------------------------- tables */
table.idx{width:100%;border-collapse:collapse;font-size:8.5pt}
table.idx th{text-align:left;font-size:6.9pt;letter-spacing:.16em;text-transform:uppercase;color:#94a3b8;
  padding:0 3mm 2.4mm 0;border-bottom:1px solid #cbd5e1;font-weight:800}
table.idx td{padding:1.9mm 3mm 1.9mm 0;border-bottom:1px solid #f1f5f9;vertical-align:middle}
table.idx tr{page-break-inside:avoid;break-inside:avoid}
table.idx td.n{font-size:8pt;font-weight:900;color:#cbd5e1;width:9mm;font-variant-numeric:tabular-nums}
table.idx td.name{font-weight:700;color:#0f172a}
table.idx td.desc{color:#64748b;font-size:8.2pt;line-height:1.45}
.mchip{display:inline-block;padding:1mm 2.6mm;border-radius:1.6mm;font-size:6.6pt;font-weight:800;
  letter-spacing:.06em;text-transform:uppercase;color:#fff;white-space:nowrap}
.ok{display:inline-flex;align-items:center;gap:1.4mm;font-size:6.9pt;font-weight:800;letter-spacing:.06em;
  text-transform:uppercase;color:#047857;white-space:nowrap}
.ok:before{content:"";width:2mm;height:2mm;border-radius:50%;background:#10b981;
  box-shadow:0 0 0 1mm rgba(16,185,129,.18)}
.ccat{display:inline-block;padding:1mm 2.6mm;border-radius:1.6mm;font-size:6.6pt;font-weight:800;
  letter-spacing:.06em;text-transform:uppercase;background:#ede9fe;color:#5b21b6;white-space:nowrap}
"""

CSS2 = """
/* ------------------------------------------------------- module opener */
.opener{margin:-16mm -15mm 8mm;padding:20mm 15mm 12mm;color:#fff;position:relative;overflow:hidden}
.opener .big{position:absolute;right:11mm;top:13mm;font-size:60pt;font-weight:900;color:rgba(255,255,255,.14);
  letter-spacing:-.06em;line-height:1}
.opener .kick{font-size:7.8pt;letter-spacing:.28em;text-transform:uppercase;font-weight:800;opacity:.85}
.opener h2{font-size:27pt;font-weight:900;margin:4mm 0 3mm}
.opener p{font-size:10.4pt;max-width:135mm;opacity:.95;line-height:1.6}
.opener .inside{margin-top:7mm;display:flex;flex-wrap:wrap;gap:2mm}
.opener .inside span{background:rgba(255,255,255,.16);border:1px solid rgba(255,255,255,.3);
  border-radius:99px;padding:1.6mm 3.4mm;font-size:7.6pt;font-weight:700}

/* ------------------------------------------------------------ features */
.feat{margin-bottom:9mm;page-break-inside:avoid;break-inside:avoid}
.feat .head{display:flex;gap:4mm;align-items:flex-start;margin-bottom:3.5mm}
.feat .idx{font-size:15pt;font-weight:900;letter-spacing:-.04em;line-height:1;width:12mm;flex-shrink:0;
  font-variant-numeric:tabular-nums}
.feat h3{font-size:14pt;font-weight:900;margin-bottom:1.6mm}
.feat p{font-size:9.2pt;color:#475569;line-height:1.58;max-width:150mm}
.feat .tick{margin-left:auto;flex-shrink:0}

.duo{display:flex;gap:4mm}
.duo .col{flex:1;min-width:0}

/* --------------------------------------------------------- browser frame */
.frame{border:1px solid #dfe6f0;border-radius:3mm;overflow:hidden;background:#fff;
  box-shadow:0 2mm 6mm rgba(15,23,42,.10)}
.frame .bar{display:flex;align-items:center;gap:1.6mm;padding:1.7mm 3mm;background:#f1f5f9;
  border-bottom:1px solid #e2e8f0}
.frame .bar i{width:1.9mm;height:1.9mm;border-radius:50%;display:inline-block}
.frame .bar .url{margin-left:2mm;flex:1;background:#fff;border:1px solid #e2e8f0;border-radius:99px;
  padding:.9mm 3mm;font-size:6.3pt;color:#94a3b8;letter-spacing:.01em;overflow:hidden;white-space:nowrap}
.frame img{width:100%;display:block}
.cap{font-size:7pt;color:#94a3b8;margin-top:1.6mm;font-style:italic}

/* ------------------------------------------------------------- extras */
.dark{background:linear-gradient(155deg,#0b1220 0%,#1e1b4b 55%,#3b0764 100%);color:#fff;
  margin:-16mm -15mm 0;padding:18mm 15mm 16mm;min-height:297mm}
.dark h2.sec{color:#fff}
.dark h2.sec .kicker{color:#f0abfc}
.dark p.lead{color:#c7d2fe}
.dark .hr{background:linear-gradient(90deg,#38bdf8,#c026d3 45%,rgba(192,38,211,0))}
.xcard{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.16);border-radius:3.5mm;
  padding:4.2mm 4.6mm;margin-bottom:3.4mm;page-break-inside:avoid;break-inside:avoid}
.xcard h4{font-size:10.6pt;font-weight:800;margin-bottom:1.4mm}
.xcard p{font-size:8.5pt;color:#cbd5e1;line-height:1.5}
.xcard .tagline{font-size:6.6pt;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:#f0abfc;margin-bottom:1.6mm}
.xgrid{display:flex;flex-wrap:wrap;gap:3.4mm}
.xgrid .xcard{width:calc(50% - 1.7mm);margin-bottom:0}

/* ------------------------------------------------------------- closing */
.close h2{font-size:30pt;font-weight:900;margin-bottom:6mm;max-width:150mm}
.close .quote{font-size:12.5pt;line-height:1.65;color:#e0e7ff;max-width:150mm}
.close .sign{margin-top:14mm;padding-top:5mm;border-top:1px solid rgba(255,255,255,.2);
  font-size:8.2pt;color:#a5b4fc;line-height:1.7}
.pagenum{position:absolute;right:15mm;bottom:8mm;font-size:7pt;color:#cbd5e1;letter-spacing:.14em;font-weight:700}
"""

# Page geometry: @page carries the margin so that a section spilling onto a
# second physical page keeps its margins; full-bleed panels (cover, module
# openers, dark pages) claw that margin back with negative margins.
CSS3 = """
@page { size: A4; margin: 15mm 15mm 14mm; }
.page{page-break-after:always;padding:0;min-height:auto;position:relative}
.cover{margin:-15mm -15mm -14mm;padding:24mm 16mm 14mm;min-height:292mm}
.dark{margin:-15mm -15mm -14mm;padding:18mm 15mm 14mm;min-height:292mm}
.opener{margin:-15mm -15mm -14mm;padding:40mm 18mm 34mm;min-height:292mm;display:flex;flex-direction:column;justify-content:center}
.opener .big{top:30mm;right:20mm;font-size:128pt;color:rgba(255,255,255,.13)}
.opener .kick{font-size:9pt;letter-spacing:.34em}
.opener h2{font-size:40pt;margin:6mm 0 5mm}
.opener p{font-size:13pt;max-width:132mm;line-height:1.55}
.opener .inside{margin-top:14mm;gap:2.6mm}
.opener .inside span{font-size:9pt;padding:2.4mm 4.6mm}
.opener .base{position:absolute;left:18mm;right:18mm;bottom:24mm;display:flex;justify-content:space-between;align-items:center;font-size:8.4pt;letter-spacing:.16em;text-transform:uppercase;font-weight:800;color:rgba(255,255,255,.78);border-top:1px solid rgba(255,255,255,.28);padding-top:5mm}
.collage{left:16mm;right:16mm;bottom:30mm}
.cover .proof{margin-top:13mm;display:flex;flex-direction:column;gap:4mm;max-width:152mm}
.cover .proof div{display:flex;gap:4mm;align-items:baseline;font-size:10pt;color:#e0e7ff;line-height:1.5}
.cover .proof i{width:9mm;height:.9mm;background:linear-gradient(90deg,#38bdf8,#c026d3);border-radius:1mm;flex-shrink:0;display:inline-block;position:relative;top:-1mm}
.cover .foot{left:16mm;bottom:11mm}
.feat{margin-bottom:7mm}
.feat .frame{max-width:128mm}
.modfoot{margin-top:4mm;border-radius:3mm;padding:4.5mm 5mm;color:#fff;display:flex;align-items:center;gap:5mm;page-break-inside:avoid;break-inside:avoid}
.modfoot b{font-size:12pt;font-weight:900;letter-spacing:-.01em}
.modfoot p{font-size:8.6pt;opacity:.92;flex:1}
.modfoot em{font-style:normal;font-size:8pt;font-weight:800;letter-spacing:.12em;text-transform:uppercase;background:rgba(255,255,255,.18);border:1px solid rgba(255,255,255,.35);border-radius:99px;padding:1.8mm 4mm;white-space:nowrap}
.feat p{font-size:9pt}
"""

o = io.StringIO()
w = o.write
w("<title>Onyx LMS &mdash; The Build, In Full</title>")
w("<style>" + CSS + CSS2 + CSS3 + "</style>")

DOTS = ('<i style="background:#f87171"></i><i style="background:#fbbf24"></i>'
        '<i style="background:#34d399"></i>')


def frame(img, url, cap):
    w('<div><div class="frame"><div class="bar">' + DOTS
      + '<span class="url">onyx-lms-v2.vercel.app' + url + '</span></div>'
      + '<img src="client-shots/' + img + '"></div>'
      + ('<div class="cap">' + cap + '</div>' if cap else '') + '</div>')


def shots_block(shots):
    if len(shots) > 1:
        w('<div class="duo">')
        for img, url, cap in shots:
            w('<div class="col">')
            frame(img, url, cap)
            w('</div>')
        w('</div>')
    else:
        img, url, cap = shots[0]
        frame(img, url, cap)


MOD = {m[0]: m for m in MODULES}

# ------------------------------------------------------------------ cover
w('<div class="cover">')
w('<div class="rule"></div>')
w('<div class="eyebrow">Built &middot; verified &middot; running today</div>')
w('<h1>Every promise<em>on screen.</em></h1>')
w('<p class="sub">All twenty-five features from the Onyx proposal, photographed inside '
  'the live product &mdash; plus nine more that were never asked for. One page at a '
  'time, in plain words, with the actual screen beside every claim.</p>')
w('<div class="stats">')
for b, s in [("25/25", "Features delivered"), (str(nExtra), "Extras beyond scope"),
             (str(nShots), "Live screenshots")]:
    w('<div class="stat"><b>' + b + '</b><span>' + s + '</span></div>')
w('</div>')
w('<div class="proof">')
for line in [
    "Every screen photographed inside the running product &mdash; nothing mocked up.",
    "Captured signed in as eight kinds of user, from a first-year student to the platform operator.",
    "Twenty-five requirements, nine extras, one deployment, one afternoon of checking.",
]:
    w('<div><i></i><span>' + line + '</span></div>')
w('</div>')
w('<div class="collage">')
for img in ["05-progress.png", "03-attendance.png", "b1-operator.png", "23-finance.png"]:
    w('<div><img src="client-shots/' + img + '"></div>')
w('</div>')
w('<div class="foot">Onyx LMS &middot; prepared for the client &middot; every image in '
  'this document is a real screen, captured live</div>')
w('</div>')

# ------------------------------------------------------- the short version
w('<div class="page">')
w('<h2 class="sec"><span class="kicker">The short version</span>Nothing is missing. '
  'Here is the proof, screen by screen.</h2>')
w('<div class="hr"></div>')
w('<p class="lead">Every requirement in the proposal has been built, and every one was '
  'driven end to end inside the running product to make this document &mdash; not '
  'described from a spec, not mocked up in a design tool. Where a screen was new and '
  'empty on the demonstration account, we did what any institution does on day one '
  '&mdash; opened a class, issued a certificate, set up a term &mdash; so you see the '
  'product in use rather than waiting to be used.</p>')
w('<div class="tiles">')
for b, s, p in [
    ("25/25", "Requirements met",
     "Every feature the proposal names, found working in the live product."),
    ("5", "Product areas",
     "Learning, Code Lab, Assessment, Career and Campus operations."),
    (str(nExtra), "Extras included",
     "Capabilities nobody asked for, built anyway and charged for nowhere."),
    (str(nShots), "Real screens",
     "Captured signed in as eight different kinds of user."),
]:
    w('<div class="tile"><b>' + b + '</b><span>' + s + '</span><p>' + p + '</p></div>')
w('</div>')
w('<h2 class="sec" style="font-size:14pt;margin-bottom:4mm"><span class="kicker">'
  'What is inside</span>Five areas, twenty-five features</h2>')
w('<div class="legend">')
for code, name, tag, color, dark, promise in MODULES:
    n = sum(1 for f in FEATURES if f[0] == code)
    w('<div class="lrow" style="border-left-color:' + color + '">'
      '<b style="color:' + dark + '">' + name + '</b>'
      '<p>' + promise + '</p>'
      '<em style="background:' + color + '">' + str(n) + ' features</em></div>')
w('</div>')
w('</div>')

# --------------------------------------------------------- index of the 25
w('<div class="page">')
w('<h2 class="sec"><span class="kicker">Index</span>All twenty-five, at a glance</h2>')
w('<div class="hr"></div>')
w('<table class="idx"><thead><tr><th>#</th><th style="width:32mm">Area</th>'
  '<th>Feature</th><th style="width:24mm">Status</th></tr></thead><tbody>')
for i, (mod, title, desc, shots) in enumerate(FEATURES, 1):
    code, name, tag, color, dark, promise = MOD[mod]
    w('<tr><td class="n">' + ('%02d' % i) + '</td>'
      '<td><span class="mchip" style="background:' + color + '">' + name + '</span></td>'
      '<td class="name">' + title + '</td>'
      '<td><span class="ok">Delivered</span></td></tr>')
w('</tbody></table>')
w('</div>')

# -------------------------------------------------------------- extras idx
w('<div class="page">')
w('<h2 class="sec"><span class="kicker">Beyond the brief</span>Nine things nobody asked for</h2>')
w('<div class="hr"></div>')
w('<p class="lead">These appear nowhere in the twenty-five requirements. They were '
  'built while getting those right, and they are in the product today.</p>')
w('<table class="idx"><thead><tr><th>#</th><th style="width:26mm">Kind</th>'
  '<th>What it is</th></tr></thead><tbody>')
for i, (cat, title, desc, shots) in enumerate(EXTRAS, 1):
    w('<tr><td class="n">' + ('%02d' % i) + '</td>'
      '<td><span class="ccat">' + cat + '</span></td>'
      '<td><span class="name">' + title + '</span>'
      + ('<div class="desc">' + desc + '</div>' if desc else '') + '</td></tr>')
w('</tbody></table>')
w('</div>')

# ---------------------------------------------------------- module sections
num = 0
for code, name, tag, color, dark, promise in MODULES:
    items = [f for f in FEATURES if f[0] == code]
    w('<div class="page">')
    w('<div class="opener" style="background:linear-gradient(150deg,#0b1220 0%,' + dark + ' 45%,' + color + ' 100%)">')
    w('<div class="big">' + ('%02d' % (MODULES.index(MOD[code]) + 1)) + '</div>')
    w('<div class="kick">' + tag + '</div>')
    w('<h2>' + name + '</h2>')
    w('<p>' + promise + '</p>')
    w('<div class="inside">')
    for _, title, _, _ in items:
        w('<span>' + title + '</span>')
    w('</div>')
    w('<div class="base"><span>' + str(len(items)) + ' features &middot; all delivered</span>'
      '<span>Area ' + str(MODULES.index(MOD[code]) + 1) + ' of ' + str(len(MODULES)) + '</span></div>')
    w('</div></div>')
    w('<div class="page">')
    for mod, title, desc, shots in items:
        num += 1
        w('<div class="feat">')
        w('<div class="head"><div class="idx" style="color:' + color + '">'
          + ('%02d' % num) + '</div><div><h3>' + title + '</h3><p>' + desc + '</p></div>'
          '<div class="tick"><span class="ok">Working</span></div></div>')
        shots_block(shots)
        w('</div>')
    w('</div>')

# --------------------------------------------------- extras, in pictures
w('<div class="page"><div class="dark">')
w('<h2 class="sec"><span class="kicker">Beyond the brief</span>The three worth seeing</h2>')
w('<div class="hr"></div>')
w('<p class="lead">Of the nine extras, these three have a screen of their own. The '
  'other six are engineering and design work that shows up as things that never go '
  'wrong rather than as a page you can open.</p>')
for cat, title, desc, shots in EXTRAS:
    if not shots:
        continue
    w('<div class="xcard">')
    w('<div class="tagline">' + cat + '</div>')
    w('<h4>' + title + '</h4><p>' + desc + '</p>')
    w('<div style="margin-top:3.4mm">')
    shots_block(shots)
    w('</div></div>')
w('</div></div>')

# ----------------------------------------------------------------- closing
w('<div class="page"><div class="dark close">')
w('<div class="rule" style="width:26mm;height:1.4mm;background:linear-gradient(90deg,#38bdf8,#c026d3);border-radius:2mm"></div>')
w('<div style="height:22mm"></div>')
w('<h2>The conversation is no longer<br>about whether it can be built.</h2>')
w('<p class="quote">Twenty-five features were promised and twenty-five are running. '
  'Nine more were built on top of them. Every screen in this document was opened, '
  'used and photographed in the live product while writing it &mdash; a learner sat a '
  'practice problem and it was graded, a teacher opened a register and the code '
  'rotated, a certificate was issued and a stranger verified it without an account.</p>')
w('<p class="quote" style="margin-top:8mm;color:#f0abfc">What is left is your content, '
  'your people and your calendar &mdash; not more software.</p>')
w('<div class="sign">Onyx LMS &middot; prepared for the client<br>'
  'Every image captured live against onyx-lms-v2.vercel.app, signed in as a real '
  'student, teacher, examinations officer, employer, guardian, administrator and '
  'platform operator.</div>')
w('</div></div>')

open("report5.html", "w", encoding="utf-8").write(o.getvalue())
print("report5.html written --", nFeat, "features,", nExtra, "extras,", nShots, "screens")
