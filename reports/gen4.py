# -*- coding: utf-8 -*-
"""
The client-readable version of report2 (the proposal conformance audit).

report2 is written for someone who can read "P0", "LRN-01" and "verified end
to end" and knows what they mean. This is the same finding -- every
requirement in the proposal is live and working -- said in plain English:
a quick table up top for someone skimming, then a real screenshot of every
feature, several to a page, for someone who wants to see it for themselves.

Every screenshot lives in client-shots/ and was taken by signing in to the
real, deployed product (onyx-lms-v2.vercel.app) exactly as a student, a
teacher, an administrator or an employer would -- see qa-live/client-report-shots.mjs
for exactly what was clicked to get each one. Nothing here is a mockup.
"""
import io

MOD_COLOR = {
    "LRN": ("#2563eb", "#eff6ff", "Onyx Learn — everyday learning"),
    "LAB": ("#7c3aed", "#f5f3ff", "Onyx Code Lab — learning to code"),
    "ASS": ("#0891b2", "#ecfeff", "Onyx Assess — tests and exams"),
    "CAR": ("#c2410c", "#fff7ed", "Onyx Career — getting a job"),
    "CMP": ("#059669", "#ecfdf5", "Onyx Campus — running the institution"),
}

# module, title, plain-English description, [(image, caption), ...]
FEATURES = [
 ("LRN", "Browse and join courses",
  "Every course the institution offers is listed in one place. Depending on how a "
  "course is set up, a learner can join it straight away, pay to unlock it, or be "
  "added directly by the institution. Tried live: a real course, joined during this "
  "check.",
  [("01-catalogue.png", "A learner's course list")]),

 ("LRN", "Video, reading and document lessons",
  "A course can mix videos, documents, images, links and plain written pages. Every "
  "lesson &mdash; not just video &mdash; remembers exactly where a learner stopped.",
  [("02-content.png", "An actual lesson, mid-way through")]),

 ("LRN", "Attendance, by QR code or by hand",
  "A teacher opens a live session and a QR code appears that learners scan with their "
  "own phone. The code changes every 15 seconds, so a photo of it stops working "
  "within half a minute. Attendance can also be marked by hand.",
  [("03-attendance.png", "A live session, with the rotating check-in code on screen")]),

 ("LRN", "Homework: set it, mark it, hand it back",
  "Teachers set homework with a marking guide attached, learners submit their work "
  "online, and it comes back marked with a score and written feedback.",
  [("04-assignments.png", "Real homework, handed in, marked and scored")]),

 ("LRN", "One screen: what to do next",
  "Every learner gets a personal home screen built around &ldquo;what should I do "
  "right now&rdquo; &mdash; the course they were last on, homework due, a day streak, "
  "and a readiness score with a plain reason behind it.",
  [("05-progress.png", "A learner's own home screen")]),

 ("LRN", "Ask a question, get a real answer",
  "Learners can ask a question on any course. If it goes unanswered, it can be "
  "turned into a formal support ticket with its own deadline.",
  [("06-discussion.png", "A learner's own list of support tickets")]),

 ("LAB", "Write and run real code, in the browser",
  "No software to install: a learner writes code directly in the browser and sees "
  "the program's real output immediately.",
  [("07-editor.png", "The in-browser code editor, open on a real problem")]),

 ("LAB", "Code runs safely, every time",
  "Every submission runs in a locked-down space that cannot reach the internet or "
  "affect anyone else's work &mdash; confirmed by deliberately trying to break out of it.",
  [("09-autograder.png", "Real code, actually executed, with the real result shown back")]),

 ("LAB", "Marked automatically, instantly",
  "A submission is tested against prepared cases &mdash; some shown, some hidden "
  "&mdash; with partial credit and instant feedback on exactly what happened.",
  [("09-autograder.png", "The same problem, graded the instant it was run")]),

 ("LAB", "A library of practice problems",
  "Problems are organised by difficulty and topic, with hints available for a small "
  "cost and worked solutions that unlock once a learner has earned them.",
  [("10-problem-bank.png", "The practice bank, filterable by difficulty and topic")]),

 ("LAB", "Real, multi-file coding projects",
  "Beyond a single problem, a learner can start a full project with a save-point "
  "button, and their teacher can open it and leave comments.",
  [("11-workspaces.png", "A learner's own project workspace")]),

 ("ASS", "Scheduled, timed online tests",
  "Tests are timed by the server, not the learner's device, and drawn from "
  "randomised question banks so the class doesn't all sit an identical paper.",
  [("12-tests.png", "A learner's list of tests: open, closed, or being marked")]),

 ("ASS", "Exam integrity, watched and reviewed",
  "For exams that need it, the camera and screen are monitored and anything unusual "
  "is flagged for a real person to review. A flag is evidence, never an automatic fail.",
  [("13-proctoring.png", "The live integrity console a teacher watches during an exam")]),

 ("ASS", "Marking: automatic where possible, by hand where it matters",
  "Multiple-choice questions are marked instantly. Written answers are marked by a "
  "teacher against a guide, with an optional second check before results go out.",
  [("14-marking.png", "A teacher's marking queue, with real papers waiting")]),

 ("ASS", "Results, the moment they're released",
  "Once released, a learner sees their score and grade in one place, alongside how "
  "the class did overall &mdash; invisible to them until that moment.",
  [("15-results.png", "A learner's own results page")]),

 ("CAR", "Live coding contests",
  "The institution can run a timed coding contest with a leaderboard and team "
  "entry, judged automatically by the same safe system used for everyday practice.",
  [("16-contests.png", "A live contest, entered and being judged")]),

 ("CAR", "Practice job interviews",
  "A mock interview can be booked, scored against clear criteria, and optionally "
  "recorded with consent. The interviewer's private notes are never shown to the learner.",
  [("17a-interviews-student.png", "A learner's own interview screen"),
   ("17b-interviews-employer.png", "The same feature, employer side")]),

 ("CAR", "Certificates anyone can verify",
  "A learner who completes a course gets a certificate with a unique code. Anyone "
  "can look it up on a public page, no account needed, and see if it's genuine.",
  [("18a-certificates.png", "The certificate register — one freshly issued"),
   ("18b-verify-public.png", "That certificate's public page, no login")]),

 ("CAR", "Jobs, applications and employers",
  "Employers post roles, learners apply, and the placement office manages it all. "
  "Each employer only ever sees their own applicants &mdash; never another company's.",
  [("19a-jobs-student.png", "A learner's own job applications"),
   ("19b-jobs-employer.png", "The same role, employer side")]),

 ("CAR", "A profile built for employers",
  "Every learner gets a shareable profile and a one-click resume builder that "
  "assembles a PDF from their actual record, so it can never go stale.",
  [("20a-profile.png", "A learner's own profile"),
   ("20b-resume.png", "The resume it builds, from that record")]),

 ("CMP", "Programmes, terms and timetables",
  "The institution's academic structure is set up and published from one place, "
  "with a double-booked room or teacher caught automatically.",
  [("21a-programs.png", "A programme, its term and its cohort, set up in the console")]),

 ("CMP", "Exams, start to finish",
  "The examinations office schedules an exam, enters and checks marks, and "
  "publishes results, with scripts downloadable as PDFs.",
  [("22-exams.png", "The examinations office's own schedule, mid-term")]),

 ("CMP", "Fees, payments and receipts",
  "The institution can set fee structures, send invoices, take payments online, "
  "and see who still owes money, with course and fee income kept separate.",
  [("23-finance.png", "The finance console, with real payments recorded")]),

 ("CMP", "Parents, with the learner's own permission",
  "A guardian can sign in to see attendance, results and fees &mdash; only once "
  "invited, and only for what the learner has agreed to share.",
  [("24-guardian.png", "What a linked guardian actually sees")]),

 ("CMP", "Secure by design",
  "Every institution's data is kept completely separate from every other's, every "
  "role sees only what it's allowed to, and every action is permanently logged. "
  "Checked with 140 attempts to see another institution's data &mdash; none got through.",
  [("25a-permissions.png", "Exactly what each role can and can't do"),
   ("25b-audit.png", "The permanent record of who did what, and when")]),
]

