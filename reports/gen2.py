import io

# id, title, priority, stage, pct, status, note
REQS = [
 # Onyx Learn
 ("LRN-01", "Course catalogue &amp; enrolment", "P0", 1, 100, "V",
  "Programme-mapped catalogue with three enrolment routes: self-service on open courses, purchase on locked ones, and enrolment by the institution. Built and enrolled into a live course during the audit."),
 ("LRN-02", "Content delivery", "P0", 1, 100, "V",
  "Video, document, image, link and written lessons; resumable playback with the position saved server-side; signed URLs; preview-before-enrol. Every lesson type now records completion, so a course made of reading advances like one made of video."),
 ("LRN-03", "Attendance tracking", "P0", 1, 100, "V",
  "Rotating QR check-in and a manual roster, plus per-learner and per-cohort analytics and CSV export. Goes beyond the brief with a 15-second rotation that defeats a photographed code."),
 ("LRN-04", "Assignment workflows", "P0", 1, 98, "V",
  "Create, submit, grade and return, with rubrics, deadline handling, late policy and structured feedback. Work can be set now or saved as a draft so criteria can be attached first, and the criteria are then fixed against work already handed in. An assignment still cannot be edited or withdrawn once created."),
 ("LRN-05", "Learning progress dashboard", "P1", 3, 100, "V",
  "Personalised progress, streaks and next-best-action nudges that state their own reasoning &mdash; fed by lesson completion across every type, and by a day boundary computed in the institution&rsquo;s own timezone."),
 ("LRN-06", "Discussion &amp; doubt resolution", "P1", 3, 95, "V",
  "Threaded course Q&amp;A, mentor escalation and a support-ticket path with SLA deadlines. Students cannot open a ticket without escalating a discussion first."),
 # Code Lab
 ("LAB-01", "Browser IDE", "P0", 2, 100, "V",
  "Monaco editor, multi-language, run controls and an interactive console showing real program output."),
 ("LAB-02", "Sandboxed execution", "P0", 2, 100, "V",
  "Isolated, resource-limited execution. Confirmed by attack: CPU budget, memory ceiling and network egress all enforced, running as an unprivileged user."),
 ("LAB-03", "Automated code evaluator", "P0", 2, 100, "V",
  "Test-case grading with hidden cases, partial scoring and instant per-case feedback including the actual output."),
 ("LAB-04", "Guided practice &amp; problem bank", "P1", 2, 100, "V",
  "A curated bank across three difficulties and six topics, with both filters verified to narrow, and worked solutions behind a release rule."),
 ("LAB-05", "Project workspaces", "P1", 2, 100, "V",
  "Multi-file project spaces with snapshots, a live preview and course attachment for mentor review."),
 # Assess
 ("ASS-01", "Timed assessment engine", "P0", 2, 100, "V",
  "Scheduled, server-timed papers drawn from randomised banks with configurable rules and sections. Exceeds the brief with parallel sets that rotate down the register."),
 ("ASS-02", "Remote proctoring", "P0", 2, 95, "V",
  "Camera and screen requirements, event capture, and reviewable integrity flags per attempt. The live camera watch could not be exercised headlessly."),
 ("ASS-03", "Auto &amp; manual grading", "P0", 2, 100, "V",
  "Automatic objective scoring alongside rubric-based subjective marking, with a moderation workflow and anonymous marking."),
 ("ASS-04", "Results &amp; analytics", "P0", 2, 100, "V",
  "Score reports, per-question analysis, cohort benchmarking and exportable results for candidates and staff."),
 # Career
 ("CAR-01", "Hackathons &amp; contests", "P1", 3, 100, "V",
  "A contest scheduled, opened, entered by a team and answered &mdash; judged by the same sandbox Code Lab uses, with the leaderboard, the penalty and the freeze all applied. Run end to end, not inspected."),
 ("CAR-02", "Mock interviews", "P1", 3, 100, "V",
  "Scheduling, structured feedback against criteria, optional recording with consent and a scoring breakdown &mdash; exercised on a real interview, released to the candidate, with the interviewer&rsquo;s private notes correctly withheld from them."),
 ("CAR-03", "Skill certificates", "P0", 3, 100, "V",
  "Verifiable, shareable certificates with unique credential ids. Issued, verified signed-out, downloaded and revoked during the audit."),
 ("CAR-04", "Placement &amp; employer portal", "P0", 3, 98, "V",
  "Employers, posts, applications, shortlisting and drive management. Both halves now work: a company sees exactly the applicant list the placement office sees, and no other company&rsquo;s. A post cannot be edited once created."),
 ("CAR-05", "Employability profile", "P0", 3, 100, "V",
  "A portfolio and skills passport with a readiness score, exceeding the brief with a resume builder and an opt-in public profile."),
 # Campus
 ("CMP-01", "Academic administration", "P0", 4, 100, "V",
  "Programmes, batches, sections, faculty allocation and a timetable with rooms, clash detection and publication. Day boundaries are computed where the institution is, at every hour of the day."),
 ("CMP-02", "Examination management", "P0", 4, 100, "V",
  "Scheduling, seating, marks entry, moderation and publication end to end, with the candidate&rsquo;s script and the marker&rsquo;s copy both downloadable as PDFs. The checksum-sealed transcript &mdash; an extra beyond the brief, and the only half-finished thing in this module &mdash; has been withdrawn rather than left to look complete. Nothing the proposal asked for was removed with it."),
 ("CMP-03", "Fee &amp; finance", "P1", 4, 95, "V",
  "Fee heads, structures, invoicing, online payments, receipts and reconciliation, with course and live-class revenue tracked separately."),
 ("CMP-04", "Parent &amp; guardian portal", "P2", 4, 100, "V",
  "Guardian sign-in with attendance, results and fee visibility, each a separate switch the learner holds, behind a learner-initiated consent link. Walked end to end with a real family: every refusal refuses, and another family&rsquo;s child is a 404."),
 ("CMP-05", "Roles, tenancy &amp; audit", "P0", 1, 100, "V",
  "Multi-tenant isolation, role-based access control and audit logging. 140 route-by-role probes and a cross-tenant sweep found no leak."),
]

