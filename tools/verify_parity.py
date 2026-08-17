#!/usr/bin/env python3
"""
F-03 acceptance test: "schema diff script vs Laravel schema returns zero differences".

Parses the generated Postgres DDL and compares table names, column names and
column ORDER against the authoritative Laravel SQLite schema.
Exits non-zero on any drift.
"""
import sqlite3, re, sys, os
from laravel_source import source_db

TARGET_SCHEMA = os.environ.get("TARGET_SCHEMA", "public")

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = source_db(sys.argv)
DDL = os.path.join(HERE, "..", "supabase", "migrations", "0001_schema.sql")


def laravel_schema():
    con = sqlite3.connect(SRC)
    out = {}
    for (t,) in con.execute("select name from sqlite_master where type='table' "
                            "and name not like 'sqlite_%' order by name"):
        out[t] = [r[1] for r in con.execute('pragma table_info("%s")' % t)]
    return out


def generated_schema():
    sql = open(DDL, encoding="utf-8").read()
    out = {}
    for m in re.finditer(r'CREATE TABLE IF NOT EXISTS ' + re.escape(TARGET_SCHEMA) + r'\."([a-z_]+)" \((.*?)\n\);',
                         sql, re.S):
        tbl, block = m.group(1), m.group(2)
        cols = []
        for line in block.split("\n"):
            line = line.strip()
            cm = re.match(r'"([a-z_]+)"\s', line)
            if cm and not line.upper().startswith("PRIMARY KEY"):
                cols.append(cm.group(1))
        out[tbl] = cols
    return out


def main():
    lar, gen = laravel_schema(), generated_schema()
    problems = []

    missing = sorted(set(lar) - set(gen))
    extra = sorted(set(gen) - set(lar))
    for t in missing:
        problems.append("MISSING TABLE: %s" % t)
    for t in extra:
        problems.append("EXTRA TABLE:   %s" % t)

    for t in sorted(set(lar) & set(gen)):
        if lar[t] != gen[t]:
            lm, gm = set(lar[t]) - set(gen[t]), set(gen[t]) - set(lar[t])
            if lm:
                problems.append("%s: missing columns %s" % (t, sorted(lm)))
            if gm:
                problems.append("%s: extra columns %s" % (t, sorted(gm)))
            if not lm and not gm:
                problems.append("%s: COLUMN ORDER differs\n  laravel: %s\n  generated: %s"
                                % (t, lar[t], gen[t]))

    cols_total = sum(len(v) for v in lar.values())
    if problems:
        print("SCHEMA PARITY: FAIL (%d problems)" % len(problems))
        for p in problems:
            print("  -", p)
        return 1
    print("SCHEMA PARITY: PASS")
    print("  tables:  %d/%d match" % (len(gen), len(lar)))
    print("  columns: %d match, in identical order" % cols_total)
    return 0


if __name__ == "__main__":
    sys.exit(main())
