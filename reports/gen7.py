# -*- coding: utf-8 -*-
"""
The flagship: Onyx, the platform. A single premium showcase PDF built to be
shown to universities and to be re-presented by the EZiL owner to their own
clients. Value and use cases first, every claim backed by a live screenshot.

Copy comes from the grounded content workflow (onyx-showcase-copy), written to
showcase-content.json. Screenshots are the same live captures in client-shots/.
This file owns only presentation: it never invents a claim.

    python gen7.py && node topdf5.mjs report7.html Onyx-Platform-Showcase.pdf
"""
import io, json, html

C = json.load(open("showcase-content.json", encoding="utf-8"))


def esc(s):
    return html.escape(str(s), quote=False)


# Pillar accent colours, in module order.
PILLAR = {
    "Onyx Learn":    ("#2563eb", "#60a5fa", "#eef4ff"),
    "Onyx Code Lab": ("#7c3aed", "#a78bfa", "#f5f1ff"),
    "Onyx Assess":   ("#0891b2", "#22d3ee", "#ecfbff"),
    "Onyx Career":   ("#c2410c", "#fb923c", "#fff4ec"),
    "Onyx Campus":   ("#059669", "#34d399", "#ecfdf5"),
}

# Screenshot -> the route it was taken from, for the browser-frame chrome.
URL = {
    "m1-landing": "onyx-edutech.app", "m3-door-tenant": "/onyx/login",
    "m4-door-platform": "/onyx/platform/login", "m5-onboard": "/onyx/platform",
    "05-progress": "/onyx/dashboard", "02-content": "/onyx/courses/…/lessons",
    "03-attendance": "/onyx/courses/…/attendance", "04-assignments": "/onyx/assignments",
    "07-editor": "/onyx/practice/…", "09-autograder": "/onyx/practice/…",
    "10-problem-bank": "/onyx/practice", "11-workspaces": "/onyx/workspaces",
    "12-tests": "/onyx/assessments", "13-proctoring": "/onyx/invigilate",
    "14-marking": "/onyx/assessments", "15-results": "/onyx/results",
    "16-contests": "/onyx/contests", "17b-interviews-employer": "/onyx/interviews",
    "18a-certificates": "/onyx/certificates", "18b-verify-public": "/onyx/verify/…",
    "19b-jobs-employer": "/onyx/jobs", "20a-profile": "/onyx/profile",
    "20b-resume": "/onyx/resume", "21a-programs": "/onyx/programs",
    "21b-timetable": "/onyx/timetable", "22-exams": "/onyx/exams",
    "23-finance": "/onyx/finance", "24-guardian": "/onyx/family",
    "25a-permissions": "/onyx/permissions", "25b-audit": "/onyx/audit",
    "b1-operator": "/onyx/platform", "b2-operator-manage": "/onyx/platform/tenants/…",
    "b3-platform-audit": "/onyx/platform/audit", "b4-settings": "/onyx/settings",
}

# Two hero screenshots per pillar.
PILLAR_SHOTS = {
    "Onyx Learn":    [("05-progress", "One screen that says what to do next"),
                      ("03-attendance", "Attendance by a code that rotates every 15 seconds")],
    "Onyx Code Lab": [("07-editor", "A real editor, running in the browser"),
                      ("09-autograder", "Graded the instant it runs, against hidden cases")],
    "Onyx Assess":   [("13-proctoring", "Integrity flags, ordered worst-first for a human"),
                      ("15-results", "Released to the learner in one place, when the institution says so")],
    "Onyx Career":   [("18b-verify-public", "A credential an employer verifies with no account"),
                      ("20b-resume", "A resume rebuilt from the record, never stale")],
    "Onyx Campus":   [("22-exams", "Examinations, scheduled to published"),
                      ("25a-permissions", "Every role against every permission, in plain words")],
}

# Extras themes -> a representative live screen, matched on the theme wording.
EXTRA_SHOT = [
    (("learner", "student"), "20b-resume"),
    (("teach", "lecturer", "attendance"), "03-attendance"),
    (("exam", "integrity", "invigil"), "13-proctoring"),
    (("credential", "certificate"), "18b-verify-public"),
    (("sell", "revenue", "commerce", "course"), "23-finance"),
    (("platform", "operator", "running"), "b1-operator"),
]


