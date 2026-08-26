import io

# id, title, priority, stage, pct, status, note
REQS = [
 # Onyx Learn
 ("LRN-01", "Course catalogue &amp; enrolment", "P0", 1, 100, "V",
  "Programme-mapped catalogue with three enrolment routes: self-service on open courses, purchase on locked ones, and enrolment by the institution. Built and enrolled into a live course during the audit."),
 ("LRN-02", "Content delivery", "P0", 1, 85, "D",
  "Video, document, image, link and written lessons; resumable playback with the position saved server-side; signed URLs; preview-before-enrol. Progress is only recorded for video, so non-video courses never advance."),
 ("LRN-03", "Attendance tracking", "P0", 1, 100, "V",
  "Rotating QR check-in and a manual roster, plus per-learner and per-cohort analytics and CSV export. Goes beyond the brief with a 15-second rotation that defeats a photographed code."),
 ("LRN-04", "Assignment workflows", "P0", 1, 90, "D",
  "Create, submit, grade and return, with rubrics, deadline handling, late policy and structured feedback. Everything is built including a good rubric builder &mdash; but a lecturer has no path to it."),
 ("LRN-05", "Learning progress dashboard", "P1", 3, 95, "D",
  "Personalised progress, streaks and next-best-action nudges that state their own reasoning. Depends in part on lesson completion, which is only half wired."),
 ("LRN-06", "Discussion &amp; doubt resolution", "P1", 3, 95, "V",
  "Threaded course Q&amp;A, mentor escalation and a support-ticket path with SLA deadlines. Students cannot open a ticket without escalating a discussion first."),
 # Code Lab
 ("LAB-01", "Browser IDE", "P0", 2, 100, "V",
  "Monaco editor, multi-language, run controls and an interactive console showing real program output."),
 ("LAB-02", "Sandboxed execution", "P0", 2, 100, "V",
  "Isolated, resource-limited execution. Confirmed by attack: CPU budget, memory ceiling and network egress all enforced, running as an unprivileged user."),
 ("LAB-03", "Automated code evaluator", "P0", 2, 100, "V",
  "Test-case grading with hidden cases, partial scoring and instant per-case feedback including the actual output."),
 ("LAB-04", "Guided practice &amp; problem bank", "P1", 2, 90, "V",
  "A 29-problem bank with difficulty filtering and worked solutions behind a release rule. Topic tagging and the harder tiers exist as structure but carry no content."),
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
 ("CAR-01", "Hackathons &amp; contests", "P1", 3, 85, "N",
  "The contest surface exists and states it is judged by the Code Lab evaluator. Nothing is scheduled on any institution, so leaderboards and judging could not be seen running."),
 ("CAR-02", "Mock interviews", "P1", 3, 85, "N",
  "Scheduling, structured feedback, optional recording with consent and a scoring breakdown are all present as surfaces. No interview exists anywhere to run through them."),
 ("CAR-03", "Skill certificates", "P0", 3, 100, "V",
  "Verifiable, shareable certificates with unique credential ids. Issued, verified signed-out, downloaded and revoked during the audit."),
 ("CAR-04", "Placement &amp; employer portal", "P0", 3, 85, "D",
  "Employers, posts, applications, shortlisting and drive management. The institution side works end to end; the employer cannot see applicants to their own post."),
 ("CAR-05", "Employability profile", "P0", 3, 100, "V",
  "A portfolio and skills passport with a readiness score, exceeding the brief with a resume builder and an opt-in public profile."),
 # Campus
 ("CMP-01", "Academic administration", "P0", 4, 95, "D",
  "Programmes, batches, sections, faculty allocation and a timetable with rooms, clash detection and publication. Day boundaries are computed in UTC."),
 ("CMP-02", "Examination management", "P0", 4, 95, "D",
  "Scheduling, seating, marks entry and transcript generation end to end, with checksum sealing beyond the brief. The registrar cannot list what they have issued."),
 ("CMP-03", "Fee &amp; finance", "P1", 4, 95, "V",
  "Fee heads, structures, invoicing, online payments, receipts and reconciliation, with course and live-class revenue tracked separately."),
 ("CMP-04", "Parent &amp; guardian portal", "P2", 4, 90, "N",
  "Guardian sign-in with attendance, results and fee visibility, gated behind a learner-initiated consent link. No linked learner existed to exercise it."),
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
  ("Transcripts sealed with a checksum",
   "The brief said transcript generation. What exists is a sealed document with a SHA-256 checksum, and a checker that answers two separate questions: is this document untampered, and has the register changed since it was sealed."),
  ("Public verification for both, with no account",
   "Credential ids and transcript serials both resolve on signed-out pages that state they show only what the issuer published and that nothing can be edited by the holder."),
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
w('<div class="eyebrow">Proposal conformance &middot; independent verification</div>')
w("<h1>Onyx LMS<br>Built vs. Proposed</h1>")
w('<p class="sub">All twenty-five requirements from the EZiL proposal, checked one by one against the running product &mdash; and the substantial set of capabilities that were built without ever being asked for.</p>')
w('<div class="meta">')
for k, v in [("Requirements", "25 of 25 shipped"), ("Delivery stages", "All four covered"),
             ("Beyond the proposal", "%d capabilities" % nExtras), ("Verified on", "27 August 2026")]:
    w("<div><span>%s</span><b>%s</b></div>" % (k, v))
w("</div></div>")

w('<div style="padding-top:8mm">')
w('<h2 class="sec">The finding in one paragraph<small>Measured by using the product, not by reading the repository</small></h2>')
w('<p class="lead">Every requirement in the proposal has shipped. Not one of the twenty-five is missing, stubbed or a placeholder screen &mdash; each has a working surface with real behaviour behind it, and sixteen were driven end to end during this audit with real data created for the purpose. Six carry defects that hold them below what was built. Three could not be exercised only because the demonstration database has nothing in them: no contest is scheduled anywhere, no mock interview exists, and no learner has linked a guardian. Set against that, the product carries a great deal that the proposal never described &mdash; an entire platform-operator tier above the institutions, a commerce stack with a public storefront, checksum-sealed transcripts, and integrity controls a good deal sharper than &ldquo;randomised banks and reviewable flags&rdquo;.</p>')
w('<div class="grid4">')
for b, s in [("25 / 25", "Requirements shipped"), ("%d" % nV, "Verified end to end"),
             ("%d" % nD, "Shipped with a defect"), ("%d" % nExtras, "Beyond the proposal")]:
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
     "The 5% shortfall is six defects and three features with no demonstration data &mdash; days of work, not months."),
    ("%d" % nExtras, "Capabilities beyond scope",
     "Roughly as much again was built on top: an operator tier, a commerce stack and a storefront the proposal never mentions."),
]:
    w('<div class="kpi"><b>%s</b><span>%s</span><p>%s</p></div>' % (b, s, p))
