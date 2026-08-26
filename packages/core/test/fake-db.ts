/**
 * In-memory stand-in for the Supabase query builder.
 * Supports the subset the services use: select/eq/neq/in/not/gte/lte/gt/lt/is/
 * or/ilike/order (chained, multi-column)/limit/range/maybeSingle/
 * insert(.select)/update/delete, plus exact counts.
 */
type Row = Record<string, unknown>;

/**
 * Orders two cells the way Postgres would for the types Onyx actually stores:
 * numbers compare as numbers, ISO timestamps and dates compare by instant, and
 * everything else falls back to a plain string compare. A single `Number(...)`
 * cast -- the original approach -- silently sorted every string column as 0,
 * which passed only because nothing had chained `.order()` on a text column
 * until the O06/O07 services did (discussion timestamps, timetable times).
 */
function compareCells(a: unknown, b: unknown): number {
  if (a == null && b == null) return 0;
  if (a == null) return -1;
  if (b == null) return 1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  const an = Date.parse(String(a));
  const bn = Date.parse(String(b));
  if (!Number.isNaN(an) && !Number.isNaN(bn)) return an - bn;
  return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
}

/** What PostgREST returns for a request that names no range. */
const POSTGREST_CAP = 1000;

export class FakeDb {
  tables: Record<string, Row[]>;
  #uniques: Record<string, string[][]>;

  /**
   * `uniques` declares composite UNIQUE constraints per table, e.g.
   * `{ onyx_payments: [['tenant_id', 'gateway', 'reference']] }`. Optional,
   * and most tests never need it -- but a handful of O07 claims (a payment
   * replay never double-credits an invoice, a room code cannot repeat) are
   * really claims about a database constraint, not about application code, and
   * a fake that lets every insert through cannot exercise the catch block that
   * makes those claims true against a real Supabase.
   */
  constructor(tables: Record<string, Row[]>, uniques: Record<string, string[][]> = {}) {
    this.tables = tables;
    this.#uniques = uniques;
  }