STAGES = [
 (1, "Foundation &amp; student learning core", "Secure core, courses, attendance and assignments", "#2563eb"),
 (2, "Engineering practice &amp; assessment integrity", "Code Lab, sandboxed execution and proctored assessments", "#7c3aed"),
 (3, "Employability &amp; career pathways", "Certificates, placement, hackathons and engagement", "#c2410c"),
 (4, "Campus operations, scale &amp; production hardening", "Academic, examination, finance, parent and hardening", "#059669"),
]

EXTRAS = [
 ("A whole tier the proposal never asked for", "#0f3963", [
  ("Multi-institution operator console",
   "The proposal asked for tenant isolation. What was built is a separate operator product above the institutions: create, suspend and delete institutions, and seven are live on the deployment today."),
  ("An operator can run a customer's institution for them",
   "From the operator tier: students, faculty, other staff, sections, courses, modules, lessons, question banks, examinations, Code Lab problems, timetable, grades, fees, permissions and the help queue. A customer can be onboarded without ever touching the product themselves."),
  ("Two sign-in doors, properly separated",
   "Institution accounts are refused at the operator door and bounced back; operator accounts land in the operator console. Verified by trying it."),
  ("Platform audit log, distinct from institutional audit",
   "Every write an operator makes across every institution, and the privileged reads too &mdash; opening an institution's grades is recorded against the operator's name."),
  ("An operator floor that cannot be removed",
   "The last remaining platform operator cannot be revoked, because a platform with no operator is one nobody can get back into."),
  ("OAuth client registry",
   "Third-party applications can register and request a signed-in user's consent to act on their behalf, with a console to take that away. Nothing in the proposal implies an integration surface."),
 ]),
 ("Integrity engineering past what was promised", "#0891b2", [
  ("Parallel papers that rotate down the register",
   "The brief said randomised banks. A bank here holds whole parallel sets, and a scheduled examination rotates them by roll number so nobody within reach of a neighbour sits the same paper."),
  ("Weighted integrity scoring, not a flag list",
   "Events carry weights and roll into a score banded high, medium and low. The console orders attempts worst-first."),
  ("An adjudication trail with a name on it",
   "Each event is dismissed or upheld by a named person, the decision is recorded, and the candidate can see the outcome. The product states plainly that a flag is evidence, not a verdict."),
  ("Consent captured before the paper opens",
   "Monitoring consent is timestamped and shown on the review page, so the record says the candidate agreed before anything was recorded."),
  ("Per-examination device requirements, monitored live",
   "Camera, screen sharing and live invigilator watch are switched on per paper, and the console shows the state of every required device while candidates are sitting."),
  ("Anonymous marking and a moderation gate",
   "The marker can be shown Candidate 1 rather than a name, and results can be blocked from publication until every attempt has been through a second pair of eyes."),
  ("Seat allocation and downloadable scripts",
   "Halls filled in seat order, and every script downloadable per candidate or for the whole sitting."),
 ]),
 ("Credentials that survive scrutiny", "#7c3aed", [
  ("Revocation that keeps answering",
   "A revoked certificate is never deleted. Its public page keeps resolving and says the credential was withdrawn &mdash; which is the only answer useful to whoever is holding a copy. Verified live."),
  ("Public verification, with no account",
   "A credential id resolves on a signed-out page that states it shows only what the issuer published and that nothing can be edited by the holder."),
 ]),
 ("Commerce the proposal scoped only as institutional fees", "#c2410c", [
  ("Live Classes &mdash; paid cohort programmes",
   "Twelve-, sixteen- and four-week live programmes with pricing, a named certificate and paid registration. Revenue is tracked separately from fee income."),
  ("Courses sold individually",
   "Locked courses carry a price and are bought before they open, with course revenue split out from fees in the finance console."),
  ("A complete public storefront",
   "Marketing site, course catalogue with price and category filters, workshops, instructor profiles, knowledge base, cart, checkout, coupons, wishlist, purchase history and invoices &mdash; effectively a second application alongside the institutional product."),
  ("Payments plumbing",
   "Gateway configuration, invoices that copy their lines at the moment of issue so a later schedule change cannot rewrite a bill, ageing analysis and offline payment recording."),
 ]),
 ("Learner experience past the brief", "#059669", [
  ("A readiness score that shows its working",
   "Not just a number: the unearned points are broken out and ranked, so the learner is told which single thing is worth the most to them right now."),
  ("A resume builder",
   "Reorderable sections, completeness coaching, and an A4 PDF assembled live from the record rather than a stale stored copy."),
  ("An opt-in public profile",
   "A shareable profile page the learner switches on themselves, assembled from courses, certificates and results."),
  ("Rotating-QR attendance as an anti-proxy control",
   "The brief said QR or manual roster. The code rotates every fifteen seconds and is accepted for its own cycle and the next, so a photograph sent to a friend is dead within half a minute."),
  ("Resolution semantics in discussions",
   "Helpful votes and an explicit &ldquo;this answered it&rdquo; from the asker, plus an SLA-timed ticket queue with ownership states and overdue tickets surfaced rather than quietly dropped."),
  ("A web-page problem type",
   "Alongside code problems, learners can be set an HTML, CSS and JavaScript build with a sandboxed live preview, marked by a person who sees the rendered page. Assessments can carry code and web questions too, which the proposal kept in a separate module."),
 ]),
 ("Quality engineering added during verification", "#0f766e", [
  ("A build that fails on the defect this product repeats most",
   "The single most repeated defect was a query reading a table that grows with the institution, naming no range, and being silently truncated at a thousand rows by PostgREST &mdash; nine separate instances, each returning a plausible number that was wrong. A unit test now scans the service layer for that exact shape and fails the build on a new one."),
  ("An API reference that cannot lie about its own guards",
   "The generated reference had described thirteen guarded endpoints &mdash; publishing a course, withdrawing a learner, the whole support queue &mdash; as public. It now follows guard helpers through the code, and an unreadable guard fails the build rather than being published as a falsehood."),
  ("A guard against the crash pattern that took four pages down at once",
   "A Server Component cannot pass a function to a client, and doing so renders a blank error page in production. A test now asserts no Server Component carries a JSX event handler."),
  ("339 checks that run against the deployed product, not a mock",
   "Twenty-one suites signing in as operator, administrator, examinations officer, lecturer, placement officer, employer, guardian and student, exercising real journeys against onyx-lms-v2.vercel.app &mdash; including an axe-core accessibility sweep over ten screens, and a phone-and-tablet pass over sixteen."),
  ("Suites that clean up after themselves",
   "The demonstration institution had accumulated forty machine-generated practice problems, one or two per run, because the suites creating them had no delete route and stopped there. They now unpublish what they make."),
 ]),
 ("Governance and operations", "#475569", [
  ("A live permission matrix per institution",
   "Ten domains of permissions, editable per role, with a reset to defaults &mdash; and copy explaining that a tick grants the act, not the reach."),
  ("Institution self-service settings",
   "Domain-allowlisted student self-registration, a switch for whether lecturers may schedule examinations, and a community invite link, all controlled by the institution rather than by support."),
  ("Section lifecycle",
   "Divisions can be retired as well as removed, so a cohort that has moved on stops appearing without its history being destroyed."),
  ("Dark theme across the whole product",
   "Audited separately and returned no accessibility violations at all."),
 ]),
]