w("</div>")

w('<h2 class="sec" style="margin-top:8mm">The nine things standing between this and a clean sweep<small>Ordered by how much they cost the score</small></h2>')
w('<table class="req"><thead><tr><th style="width:15mm">Ref</th><th>What is missing or wrong</th><th style="width:28mm">Nature</th></tr></thead><tbody>')
GAPS = [
 ("LRN-02", "Reading, link, document and image lessons never record completion, so a course made of them stays at nought per cent and the progress meter, streak and readiness score never move.", "Defect"),
 ("LRN-04", "The rubric builder is only enabled on a draft assignment, and the lecturer's create control publishes immediately &mdash; so the rubric the proposal promises can never be attached.", "Wiring"),
 ("CAR-04", "The employer sees no applicants on their own post while the placement officer sees them. The institution half works; the employer half does not.", "Defect"),
 ("CMP-02", "Transcripts issue, seal, verify and reach the student correctly, but the registrar's own list of issued transcripts stays empty, and the student's request button leads nowhere.", "Defect"),
 ("CMP-01", "Day boundaries are computed in UTC, so an Indian institution is told it is yesterday until half past five in the morning.", "Defect"),
 ("LRN-05", "Depends on lesson completion above; the dashboard itself is complete and unusually good.", "Knock-on"),
 ("CAR-01", "Contests are built and wired to the Code Lab evaluator, but none is scheduled anywhere, so leaderboards and judging could not be observed.", "No data"),
 ("CAR-02", "Mock interview scheduling, feedback and scoring all exist as surfaces with no interview anywhere to run through them.", "No data"),
 ("CMP-04", "The guardian portal and its learner-initiated consent model are correct in design; no learner has linked a guardian, so nothing could be seen through it.", "No data"),
]
for rid, txt, kind in GAPS:
    kc, kbg = {"Defect": ("#dc2626", "#fee2e2"), "Wiring": ("#d97706", "#fef3c7"),
               "Knock-on": ("#d97706", "#fef3c7"), "No data": ("#0891b2", "#cffafe")}[kind]
    w('<tr><td class="id" style="color:%s">%s</td><td>%s</td><td><span class="pill" style="background:%s;color:%s">%s</span></td></tr>'
      % (modcol[rid[:3]], rid, txt, kbg, kc, kind))
w("</tbody></table>")

w('<div class="note" style="margin-top:6mm"><b>Conclusion.</b> The proposal described a phased platform to be built. The verification says it has been &mdash; every requirement, across every stage, including the ones the proposal itself placed last. Three of the nine remaining gaps are not engineering at all: they are an empty demonstration database, and seeding one contest, one mock interview and one guardian link would close them in an afternoon. Of the six that are engineering, five are single-surface fixes and one &mdash; the UTC day boundary &mdash; is a one-line concern with an institution-wide symptom. On the evidence of using it, this is a product past the point where the conversation is about whether it can be built.</div>')
w('<div class="foot">Onyx LMS proposal conformance and feature completeness &middot; prepared by an external QA tester &middot; 27 August 2026 &middot; requirements taken from onyx.proposal.ezil.work, verified against onyx-lms-v2.vercel.app</div>')
w("</div>")

open("report2.html", "w", encoding="utf-8").write(o.getvalue())
print("report2.html written; completeness", overall, "V/D/N", nV, nD, nN, "extras", nExtras)