def extra_shot(name, used):
    low = name.lower()
    for keys, img in EXTRA_SHOT:
        if img not in used and any(k in low for k in keys):
            used.add(img)
            return img
    for _, img in EXTRA_SHOT:
        if img not in used:
            used.add(img)
            return img
    return "b4-settings"


DOTS = ('<i style="background:#ff5f57"></i><i style="background:#febc2e"></i>'
        '<i style="background:#28c840"></i>')


def frame(img, cap="", dark=False):
    url = URL.get(img, "onyx-lms-v2.vercel.app")
    cls = "frame ondark" if dark else "frame"
    out = ('<figure class="' + cls + '"><div class="bar">' + DOTS
           + '<span class="url">' + esc(url) + '</span></div>'
           + '<img src="client-shots/' + img + '.png" alt="">')
    if cap:
        out += '<figcaption>' + esc(cap) + '</figcaption>'
    out += '</figure>'
    return out


CSS = r"""
@page { size: A4; margin: 0; }
*{box-sizing:border-box;margin:0;padding:0}
:root{
  --ink:#0a0f1e; --ink2:#1b2440; --paper:#ffffff; --mut:#5b6373; --line:#e4e8ef;
  --accent:#2f6bff; --accent2:#7c3aed;
}
body{font-family:"Segoe UI",Inter,system-ui,-apple-system,sans-serif;color:var(--ink);
     font-size:9.9pt;line-height:1.6;-webkit-print-color-adjust:exact;print-color-adjust:exact}
h1,h2,h3,h4{line-height:1.12;letter-spacing:-.022em;font-weight:800}
.pg{page-break-after:always;padding:17mm 16mm 15mm;min-height:297mm;position:relative}
.pg:last-child{page-break-after:auto}
.bleed{page-break-after:always;min-height:297mm;position:relative;overflow:hidden}
.avoid{page-break-inside:avoid;break-inside:avoid}
.eyebrow{font-size:7.6pt;letter-spacing:.28em;text-transform:uppercase;font-weight:800;color:var(--accent)}
.pagemark{position:absolute;right:16mm;bottom:9mm;font-size:6.8pt;letter-spacing:.22em;
  text-transform:uppercase;color:#aab2c0;font-weight:700}
.pagemark.on-dark{color:rgba(255,255,255,.5)}

/* ------------------------------------------------------------------ cover */
.cover{background:
   radial-gradient(70% 55% at 78% 4%, rgba(124,58,237,.55) 0%, rgba(124,58,237,0) 55%),
   radial-gradient(60% 45% at 6% 96%, rgba(47,107,255,.55) 0%, rgba(47,107,255,0) 60%),
   linear-gradient(158deg,#060a17 0%,#0b1330 46%,#131a3d 72%,#2a1c54 100%);
  color:#fff;padding:24mm 16mm 16mm;display:flex;flex-direction:column}
.cover .brandrow{display:flex;align-items:center;gap:3mm;font-weight:800;font-size:11pt;letter-spacing:-.01em}
.cover .brandrow .dot{width:6mm;height:6mm;border-radius:2mm;
  background:linear-gradient(135deg,#38bdf8,#7c3aed)}
.cover .tag{margin-left:auto;font-size:7pt;letter-spacing:.22em;text-transform:uppercase;
  border:1px solid rgba(255,255,255,.34);border-radius:99px;padding:1.6mm 3.6mm;font-weight:800;color:#c7d2fe}
.cover .rule{width:22mm;height:1.3mm;border-radius:2mm;margin-top:18mm;
  background:linear-gradient(90deg,#38bdf8,#c026d3)}
.cover .kick{margin-top:6mm;font-size:8.4pt;letter-spacing:.3em;text-transform:uppercase;font-weight:800;color:#c7d2fe}
.cover h1{font-size:46pt;font-weight:900;letter-spacing:-.04em;margin-top:6mm;max-width:172mm}
.cover h1 em{font-style:normal;display:block;
  background:linear-gradient(92deg,#67e8f9,#a78bfa 46%,#f0abfc);-webkit-background-clip:text;background-clip:text;color:transparent}
.cover .sub{margin-top:8mm;max-width:130mm;font-size:12pt;line-height:1.62;color:#dbe3f4}
.cover .montage{margin-top:auto;display:flex;gap:0;align-items:flex-end;padding-bottom:2mm}
.cover .montage figure{flex:1;border-radius:2.6mm;overflow:hidden;border:1px solid rgba(255,255,255,.24);
  box-shadow:0 12mm 26mm rgba(0,0,0,.55);background:#0b1330}
.cover .montage figure:nth-child(1){transform:rotate(-2.2deg) translateY(4mm);z-index:1;margin-right:-5mm}
.cover .montage figure:nth-child(2){transform:rotate(-.7deg);z-index:3;margin-right:-4mm}
.cover .montage figure:nth-child(3){transform:rotate(.9deg);z-index:2;margin-right:-5mm}
.cover .montage figure:nth-child(4){transform:rotate(2.4deg) translateY(5mm);z-index:1}
.cover .montage img{width:100%;display:block}
.cover .foot{margin-top:9mm;display:flex;justify-content:space-between;align-items:center;
  border-top:1px solid rgba(255,255,255,.16);padding-top:5mm;font-size:7.8pt;color:#9fb0d4;letter-spacing:.04em}
.cover .foot b{color:#fff;font-weight:700}

/* --------------------------------------------------------------- headings */
h2.sec{font-size:23pt;margin:2mm 0 3mm;letter-spacing:-.03em}
p.lead{font-size:11pt;line-height:1.72;color:#333c4d;max-width:164mm}
.hr{height:.35mm;background:var(--ink);margin:5mm 0 6mm}
.hrthin{height:.2mm;background:var(--line);margin:5mm 0}

/* --------------------------------------------------------- stat / chips */
.stats{display:flex;gap:0;margin:7mm 0 0}
.stats>div{flex:1;padding-right:6mm}
.stats b{display:block;font-size:25pt;font-weight:900;letter-spacing:-.03em;line-height:1;
  background:linear-gradient(120deg,var(--accent),var(--accent2));-webkit-background-clip:text;background-clip:text;color:transparent}
.stats span{display:block;margin-top:2.4mm;font-size:7.2pt;letter-spacing:.13em;text-transform:uppercase;color:var(--mut);font-weight:800}
.chips{display:flex;flex-wrap:wrap;gap:2.2mm;margin-top:4mm}
.chip{font-size:8pt;font-weight:700;border:1px solid var(--line);border-radius:99px;padding:1.6mm 3.4mm;color:#33405c}
.chip.k{border-color:transparent;color:#fff}

/* --------------------------------------------------------- generic cards */
.two{display:flex;gap:6mm;align-items:flex-start}
.two>.col{flex:1;min-width:0}
.cards{display:flex;gap:4mm;flex-wrap:wrap}
.card{border:1px solid var(--line);border-radius:3mm;padding:4.5mm 5mm;flex:1;min-width:0}
.card h4{font-size:10.4pt;font-weight:800;margin-bottom:1.4mm}
.card p{font-size:8.7pt;color:#4a5364;line-height:1.55}
.card .num{font-size:8pt;font-weight:900;color:var(--accent);letter-spacing:.1em;margin-bottom:1.6mm}

/* ------------------------------------------------------------ browser frame */
.frame{border:1px solid #dce2ea;border-radius:2.6mm;overflow:hidden;background:#fff;
  box-shadow:0 2mm 7mm rgba(15,23,42,.10)}
.frame .bar{display:flex;align-items:center;gap:1.5mm;padding:1.7mm 3mm;background:#f1f4f9;border-bottom:1px solid #e5eaf1}
.frame .bar i{width:1.9mm;height:1.9mm;border-radius:50%;display:inline-block}
.frame .bar .url{margin-left:2mm;font-size:6.2pt;color:#96a0b1;letter-spacing:.02em;
  background:#fff;border:1px solid #e5eaf1;border-radius:99px;padding:.8mm 3mm;flex:1;white-space:nowrap;overflow:hidden}
.frame img{width:100%;display:block}
.frame figcaption{font-size:7pt;color:#7b8494;padding:2mm 3mm 2.6mm;line-height:1.4;font-style:italic}
.frame.ondark{border-color:rgba(255,255,255,.18);box-shadow:0 3mm 10mm rgba(0,0,0,.45)}

/* ---------------------------------------------------------- pillar spread */
.pillar .eyebrow{color:var(--pc)}
.pillar h2{font-size:22pt;margin:2mm 0 1mm}
.pillar .promise{font-size:9pt;color:var(--mut);margin-bottom:4mm;letter-spacing:.02em}
.pillar .val{font-size:12.5pt;font-weight:800;color:#111726;max-width:150mm;line-height:1.4;margin-bottom:2.6mm}
.pillar p.stmt{font-size:9.6pt;color:#3d4657;line-height:1.62;max-width:158mm;margin-bottom:4mm}
.pillar .heroes{display:flex;flex-wrap:wrap;gap:2mm;margin-bottom:6mm}
.pillar .heroes .chip{border-color:var(--pc);color:var(--pc);font-weight:700}
.uc{display:flex;gap:4mm;margin-bottom:6mm}
.uc .u{flex:1;border:1px solid var(--line);border-left:2.4mm solid var(--pc);border-radius:2.5mm;padding:3.6mm 4.2mm}
.uc .u h4{font-size:9.6pt;font-weight:800;margin-bottom:1.6mm}
.uc .u .s{font-size:8.4pt;color:#5b6373;line-height:1.5;margin-bottom:1.6mm}
.uc .u .o{font-size:8.6pt;color:#111726;line-height:1.52;font-weight:600}
.pillar .panel{border-radius:4mm;padding:6mm 6mm 5mm;background:var(--tint)}
.pillar .panel .plabel{font-size:7pt;letter-spacing:.2em;text-transform:uppercase;font-weight:800;
  color:var(--pc);margin-bottom:3.4mm}
.pillar .shots{display:flex;gap:4mm}
.pillar .shots .frame{flex:1;min-width:0}

/* ------------------------------------------------------------- dark pages */
.dark{background:
   radial-gradient(60% 50% at 90% 6%, rgba(124,58,237,.4) 0%, rgba(124,58,237,0) 60%),
   linear-gradient(160deg,#070c1b 0%,#0d1530 55%,#241a4d 100%);color:#fff;padding:18mm 16mm 16mm;min-height:297mm}
.dark .eyebrow{color:#a5b4fc}
.dark h2.sec{color:#fff}
.dark p.lead{color:#c7d2e8}
.dark .hr{background:linear-gradient(90deg,#38bdf8,#c026d3 45%,rgba(192,38,211,0))}
.dark .card{border-color:rgba(255,255,255,.16)}
.dark .card h4{color:#fff}
.dark .card p{color:#c0c9de}
.dark .card .num{color:#a5b4fc}

/* --------------------------------------------------------------- business */
.levers{display:flex;flex-direction:column;gap:0;margin:2mm 0 6mm}
.lever{display:flex;gap:5mm;align-items:baseline;padding:2.7mm 0;border-bottom:1px solid var(--line)}
.two.tight{gap:5mm}
.two.tight .frame{max-width:70mm;margin:0 auto}
.rail{padding:5mm 6mm 4mm}
.lever .ln{font-size:8.4pt;font-weight:900;color:var(--accent);width:8mm;flex-shrink:0}
.lever b{font-size:10.4pt;font-weight:800;width:52mm;flex-shrink:0}
.lever p{font-size:8.8pt;color:#4a5364;flex:1;line-height:1.5}
.rail{border:1px solid var(--line);border-radius:3.5mm;padding:6mm 7mm 5mm}
.rail .r{display:flex;gap:5mm;position:relative;padding-bottom:3.2mm}
.rail .r:last-child{padding-bottom:0}
.rail .r:before{content:"";position:absolute;left:2.6mm;top:6mm;bottom:0;width:.25mm;background:var(--line)}
.rail .r:last-child:before{display:none}
.rail .r .k{width:5.2mm;height:5.2mm;border-radius:50%;border:1px solid var(--accent);color:var(--accent);
  font-size:7pt;font-weight:900;display:flex;align-items:center;justify-content:center;flex-shrink:0;
  background:#fff;position:relative;z-index:1}
.rail .r p{font-size:8.8pt;color:#3d4657;line-height:1.5;padding-top:.6mm}

/* --------------------------------------------------------------- personas */
.journeys{display:flex;flex-wrap:wrap;gap:4mm}
.j{width:calc(50% - 2mm);border:1px solid var(--line);border-radius:3mm;padding:4.2mm 4.6mm;
  page-break-inside:avoid;break-inside:avoid}
.j .role{font-size:10pt;font-weight:800;margin-bottom:1.2mm}
.j .sc{font-size:8.4pt;color:#5b6373;line-height:1.5;margin-bottom:2.6mm}
.j ol{margin:0 0 2.6mm 0;padding:0;list-style:none;counter-reset:s}
.j ol li{counter-increment:s;position:relative;padding-left:7mm;font-size:8.4pt;color:#2c3546;
  line-height:1.5;margin-bottom:1.4mm}
.j ol li:before{content:counter(s);position:absolute;left:0;top:.2mm;width:4.6mm;height:4.6mm;
  border-radius:50%;background:var(--ink);color:#fff;font-size:6.6pt;font-weight:800;
  display:flex;align-items:center;justify-content:center}
.j .pay{font-size:8.5pt;font-weight:700;color:var(--accent);line-height:1.45;padding-top:2mm;border-top:1px solid var(--line)}

/* -------------------------------------------------------------- proof strip */
.proofgrid{display:flex;gap:4mm;margin-top:6mm;flex-wrap:wrap}
.proofgrid .p{flex:1 1 calc(50% - 2mm);border:1px solid rgba(255,255,255,.16);border-radius:3.5mm;padding:6mm 5.4mm;
  background:rgba(255,255,255,.03)}
.proofgrid .p:first-child{background:linear-gradient(140deg,rgba(56,189,248,.16),rgba(124,58,237,.2));
  border-color:rgba(165,180,252,.4)}
.proofgrid .p b{display:block;font-size:31pt;font-weight:800;letter-spacing:-.045em;line-height:1;
  background:linear-gradient(120deg,#67e8f9,#a78bfa);-webkit-background-clip:text;background-clip:text;color:transparent}
.proofgrid .p span{display:block;margin-top:2mm;font-size:7.4pt;letter-spacing:.11em;text-transform:uppercase;color:#a5b4fc;font-weight:800}
.proofgrid .p p{margin-top:2.6mm;font-size:8pt;color:#c0c9de;line-height:1.45}

/* --------------------------------------------------------------- closing */
.xc{width:calc(50% - 2mm);border:1px solid var(--line);border-radius:3.5mm;overflow:hidden;
  page-break-inside:avoid;break-inside:avoid}
.xc .mini{background:#f4f7fb;border-bottom:1px solid var(--line);padding:3.4mm 3.4mm 0;height:31mm;overflow:hidden}
.xc .mini img{width:100%;display:block;border-radius:1.6mm 1.6mm 0 0;border:1px solid #dfe5ee;border-bottom:0;
  box-shadow:0 2mm 5mm rgba(15,23,42,.12)}
.xc .body{padding:4mm 4.6mm 4.6mm}
.xc h4{font-size:10pt;font-weight:800;margin-bottom:1.4mm}
.xc p{font-size:8.5pt;color:#4a5364;line-height:1.52}
.close h2{font-size:30pt;max-width:150mm;letter-spacing:-.03em}
.close p{font-size:11pt;line-height:1.72;color:#c7d2e8;max-width:150mm;margin-top:5mm}
.close .owner{margin-top:8mm;border:1px solid rgba(255,255,255,.18);border-radius:3.5mm;padding:5.5mm 6mm}
.close .owner .k{font-size:7.4pt;letter-spacing:.2em;text-transform:uppercase;color:#a5b4fc;font-weight:800;margin-bottom:2mm}
.close .owner p{margin-top:0;color:#dbe3f4;font-size:9.6pt}
.close .sign{margin-top:auto;padding-top:6mm;font-size:8pt;color:#9fb0d4;letter-spacing:.04em}
"""