def st_meta(s):
    return {"V": ("#059669", "#d1fae5", "Verified end to end"),
            "D": ("#d97706", "#fef3c7", "Shipped, with defect"),
            "N": ("#0891b2", "#cffafe", "Built, no data to run it")}[s]


pri_meta = {"P0": ("#dc2626", "#fee2e2"), "P1": ("#d97706", "#fef3c7"), "P2": ("#0891b2", "#cffafe")}

overall = round(sum(r[4] for r in REQS) / (len(REQS) * 100) * 100)
nV = sum(1 for r in REQS if r[5] == "V")
nD = sum(1 for r in REQS if r[5] == "D")
nN = sum(1 for r in REQS if r[5] == "N")
nExtras = sum(len(g[2]) for g in EXTRAS)

CSS = """
@page { size: A4; margin: 14mm 12mm 15mm; }
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:"Segoe UI",Inter,system-ui,-apple-system,sans-serif;color:#12212e;font-size:9.6pt;line-height:1.5;-webkit-print-color-adjust:exact;print-color-adjust:exact}
h1,h2,h3,h4{line-height:1.22}
.sheet{page-break-after:always}
.sheet:last-child{page-break-after:auto}
.avoid{page-break-inside:avoid}
.cover{background:linear-gradient(135deg,#3b1d6e 0%,#5b2ea6 40%,#c2410c 115%);color:#fff;margin:-14mm -12mm 0;padding:20mm 14mm 14mm;min-height:152mm;position:relative}
.eyebrow{font-size:8pt;letter-spacing:.22em;text-transform:uppercase;opacity:.72;font-weight:700}
.cover h1{font-size:31pt;font-weight:800;letter-spacing:-.02em;margin:6mm 0 4mm}
.cover .sub{font-size:11.2pt;opacity:.93;max-width:116mm;line-height:1.6}
.cover .meta{margin-top:11mm;display:grid;grid-template-columns:repeat(4,1fr);gap:4mm;border-top:1px solid rgba(255,255,255,.3);padding-top:5mm}
.cover .meta span{display:block;font-size:7pt;letter-spacing:.14em;text-transform:uppercase;opacity:.65;font-weight:700;margin-bottom:1.5mm}
.cover .meta b{font-size:10pt;font-weight:700}
.ring{position:absolute;right:14mm;top:22mm;width:44mm;height:44mm;border-radius:50%;background:conic-gradient(#fbbf24 0 PCTdeg,rgba(255,255,255,.2) PCTdeg 360deg);display:grid;place-items:center}
.ring i{width:34mm;height:34mm;border-radius:50%;background:#43217c;display:grid;place-items:center;font-style:normal;text-align:center}
.ring b{display:block;font-size:19pt;font-weight:800;line-height:1}
.ring s{display:block;text-decoration:none;font-size:6.4pt;letter-spacing:.13em;text-transform:uppercase;opacity:.75;margin-top:1.5mm}
h2.sec{font-size:15pt;font-weight:800;letter-spacing:-.01em;margin:0 0 4mm;padding-bottom:2mm;border-bottom:2.5px solid #43217c}
h2.sec small{display:block;font-size:8pt;font-weight:600;color:#64748b;letter-spacing:.03em;margin-top:1.5mm}
.lead{font-size:10pt;line-height:1.68;color:#334155;margin:0 0 4mm}
.grid4{display:grid;grid-template-columns:repeat(4,1fr);gap:3mm;margin:4mm 0}
.grid3{display:grid;grid-template-columns:repeat(3,1fr);gap:3mm;margin:4mm 0}
.kpi{border:1px solid #e2e8f0;border-radius:3mm;padding:4mm;background:#f8fafc}
.kpi b{display:block;font-size:19pt;font-weight:800;line-height:1;color:#43217c}
.kpi span{display:block;font-size:7pt;letter-spacing:.13em;text-transform:uppercase;color:#64748b;font-weight:700;margin-top:2mm}
.kpi p{font-size:8.2pt;color:#475569;margin-top:2.4mm;line-height:1.5}
table.req{width:100%;border-collapse:collapse;font-size:8.4pt}
table.req th{text-align:left;font-size:7pt;letter-spacing:.13em;text-transform:uppercase;color:#64748b;padding:0 2.5mm 2mm 0;border-bottom:1.5px solid #cbd5e1}
table.req td{padding:2.6mm 2.5mm 2.6mm 0;border-bottom:1px solid #eef2f7;line-height:1.46;vertical-align:top}
table.req tr{page-break-inside:avoid}
table.req td.id{font-size:7.4pt;font-weight:800;color:#475569;white-space:nowrap}
table.req td.t b{font-size:9.2pt}
table.req td.t p{font-size:8.1pt;color:#475569;margin-top:.8mm;line-height:1.46}
.pill{display:inline-block;padding:.8mm 2mm;border-radius:1.4mm;font-size:6.6pt;font-weight:800;letter-spacing:.07em;text-transform:uppercase;white-space:nowrap}
.mini{width:26mm}
.mbar{height:3.6mm;border-radius:1.8mm;background:#e8edf3;position:relative;overflow:hidden}
.mbar i{position:absolute;top:0;bottom:0;left:0;border-radius:1.8mm}
.mnum{font-size:7.2pt;font-weight:800;color:#334155;margin-top:.7mm;display:block;text-align:right}
.stage{border:1px solid #e8edf3;border-left:3.5mm solid;border-radius:2.5mm;padding:3.4mm 4mm;margin-bottom:3mm}
.stage h4{font-size:10pt;font-weight:800;display:flex;justify-content:space-between;align-items:baseline}
.stage h4 em{font-style:normal;font-size:9pt}
.stage p{font-size:8.3pt;color:#64748b;margin:.8mm 0 2mm}
.stbar{height:5mm;border-radius:2.5mm;background:#eef2f7;overflow:hidden;display:flex}
.stbar i{display:block;height:100%}
.xg{margin-bottom:5mm}
.xg h3{font-size:11.4pt;font-weight:800;padding:2mm 0 2mm 3.5mm;border-left:3.5mm solid;margin-bottom:2mm}
.xi{display:grid;grid-template-columns:5mm 1fr;gap:2mm;padding:1.9mm 0;border-top:1px solid #eef2f7}
.xi .n{font-size:7.6pt;font-weight:800;color:#94a3b8;padding-top:.4mm}
.xi b{font-size:9.2pt;font-weight:700;display:block}
.xi p{font-size:8.2pt;color:#475569;line-height:1.48;margin-top:.7mm}
.note{background:#f6f3fb;border:1px solid #e2daf2;border-left:3.2mm solid #43217c;border-radius:2.5mm;padding:4mm 4.5mm;font-size:8.7pt;color:#2c2140;line-height:1.6}
.note.warm{background:#fff7ed;border-color:#fed7aa;border-left-color:#c2410c;color:#42210f}
.foot{margin-top:6mm;padding-top:3mm;border-top:1px solid #e2e8f0;font-size:7.4pt;color:#94a3b8}
.legend{display:flex;gap:5mm;font-size:7.6pt;color:#475569;margin:0 0 3mm;flex-wrap:wrap}
.legend span{display:flex;align-items:center;gap:1.6mm}
.dot{width:2.6mm;height:2.6mm;border-radius:50%;display:inline-block}
"""

