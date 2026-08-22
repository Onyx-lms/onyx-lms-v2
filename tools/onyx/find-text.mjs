/**
 * Every text column of every table, searched for one phrase.
 *
 * The blunt instrument, written because a targeted search kept coming back
 * empty and "it is not in the six tables I thought of" is a weaker claim than
 * "it is nowhere". This scans information_schema for every character column in
 * the public schema and runs one ILIKE per table, so a name sitting in a
 * settings blob, a menu label or a page body is found too.
 *
 * READ ONLY. Slow by design -- it is not something to run in a request path.
 *
 *   node tools/onyx/find-text.mjs advance
 *   node tools/onyx/find-text.mjs "advance learn"
 */
import { connect } from '../db/connect.mjs';

const NEEDLE = process.argv[2];
if (!NEEDLE) {
  console.error('Give it a phrase:  node tools/onyx/find-text.mjs "advance learn"');
  process.exit(1);
}

const client = await connect();
try {
  const { rows: cols } = await client.query(`
    SELECT table_name, column_name
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND data_type IN ('character varying', 'text', 'character')
     ORDER BY table_name, ordinal_position`);

  const byTable = new Map();
  for (const c of cols) {
    byTable.set(c.table_name, [...(byTable.get(c.table_name) ?? []), c.column_name]);
  }

  console.log('\nLooking for "' + NEEDLE + '" in ' + byTable.size + ' tables.\n');
  let hits = 0;

  for (const [table, columns] of byTable) {
    // One query per table with an OR across its text columns. A column per
    // query would be thousands of round trips.
    const where = columns.map((c) => `"${c}" ILIKE $1`).join(' OR ');
    const pick = columns.slice(0, 6).map((c) => `"${c}"`).join(', ');
    try {
      const { rows } = await client.query(
        `SELECT ${pick} FROM public."${table}" WHERE ${where} LIMIT 5`, ['%' + NEEDLE + '%']);
      for (const row of rows) {
        hits++;
        console.log('  ' + table.padEnd(34)
          + Object.entries(row)
            .filter(([, v]) => v !== null && String(v).trim())
            .map(([k, v]) => k + '=' + String(v).slice(0, 60))
            .join('  |  '));
      }
    } catch (err) {
      console.log('  (skipped ' + table + ': ' + err.message.split('\n')[0] + ')');
    }
  }

  console.log('\n' + (hits ? hits + ' row(s).' : 'Nothing, anywhere in the database.') + '\n');
} finally {
  await client.end();
}
