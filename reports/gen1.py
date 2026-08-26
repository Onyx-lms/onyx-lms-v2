import io, html

CATS = [
 ("Onyx Learn", "#2563eb", "#dbeafe", [
  ("LRN-01", "Course catalogue &amp; enrolment", 8,
   "Created, published and enrolled into a live course end to end. Three access models: open and free, locked behind payment, or enrolled by the institution. The operator console mis-reports enrolment counts."),
  ("LRN-02", "Content delivery", 6,
   "Five lesson types, resumable video with server-side position saving, signed URLs, preview-before-enrol. Completion is only ever recorded for video, so a reading course sits at 0% forever."),
  ("LRN-03", "Attendance tracking", 10,
   "A rotating 15-second QR that a photograph outlives by under half a minute, a manual register with Present, Late, Absent and Excused, close-auto-absents, capture method recorded per learner, CSV export."),
  ("LRN-04", "Assignment workflows", 7,
   "Brief, due date, late policy with penalty, autosave draft, marks hidden until returned, written feedback. The rubric builder is real and good, but a lecturer can never reach it."),
  ("LRN-05", "Learning progress dashboard", 7,
   "Readiness score, streaks, next-best-action with the reason stated, weekly counts, and a &ldquo;worth the most right now&rdquo; nudge. Partly fed by lesson progress, which is broken."),
  ("LRN-06", "Discussion &amp; doubt resolution", 9,
   "Course Q&amp;A with replies, helpful votes, a &ldquo;this answered it&rdquo; resolution, escalation to a mentor and an SLA-timed ticket queue. Students cannot open a ticket directly."),
 ]),
 ("Onyx Code Lab", "#7c3aed", "#ede9fe", [
  ("LAB-01", "Browser IDE", 9,
   "Monaco editor, per-problem language choice, Run against the visible case and Submit against the hidden ones, with real stdout diffed against expected. Two contrast failures in the editor chrome."),
  ("LAB-02", "Sandboxed execution", 9,
   "Verified by attack: an infinite loop killed at 2.09s against a 2.0s budget, a memory bomb killed by the runtime, DNS resolution refused, code running as an unprivileged uid inside an isolate box. The runtime is Python 3.8.1, which is end-of-life."),
  ("LAB-03", "Automated code evaluator", 10,
   "Hidden test cases, per-case timing, partial scoring, and the actual output shown beside the expected one when a case fails."),
  ("LAB-04", "Guided practice &amp; problem bank", 7,
   "29 problems, a difficulty filter, worked solutions behind a release rule. Every problem is tagged Easy with no topic, so both filters have nothing to filter."),
  ("LAB-05", "Project workspaces", 9,
   "Multi-file projects, snapshots, a named entry file, live in-browser preview, and attachment to a course so the people teaching it can review the work."),
 ]),
 ("Onyx Assess", "#0891b2", "#cffafe", [
  ("ASS-01", "Timed assessment engine", 10,
   "A server-held clock that survives a closed tab, parallel sets that rotate down the register so neighbours never share a paper, question and option shuffling, attempt caps, windows and per-section targeting."),
  ("ASS-02", "Remote proctoring", 9,
   "A consent gate before the paper opens, paste and copy captured and weighted into an integrity score, a live invigilation console showing device state, and an adjudication trail where dismiss or uphold is recorded against a named person."),
  ("ASS-03", "Auto &amp; manual grading", 9,
   "Auto-marked the instant the paper was handed in, with a marking queue, a moderation gate, anonymous marking, pull-marks-to-register and publish. The plain attempt view returns a server error for every staff role."),
  ("ASS-04", "Results &amp; analytics", 9,
   "Per-question feedback with the correct answer beside the given one, score, percentage and pass state, cohort statistics, downloadable scripts and reports."),
 ]),
 ("Onyx Career", "#c2410c", "#ffedd5", [
  ("CAR-01", "Hackathons &amp; contests", 5,
   "The surface is built and states it is judged by the same evaluator as Code Lab, but nothing is scheduled on any tenant, so it could not be exercised."),
  ("CAR-02", "Mock interviews", 5,
   "Scheduling, structured feedback, consent-to-record and a scoring breakdown all exist as surfaces. No interview exists anywhere to run one through."),
  ("CAR-03", "Skill certificates", 10,
   "Issued one, verified it from a signed-out browser, downloaded the PDF, then revoked it with a reason &mdash; and the public page kept answering, saying revoked rather than not-found. Both writes went to the audit log."),
  ("CAR-04", "Placement &amp; employer portal", 6,
   "Registered an employer, posted a role, applied as a student with a readiness snapshot and an explicit data-sharing notice, and moved the candidate through the pipeline. The employer cannot see applicants to their own post."),
  ("CAR-05", "Employability profile", 9,
   "A readiness score out of 100 with the unearned points broken out and ranked by value, a resume builder with reorderable sections and A4 export, and an opt-in public profile."),
 ]),
 ("Onyx Campus", "#059669", "#d1fae5", [
  ("CMP-01", "Academic administration", 7,
   "Programmes, semesters, batches, 24 sections, teaching allocation, and a timetable with rooms, clash detection and a publish step. Day boundaries are computed in UTC, so Indian users are shown yesterday until 05:30."),
  ("CMP-02", "Examination management", 8,
   "Scheduling, seating allocation, marks entry, moderation, publication, and transcripts sealed with a checksum a stranger can verify. The registrar&rsquo;s own list of issued transcripts stays empty."),
  ("CMP-03", "Fee &amp; finance", 8,
   "Fee heads, structures, invoices that copy their lines at the moment of issue, payments, gateway configuration, ageing analysis, and rupees throughout. Course and live-class revenue are tracked separately."),
  ("CMP-04", "Parent &amp; guardian portal", 6,
   "Guardian sign-in, family view, fees and results &mdash; gated behind a link the learner initiates and confirms, which is the right consent model. No linked learner existed to exercise it."),
  ("CMP-05", "Roles, tenancy &amp; audit", 10,
   "140 route-by-role probes with no leak, cross-tenant records returning not-found rather than denied, a per-institution permission matrix, and an audit log carrying IP addresses that flags security-relevant entries."),
 ]),
]