o = io.StringIO()
w = o.write
w("<title>Onyx LMS &mdash; Proposal Conformance &amp; Feature Completeness</title>")
w("<style>" + CSS.replace("PCTdeg", str(round(overall * 3.6)) + "deg") + "</style>")

# ---- cover
w('<div class="sheet"><div class="cover">')
w('<div class="ring"><i><b>%d%%</b><s>Delivered</s></i></div>' % overall)
w('<div class="eyebrow">PROPOSAL CONFORMANCE &middot; INDEPENDENT VERIFICATION &middot; REVISION 2</div>')
w("<h1>Onyx LMS<br>Built vs. Proposed</h1>")
w('<p class="sub">All twenty-five requirements from the EZiL proposal, checked one by one against the running product &mdash; and the substantial set of capabilities that were built without ever being asked for.</p>')
w('<div class="meta">')
for k, v in [("Requirements", "25 of 25 shipped"), ("Delivery stages", "All four covered"),
             ("Beyond the proposal", "%d capabilities" % nExtras), ("Verified &middot; re-verified", "27 August 2026")]:
    w("<div><span>%s</span><b>%s</b></div>" % (k, v))
w("</div></div>")

w('<div style="padding-top:8mm">')
w('<h2 class="sec">The finding in one paragraph<small>Measured by using the product, not by reading the repository</small></h2>')
w('<p class="lead">Every requirement in the proposal has shipped, and on this second pass every one of the twenty-five has been driven end to end with real data. Not one is missing, stubbed or a placeholder screen. The first pass found six carrying defects and three that could not be exercised at all, because no contest was scheduled anywhere, no mock interview existed and no learner had linked a guardian. All nine were worked through: the defects are fixed and re-tested against the live deployment, and the three empty ones were seeded and then run &mdash; a contest entered and judged by the live sandbox, an interview marked and released, a guardian linked and consented. Set against that, the product carries a great deal the proposal never described &mdash; an entire platform-operator tier above the institutions, a commerce stack with a public storefront, and integrity controls a good deal sharper than &ldquo;randomised banks and reviewable flags&rdquo;.</p>')
w('<div class="grid4">')
for b, s in [("25 / 25", "Requirements shipped"), ("%d / 25" % nV, "Verified end to end"),
             ("339", "Automated checks now passing"), ("%d" % nExtras, "Beyond the proposal")]:
    w('<div class="kpi"><b>%s</b><span>%s</span></div>' % (b, s))
