# -*- coding: utf-8 -*-
"""
The feature book: the third and quietest of the three client documents.

report4 is the plain-language conformance report. report5 is the showcase --
dark, full-bleed, loud. This one is the opposite of loud: white paper, black
type, colour only ever in the words themselves and never behind them. The
requirements list is a list, not a dashboard.

The other difference is what counts as an "extra". report5 listed nine, and
five of them were engineering (a build check, a generated reference, a test
suite) -- true, but not things a client can hold. This document lists 21
extras and every one of them is a capability somebody can use: an operator
console, parallel exam papers, anonymous marking, a resume builder, a
storefront. Each is taken from the verified extras in report2.

Feature data is read straight out of gen5.py so the two documents can never
drift apart.

    python gen6.py && node topdf5.mjs report6.html Onyx-LMS-Feature-Book.pdf
"""
import io

_src = open("gen5.py", encoding="utf-8").read()
_ns = {}
exec(_src.split("# category, title, description")[0], _ns)   # MODULES + FEATURES only
MODULES = _ns["MODULES"]
FEATURES = _ns["FEATURES"]

# Extras, grouped the way a reader would ask for them: who is it for, what is
# it. Every entry is a capability, not an engineering practice.
EXTRA_GROUPS = [
 ("For your learners", "#1d4ed8", [
  ("A resume builder, and a profile worth sharing",
   "A learner assembles an A4 resume from their own record in one click. It is rebuilt "
   "from live data every time, so it cannot go stale, and they can switch on a public "
   "profile page to send an employer.",
   [("20b-resume.png", "/onyx/resume", "Built from the record itself, not a stored copy")]),
  ("A readiness score that explains itself",
   "Not just a number out of a hundred. The points still unearned are broken out and "
   "ranked, so a learner is told which single thing is worth the most to them right now.",
   [("05-progress.png", "/onyx/dashboard", "The score, with its own reasoning beside it")]),
  ("Web-page problems, not only code problems",
   "Alongside ordinary exercises a learner can be set an HTML, CSS and JavaScript build "
   "with a live preview of the page they are making, marked by a person who sees the "
   "rendered result.", None),
 ]),
 ("For teaching", "#6d28d9", [
  ("A check-in code that defeats proxy attendance",
   "The proposal asked for a QR code or a paper register. What exists rotates the code "
   "every fifteen seconds and accepts it for its own cycle and the next only, so a "
   "photograph sent to a friend outside the room is useless within half a minute.",
   [("03-attendance.png", "/onyx/courses/593/attendance/601", "The code on the projector, redrawing itself")]),
  ("Questions that get closed, not just answered",
   "The learner who asked marks the reply that actually answered them, and useful "
   "answers are voted up. Anything still unanswered becomes a ticket with a deadline "
   "and an owner's name on it.", None),
  ("Cohorts can be retired, not only deleted",
   "A section that has moved on is closed so it stops appearing everywhere, without "
   "destroying the record of who was in it.", None),
 ]),
 ("For examinations", "#0e7490", [
  ("Parallel papers, rotated down the register",
   "The proposal asked for randomised banks. A bank here holds whole parallel papers, "
   "and a scheduled examination hands them out by roll number, so nobody within sight "
   "of a neighbour is sitting the same paper.", None),
  ("Anonymous marking, and a gate before publication",
   "A marker can be shown Candidate 1 rather than a name, and results can be held back "
   "until every attempt has been past a second pair of eyes.", None),
  ("Seating plans, and every script downloadable",
   "Halls are filled in seat order, and a candidate's script can be downloaded on its "
   "own or for the whole sitting at once.", None),
  ("Integrity flags a named person decides on",
   "Events carry weights and roll into a score banded high, medium and low, ordered "
   "worst first. Each is dismissed or upheld by a named person, the decision is kept, "
   "and the candidate can see the outcome.",
   [("13-proctoring.png", "/onyx/invigilate", "Ordered worst-first, waiting on a human decision")]),
 ]),
 ("For credentials", "#9a3412", [
  ("A certificate that keeps answering after it is withdrawn",
   "A revoked credential is never deleted. Its public page keeps resolving and says the "
   "credential was withdrawn &mdash; the only answer of any use to whoever is holding a "
   "copy of it.",
   [("18a-certificates.png", "/onyx/certificates", "In force and withdrawn, both kept on the register")]),
  ("Verification with no account at all",
   "Whoever is checking a certificate signs up for nothing. They open the page and it "
   "tells them what the issuer published, and nothing else.",
   [("18b-verify-public.png", "/onyx/verify/BB173F56...", "What a stranger sees, signed out")]),
 ]),
 ("For selling courses", "#047857", [
  ("Live Classes &mdash; paid cohort programmes",
   "Four-, twelve- and sixteen-week live programmes with their own pricing, paid "
   "registration and a named certificate at the end.", None),
  ("Courses sold one at a time",
   "A locked course carries a price and is bought before it opens, and that revenue is "
   "reported apart from institutional fee income.",
   [("23-finance.png", "/onyx/finance", "Course income, kept separate from fees")]),
  ("A complete public storefront",
   "A marketing site with its own catalogue and price filters, workshops, instructor "
   "pages, a knowledge base, cart, checkout, coupons, a wishlist, purchase history and "
   "invoices &mdash; effectively a second application beside the institutional one.", None),
 ]),
 ("For running the platform", "#3730a3", [
  ("An operator console above every institution",
   "Create, suspend or remove an entire institution &mdash; and, where a customer wants "
   "it, run theirs for them: their students, staff, courses, timetable, fees and help "
   "queue, without them ever signing in.",
   [("b1-operator.png", "/onyx/platform", "Every institution on the platform"),
    ("b2-operator-manage.png", "/onyx/platform/tenants/798", "One of them, run from above")]),
  ("Each institution's settings in its own hands",
   "Whether learners may register themselves, which email domains are accepted, the "
   "community link on the jobs page &mdash; changed by the institution, not by a "
   "support request.",
   [("b4-settings.png", "/onyx/settings", "An institution's own controls")]),
  ("A permission matrix anyone can read",
   "Ten areas of permission, editable for every role, written as plain sentences "
   "&mdash; with a reset to defaults, and wording that explains a tick grants the act, "
   "not the reach.",
   [("25a-permissions.png", "/onyx/permissions", "Every role against every permission")]),
  ("A record of what the platform team does",
   "Separate from each institution's own log: every change an operator makes anywhere, "
   "and the privileged reads too &mdash; opening somebody's grades is recorded against "
   "the operator's name.",
   [("b3-platform-audit.png", "/onyx/platform/audit", "The operator's own record")]),
  ("Other software can connect, with permission",
   "An outside application can ask a signed-in user for permission to act on their "
   "behalf, and that permission can be taken back at any time.", None),
  ("A dark theme across the whole product",
   "Every screen, not a subset, and checked for contrast in both themes.", None),
 ]),
]