FIND = [
 ("HIGH", "Staff cannot open an exam attempt &mdash; server error", "/onyx/attempts/{id}",
  "Administrator, examinations officer and lecturer all receive a server error page on the plain attempt view; only the candidate gets a page. Reproduced on two tenants and on attempts we did not create. The sibling routes for marking and for integrity review both work, so the route simply carries no role guard and the candidate-scoped fetch throws into the error boundary. It should land on the denied page like its siblings."),
 ("MEDIUM", "Every course reports zero enrolments to the operator", "Platform &rsaquo; Institution &rsaquo; Courses",
  "The operator console shows zero enrolled against all 64 courses at Malla Reddy, including PY122, which the lecturer console on the same deployment reports as 1,441 enrolled. The tally scans the enrolments table under an unordered 5,000-row cap and this institution is well past it. Capacity, staffing and revenue judgements made from this screen would be wrong."),
 ("MEDIUM", "Every question-bank row is a dead link", "Platform &rsaquo; Examinations &rsaquo; Papers, and Assessments &rsaquo; Banks",
  "All 19 bank rows on both pages point at a detail route that does not exist and returns Page not found. Because the links are prefetched, simply opening either page fires a burst of 404s. An operator can build a question bank but cannot open one afterwards."),
 ("MEDIUM", "A lecturer can never attach a rubric", "Course &rsaquo; Create an assignment",
  "The rubric builder is well made &mdash; criteria, marks, a running total that tells you how far off you are, and a split-evenly shortcut. It is only enabled while an assignment is a draft. The one control a lecturer has creates the assignment and publishes it in the same click, and drafts made from the operator console are not linked anywhere on the lecturer&rsquo;s course page. In practice every assignment is marked as a single number."),
 ("MEDIUM", "Reading lessons never count as complete", "Course &rsaquo; Lesson",
  "Progress is only ever posted by the video player. Text, image, document and link lessons return before any progress call is made and offer no mark-as-done control. Our student opened all three lessons of a course and it still read 0 of 3 lessons, 0% complete. This feeds the progress meter, the daily streak and the readiness score."),
 ("MEDIUM", "The platform believes it is yesterday until 05:30 IST", "Timetable and dashboard",
  "With the browser set to Asia/Kolkata at 01:55 on Thursday 27 August, the timetable and the dashboard both headline TODAY &middot; WEDNESDAY and highlight 26 August &mdash; while the audit log on the same deployment headlines THURSDAY, 27 AUGUST 2026. Day boundaries are computed in UTC. For an Indian institution the product is wrong about the date for five and a half hours of every day."),
 ("MEDIUM", "An employer cannot see who applied to their own post", "Jobs &rsaquo; a role",
  "Signed in as the employer that owns the post, the applicants table reads Nobody has applied yet, while the placement officer looking at the same post sees one shortlisted candidate. The employer half of the placement portal does not function."),
 ("MEDIUM", "The registrar cannot see the transcripts they issued", "Results &rsaquo; Transcripts, staff view",
  "Issuing a transcript succeeds: the student sees it on their record and a signed-out stranger can verify its serial and checksum. The examinations officer&rsquo;s own panel still reads None issued yet. The staff page appears to be listing the viewer&rsquo;s personal transcripts rather than the institution&rsquo;s."),
 ("MEDIUM", "Request a transcript goes nowhere", "Results, student view",
  "The button is a plain link to the help page, and the student help page carries no control to raise a ticket &mdash; it says tickets are created by escalating a course discussion. A student who wants a transcript has no route to ask for one."),
 ("LOW", "Database row ids surface in user-facing copy", "several pages",
  "A student&rsquo;s exam page says Course #626 rather than naming the course; the operator grades page says Exam #353; the applicants table footer ends with Job 69; and the integrity review identifies the candidate by raw UUID even with anonymous marking switched off."),
 ("LOW", "Staff-only controls render in the student view", "/onyx/exams and /onyx/assessments",
  "Students are shown an Invigilation console link and Copy link for candidates buttons. Access control holds &mdash; the link lands on the denied page &mdash; but a candidate about to sit a paper should not be offered an invigilator&rsquo;s navigation."),
 ("LOW", "Handing in an exam is confirmed by a browser alert", "Attempt &rsaquo; Hand in",
  "The single most consequential and irreversible action a candidate takes is gated by a native browser confirm dialog rather than by the product&rsquo;s own modal, which is used elsewhere for lesser actions."),
 ("LOW", "Two main landmarks on the not-found page", "/onyx/* in its 404 state",
  "The not-found page renders its own main region inside the shell&rsquo;s. Screen-reader landmark navigation lands in the wrong place."),
 ("LOW", "Raw enum values in a picker", "Certificates &rsaquo; Issue a certificate",
  "The certificate kind dropdown offers course, assessment, contest and program exactly as written in the database rather than as readable labels."),
 ("LOW", "Post a job opens with an unfillable required field", "Jobs &rsaquo; Post a job",
  "With no employer registered the Employer select is empty and required, and nothing on screen says an employer has to be added first."),
 ("LOW", "New assignments need a manual refresh", "Course page",
  "An assignment created from the course page does not appear under Set Work until the page is reloaded, even though the write succeeded."),
 ("LOW", "Contrast failures in the code editor", "/onyx/practice/{id}",
  "Two serious contrast violations in the Monaco chrome &mdash; the only serious accessibility failure found across eleven audited pages."),
]