def build():
    o = io.StringIO()
    w = o.write
    w("<title>Onyx &mdash; The Platform</title>")
    w("<style>" + CSS + "</style>")

    pos, biz = C["positioning"], C["business"]
    extras, personas = C["extras"], C["personas"]
    diff, proof, closing = C["differentiators"], C["proof"], C["closing"]

    # ---------------------------------------------------------------- cover
    w('<div class="bleed cover">')
    w('<div class="brandrow"><span class="dot"></span>Onyx'
      '<span class="tag">One platform &middot; many institutions</span></div>')
    w('<div class="rule"></div>')
    w('<div class="kick">' + esc(pos["eyebrow"]) + '</div>')
    head = esc(pos["headline"].replace("\\n", "\n")).replace("\n", "<em>", 1)
    if "<em>" in head:
        head += "</em>"
    w('<h1>' + head + '</h1>')
    w('<p class="sub">' + esc(pos["subhead"]) + '</p>')
    w('<div class="montage">')
    for img in ["05-progress", "13-proctoring", "b1-operator", "23-finance"]:
        w('<figure><img src="client-shots/' + img + '.png" alt=""></figure>')
    w('</div>')
    w('<div class="foot"><span>Onyx LMS &middot; a live platform, shown as it runs</span>'
      '<span><b>25</b> features &nbsp;&middot;&nbsp; <b>21</b> extras &nbsp;&middot;&nbsp; '
      '<b>7</b> institutions live &nbsp;&middot;&nbsp; <b>1,507</b> members</span></div>')
    w('</div>')

    # ------------------------------------------------------- positioning page
    w('<div class="pg">')
    w('<div class="eyebrow">The idea</div>')
    w('<h2 class="sec">One system, not six that never agree</h2>')
    w('<div class="hr"></div>')
    w('<div class="two">')
    w('<div class="col">')
    w('<p class="lead">' + esc(pos["thesis"]) + '</p>')
    w('<div style="margin-top:7mm">')
    for s in pos["statements"]:
        w('<div class="avoid" style="margin-bottom:5mm">'
          '<div style="font-size:10.6pt;font-weight:800;color:#111726;margin-bottom:1mm">'
          + esc(s["k"]) + '</div>'
          '<div style="font-size:9.2pt;color:#4a5364;line-height:1.55">' + esc(s["v"]) + '</div></div>')
    w('</div></div>')
    w('<div class="col">' + frame("m1-landing", "The platform's own front page, live today") + '</div>')
    w('</div>')
    w('<div class="pagemark">Onyx &middot; the platform</div>')
    w('</div>')

    # -------------------------------------------------------- business model
    w('<div class="pg">')
    w('<div class="eyebrow">The business</div>')
    w('<h2 class="sec">' + esc(biz["title"]) + '</h2>')
    w('<div class="hr"></div>')
    w('<p class="lead" style="font-size:10.2pt">' + esc(biz["thesis"]) + '</p>')
    w('<div style="font-size:7.6pt;letter-spacing:.2em;text-transform:uppercase;color:#5b6373;'
      'font-weight:800;margin:7mm 0 1mm">How the money is made</div>')
    w('<div class="levers">')
    for i, lv in enumerate(biz["levers"], 1):
        w('<div class="lever"><span class="ln">%02d</span><b>%s</b><p>%s</p></div>'
          % (i, esc(lv["name"]), esc(lv["desc"])))
    w('</div>')
    w('<div class="two tight" style="margin-top:5mm">')
    w('<div class="col">' + frame("m5-onboard", "Standing up a new university, from the operator console") + '</div>')
    w('<div class="col">' + frame("23-finance", "Each institution's own revenue, course income kept apart from fees") + '</div>')
    w('</div>')
    w('<div style="font-size:7.6pt;letter-spacing:.2em;text-transform:uppercase;color:#5b6373;'
      'font-weight:800;margin:7mm 0 3mm">Onboarding a new institution</div>')
    w('<div class="rail">')
    for i, st in enumerate(biz["onboarding"], 1):
        w('<div class="r"><div class="k">%d</div><p>%s</p></div>' % (i, esc(st)))
    w('</div>')
    w('<div class="pagemark">Onyx &middot; the platform</div>')
    w('</div>')

    # ---------------------------------------------------------- two doors page
    w('<div class="pg">')
    w('<div class="eyebrow">How it is run</div>')
    w('<h2 class="sec">Two doors, cleanly separated</h2>')
    w('<div class="hr"></div>')
    w('<p class="lead">' + esc(biz["operator_value"]) + '</p>')
    w('<p class="lead" style="margin-top:4mm">The people who run the platform and the people '
      'who use an institution come in through different doors, and neither can wander into '
      'the other. One account works across every institution a person belongs to.</p>')
    w('<div class="two" style="margin-top:6mm">')
    w('<div class="col">' + frame("m3-door-tenant", "The institution door, for staff and learners") + '</div>')
    w('<div class="col">' + frame("m4-door-platform", "The operator door, for the platform team") + '</div>')
    w('</div>')
    w('<div class="cards" style="margin-top:7mm">')
    w('<div class="card"><div class="num">FOR THE OPERATOR</div><h4>Every institution, from above</h4>'
      '<p>Create, suspend or remove an institution, and run one on a customer\'s behalf '
      'when they ask, without ever needing their password.</p></div>')
    w('<div class="card"><div class="num">FOR THE INSTITUTION</div><h4>Its own front desk</h4>'
      '<p>Self-registration rules, allowed email domains and community links are set by '
      'the institution itself, not by a support ticket.</p></div>')
    w('<div class="card"><div class="num">FOR EVERY PERSON</div><h4>One account, one identity</h4>'
      '<p>A single sign-in that carries a person across every institution they belong '
      'to, with the right role in each.</p></div>')
    w('</div>')
    w('<div class="pagemark">Onyx &middot; the platform</div>')
    w('</div>')

    # ---------------------------------------------------- pillar section opener
    w('<div class="pg">')
    w('<div class="eyebrow">What is inside</div>')
    w('<h2 class="sec">Five pillars, one roster,<br>one calendar, one record</h2>')
    w('<div class="hr"></div>')
    w('<p class="lead">The next five pages walk each part of the platform, value first, '
      'with the real screen beside it. They are not five products bolted together, they '
      'are one system: a mark entered in an exam, a lesson finished, a fee paid and a '
      'certificate issued all move the same learner\'s record.</p>')
    w('<div class="cards" style="margin-top:8mm">')
    for name, tag, promise in C["modules"]:
        pc = PILLAR[name][0]
        w('<div class="card avoid" style="border-top:2.4mm solid ' + pc + '">'
          '<div class="num" style="color:' + pc + '">' + esc(tag) + '</div>'
          '<h4>' + esc(name) + '</h4><p>' + esc(promise) + '</p></div>')
    w('</div>')
    w('<div class="pagemark">Onyx &middot; the platform</div>')
    w('</div>')

    # ---------------------------------------------------------- pillar spreads
    for pi, p in enumerate(C["pillars"]):
        name = p["name"]
        pc, pc2, tint = PILLAR[name]
        w('<div class="pg pillar" style="--pc:' + pc + ';--tint:' + tint + '">')
        w('<div class="eyebrow">' + esc(p["tag"]) + '</div>')
        w('<h2 style="color:' + pc + '">' + esc(name) + '</h2>')
        w('<div class="promise">' + esc(p["promise"]) + '</div>')
        w('<div class="val">' + esc(p["value_headline"]) + '</div>')
        w('<p class="stmt">' + esc(p["value_statement"]) + '</p>')
        w('<div class="heroes">')
        for h in p["hero_features"]:
            w('<span class="chip">' + esc(h) + '</span>')
        w('</div>')
        w('<div class="uc">')
        for u in p["use_cases"]:
            w('<div class="u"><h4>' + esc(u["title"]) + '</h4>'
              '<div class="s">' + esc(u["scenario"]) + '</div>'
              '<div class="o">' + esc(u["outcome"]) + '</div></div>')
        w('</div>')
        shots = PILLAR_SHOTS[name]
        if pi % 2:                       # alternate, so no two spreads look alike
            shots = list(reversed(shots))
        w('<div class="panel"><div class="plabel">Live in the product</div>')
        w('<div class="shots">')
        for img, cap in shots:
            w(frame(img, cap))
        w('</div></div>')
        w('<div class="pagemark">' + esc(name) + '</div>')
        w('</div>')

    # ---------------------------------------------------- beyond the proposal
    w('<div class="pg">')
    w('<div class="eyebrow">Beyond the brief</div>')
    w('<h2 class="sec">Twenty-one capabilities<br>nobody asked for</h2>')
    w('<div class="hr"></div>')
    w('<p class="lead">' + esc(extras["intro"]) + '</p>')
    used = set()
    w('<div class="cards" style="margin-top:6mm;flex-wrap:wrap">')
    for t in extras["themes"]:
        img = extra_shot(t["name"], used)
        w('<div class="xc"><div class="mini"><img src="client-shots/' + img + '.png" alt=""></div>'
          '<div class="body"><h4>' + esc(t["name"]) + '</h4>'
          '<p>' + esc(t["desc"]) + '</p></div></div>')
    w('</div>')
    w('<div class="pagemark">Onyx &middot; the platform</div>')
    w('</div>')

    # -------------------------------------------------------------- personas
    journeys = personas["journeys"]
    half = (len(journeys) + 1) // 2
    for page_i, chunk in enumerate([journeys[:half], journeys[half:]]):
        w('<div class="pg">')
        if page_i == 0:
            w('<div class="eyebrow">In use</div>')
            w('<h2 class="sec">A day on the platform</h2>')
            w('<div class="hr"></div>')
            w('<p class="lead">' + esc(personas["intro"]) + '</p>')
            w('<div class="journeys" style="margin-top:6mm">')
        else:
            w('<div class="eyebrow">In use</div>')
            w('<h2 class="sec">A day on the platform, continued</h2>')
            w('<div class="hr"></div>')
            w('<div class="journeys">')
        for j in chunk:
            w('<div class="j"><div class="role">' + esc(j["role"]) + '</div>'
              '<div class="sc">' + esc(j["scenario"]) + '</div><ol>')
            for step in j["steps"]:
                w('<li>' + esc(step) + '</li>')
            w('</ol><div class="pay">' + esc(j["payoff"]) + '</div></div>')
        w('</div>')
        w('<div class="pagemark">Onyx &middot; the platform</div>')
        w('</div>')

    # ------------------------------------------------------- why this wins (dark)
    w('<div class="bleed dark">')
    w('<div class="eyebrow">Why it wins</div>')
    w('<h2 class="sec">' + esc(diff["title"]) + '</h2>')
    w('<div class="hr"></div>')
    w('<p class="lead">' + esc(diff["thesis"]) + '</p>')
    w('<div class="cards" style="margin-top:7mm;flex-wrap:wrap">')
    for pt in diff["points"]:
        w('<div class="card avoid" style="flex:0 0 calc(50% - 2mm)">'
          '<h4>' + esc(pt["name"]) + '</h4><p>' + esc(pt["desc"]) + '</p></div>')
    w('</div>')
    w('<div class="pagemark on-dark">Onyx &middot; the platform</div>')
    w('</div>')

    # -------------------------------------------------------------- proof (dark)
    w('<div class="bleed dark">')
    w('<div class="eyebrow">The evidence</div>')
    w('<h2 class="sec">' + esc(proof["title"]) + '</h2>')
    w('<div class="hr"></div>')
    w('<p class="lead">' + esc(proof["statement"]) + '</p>')
    w('<div class="proofgrid">')
    for pt in proof["points"]:
        w('<div class="p"><b>' + esc(pt["stat"]) + '</b><span>' + esc(pt["label"]) + '</span>'
          '<p>' + esc(pt["detail"]) + '</p></div>')
    w('</div>')
    w('<div class="two" style="margin-top:9mm">')
    w('<div class="col">' + frame("25b-audit", "Every consequential action, written to a record nobody can edit", dark=True) + '</div>')
    w('<div class="col">' + frame("b2-operator-manage", "One of seven institutions, run from the operator console", dark=True) + '</div>')
    w('</div>')
    w('<div class="pagemark on-dark">Onyx &middot; the platform</div>')
    w('</div>')

    # -------------------------------------------------------------- closing (dark)
    w('<div class="bleed dark close" style="display:flex;flex-direction:column">')
    w('<div class="rule" style="width:22mm;height:1.3mm;border-radius:2mm;'
      'background:linear-gradient(90deg,#38bdf8,#c026d3)"></div>')
    w('<div style="height:20mm"></div>')
    w('<h2>' + esc(closing["headline"]) + '</h2>')
    w('<p>' + esc(closing["body"]) + '</p>')
    w('<div class="owner"><div class="k">For the EZiL team</div>'
      '<p>' + esc(closing["for_the_owner"]) + '</p></div>')
    w('<div class="sign">' + esc(closing["signoff"])
      + '<br>Onyx LMS &middot; every screen in this document captured live against '
      'onyx-lms-v2.vercel.app.</div>')
    w('</div>')

    open("report7.html", "w", encoding="utf-8").write(o.getvalue())
    n = C.get("critic_findings", [])
    print("report7.html written --", len(C["pillars"]), "pillars,",
          len(personas["journeys"]), "journeys, critic findings:", len(n))
    for f in n:
        print("  CRITIC[" + f.get("section", "?") + "]:", f.get("phrase", "")[:70],
              "->", f.get("fix", "")[:70])


build()