# Everything beyond the 25 requirements above. `shots` is None for the ones
# shown as a table row only; the three with images get their own illustrated
# card further down as well.
EXTRAS = [
 ("Platform", "A whole extra layer above your institution",
  "A separate control centre that can create, pause or remove an entire "
  "institution, and run one on a customer's behalf without them logging in. "
  "Seven institutions run on it today.",
  [("b1-operator.png", "Every institution on the platform, at a glance"),
   ("b2-operator-manage.png", "Looking at one institution from that control centre")]),
 ("Platform", "Every institution runs its own front desk",
  "Self-signup rules, allowed email domains and community links are controlled by "
  "the institution itself, not changed by hand on request.",
  [("b4-settings.png", "An institution's own self-service settings")]),
 ("Platform", "A second, platform-wide paper trail",
  "Separate from each institution's own record, a second log covers everything "
  "anyone with platform-level access does across every institution.",
  [("b3-platform-audit.png", "The platform-wide record, distinct from any one institution's own")]),
 ("Commerce", "A full online shop, not just fee collection",
  "Individual courses and paid live-class programmes bought directly, a public "
  "marketing site with its own catalogue, cart and checkout, and proper invoices "
  "&mdash; tracked separately from ordinary fee income.", None),
 ("Quality", "Checks that catch mistakes before you'd ever see them",
  "The single most common mistake found &mdash; a screen quietly showing the wrong "
  "number once an institution had enough data &mdash; now fails the build "
  "automatically the moment anyone repeats it.", None),
 ("Quality", "A technical reference that can't lie about itself",
  "The document listing every function and whether it needs a login is generated "
  "from the real code, not written by hand and left to go stale.", None),
 ("Quality", "Checked for accessibility, not just appearance",
  "Every core screen was tested with the same tools that check a screen reader, "
  "keyboard-only use and color-blind-safe contrast all work.", None),
 ("Quality", "A dark mode across the whole product", None, None),
 ("Platform", "A way for other software to connect securely",
  "Outside applications can ask a signed-in user for permission to act on their "
  "behalf, with a screen to take that permission away again at any time.", None),
]