SEC = [
 ("PASS", "Transport and headers",
  "HSTS with preload for two years, X-Frame-Options SAMEORIGIN, a CSP frame-ancestors directive, nosniff, strict-origin-when-cross-origin, and a Permissions-Policy that shuts off microphone and geolocation while keeping camera available for proctoring."),
 ("PASS", "Session cookie",
  "The session cookie is HttpOnly, Secure and SameSite=Lax."),
 ("PASS", "Brute-force resistance",
  "Rate limiting engages inside a single window. Forty rapid sign-in attempts across nine accounts produced 429 responses, and the correct password was still refused with 429 while the lockout held."),
 ("PASS", "Tenant isolation",
  "An ABC Institution administrator received not-found on every Malla Reddy course, assignment, exam, attempt and submission id we tried. Tenant staff aiming at the operator console are bounced to the operator sign-in door."),
 ("PASS", "Role enforcement",
  "140 route-by-role probes across student, lecturer, examinations and administrator. Every unauthorised route landed on the denied page. Nothing leaked and nothing errored."),
 ("PASS", "Code sandbox",
  "CPU budget enforced at 2.09s against 2.0s, a memory bomb killed by the runtime, outbound DNS refused, and execution under an unprivileged uid inside an isolate box."),
 ("PASS", "Open redirect",
  "A next parameter pointing at an external host is discarded and the sign-in lands inside the application."),
 ("WATCH", "The CSP carries only frame-ancestors",
  "There is no default-src or script-src, so the policy contributes nothing against cross-site scripting. For a platform that renders learner-authored HTML in Code Lab previews and learner-authored prose in discussions, this is the cheapest hardening still on the table."),
 ("WATCH", "A test account holds full platform-admin rights",
  "The operator list on the live deployment carries an account named test123456 at admin2@test.com, granted on 23 August, able to create, suspend and read every institution on the platform. It should be revoked before this URL is shown to a customer."),
 ("WATCH", "Framework disclosed",
  "An x-powered-by header naming the framework is returned on every response."),
 ("WATCH", "End-of-life language runtime",
  "The evaluator reports Python 3.8.1, which stopped receiving security fixes in October 2024."),
]