  from(table: string) {
    const rows = (): Row[] => (this.tables[table] ??= []);
    const eqs: [string, unknown][] = [];
    const ins: [string, unknown[]][] = [];
    let headOnly = false;
    let projection: string[] | null = null;
    let orTerm: string | null = null;
    const likes: string[] = [];
    // A stack, not a single slot: the O06 discussion list chains
    // .order('last_post_at').order('created_at') as a tie-breaker, which the
    // original single-slot version silently discarded the first of.
    const orderBy: { col: string; asc: boolean }[] = [];
    let limitN: number | null = null;
    let range: [number, number] | null = null;
    const neqs: [string, unknown][] = [];
    const gtes: [string, unknown][] = [];
    const ltes: [string, unknown][] = [];
    const gts: [string, unknown][] = [];
    const lts: [string, unknown][] = [];
    // Each entry negates one clauseMatches() check -- `.not('x', 'is', null)`
    // is "x is not null", the one every service here actually calls.
    const nots: string[] = [];
    // `.is(col, null | true | false)` -- kept apart from eqs because `null`
    // needs `== null` (covers both null and undefined), not `=== null`.
    const isChecks: [string, unknown][] = [];
    let pendingUpdate: Row | null = null;
    let pendingDelete = false;
    let inserted: Row[] | null = null;
    let insertError: { message: string } | null = null;

    const matches = (r: Row) => {
      if (!eqs.every(([c, v]) => r[c] === v)) return false;
      if (!neqs.every(([c, v]) => r[c] !== v)) return false;
      if (!ins.every(([c, vs]) => vs.includes(r[c]))) return false;
      if (!gtes.every(([c, v]) => compareCells(r[c], v) >= 0)) return false;
      if (!ltes.every(([c, v]) => compareCells(r[c], v) <= 0)) return false;
      if (!gts.every(([c, v]) => compareCells(r[c], v) > 0)) return false;
      if (!lts.every(([c, v]) => compareCells(r[c], v) < 0)) return false;
      if (!nots.every((clause) => !clauseMatches(r, clause))) return false;
      if (!isChecks.every(([c, v]) => (v === null ? r[c] == null : r[c] === v))) return false;
      if (likes.length && !likes.every((clause) => clauseMatches(r, clause))) return false;
      if (orTerm) return splitTop(orTerm).some((clause) => clauseMatches(r, clause));
      return true;
    };

    const resolve = () => {
      if (insertError) return { data: null, count: 0, error: insertError };
      if (inserted) return { data: inserted, count: inserted.length, error: null };
      if (pendingDelete) {
        const keep = rows().filter((r) => !matches(r));
        const removed = rows().length - keep.length;
        this.tables[table] = keep;
        return { data: null, count: removed, error: null };
      }
      if (pendingUpdate) {
        const changed: Row[] = [];
        for (const r of rows()) if (matches(r)) { Object.assign(r, pendingUpdate); changed.push(r); }
        // Real Supabase returns the updated rows when `.select()` follows
        // `.update()` -- several O06/O07 services chain
        // `.update(...).select(COLUMNS).maybeSingle()` to get the new row back
        // in one round trip rather than updating and re-fetching separately.
        // Respect the same projection a plain select() would.
        const data = projection
          ? changed.map((r) => Object.fromEntries(
            projection!.filter((c) => c in r).map((c) => [c, r[c]])) as Row)
          : changed;
        return { data, count: changed.length, error: null };
      }
      let out = rows().filter(matches);
      const total = out.length;
      if (headOnly) return { data: null, count: total, error: null };
      if (orderBy.length) {
        out = [...out].sort((a, b) => {
          for (const { col, asc } of orderBy) {
            const c = compareCells(a[col], b[col]) * (asc ? 1 : -1);
            if (c !== 0) return c;
          }
          return 0;
        });
      }
      /*
       * The server's own row cap, which is the point of emulating it.
       *
       * PostgREST answers a request that names no range with AT MOST
       * `POSTGREST_CAP` rows. Reading that as "all of them" has now been the
       * cause of five separate defects in this product -- an institution of
       * 1,440 reported as 943, a roster of 1,000, a directory of 1,000, a
       * members list of 1,000, and a catalogue that said one course had a
       * thousand students and every other course none. Every one of them
       * passed its tests, because the fake happily returned everything.
       *
       * So the fake stops being more generous than the real thing. A caller
       * that wants every row has to page for it, here as in production.
       */
      if (range) out = out.slice(range[0], range[1] + 1);
      else if (out.length > POSTGREST_CAP) out = out.slice(0, POSTGREST_CAP);
      if (projection) {
        const keep = projection;
        out = out.map((r) => Object.fromEntries(
          keep.filter((c) => c in r).map((c) => [c, r[c]])) as Row);
      }
      if (limitN !== null) out = out.slice(0, limitN);
      return { data: out, count: total, error: null };
    };

    const builder: any = {
      // Honours the column list, like PostgREST does. Without this, tests that
      // assert a field is NOT returned (answer keys, password hashes) silently
      // pass against a fake that returns everything.
      select: (cols?: string, opts?: { head?: boolean }) => {
        if (opts && opts.head) headOnly = true;
        if (cols && cols.trim() !== '*') {
          projection = cols.split(',').map((c) => c.trim().split(' ')[0]!).filter(Boolean);
        }
        return builder;
      },
      in: (col: string, vals: unknown[]) => { ins.push([col, vals]); return builder; },
      eq: (col: string, val: unknown) => { eqs.push([col, val]); return builder; },
      neq: (col: string, val: unknown) => { neqs.push([col, val]); return builder; },
      gte: (col: string, val: unknown) => { gtes.push([col, val]); return builder; },
      lte: (col: string, val: unknown) => { ltes.push([col, val]); return builder; },
      gt: (col: string, val: unknown) => { gts.push([col, val]); return builder; },
      lt: (col: string, val: unknown) => { lts.push([col, val]); return builder; },
      is: (col: string, val: unknown) => { isChecks.push([col, val]); return builder; },
      or: (term: string) => { orTerm = term; return builder; },
      /**
       * `.not(col, 'is', null)` -- the only form every service here calls.
       * Stored as the plain "is null" clause and negated at match time, which
       * is what makes it "is NOT null" without a second code path.
       */
      not: (col: string, op: string, val: unknown) => {
        if (op !== 'is') throw new Error('fake-db: not() only supports the "is" operator');
        nots.push(col + '.is.' + (val === null ? 'null' : String(val)));
        return builder;
      },
      // Same clause grammar as or(), so one implementation covers both.
      ilike: (col: string, pattern: string) => {
        likes.push(col + '.ilike.' + pattern); return builder;
      },
      // Chainable: a second .order() adds a tie-breaker rather than replacing
      // the first, matching PostgREST's own multi-column ORDER BY.
      order: (col: string, opts?: { ascending?: boolean }) => {
        orderBy.push({ col, asc: opts?.ascending !== false }); return builder;
      },
      limit: (n: number) => { limitN = n; return builder; },
      range: (a: number, b: number) => { range = [a, b]; return builder; },
      update: (patch: Row) => { pendingUpdate = patch; return builder; },
      delete: () => { pendingDelete = true; return builder; },
      insert: (row: Row | Row[]) => {
        const list = Array.isArray(row) ? row : [row];
        const keys = this.#uniques[table] ?? [];
        const clashesWith = (r: Row) => rows().some((existing) =>
          keys.some((cols) => cols.every((c) => existing[c] === r[c])));

        const clash = list.find(clashesWith);
        if (clash) {
          // The same message shape a real Postgres unique violation carries,
          // because every service that relies on this constraint matches on
          // /duplicate key|unique/i to tell "already exists" apart from a
          // real failure -- a fake with a different message shape would let
          // that branch go untested.
          insertError = { message: 'duplicate key value violates unique constraint' };
          return builder;
        }

        const nextId = () => rows().reduce((m, r) => Math.max(m, Number(r['id'] ?? 0)), 0) + 1;
        inserted = list.map((r) => {
          const created = { id: r['id'] ?? nextId(), ...r };
          rows().push(created);
          return created;
        });
        return builder;
      },
      maybeSingle: async () => {
        const res = resolve();
        if (res.error) return { data: null, count: 0, error: res.error };
        const list = (res.data ?? []) as Row[];
        return { data: list[0] ?? null, count: res.count, error: null };
      },
      then: (resolveFn: (v: unknown) => unknown) => Promise.resolve(resolve()).then(resolveFn),
    };
    return builder;
  }
}