nFeat = len(FEATURES)
nExtra = sum(len(g[2]) for g in EXTRA_GROUPS)

# White paper, black type. Colour appears only as text; nothing in this
# stylesheet paints a coloured background behind anything.
CSS = """
@page { size: A4; margin: 18mm 17mm 16mm; }
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:"Segoe UI",Inter,system-ui,-apple-system,sans-serif;color:#111418;
     font-size:10pt;line-height:1.6;-webkit-print-color-adjust:exact;print-color-adjust:exact}
h1,h2,h3,h4{line-height:1.16;letter-spacing:-.02em;font-weight:800}
.page{page-break-after:always}
.page:last-child{page-break-after:auto}
.avoid{page-break-inside:avoid;break-inside:avoid}
.rule{height:.35mm;background:#111418;margin:0}
.hair{height:.2mm;background:#d7dce3;margin:0}

/* ---------------------------------------------------------------- cover */
.cover{min-height:255mm;display:flex;flex-direction:column}
.cover .top{font-size:8pt;letter-spacing:.3em;text-transform:uppercase;font-weight:800;color:#111418}
.cover h1{font-size:41pt;margin:12mm 0 0;letter-spacing:-.035em;max-width:160mm}
.cover h1 span{color:#5b6472;display:block;font-weight:800}
.cover p.sub{margin-top:9mm;max-width:132mm;font-size:11.5pt;line-height:1.7;color:#3d454f}
.cover .areas{margin-top:11mm;border-top:.2mm solid #d7dce3}
.cover .areas div{display:flex;align-items:baseline;gap:5mm;padding:3.1mm 0;border-bottom:.2mm solid #d7dce3}
.cover .areas b{font-size:10.6pt;font-weight:800;width:44mm;flex-shrink:0}
.cover .areas span{flex:1;font-size:9.2pt;color:#5b6472}
.cover .areas em{font-style:normal;font-size:8pt;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:#5b6472;white-space:nowrap}
.cover .facts{margin-top:auto;display:flex;gap:0}
.cover .facts div{flex:1;padding-right:6mm}
.cover .facts b{display:block;font-size:26pt;font-weight:800;letter-spacing:-.03em;line-height:1}
.cover .facts span{display:block;margin-top:2.6mm;font-size:7.6pt;letter-spacing:.16em;
  text-transform:uppercase;color:#5b6472;font-weight:800}
.cover .sign{margin-top:9mm;font-size:8.4pt;color:#5b6472;line-height:1.7}

/* -------------------------------------------------------------- section */
.kicker{font-size:7.8pt;letter-spacing:.26em;text-transform:uppercase;font-weight:800;
  color:#5b6472;margin-bottom:3mm}
h2.sec{font-size:19pt;margin-bottom:4mm}
p.lead{font-size:10.4pt;line-height:1.68;color:#3d454f;max-width:158mm;margin-bottom:5mm}

/* ---------------------------------------------------- simple index list */
.cols{display:flex;gap:10mm;align-items:flex-start}
.cols .col{flex:1;min-width:0}
.grp{margin-bottom:6mm;page-break-inside:avoid;break-inside:avoid}
.grp h3{font-size:8.6pt;letter-spacing:.2em;text-transform:uppercase;margin-bottom:2mm}
.grp .row{display:flex;align-items:baseline;gap:4mm;padding:1.45mm 0;border-bottom:.2mm solid #e7eaef}
.grp .row .n{font-size:8.4pt;font-weight:800;color:#9aa3af;width:7mm;flex-shrink:0;
  font-variant-numeric:tabular-nums}
.grp .row .t{flex:1;font-size:9.6pt;font-weight:600}
.grp .row .d{font-size:7.6pt;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:#047857}

/* ------------------------------------------------------------- features */
.feat{margin-bottom:7mm;page-break-inside:avoid;break-inside:avoid}
.feat .n{font-size:8.6pt;font-weight:800;letter-spacing:.14em;margin-bottom:2mm}
.feat h3{font-size:13pt;margin-bottom:2mm}
.feat p{font-size:9.2pt;color:#3d454f;line-height:1.55;max-width:156mm;margin-bottom:3.4mm}
.shots{display:flex;gap:5mm}
.shots .s{flex:1;min-width:0}
.frame{border:.25mm solid #cfd6de;border-radius:1.5mm;overflow:hidden}
.frame img{width:100%;display:block}
.feat .frame{max-width:118mm}
.cap{font-size:7.2pt;color:#7a8492;margin-top:1.8mm;line-height:1.4}
.cap b{font-weight:600;color:#9aa3af}

/* --------------------------------------------------------------- extras */
.xgrp{margin-bottom:8mm}
.xgrp > h3{font-size:12pt;margin-bottom:1mm}
.xgrp > .sub{font-size:8pt;letter-spacing:.16em;text-transform:uppercase;color:#9aa3af;
  font-weight:800;margin-bottom:3.5mm}
.x{padding:3.5mm 0;border-top:.2mm solid #e7eaef;page-break-inside:avoid;break-inside:avoid}
.x h4{font-size:11pt;font-weight:800;margin-bottom:1.4mm}
.x p{font-size:9.2pt;color:#3d454f;line-height:1.6;max-width:156mm}
.x .n{font-size:7.6pt;font-weight:800;color:#9aa3af;letter-spacing:.12em;margin-bottom:1.2mm}
.x .shots{margin-top:3.5mm}
.x .frame{max-width:122mm}

/* -------------------------------------------------------------- closing */
.close h2{font-size:26pt;max-width:150mm;margin-bottom:6mm}
.close p{font-size:11pt;line-height:1.75;color:#3d454f;max-width:152mm;margin-bottom:5mm}
.foot{margin-top:10mm;padding-top:4mm;border-top:.2mm solid #d7dce3;font-size:7.8pt;color:#7a8492;line-height:1.7}
"""