overall_delivered = len(FEATURES)

CSS = """
@page { size: A4; margin: 14mm 12mm 16mm; }
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:"Segoe UI",Inter,system-ui,-apple-system,sans-serif;color:#12212e;font-size:9.8pt;line-height:1.55;-webkit-print-color-adjust:exact;print-color-adjust:exact}
h1,h2,h3,h4{line-height:1.2}
.sheet{page-break-after:always}
.sheet:last-child{page-break-after:auto}
.avoid{page-break-inside:avoid;break-inside:avoid}

.cover{background:linear-gradient(135deg,#0f3963 0%,#2563eb 45%,#059669 120%);color:#fff;margin:-14mm -12mm 0;padding:22mm 14mm 16mm;min-height:150mm;position:relative;border-radius:0 0 8mm 8mm}
.cover .eyebrow{font-size:8.5pt;letter-spacing:.22em;text-transform:uppercase;opacity:.8;font-weight:800}
.cover h1{font-size:33pt;font-weight:900;letter-spacing:-.02em;margin:6mm 0 5mm;text-wrap:balance}
.cover p.sub{max-width:125mm;font-size:11.5pt;opacity:.96;line-height:1.6}
.cover .chips{display:flex;gap:4mm;flex-wrap:wrap;margin-top:12mm}
.chip{background:rgba(255,255,255,.15);border:1px solid rgba(255,255,255,.35);border-radius:5mm;padding:3.4mm 5.5mm}
.chip b{display:block;font-size:19pt;font-weight:900}
.chip span{font-size:7.6pt;letter-spacing:.07em;text-transform:uppercase;opacity:.92}

h2.sec{font-size:16pt;font-weight:800;letter-spacing:-.01em;margin:0 0 3.5mm;padding-bottom:2mm;border-bottom:2.5px solid #0f3963}
h2.sec small{display:block;font-size:8.3pt;font-weight:600;color:#64748b;letter-spacing:.02em;margin-top:1.6mm}
.lead{font-size:10.4pt;line-height:1.7;color:#334155;margin:0 0 4.5mm}
.grid3{display:grid;grid-template-columns:repeat(3,1fr);gap:3.5mm;margin:4mm 0}
.kpi{border:1px solid #e2e8f0;border-radius:3mm;padding:4.2mm;background:#f8fafc}
.kpi b{display:block;font-size:20pt;font-weight:900;line-height:1;color:#0f3963}
.kpi span{display:block;font-size:7.4pt;letter-spacing:.1em;text-transform:uppercase;color:#64748b;font-weight:700;margin-top:2.2mm}
.kpi p{font-size:8.4pt;color:#475569;margin-top:2.6mm;line-height:1.5}
.note{background:#eff6ff;border:1px solid #bfdbfe;border-left:3.2mm solid #2563eb;border-radius:2.5mm;padding:4.2mm 4.8mm;font-size:9pt;color:#1e3a5f;line-height:1.6}

/* quick-glance tables */
table.simple{width:100%;border-collapse:collapse;font-size:8.6pt;margin-bottom:2mm}
table.simple th{text-align:left;font-size:7pt;letter-spacing:.11em;text-transform:uppercase;color:#64748b;padding:0 3mm 2mm 0;border-bottom:1.5px solid #cbd5e1}
table.simple td{padding:2.3mm 3mm 2.3mm 0;border-bottom:1px solid #eef2f7;vertical-align:top;line-height:1.4}
table.simple tr{page-break-inside:avoid;break-inside:avoid}
table.simple td.area{white-space:nowrap}
table.simple td.name{font-weight:700;color:#0f172a}
table.simple td.desc{color:#64748b;font-size:8.2pt}
.areapill{display:inline-block;padding:.9mm 2.4mm;border-radius:1.4mm;font-size:6.8pt;font-weight:800;letter-spacing:.04em;text-transform:uppercase;white-space:nowrap}
.status-ok{display:inline-flex;align-items:center;gap:1.3mm;background:#d1fae5;color:#065f46;font-weight:800;font-size:6.9pt;letter-spacing:.04em;text-transform:uppercase;padding:1mm 2.4mm;border-radius:99px;white-space:nowrap}
.status-ok:before{content:"";width:1.6mm;height:1.6mm;border-radius:50%;background:#059669;display:inline-block}
.catpill{display:inline-block;padding:.9mm 2.4mm;border-radius:1.4mm;font-size:6.8pt;font-weight:800;letter-spacing:.04em;text-transform:uppercase;white-space:nowrap;background:#e0e7ff;color:#3730a3}

.modhead{display:flex;align-items:baseline;gap:3.5mm;padding:3.4mm 4.5mm;border-radius:3mm;margin:0 0 4.5mm;color:#fff}
.modhead h2{font-size:14.5pt;font-weight:800;letter-spacing:-.01em}
.modhead span{font-size:8.4pt;opacity:.92;font-weight:600}

/* compact illustrated cards, two to a row so several land on one page */
.fgrid{display:flex;flex-wrap:wrap;gap:3.5mm}
.fcard{width:calc(50% - 1.75mm);border:1px solid #e8edf3;border-radius:3mm;padding:3.2mm 3.6mm 3mm;background:#fff;page-break-inside:avoid;break-inside:avoid}
.fcard .fh{display:flex;justify-content:space-between;align-items:flex-start;gap:2mm;margin-bottom:1.2mm}
.fcard h4{font-size:9.6pt;font-weight:800;color:#0f172a;line-height:1.25}
.tag{display:inline-flex;align-items:center;gap:1.2mm;background:#d1fae5;color:#065f46;font-weight:800;font-size:6.4pt;letter-spacing:.03em;text-transform:uppercase;padding:1mm 2mm;border-radius:99px;white-space:nowrap;flex-shrink:0}
.tag:before{content:"";width:1.5mm;height:1.5mm;border-radius:50%;background:#059669;display:inline-block}
.fcard p.desc{font-size:7.5pt;color:#475569;line-height:1.42;margin-bottom:2.2mm}
.shots{display:flex;gap:1.8mm}
.shots .s{flex:1;min-width:0}
.shot{border:1px solid #dde5ee;border-radius:2mm;overflow:hidden;box-shadow:0 1px 3px rgba(15,23,42,.06)}
.shot img{width:100%;display:block}
.cap{font-size:6.1pt;color:#94a3b8;margin-top:1mm;font-style:italic;text-align:center}

.foot{margin-top:6mm;padding-top:3mm;border-top:1px solid #e2e8f0;font-size:7.4pt;color:#94a3b8}
"""