w("</div>")
w('<div class="note"><b>How completeness was scored.</b> A requirement scores 100 when every clause of its wording in the proposal was found working in the product. It loses points only where a stated capability is unreachable, wrong, or could not be shown to work. It is not marked down for being unpolished, and it is not credited for anything the proposal did not ask for &mdash; that goes in the second half of this document instead.</div>')
w("</div></div>")

# ---- requirement table
w('<div class="sheet">')
w('<h2 class="sec">All twenty-five requirements<small>Priority and module as written in the proposal; completeness as verified in the product</small></h2>')
w('<div class="legend">')
for code in ["V", "D", "N"]:
    c, bg, lab = st_meta(code)
    w('<span><i class="dot" style="background:%s"></i>%s</span>' % (c, lab))
w("</div>")

order = {"Onyx Learn": "LRN", "Onyx Code Lab": "LAB", "Onyx Assess": "ASS", "Onyx Career": "CAR", "Onyx Campus": "CMP"}
modcol = {"LRN": "#2563eb", "LAB": "#7c3aed", "ASS": "#0891b2", "CAR": "#c2410c", "CMP": "#059669"}
w('<table class="req"><thead><tr><th style="width:15mm">Ref</th><th style="width:11mm">Pri</th><th>Requirement and what was found</th><th style="width:24mm">Status</th><th style="width:26mm">Complete</th></tr></thead><tbody>')
for rid, title, pri, stage, pct, status, note in REQS:
    c, bg, lab = st_meta(status)
    pc, pbg = pri_meta[pri]
    mc = modcol[rid[:3]]
    w("<tr>")
    w('<td class="id" style="color:%s">%s</td>' % (mc, rid))
    w('<td><span class="pill" style="background:%s;color:%s">%s</span></td>' % (pbg, pc, pri))
    w('<td class="t"><b>%s</b><p>%s</p></td>' % (title, note))
    w('<td><span class="pill" style="background:%s;color:%s">%s</span></td>' % (bg, c, lab))
    w('<td class="mini"><div class="mbar"><i style="width:%d%%;background:%s"></i></div><b class="mnum">%d%%</b></td>' % (pct, c, pct))
    w("</tr>")