PERF = [("Student dashboard", 897), ("Student profile", 807), ("Course page", 397),
        ("Code Lab problem", 372), ("Examinations", 249), ("Results", 278),
        ("Resume", 237), ("Timetable", 308), ("Admin &middot; People, 1,446 rows", 473),
        ("Admin &middot; Audit log", 522), ("Admin &middot; Finance", 543),
        ("Operator &middot; Students, 200 rows", 545), ("Operator &middot; Courses, 64", 372)]

DATA = [
 "Automated-test debris is sitting in the live demonstration tenant: inbox notifications titled &ldquo;Window probe w17cb hall&rdquo; and &ldquo;Faculty examination fac-d17tw1&rdquo;, support tickets titled &ldquo;Fee receipt is wrong rffyp&rdquo;, practice problems titled &ldquo;Build a welcome card mt90pw7r&rdquo; and assessments titled &ldquo;Web development test mt90emkc&rdquo;. A prospect clicking through will see them.",
 "Malla Reddy Demo has no programmes, semesters or batches, which blocks teaching allocation outright and leaves the timetable reading zero classes and zero rooms. Two of the strongest campus features cannot be shown.",
 "Before this audit the tenant had no employers, job posts, drives, contests, interviews or certificates. Three of the five Career requirements had nothing to demonstrate.",
 "63 of the 64 courses carry no lessons at all. The student dashboard&rsquo;s START HERE card points at PYTHON and reads &ldquo;0 of 0 lessons&rdquo;.",
 "All 29 Code Lab problems are tagged Easy with no topic, so the difficulty and topic filters both sit over an undifferentiated list.",
 "The public marketing site and store are live and fully built &mdash; catalogue, workshops, instructors, knowledge base &mdash; and every one of them is empty.",
]


def score_colour(s):
    if s >= 9:
        return "#059669"
    if s >= 7:
        return "#0891b2"
    if s >= 5:
        return "#d97706"
    return "#dc2626"


tot = sum(s for _, _, _, items in CATS for _, _, s, _ in items)
mx = sum(len(i[3]) for i in CATS) * 10
overall = round(tot / mx * 100)