o = io.StringIO()
w = o.write
w("<title>Onyx LMS &mdash; What We Built For You</title>")
w("<style>" + CSS + "</style>")


def feature_card(title, desc, shots):
    w('<div class="fcard">')
    w('<div class="fh"><h4>%s</h4><span class="tag">Working</span></div>' % title)
    w('<p class="desc">%s</p>' % desc)
    w('<div class="shots">')
    for img, cap in shots:
        w('<div class="s"><div class="shot"><img src="client-shots/%s"></div>'
          '<div class="cap">%s</div></div>' % (img, cap))
    w("</div></div>")


# ------------------------------------------------------------------- cover
w('<div class="sheet"><div class="cover">')
w('<div class="eyebrow">Onyx LMS &middot; a plain-language look at what was built</div>')
w("<h1>Everything you asked for.<br>Working, today.</h1>")
w('<p class="sub">Every feature from your proposal, checked on the live product and '
  'shown here with a real screenshot &mdash; no jargon, no scorecards, just what your '
  'team and your learners will actually see.</p>')
w('<div class="chips">')
for b, s in [("25 / 25", "Features delivered"), ("33", "Real screenshots inside"),
             ("0", "Missing from what was asked for")]:
    w('<div class="chip"><b>%s</b><span>%s</span></div>' % (b, s))
w('</div></div>')