o = io.StringIO()
w = o.write
w("<title>Onyx LMS &mdash; The Feature Book</title>")
w("<style>" + CSS + "</style>")

MOD = {m[0]: m for m in MODULES}


def frame(img, url, cap):
    w('<div><div class="frame"><img src="client-shots/' + img + '"></div>'
      '<div class="cap">' + cap + ' &nbsp;<b>' + url + '</b></div></div>')


def shots_block(shots):
    if not shots:
        return
    w('<div class="shots">')
    for img, url, cap in shots:
        w('<div class="s">')
        frame(img, url, cap)
        w('</div>')
    w('</div>')


# ------------------------------------------------------------------ cover
w('<div class="page"><div class="cover">')
w('<div class="rule"></div>')
w('<div class="top" style="margin-top:5mm">Onyx LMS &nbsp;&middot;&nbsp; The feature book</div>')
w('<h1>Twenty-five features asked for.<span>Twenty-one more that were not.</span></h1>')
w('<p class="sub">Everything in the proposal, and everything built on top of it, '
  'written out one by one with the real screen beside it. Nothing here is a plan or a '
  'design &mdash; every page is a photograph of the product as it runs today.</p>')
w('<div class="areas">')
for code, name, tag, color, dark, promise in MODULES:
    cnt = sum(1 for f in FEATURES if f[0] == code)
    w('<div><b>' + name + '</b><span>' + tag.lower() + '</span>'
      '<em>' + str(cnt) + ' features</em></div>')
