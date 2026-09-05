"""Rebuild showcase-content.json from the content workflow's journal.

Results in the journal carry no label, so each is classified by the shape of
its JSON (each schema has a distinct required-key set). The five pillars share
a shape, so each is matched to its module by which module's feature titles its
hero_features overlap.
"""
import json, os, sys, glob

D = ("/Users/turbostart-blr-lap0168/.claude/projects/"
     "-Users-turbostart-blr-lap0168-Downloads-Dev-TT002-LEO-LMS-onyx-lms-v2/"
     "beb5276e-bde4-4798-b4ef-636807956656/subagents/workflows")
run = sorted(glob.glob(os.path.join(D, "wf_*")), key=os.path.getmtime)[-1]
journal = os.path.join(run, "journal.jsonl")

results = []
for line in open(journal):
    e = json.loads(line)
    if e.get("type") == "result" and isinstance(e.get("result"), dict):
        results.append(e["result"])
print("results in journal:", len(results), "from", os.path.basename(run))

def has(d, *ks):
    return all(k in d for k in ks)

buckets = {"pillars": []}
for r in results:
    if has(r, "eyebrow", "headline", "subhead", "thesis", "statements"): buckets["positioning"] = r
    elif has(r, "levers", "onboarding", "operator_value"):               buckets["business"] = r
    elif has(r, "value_headline", "value_statement", "hero_features"):   buckets["pillars"].append(r)
    elif has(r, "themes"):                                              buckets["extras"] = r
    elif has(r, "journeys"):                                            buckets["personas"] = r
    elif has(r, "findings"):                                            buckets["critic"] = r
    elif has(r, "statement", "points"):                                 buckets["proof"] = r
    elif has(r, "thesis", "points"):                                    buckets["differentiators"] = r
    elif has(r, "for_the_owner"):                                       buckets["closing"] = r
    else: print("  UNCLASSIFIED:", sorted(r)[:6])

# module feature titles, to place each pillar draft against its module
g5 = open("gen5.py", encoding="utf-8").read()
ns = {}
exec(g5.split("# category, title, description")[0], ns)
MODULES, FEATURES = ns["MODULES"], ns["FEATURES"]
titles = {m[0]: [f[1] for f in FEATURES if f[0] == m[0]] for m in MODULES}

def tokens(s):
    return {w for w in "".join(c.lower() if c.isalnum() else " " for c in s).split() if len(w) > 3}

ordered, pool = [], list(buckets["pillars"])
for m in MODULES:
    want = set().union(*[tokens(t) for t in titles[m[0]]]) if titles[m[0]] else set()
    best, score = None, -1
    for cand in pool:
        got = set().union(*[tokens(h) for h in cand["hero_features"]]) if cand["hero_features"] else set()
        sc = len(want & got)
        if sc > score:
            best, score = cand, sc
    if best is None:
        print("  !! no pillar draft for", m[0]); continue
    pool.remove(best)
    ordered.append({"name": m[1], "tag": m[2],
                    "promise": m[5].replace("&mdash;", "\u2014"), **best})
    print("  pillar ->", m[1], "(overlap", score, ")", best["hero_features"])

missing = [k for k in ("positioning","business","extras","personas","differentiators","proof","closing")
           if k not in buckets]
if missing or len(ordered) != 5:
    print("INCOMPLETE, missing:", missing, "pillars:", len(ordered))
    sys.exit(1)

content = {
    "modules": [[m[1], m[2], m[5].replace("&mdash;", "\u2014")] for m in MODULES],
    "positioning": buckets["positioning"], "business": buckets["business"],
    "pillars": ordered, "extras": buckets["extras"], "personas": buckets["personas"],
    "differentiators": buckets["differentiators"], "proof": buckets["proof"],
    "closing": buckets["closing"],
    "critic_findings": buckets.get("critic", {}).get("findings", []),
}
json.dump(content, open("showcase-content.json", "w", encoding="utf-8"), indent=1, ensure_ascii=False)
print("wrote showcase-content.json | critic findings:", len(content["critic_findings"]))