CSS = """
@page { size: A4; margin: 14mm 12mm 15mm; }
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:"Segoe UI",Inter,system-ui,-apple-system,sans-serif;color:#12212e;font-size:9.6pt;line-height:1.5;-webkit-print-color-adjust:exact;print-color-adjust:exact}
h1,h2,h3,h4{line-height:1.22}
.sheet{page-break-after:always}
.sheet:last-child{page-break-after:auto}
.avoid{page-break-inside:avoid}
.cover{background:linear-gradient(135deg,#0f3963 0%,#134a80 42%,#0891b2 100%);color:#fff;margin:-14mm -12mm 0;padding:20mm 14mm 14mm;min-height:152mm;position:relative}
.eyebrow{font-size:8pt;letter-spacing:.22em;text-transform:uppercase;opacity:.7;font-weight:700}
.cover h1{font-size:32pt;font-weight:800;letter-spacing:-.02em;margin:6mm 0 4mm}
.cover .sub{font-size:11.4pt;opacity:.92;max-width:118mm;line-height:1.6}
.cover .meta{margin-top:11mm;display:grid;grid-template-columns:repeat(4,1fr);gap:4mm;border-top:1px solid rgba(255,255,255,.28);padding-top:5mm}
.cover .meta span{display:block;font-size:7pt;letter-spacing:.14em;text-transform:uppercase;opacity:.62;font-weight:700;margin-bottom:1.5mm}
.cover .meta b{font-size:10pt;font-weight:700}
.ring{position:absolute;right:14mm;top:22mm;width:44mm;height:44mm;border-radius:50%;background:conic-gradient(#5eead4 0 PCTdeg,rgba(255,255,255,.18) PCTdeg 360deg);display:grid;place-items:center}
.ring i{width:34mm;height:34mm;border-radius:50%;background:#103b68;display:grid;place-items:center;font-style:normal;text-align:center}
.ring b{display:block;font-size:19pt;font-weight:800;line-height:1}
.ring s{display:block;text-decoration:none;font-size:6.6pt;letter-spacing:.15em;text-transform:uppercase;opacity:.72;margin-top:1.5mm}
h2.sec{font-size:15pt;font-weight:800;letter-spacing:-.01em;margin:0 0 4mm;padding-bottom:2mm;border-bottom:2.5px solid #0f3963}
h2.sec small{display:block;font-size:8pt;font-weight:600;color:#64748b;letter-spacing:.03em;margin-top:1.5mm}
.lead{font-size:10pt;line-height:1.68;color:#334155;margin:0 0 4mm}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:4mm}
.grid4{display:grid;grid-template-columns:repeat(4,1fr);gap:3mm;margin:4mm 0}
.kpi{border:1px solid #e2e8f0;border-radius:3mm;padding:4mm;background:#f8fafc}
.kpi b{display:block;font-size:19pt;font-weight:800;line-height:1;color:#0f3963}
.kpi span{display:block;font-size:7pt;letter-spacing:.13em;text-transform:uppercase;color:#64748b;font-weight:700;margin-top:2mm}
.kpi p{font-size:8.2pt;color:#475569;margin-top:2.4mm;line-height:1.5}
.cat{border-radius:3mm;padding:4mm 4.5mm;margin:0 0 4mm;border-left:3.5mm solid}
.cat h3{font-size:11.6pt;font-weight:800;display:flex;justify-content:space-between;align-items:baseline;margin-bottom:1mm}
.cat h3 em{font-style:normal;font-size:9.6pt;font-weight:800}
.row{display:grid;grid-template-columns:16mm 1fr 32mm;gap:3mm;align-items:start;padding:2.5mm 0;border-top:1px solid rgba(15,57,99,.13)}
.row code{font-size:7.4pt;font-weight:800;letter-spacing:.03em;color:#475569;padding-top:.7mm}
.row b{display:block;font-size:9.3pt;font-weight:700}
.row p{font-size:8.1pt;color:#475569;line-height:1.48;margin-top:.9mm}
.bar{height:4.2mm;border-radius:2.1mm;background:rgba(15,23,42,.1);position:relative;margin-top:1.4mm;overflow:hidden}
.bar i{position:absolute;top:0;bottom:0;left:0;border-radius:2.1mm}
.bar em{position:absolute;right:1.8mm;top:.1mm;font-style:normal;font-size:7pt;font-weight:800;color:#0f172a}
table{width:100%;border-collapse:collapse;font-size:8.4pt}
th{text-align:left;font-size:7pt;letter-spacing:.13em;text-transform:uppercase;color:#64748b;padding:0 3mm 2mm 0;border-bottom:1.5px solid #cbd5e1}
td{padding:2.5mm 3mm 2.5mm 0;border-bottom:1px solid #eef2f7;line-height:1.48;vertical-align:top}
.pill{display:inline-block;padding:.8mm 2.2mm;border-radius:1.4mm;font-size:6.8pt;font-weight:800;letter-spacing:.08em;text-transform:uppercase;white-space:nowrap}
.f{border:1px solid #e8edf3;border-left:3.2mm solid;border-radius:2.5mm;padding:3.2mm 4mm;margin-bottom:2.8mm}
.f h4{font-size:9.6pt;font-weight:700;margin-bottom:.9mm}
.f .where{font-size:7.2pt;color:#64748b;font-weight:700;letter-spacing:.05em;margin-bottom:1.5mm}
.f p{font-size:8.3pt;color:#334155;line-height:1.52}
.note{background:#f1f6fb;border:1px solid #d6e4f0;border-left:3.2mm solid #0f3963;border-radius:2.5mm;padding:4mm 4.5mm;font-size:8.7pt;color:#20374d;line-height:1.6}
.foot{margin-top:6mm;padding-top:3mm;border-top:1px solid #e2e8f0;font-size:7.4pt;color:#94a3b8}
.perfrow{display:grid;grid-template-columns:56mm 1fr 15mm;gap:3mm;align-items:center;padding:1.4mm 0;font-size:8.3pt}
.pb{height:3.4mm;background:#e6edf4;border-radius:1.7mm;overflow:hidden}
.pb i{display:block;height:100%;background:linear-gradient(90deg,#0f3963,#22d3ee);border-radius:1.7mm}
ul.dl{list-style:none}
ul.dl li{position:relative;padding-left:6mm;margin-bottom:2.6mm;font-size:8.5pt;color:#334155;line-height:1.55}
ul.dl li:before{content:"";position:absolute;left:0;top:1.7mm;width:2.4mm;height:2.4mm;border-radius:50%;background:#c2410c}
"""