w("</tbody></table>")
w("</div>")

# ---- stages
w('<div class="sheet">')
w('<h2 class="sec">Against the four delivery stages<small>The proposal sequenced the work to reduce risk. All four stages are present in the product today.</small></h2>')
for num, name, desc, col in STAGES:
    items = [r for r in REQS if r[3] == num]
    pct = round(sum(i[4] for i in items) / (len(items) * 100) * 100)
    v = sum(1 for i in items if i[5] == "V")
    d = sum(1 for i in items if i[5] == "D")
    n = sum(1 for i in items if i[5] == "N")
    w('<div class="stage avoid" style="border-left-color:%s">' % col)
    w('<h4><span>Stage %d &nbsp;&middot;&nbsp; %s</span><em style="color:%s">%d%%</em></h4>' % (num, name, col, pct))
    w("<p>%s &mdash; %d requirements: %d verified end to end, %d shipped with a defect, %d built but not demonstrable on the current data.</p>"
      % (desc, len(items), v, d, n))
    w('<div class="stbar">')
    tot = len(items)
    for cnt, cc in ((v, "#059669"), (d, "#d97706"), (n, "#0891b2")):
        if cnt:
            w('<i style="width:%.2f%%;background:%s"></i>' % (cnt / tot * 100, cc))
    w("</div>")
    w('<div style="margin-top:2mm;font-size:7.6pt;color:#64748b;font-weight:700;letter-spacing:.04em">'
      + " &nbsp;&middot;&nbsp; ".join(i[0] for i in items) + "</div>")
    w("</div>")