w('</div>')
w('<div class="facts">')
for b, s in [(str(nFeat), "Requirements delivered"), (str(nExtra), "Extra features"),
             ("33", "Screens photographed"), ("8", "Kinds of user")]:
    w('<div><b>' + b + '</b><span>' + s + '</span></div>')
w('</div>')
w('<div class="sign">Prepared for the client.<br>'
  'Captured live against onyx-lms-v2.vercel.app, signed in as a student, a lecturer, '
  'an examinations officer, a placement officer, an employer, a guardian, an '
  'administrator and the platform operator.</div>')
w('<div class="rule" style="margin-top:6mm"></div>')
w('</div></div>')

# ---------------------------------------------------- the requirements list
w('<div class="page">')
w('<div class="kicker">Part one</div>')
w('<h2 class="sec">The twenty-five, as asked for</h2>')
w('<div class="rule" style="margin-bottom:5mm"></div>')
w('<p class="lead">Every requirement in the proposal, grouped the way the proposal '
  'grouped them. Each one is shown working later in this document, with the screen it '
  'was found on.</p>')
n = 0
w('<div class="cols"><div class="col">')
for mi, (code, name, tag, color, dark, promise) in enumerate(MODULES):
    if mi == 3:
        w('</div><div class="col">')
    items = [f for f in FEATURES if f[0] == code]
    w('<div class="grp">')
    w('<h3 style="color:' + dark + '">' + name + '</h3>')
    for mod, title, desc, shots in items:
        n += 1
        w('<div class="row"><span class="n">' + ('%02d' % n) + '</span>'
          '<span class="t">' + title + '</span>'
          '<span class="d">Delivered</span></div>')
    w('</div>')
w('</div></div>')
w('</div>')

# ------------------------------------------------------- the extras, listed
w('<div class="page">')
w('<div class="kicker">Part two</div>')
w('<h2 class="sec">The twenty-one that were never asked for</h2>')
w('<div class="rule" style="margin-bottom:5mm"></div>')
w('<p class="lead">None of these appear anywhere in the twenty-five requirements. They '
  'are not engineering practices or internal checks &mdash; each one is a capability '
  'somebody at your institution can open and use, and each is in the product today.</p>')