/**
 * Splits a PostgREST filter list on top-level commas only, so a nested group
 * like `and(a.eq.1,b.eq.2)` stays in one piece. Splitting naively made
 * `or(and(...),and(...))` unparseable, which silently turned a two-condition
 * pair lookup into "match everything".
 */
function splitTop(expr: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < expr.length; i++) {
    const ch = expr[i];
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    else if (ch === ',' && depth === 0) { out.push(expr.slice(start, i)); start = i + 1; }
  }
  out.push(expr.slice(start));
  return out.map((s) => s.trim()).filter(Boolean);
}

/** One clause: `and(...)`, `or(...)`, `col.eq.v` or `col.ilike.%v%`. */
function clauseMatches(row: Record<string, unknown>, clause: string): boolean {
  const group = /^(and|or)\((.*)\)$/s.exec(clause);
  if (group) {
    const parts = splitTop(group[2] ?? '');
    return group[1] === 'and'
      ? parts.every((p) => clauseMatches(row, p))
      : parts.some((p) => clauseMatches(row, p));
  }
  const dot = clause.indexOf('.');
  const col = clause.slice(0, dot);
  const rest = clause.slice(dot + 1);
  const op = rest.slice(0, rest.indexOf('.'));
  const value = rest.slice(rest.indexOf('.') + 1);

  if (op === 'ilike' || op === 'like') {
    const needle = value.replace(/%/g, '');
    const cell = String(row[col] ?? '');
    return op === 'ilike'
      ? cell.toLowerCase().includes(needle.toLowerCase())
      : cell.includes(needle);
  }
  if (op === 'eq') return String(row[col] ?? '') === value;
  if (op === 'neq') return String(row[col] ?? '') !== value;
  if (op === 'is') return value === 'null' ? row[col] == null : String(row[col]) === value;
  throw new Error('fake-db: unsupported filter operator ' + JSON.stringify(op));
}