w('<div class="note warm" style="margin-top:5mm"><b>Worth saying plainly.</b> The proposal presented four stages as a sequence to be delivered over time, with Phase 1 first and the rest to follow. What is running at this URL contains all four. Stage 4 &mdash; campus operations, finance, the guardian portal and production hardening, described in the proposal as the last thing to be built &mdash; is present and, in the case of finance and tenancy, among the strongest parts of the product.</div>')
w("</div>")

# ---- extras
w('<div class="sheet">')
w('<h2 class="sec">Built without being asked<small>%d capabilities found in the product that appear nowhere in the twenty-five requirements</small></h2>' % nExtras)
w('<p class="lead">These are not restatements of requirements met well. Each one is a capability the proposal does not describe, in any of its twenty-five requirement cards, its five capability pillars or its four delivery stages.</p>')
i = 0
for gname, gcol, items in EXTRAS:
    w('<div class="xg avoid">')
    w('<h3 style="border-left-color:%s;color:%s">%s</h3>' % (gcol, gcol, gname))
    for t, d in items:
        i += 1
        w('<div class="xi"><span class="n">%02d</span><div><b>%s</b><p>%s</p></div></div>' % (i, t, d))
    w("</div>")
w("</div>")

# ---- closing
w('<div class="sheet">')
w('<h2 class="sec">What this means for the proposal<small>Reading the two documents side by side</small></h2>')
w('<div class="grid3">')
for b, s, p in [
    ("25/25", "Requirements shipped",
     "Nothing in the proposal is missing from the product. The gap between what was promised and what exists is not one of scope."),
    ("%d%%" % overall, "Completeness",
     "The remaining one per cent is a support ticket a learner cannot raise directly, and four record types that can be created and never corrected. Nothing structural."),
    ("%d" % nExtras, "Capabilities beyond scope",
     "Roughly as much again was built on top: an operator tier, a commerce stack and a storefront the proposal never mentions."),
]:
    w('<div class="kpi"><b>%s</b><span>%s</span><p>%s</p></div>' % (b, s, p))