xn = 0
w('<div class="cols"><div class="col">')
for gi, (gname, gcolor, items) in enumerate(EXTRA_GROUPS):
    if gi == 3:
        w('</div><div class="col">')
    w('<div class="grp">')
    w('<h3 style="color:' + gcolor + '">' + gname + '</h3>')
    for title, desc, shots in items:
        xn += 1
        w('<div class="row"><span class="n">' + ('%02d' % xn) + '</span>'
          '<span class="t">' + title + '</span>'
          '<span class="d">Built</span></div>')
    w('</div>')
w('</div></div>')
w('</div>')

# ------------------------------------------------------ part three: the 25
num = 0
for code, name, tag, color, dark, promise in MODULES:
    items = [f for f in FEATURES if f[0] == code]
    w('<div class="page">')
    w('<div class="kicker" style="color:' + dark + '">' + tag + '</div>')
    w('<h2 class="sec">' + name + '</h2>')
    w('<div class="rule" style="margin-bottom:4mm"></div>')
    w('<p class="lead" style="margin-bottom:8mm">' + promise + '</p>')
    for mod, title, desc, shots in items:
        num += 1
        w('<div class="feat">')
        w('<div class="n" style="color:' + dark + '">' + ('%02d' % num)
          + ' &nbsp;&middot;&nbsp; Delivered</div>')
        w('<h3>' + title + '</h3>')
        w('<p>' + desc + '</p>')
        shots_block(shots)
        w('</div>')
    w('</div>')

# --------------------------------------------------- part four: the extras
w('<div class="page">')
w('<div class="kicker">Part four</div>')
w('<h2 class="sec">The extra features, one by one</h2>')
w('<div class="rule" style="margin-bottom:5mm"></div>')
w('<p class="lead">The same twenty-one, described properly. Where one has a screen of '
  'its own, it is here.</p>')

xn = 0
for gname, gcolor, items in EXTRA_GROUPS:
    w('<div class="xgrp">')
    w('<h3 style="color:' + gcolor + '">' + gname + '</h3>')
    w('<div class="sub">' + str(len(items)) + ' extra features</div>')
    w('<div class="rule" style="margin-bottom:1mm"></div>')
    for title, desc, shots in items:
        xn += 1
        w('<div class="x">')
        w('<div class="n">Extra ' + ('%02d' % xn) + '</div>')
        w('<h4>' + title + '</h4>')
        w('<p>' + desc + '</p>')
        shots_block(shots)
        w('</div>')
    w('</div>')
w('</div>')

# ----------------------------------------------------------------- closing
w('<div class="page"><div class="close">')
w('<div class="rule" style="margin-bottom:8mm"></div>')
w('<div class="kicker">In closing</div>')
w('<h2>Forty-six features, and a product you can open right now.</h2>')
w('<p>Twenty-five were promised in the proposal and twenty-five are running. '
  'Twenty-one more were built on top of them, and every one of those is something '
  'a learner, a lecturer, an examinations officer or your own operations team can '
  'use &mdash; not an internal engineering detail.</p>')
w('<p>Every screen in this document was opened, used and photographed in the live '
  'product while it was being written: a learner sat a practice problem and it was '
  'graded, a lecturer opened a register and the check-in code rotated on screen, a '
  'certificate was issued and then verified by somebody with no account at all.</p>')
w('<p style="font-weight:600;color:#111418">What is left is your content, your people '
  'and your calendar &mdash; not more software.</p>')
w('<div class="foot">Onyx LMS &middot; the feature book &middot; prepared for the '
  'client.<br>Requirements as written in the proposal; extras as verified during the '
  'independent quality review. Every image captured live against '
  'onyx-lms-v2.vercel.app.</div>')
w('</div></div>')

open("report6.html", "w", encoding="utf-8").write(o.getvalue())
print("report6.html written --", nFeat, "requirements,", nExtra, "extra features")