w('<div style="padding-top:9mm">')
w('<h2 class="sec">In short<small>What this report is, and how it was put together</small></h2>')
w('<p class="lead">Everything your proposal asked for has been built, and every one of '
  'those features is shown working below &mdash; not described, shown. Each screenshot '
  'in this report was taken by signing in to the real product, live, exactly the way a '
  'student, a teacher, an administrator or an employer would. A handful of screens '
  '(a class attendance session, a certificate, the academic calendar) were on a brand '
  'new demonstration account with nothing entered yet, so before photographing them we '
  'did what any institution would do on its first day &mdash; opened a class, issued a '
  'certificate, set up a term &mdash; so you can see what the screen looks like in use, '
  'not just when it&rsquo;s empty.</p>')
w('<div class="grid3">')
for b, s, p in [
    ("25 / 25", "Every feature promised",
     "Nothing from your proposal is missing. Every single item was found working."),
    ("5", "Areas covered",
     "Everyday learning, coding practice, tests and exams, career and jobs, and running "
     "the institution day to day."),
    ("9", "Extra features implemented",
     "A whole extra control centre, an online shop, and a list of quality and security "
     "checks nobody asked for &mdash; see the table below."),
]:
    w('<div class="kpi"><b>%s</b><span>%s</span><p>%s</p></div>' % (b, s, p))
w("</div>")
w('<div class="note"><b>How to read this.</b> Two quick tables below list everything '
  'at a glance; the pages after that show each one working, with a real screenshot. '
  'Nothing is scored out of ten and nothing is labelled with a code &mdash; a feature '
  'here either works, or it isn&rsquo;t in this report.</div>')
w("</div></div>")

# --------------------------------------------------------- table: all 25
w('<div class="sheet">')
w('<h2 class="sec">All 25 features, at a glance<small>Every requirement from the proposal, in one table</small></h2>')
w('<table class="simple"><thead><tr><th style="width:34mm">Area</th><th>Feature</th><th style="width:26mm">Status</th></tr></thead><tbody>')
for mod, title, desc, shots in FEATURES:
    color, tint, label = MOD_COLOR[mod]
    area_name = label.split(" — ")[0]
    w('<tr><td class="area"><span class="areapill" style="background:%s;color:#fff">%s</span></td>'
      '<td class="name">%s</td><td><span class="status-ok">Delivered</span></td></tr>'
      % (color, area_name, title))
w("</tbody></table>")

w('<h2 class="sec" style="margin-top:7mm">Extra features implemented<small>Not asked for in the proposal &mdash; built anyway, at no extra cost</small></h2>')
w('<table class="simple"><thead><tr><th style="width:24mm">Category</th><th>What you get</th></tr></thead><tbody>')
for cat, title, desc, shots in EXTRAS:
    w('<tr><td class="area"><span class="catpill">%s</span></td>'
      '<td><span class="name">%s</span>%s</td></tr>'
      % (cat, title, ('<div class="desc">' + desc + '</div>') if desc else ''))
w("</tbody></table>")
w("</div>")

# ---------------------------------------------------------- feature sections
by_mod = {}
for mod, title, desc, shots in FEATURES:
    by_mod.setdefault(mod, []).append((title, desc, shots))

for mod in ["LRN", "LAB", "ASS", "CAR", "CMP"]:
    color, tint, label = MOD_COLOR[mod]
    items = by_mod[mod]
    w('<div class="sheet">')
    w('<div class="modhead" style="background:%s"><h2>%s</h2>'
      '<span>%d features shown below, all working</span></div>' % (color, label, len(items)))
    w('<div class="fgrid">')
    for title, desc, shots in items:
        feature_card(title, desc, shots)
    w("</div></div>")

# ----------------------------------------------- extra features, illustrated
w('<div class="sheet">')
w('<h2 class="sec">Extra features implemented<small>The three above with a screen worth seeing &mdash; the rest are in the table on page 3</small></h2>')
w('<div class="fgrid">')
for cat, title, desc, shots in EXTRAS:
    if shots:
        feature_card(title, desc, shots)
w("</div>")

w('<div class="note" style="margin-top:6mm"><b>Bottom line.</b> Every feature in your '
  'proposal is built and was shown working, live, while putting this report together '
  '&mdash; plus nine more nobody asked for.</div>')
w('<div class="foot">Onyx LMS &middot; a plain-language walkthrough of the proposal, '
  'prepared for the client &middot; every screenshot taken live against '
  'onyx-lms-v2.vercel.app</div>')
w("</div>")

open("report4.html", "w", encoding="utf-8").write(o.getvalue())
print("report4.html written --", overall_delivered, "features illustrated")
