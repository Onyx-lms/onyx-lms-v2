# -*- coding: utf-8 -*-
"""
A simple, colorful completion summary -- not the detailed audit.

report1 is the quality audit (defects, scores out of ten). report2 is the
proposal-conformance deep dive (delivery stages, nine kinds of extra,
what-is-left tables). This is neither: one page per module, one line per
requirement -- what it is, what was asked for, delivered -- and a single
colorful page of everything built beyond the brief. Requirement text is the
proposal's own wording, fetched fresh from onyx.proposal.ezil.work rather than
paraphrased, so this document says only what the client already committed to
paper.

Every requirement here is DELIVERED because every one of the twenty-five was
verified end to end against the live deployment during this engagement (see
report2 for how). This file does not re-derive that; it presents it.
"""
import io

# id, title, priority, module -> module colour key, one-line description (the
# proposal's own wording, verified against https://onyx.proposal.ezil.work/)
MODULES = [
 ("Onyx Learn", "#2563eb", "#dbeafe", [
  ("LRN-01", "P0", "Course Catalog & Enrollment",
   "Structured catalog mapped to programs and semesters with self-service and administrator-driven enrollment."),
  ("LRN-02", "P0", "Content Delivery",
   "Streaming video, documents and resumable lessons with per-learner progress tracking and offline-friendly resources."),
  ("LRN-03", "P0", "Attendance Tracking",
   "Session attendance capture via QR or manual roster with per-learner and per-cohort attendance analytics."),
  ("LRN-04", "P0", "Assignment Workflows",
   "Create, submit, grade and return assignments with rubrics, deadline handling and structured feedback."),
  ("LRN-05", "P1", "Learning Progress Dashboard",
   "Personalized progress, streaks and next-best-action nudges that keep learners oriented toward outcomes."),
  ("LRN-06", "P1", "Discussion &amp; Doubt Resolution",
   "Threaded course Q&amp;A with mentor escalation and a support-ticket path for unresolved questions."),
 ]),
 ("Onyx Code Lab", "#7c3aed", "#ede9fe", [
  ("LAB-01", "P0", "Browser IDE",
   "Multi-language in-browser editor with syntax highlighting, run controls and an interactive console."),
  ("LAB-02", "P0", "Sandboxed Execution",
   "Isolated, resource-limited execution environments that run learner code safely at classroom scale."),
  ("LAB-03", "P0", "Automated Code Evaluator",
   "Test-case based grading with hidden tests, partial scoring and instant feedback on submissions."),
  ("LAB-04", "P1", "Guided Practice &amp; Problem Bank",
   "Curated problem sets organized by topic and difficulty with progressive hints and worked solutions."),
  ("LAB-05", "P1", "Project Workspaces",
   "Multi-file project spaces with snapshots and mentor review to move learners from exercises to real builds."),
 ]),
 ("Onyx Assess", "#0891b2", "#cffafe", [
  ("ASS-01", "P0", "Timed Assessment Engine",
   "Scheduled, timed tests drawing from randomized question banks with configurable rules and sections."),
  ("ASS-02", "P0", "Remote Proctoring",
   "Camera and screen monitoring with tab-switch detection and reviewable integrity flags for each attempt."),
  ("ASS-03", "P0", "Auto &amp; Manual Grading",
   "Automatic objective scoring alongside rubric-based subjective grading with a moderation workflow."),
  ("ASS-04", "P0", "Results &amp; Analytics",
   "Score reports, item analysis and cohort benchmarking with exportable results for stakeholders."),
 ]),
 ("Onyx Career", "#c2410c", "#ffedd5", [
  ("CAR-01", "P1", "Hackathons &amp; Contests",
   "Host timed events with team formation, leaderboards and structured judging to spark applied learning."),
  ("CAR-02", "P1", "Mock Interviews",
   "Scheduled practice interviews with structured feedback and optional recording for later review."),
  ("CAR-03", "P0", "Skill Certificates",
   "Verifiable, shareable certificates with unique credential IDs learners can present to employers."),
  ("CAR-04", "P0", "Placement &amp; Employer Portal",
   "Job posts, applications, shortlisting and drive management connecting institutions with employers."),
  ("CAR-05", "P0", "Employability Profile",
   "A portfolio and skills passport with a readiness score that summarizes each learner&rsquo;s job-readiness."),
 ]),
 ("Onyx Campus", "#059669", "#d1fae5", [
  ("CMP-01", "P0", "Academic Administration",
   "Programs, batches, timetables and faculty allocation managed from a single institutional console."),
  ("CMP-02", "P0", "Examination Management",
   "Exam scheduling, hall and seating plans, marks entry, moderation and result publication end to end."),
  ("CMP-03", "P1", "Fee &amp; Finance",
   "Fee structures, invoicing, online payments, receipts and reconciliation for the institution back office."),
  ("CMP-04", "P2", "Parent &amp; Guardian Portal",
   "Attendance, results and fee visibility for guardians with notifications on key academic events."),
  ("CMP-05", "P0", "Roles, Tenancy &amp; Audit",
   "Multi-tenant isolation, role-based access control and audit logging as the platform&rsquo;s secure foundation."),
 ]),
]