o = io.StringIO()
w = o.write
w("<title>Onyx LMS &mdash; End-User Quality Report</title>")
w("<style>" + CSS.replace("PCTdeg", str(round(overall * 3.6)) + "deg") + "</style>")

# Cover
w('<div class="sheet"><div class="cover">')
w('<div class="ring"><i><b>%d%%</b><s>Overall</s></i></div>' % overall)
w('<div class="eyebrow">Independent quality assurance &middot; external tester</div>')
w("<h1>Onyx LMS<br>End-User Quality Report</h1>")
w('<p class="sub">A full end-to-end pass over the live deployment, driven entirely through the browser as a real user would &mdash; platform operator, institution administrator, examinations officer, lecturer, placement officer, employer, guardian and student.</p>')
w('<div class="meta">')
for k, v in [("Deployment", "onyx-lms-v2.vercel.app"), ("Institutions", "Malla Reddy Demo &middot; ABC"),
             ("Roles signed in as", "Eight"), ("Date of audit", "27 August 2026")]:
    w("<div><span>%s</span><b>%s</b></div>" % (k, v))
w("</div></div>")

w('<div style="padding-top:8mm">')
w('<h2 class="sec">What was done<small>Not a code read &mdash; every finding below came from using the product</small></h2>')
w('<p class="lead">We signed in with the supplied demonstration credentials and worked the way an institution would in its first week. As platform operator: created a course, assigned a lecturer, enrolled learners, built two modules and three lessons, authored a question bank of two parallel sets, and scheduled two examinations from it. As a student: opened the course, read the lessons, sat a monitored examination, submitted an assignment and solved a Code Lab problem. As lecturer: took a register by rotating QR code, set work and marked it. As examinations officer: pulled marks, published results and sealed a transcript. As placement officer, employer and guardian: registered an employer, posted a role, applied to it and moved the candidate down the pipeline.</p>')
w('<div class="grid4">')
for b, s in [("11", "End-to-end journeys"), ("140", "Route by role probes"),
             ("8", "Roles signed in as"), ("17", "Defects raised")]:
    w('<div class="kpi"><b>%s</b><span>%s</span></div>' % (b, s))
w("</div>")
w('<div class="note"><b>The headline.</b> This is a working product, not a prototype. The examination pipeline &mdash; question bank to parallel sets to a monitored sitting to auto-marking to integrity adjudication to a published result to a checksum-sealed transcript a stranger can verify &mdash; ran end to end without a single error. The security posture withstood everything we threw at it: no cross-tenant leak in 140 probes, a code sandbox that killed an infinite loop, a memory bomb and outbound DNS, and rate limiting that locked us out mid-attack. What holds it back is narrower than it looks: one staff route returns a server error, one operator screen reports zero enrolments for an institution of 1,441 learners, and a handful of paths are built but not wired to one another &mdash; a rubric a lecturer cannot reach, an employer who cannot see their own applicants, and reading lessons that never count as read.</div>')
w("</div></div>")

# Scores
w('<div class="sheet">')
w('<h2 class="sec">Feature scores<small>Scored on what the product did when it was used, out of ten</small></h2>')
for name, col, tint, items in CATS:
    csum = sum(i[2] for i in items)
    cmax = len(items) * 10
    w('<div class="cat avoid" style="background:%s;border-left-color:%s">' % (tint, col))
    w('<h3><span style="color:%s">%s</span><em style="color:%s">%d / %d &middot; %d%%</em></h3>'
      % (col, name, col, csum, cmax, round(csum / cmax * 100)))
    for cid, t, s, d in items:
        w('<div class="row"><code>%s</code><div><b>%s</b><p>%s</p></div>' % (cid, t, d))
        w('<div><div class="bar"><i style="width:%d%%;background:%s"></i><em>%d/10</em></div></div></div>'
          % (s * 10, score_colour(s), s))
    w("</div>")
