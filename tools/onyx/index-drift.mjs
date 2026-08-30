/**
 * Does the database have the indexes the schema says it has?
 *
 *   npm run db:index-drift
 *
 * THE FAILURE THIS EXISTS FOR. Every index and constraint in the Onyx
 * migrations is written inside `CREATE TABLE ... IF NOT EXISTS`. Where the
 * table already exists Postgres skips the WHOLE statement -- columns,
 * constraints and indexes together -- and reports success. Nothing else in the
 * gate looks at indexes: `db:verify` checks table and column names, `db:audit`
 * checks types, nullability and RLS, `test:rls` checks isolation. So a
 * declared constraint could simply not exist, for as long as anybody cared to
 * not look.
 *
 * Thirty-five of them did not exist. One was `onyx_readiness_scores`'s unique
 * key, and its absence was not cosmetic: the row is written
 * read-then-insert-or-update, so once a second row existed `.maybeSingle()`
 * returned neither -- PostgREST answers more-than-one-row with an error -- the
 * read came back null, the code inserted again, and one learner reached 258
 * copies of their score, growing by one on every view of their profile.
 *
 * A schema file that describes a database nobody built is worse than no schema
 * file, because it is read and believed. This is the check that makes it true.
 *
 * WITHOUT A DATABASE it says so and passes. The gate runs on machines that have
 * no credentials, and a check that fails there teaches people to skip the gate.
 */
import fs from 'node:fs';
import path from 'node:path';
import { connect, loadEnv } from '../db/connect.mjs';

const ROOT = path.dirname(path.dirname(new URL('.', import.meta.url).pathname
  .replace(/^[/]([A-Za-z]:)/, '$1')));
const DIR = path.join(ROOT, 'supabase', 'onyx', 'migrations');

/**
 * Declared, and deliberately not built. Each needs a reason, because the
 * alternative is a list that grows every time somebody finds this check
 * inconvenient.
 */
const DELIBERATE = {
  onyx_notifications_user_idx:
    'Superseded by 0044. Two narrower indexes serve the two reads this one '
    + 'covered -- the listing, and a partial index for the unread count -- and '
    + 'both were measured. A third overlapping index on ninety-five thousand '
    + 'rows is paid for on every insert and earns nothing.',
  onyx_transcripts_person_idx:
    'The feature is gone. Transcripts were removed from the product; the table '
    + 'survives with its rows so nothing is destroyed, and nothing reads it.',
};

/**
 * SQL with the comments taken out.
 *
 * Necessary, not tidiness: the first version of this scanner read
 * `CREATE UNIQUE INDEX IF NOT EXISTS` out of a sentence in 0044's header
 * explaining why that form is used, and reported a missing index named "IF".
 * A checker that invents findings is one people learn to ignore.
 */
function withoutComments(sql) {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n');
}

/** Every index and unique constraint the migrations name, and where. */
function declared() {
  const out = new Map();
  for (const file of fs.readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort()) {
    const sql = withoutComments(fs.readFileSync(path.join(DIR, file), 'utf8'));
    const add = (name, kind) => {
      if (name && !out.has(name)) out.set(name, { file, kind });
    };
    for (const m of sql.matchAll(
      /CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:CONCURRENTLY\s+)?(?:IF\s+NOT\s+EXISTS\s+)?"?([a-z][a-z0-9_]*)"?/gi)) {
      add(m[1], 'index');
    }
    for (const m of sql.matchAll(/CONSTRAINT\s+"?([a-z][a-z0-9_]*)"?\s+UNIQUE/gi)) {
      add(m[1], 'unique');
    }
    /*
     * A migration may DROP one it declared earlier -- 0044 supersedes nothing
     * that way today, but a schema that can only ever add is a schema that
     * accumulates. A dropped name stops being expected.
     */
    for (const m of sql.matchAll(/DROP\s+INDEX\s+(?:IF\s+EXISTS\s+)?(?:public\.)?"?([a-z][a-z0-9_]*)"?/gi)) {
      out.delete(m[1]);
    }
  }
  return out;
}

const env = loadEnv();
void env;

let db;
try {
  db = await connect();
} catch (e) {
  console.log('No database reachable, so index drift was not checked.');
  console.log('  (' + String(e?.message ?? e).split('\n')[0] + ')');
  process.exitCode = 0;
  process.exit(0);
}

const { rows } = await db.query(
  `select indexname from pg_indexes where schemaname = 'public' and tablename like 'onyx_%'`);
const live = new Set(rows.map((r) => r.indexname));
await db.end();

const want = declared();
const missing = [];
const excused = [];
for (const [name, { file, kind }] of want) {
  if (live.has(name)) continue;
  if (DELIBERATE[name]) excused.push([name, file]);
  else missing.push([name, file, kind]);
}

/*
 * The other direction. An entry in DELIBERATE for an index that DOES exist is
 * a note nobody has read since it stopped being true, and the next person
 * reads the list as two approved exceptions rather than one.
 */
const stale = Object.keys(DELIBERATE).filter((n) => live.has(n));

console.log(want.size + ' indexes and unique constraints declared across the migrations');
console.log(live.size + ' live on onyx_ tables');

if (excused.length) {
  console.log('\nDeclared and deliberately not built (' + excused.length + ')');
  for (const [name, file] of excused) {
    console.log('  ~ ' + name + '  (' + file + ')');
    console.log('      ' + DELIBERATE[name]);
  }
}

if (stale.length) {
  console.log('\nFAIL: listed as deliberate, but present in the database (' + stale.length + ')');
  for (const n of stale) console.log('  x ' + n + ' -- delete its entry from DELIBERATE');
}

if (missing.length) {
  console.log('\nFAIL: declared in a migration, absent from the database (' + missing.length + ')');
  for (const [name, file, kind] of missing) {
    console.log('  x ' + name.padEnd(46) + kind.padEnd(7) + file);
  }
  console.log('\nAlmost always this is `CREATE TABLE ... IF NOT EXISTS` skipping a whole');
  console.log('statement on a database where the table already existed. Add a migration');
  console.log('that creates them on their own -- and check for duplicates BEFORE adding a');
  console.log('unique one, because a table that has been running without it may have some.');
}

const failed = missing.length + stale.length;
console.log('\n' + (failed
  ? 'INDEX DRIFT: ' + failed + ' problem(s)'
  : 'No index drift. The database has every index the schema declares.'));
process.exitCode = failed ? 1 : 0;