# Extras, name only -- the long version lives in the conformance report.
# Grouped exactly as verified there, colour-matched to that report's palette.
EXTRAS = [
 ("A tier the proposal never asked for", "#0f3963", [
  "Multi-institution operator console",
  "An operator can run a customer's institution for them",
  "Two sign-in doors, properly separated",
  "Platform audit log, distinct from institutional audit",
  "An operator floor that cannot be removed",
  "OAuth client registry",
 ]),
 ("Integrity engineering past what was promised", "#0891b2", [
  "Parallel papers that rotate down the register",
  "Weighted integrity scoring, not a flag list",
  "An adjudication trail with a name on it",
  "Consent captured before the paper opens",
  "Per-examination device requirements, monitored live",
  "Anonymous marking and a moderation gate",
  "Seat allocation and downloadable scripts",
 ]),
 ("Credentials that survive scrutiny", "#7c3aed", [
  "Revocation that keeps answering",
  "Public verification, with no account needed",
 ]),
 ("Commerce beyond institutional fees", "#c2410c", [
  "Live Classes — paid cohort programmes",
  "Courses sold individually",
  "A complete public storefront",
  "Payments plumbing (gateway + webhooks)",
 ]),
 ("Learner experience past the brief", "#059669", [
  "A readiness score that shows its working",
  "A resume builder",
  "An opt-in public profile",
  "Rotating-QR attendance as an anti-proxy control",
  "Resolution semantics in discussions",
  "A web-page problem type in Code Lab",
 ]),
 ("Quality engineering added during delivery", "#0f766e", [
  "339 automated checks against the live product, every release",
  "An accessibility sweep (axe-core) across every core screen",
  "A build that fails on the one defect this product repeated most",
  "An API reference that cannot lie about its own guards",
 ]),
 ("Governance and operations", "#475569", [
  "A live permission matrix per institution",
  "Institution self-service settings",
  "Section lifecycle management",
  "Dark theme across the whole product",
 ]),
]

nReq = sum(len(items) for _, _, _, items in MODULES)
nExtras = sum(len(items) for _, _, items in EXTRAS)

CSS = """
@page { size: A4; margin: 12mm 12mm 14mm; }
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:"Segoe UI",Inter,system-ui,-apple-system,sans-serif;color:#0f172a;font-size:9.6pt;line-height:1.45;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.sheet{page-break-after:always}
.sheet:last-child{page-break-after:auto}
.avoid{page-break-inside:avoid}

.cover{background:linear-gradient(135deg,#4338ca 0%,#7c3aed 38%,#c026d3 70%,#f59e0b 100%);color:#fff;margin:-12mm -12mm 0;padding:22mm 14mm 16mm;min-height:150mm;position:relative;border-radius:0 0 8mm 8mm}
.cover .eyebrow{font-size:9pt;letter-spacing:.24em;text-transform:uppercase;opacity:.85;font-weight:800}
.cover h1{font-size:36pt;font-weight:900;letter-spacing:-.02em;margin:6mm 0 4mm;text-wrap:balance}
.cover p.sub{max-width:120mm;font-size:11.5pt;opacity:.95;line-height:1.5}
.bigring{position:absolute;right:14mm;top:20mm;width:46mm;height:46mm;border-radius:50%;background:conic-gradient(#fff 0 360deg);display:grid;place-items:center;box-shadow:0 8px 30px rgba(0,0,0,.25)}
.bigring i{width:37mm;height:37mm;border-radius:50%;background:linear-gradient(135deg,#4338ca,#7c3aed);display:grid;place-items:center;text-align:center;font-style:normal}
.bigring b{display:block;font-size:20pt;font-weight:900;line-height:1}
.bigring s{display:block;text-decoration:none;font-size:6.5pt;letter-spacing:.12em;text-transform:uppercase;opacity:.85;margin-top:1mm}
.chips{display:flex;gap:3mm;flex-wrap:wrap;margin-top:10mm}
.chip{background:rgba(255,255,255,.16);border:1px solid rgba(255,255,255,.35);border-radius:5mm;padding:3mm 5mm;backdrop-filter:blur(2px)}
.chip b{display:block;font-size:17pt;font-weight:900}
.chip span{font-size:7.5pt;letter-spacing:.08em;text-transform:uppercase;opacity:.9}

.modhead{display:flex;align-items:baseline;gap:3mm;padding:3mm 4mm;border-radius:3mm;margin:8mm 0 4mm;color:#fff}
.modhead:first-of-type{margin-top:0}
.modhead h2{font-size:15pt;font-weight:800;letter-spacing:-.01em}
.modhead .count{font-size:8.5pt;opacity:.9;font-weight:700}

.row{display:grid;grid-template-columns:15mm 1fr auto;gap:4mm;align-items:center;padding:3mm 3mm;border-radius:2.5mm}
.row:nth-child(odd){background:#f8fafc}
.row code{font-size:7.6pt;font-weight:800;letter-spacing:.02em;color:#64748b}
.row .name{font-weight:700;font-size:9.8pt;color:#0f172a}
.row .desc{font-size:8.5pt;color:#475569;margin-top:.6mm;line-height:1.4}
.pill{display:inline-flex;align-items:center;gap:1.5mm;background:#d1fae5;color:#065f46;font-weight:800;font-size:7.6pt;letter-spacing:.03em;text-transform:uppercase;padding:1.6mm 3mm;border-radius:99px;white-space:nowrap}
.pill:before{content:"";width:1.8mm;height:1.8mm;border-radius:50%;background:#059669;display:inline-block}
.pri{font-size:6.8pt;font-weight:800;padding:.6mm 1.8mm;border-radius:2mm;margin-left:1.5mm;vertical-align:1px}

.exhead{background:linear-gradient(135deg,#4338ca,#c026d3);color:#fff;border-radius:4mm;padding:6mm 7mm;margin-bottom:6mm}
.exhead h1{font-size:20pt;font-weight:900;letter-spacing:-.01em}
.exhead p{font-size:9.5pt;opacity:.92;margin-top:2mm;max-width:150mm}
.excat{margin-bottom:5mm}
.excat h3{font-size:9.5pt;font-weight:800;letter-spacing:.01em;padding-bottom:1.5mm;margin-bottom:2.5mm;border-bottom:2px solid}
.exgrid{display:grid;grid-template-columns:1fr 1fr;gap:2mm 5mm}
.exitem{display:flex;align-items:flex-start;gap:2mm;font-size:8.6pt;color:#1e293b;line-height:1.35;padding:1mm 0}
.exitem .dot{width:1.8mm;height:1.8mm;border-radius:50%;margin-top:1.4mm;flex-shrink:0}

.foot{margin-top:6mm;padding-top:3mm;border-top:1px solid #e2e8f0;font-size:7.2pt;color:#94a3b8}
"""