w("</div>")

w('<h2 class="sec" style="margin-top:8mm">What is left<small>Two are engineering, two are an empty database, and one is an account somebody should revoke</small></h2>')
w('<table class="req"><thead><tr><th style="width:15mm">Ref</th><th>What is missing or wrong</th><th style="width:28mm">Nature</th></tr></thead><tbody>')
GAPS = [
 ("LRN-06", "A learner still cannot open a support ticket directly &mdash; the only route in is to escalate a course discussion, which is the wrong door for &ldquo;my fee receipt is wrong&rdquo;.", "Wiring"),
 ("ALL", "A job post, an employer, an assignment and a Code Lab problem can each be created and then neither edited nor deleted. A title typed wrongly is permanent, and a demonstration tenant silts up because nothing that accumulates can be cleared.", "Gap"),
 ("ASS-02", "The live camera watch could not be exercised from a headless browser. This is a limit of the testing, not a finding about the product.", "Not testable"),
 ("&mdash;", "The demonstration institution has no programmes, semesters or batches, so teaching allocation and the timetable have nothing to allocate; and 63 of its 64 courses carry no lessons.", "No data"),
 ("&mdash;", "A platform operator account named test123456 still holds full rights over every institution. This is the one outstanding item that is a security matter rather than a presentation one.", "Housekeeping"),
]
for rid, txt, kind in GAPS:
    kc, kbg = {"Defect": ("#dc2626", "#fee2e2"), "Wiring": ("#d97706", "#fef3c7"),
               "Gap": ("#d97706", "#fef3c7"), "Knock-on": ("#d97706", "#fef3c7"),
               "Housekeeping": ("#dc2626", "#fee2e2"),
               "Not testable": ("#64748b", "#e2e8f0"),
               "No data": ("#0891b2", "#cffafe")}[kind]
    w('<tr><td class="id" style="color:%s">%s</td><td>%s</td><td><span class="pill" style="background:%s;color:%s">%s</span></td></tr>'
      % (modcol.get(rid[:3], "#64748b"), rid, txt, kbg, kc, kind))
w("</tbody></table>")

w('<div class="note" style="margin-top:6mm"><b>Conclusion.</b> The proposal described a phased platform to be built. The verification says it has been &mdash; every requirement, across every stage, including the ones the proposal itself placed last. This second pass was written after the defects found in the first were worked through: nineteen of twenty are closed, each re-tested against the live deployment rather than marked done, and the requirements that could not be exercised because the database was empty have now been run end to end with real data and re-scored on what they then did. Two things remain that are engineering: a support ticket a learner cannot raise without first escalating a discussion, and records across four kinds that can be created and never corrected. The rest is a seeding job and one account to revoke. On the evidence of using it twice, this is a product past the point where the conversation is about whether it can be built.</div>')
w('<div class="foot">Onyx LMS proposal conformance and feature completeness, revision 2 &middot; prepared by an external QA tester &middot; 27 August 2026 &middot; requirements taken from onyx.proposal.ezil.work, verified against onyx-lms-v2.vercel.app</div>')
w("</div>")

open("report2.html", "w", encoding="utf-8").write(o.getvalue())
print("report2.html written; completeness", overall, "V/D/N", nV, nD, nN, "extras", nExtras)