w("</div>")

# Findings
w('<div class="sheet">')
w('<h2 class="sec">Defects<small>Each one reproduced at least twice before it was written down</small></h2>')
tone = {"HIGH": ("#dc2626", "#fee2e2"), "MEDIUM": ("#d97706", "#fef3c7"), "LOW": ("#0891b2", "#cffafe")}
for sev, title, where, body in FIND:
    c, bg = tone[sev]
    w('<div class="f avoid" style="border-left-color:%s">' % c)
    w('<h4><span class="pill" style="background:%s;color:%s;margin-right:2.5mm">%s</span>%s</h4>' % (bg, c, sev, title))
    w('<div class="where">%s</div><p>%s</p></div>' % (where, body))
w("</div>")

# Security
w('<div class="sheet">')
w('<h2 class="sec">Security and resilience<small>Probed, not assumed</small></h2>')
w('<table><thead><tr><th style="width:18mm"></th><th style="width:44mm">Control</th><th>What was observed</th></tr></thead><tbody>')
for st, name, body in SEC:
    c, bg = ("#059669", "#d1fae5") if st == "PASS" else ("#d97706", "#fef3c7")
    w('<tr><td><span class="pill" style="background:%s;color:%s">%s</span></td><td><b>%s</b></td><td>%s</td></tr>'
      % (bg, c, st, name, body))
w("</tbody></table>")

w('<h2 class="sec" style="margin-top:8mm">Speed<small>Median of three cold loads, measured from India over the public internet</small></h2>')
mxp = max(v for _, v in PERF)
for n, v in PERF:
    w('<div class="perfrow"><span>%s</span><span class="pb"><i style="width:%d%%"></i></span><b style="text-align:right">%d ms</b></div>'
      % (n, round(v / mxp * 100), v))
w('<div class="note" style="margin-top:5mm">Time to first byte held at roughly 23&nbsp;ms on every route measured. The slowest page in the product is the student dashboard at 897&nbsp;ms, and it is assembling readiness, streaks, deadlines and recommendations in a single pass. Nothing we measured came near a second.</div>')
w("</div>")

# a11y + data
w('<div class="sheet">')
w('<h2 class="sec">Accessibility<small>axe-core against WCAG 2.1 and 2.2 AA, eleven pages plus the signed-out doors</small></h2>')
w('<div class="grid2">')
w('<div class="kpi"><b>1</b><span>Serious violation, eleven pages</span><p>Two contrast failures in the Monaco editor chrome on the Code Lab problem page. Every other audited page returned clean, including both sign-in doors and the public credential checker.</p></div>')
w('<div class="kpi"><b>0</b><span>Violations in dark theme</span><p>The dark palette was audited separately and returned nothing at all. Screen-reader legends are present on every exam question, and no page scrolled horizontally at 390&nbsp;px.</p></div>')
w("</div>")
w('<div class="note" style="margin-top:4mm">The proposal targets WCAG 2.2 AA. On the evidence of this audit that target is being hit, which is unusual for a product of this surface area. Keyboard focus is visible throughout, form fields are labelled, and the exam paper carries a visually-hidden legend repeating each question for screen-reader users &mdash; a detail that only appears when somebody has actually thought about a blind candidate sitting a timed paper.</div>')

w('<h2 class="sec" style="margin-top:8mm">Demonstration data<small>Not product defects &mdash; but they are what a prospect will see</small></h2>')
w('<ul class="dl">')
for d in DATA:
    w("<li>%s</li>" % d)
w("</ul>")
w('<div class="note" style="margin-top:4mm"><b>Recommendation.</b> Before this URL goes in front of a customer: revoke the test123456 platform operator, purge the automated-test debris from the demonstration tenant, and seed one programme with one semester, a handful of employers with open roles, a scheduled contest and a few lessons on the flagship courses. Six of the twenty-five requirements scored below what the build deserves purely because there was nothing in the database to show.</div>')
w('<div class="foot">Onyx LMS end-user quality report &middot; prepared by an external QA tester &middot; 27 August 2026 &middot; every finding reproduced against the live deployment at onyx-lms-v2.vercel.app</div>')
w("</div>")

open("report1.html", "w", encoding="utf-8").write(o.getvalue())
print("report1.html written; overall", overall, tot, mx)