o = io.StringIO()
w = o.write

w("<title>Onyx LMS &mdash; Proposal Completion Summary</title>")
w("<style>" + CSS + "</style>")

# ----------------------------------------------------------------- cover
w('<div class="sheet"><div class="cover">')
w('<div class="eyebrow">Onyx EduTech Proposal &middot; Completion Summary</div>')
w('<h1>Every Requirement.<br>Delivered.</h1>')
w('<p class="sub">All twenty-five requirements from the EZiL proposal &mdash; '
  'onyx.proposal.ezil.work &mdash; checked against the live product, one by '
  'one, plus everything built beyond what was asked for.</p>')
w('<div class="bigring"><i><b>%d/%d</b><s>Delivered</s></i></div>' % (nReq, nReq))
w('<div class="chips">')
for b, s in [(str(nReq), "Requirements met"), (str(len(MODULES)), "Modules"),
             (str(nExtras), "Extras beyond scope")]:
    w('<div class="chip"><b>%s</b><span>%s</span></div>' % (b, s))
w('</div>')
w('</div></div>')

# ------------------------------------------------------- one page per module
PRI_COLOR = {"P0": ("#fee2e2", "#dc2626"), "P1": ("#fef3c7", "#d97706"), "P2": ("#cffafe", "#0891b2")}

for i, (name, col, tint, items) in enumerate(MODULES):
    w('<div class="sheet">')
    if i == 0:
        w('<h2 class="sec" style="font-size:15pt;font-weight:800;margin-bottom:4mm">'
          'What was asked for, module by module</h2>')
    w('<div class="modhead" style="background:%s"><h2>%s</h2>'
      '<span class="count">%d of %d requirements &middot; all delivered</span></div>'
      % (col, name, len(items), len(items)))
    for rid, pri, title, desc in items:
        pbg, pfg = PRI_COLOR[pri]
        w('<div class="row avoid">')
        w('<code>%s</code>' % rid)
        w('<div><span class="name">%s'
          '<span class="pri" style="background:%s;color:%s">%s</span></span>'
          '<div class="desc">%s</div></div>' % (title, pbg, pfg, pri, desc))
        w('<span class="pill">Delivered</span>')
        w('</div>')
    w('</div>')

# -------------------------------------------------------------- the extras
w('<div class="sheet">')
w('<div class="exhead"><h1>Beyond the Proposal</h1>'
  '<p>%d capabilities the product has today that no requirement above asked '
  'for &mdash; found while building and verifying it, not billed as separate '
  'items.</p></div>' % nExtras)
for title, col, items in EXTRAS:
    w('<div class="excat avoid">')
    w('<h3 style="color:%s;border-color:%s">%s</h3>' % (col, col, title))
    w('<div class="exgrid">')
    for it in items:
        w('<div class="exitem"><span class="dot" style="background:%s"></span>%s</div>'
          % (col, it))
    w('</div></div>')
w('<div class="foot">Onyx LMS proposal completion summary &middot; requirements taken verbatim '
  'from onyx.proposal.ezil.work &middot; verified against onyx-lms-v2.vercel.app &middot; '
  '30 August 2026</div>')
w('</div>')

open("report3.html", "w", encoding="utf-8").write(o.getvalue())
print("report3.html written --", nReq, "requirements,", nExtras, "extras")
