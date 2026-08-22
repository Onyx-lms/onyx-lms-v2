/**
 * Every place a price lives, and what each one actually charges.
 *
 * Written for a one-line request -- "change Advance Learn from 10,000 to
 * 5,000" -- that turned out to have no obvious answer, because the name is in
 * no source file in any of the four repositories. It is data, and data can sit
 * in any of six tables that disagree with each other about two things: whether
 * an amount is in rupees or paise, and what a discount column means.
 *
 * The disagreement about discounts is the trap this tool exists for.
 * `packages/core/src/bootcamp/purchase.service.ts` documents it in the ported
 * Laravel logic:
 *
 *     a COURSE:   discount_flag = 1  ->  discounted_price IS the price paid
 *     a BOOTCAMP: discount_flag = 1  ->  price - discounted_price is paid
 *
 * So on a discounted course, setting `price` changes nothing anybody sees; on a
 * discounted bootcamp, setting `discounted_price = 5000` means five thousand
 * OFF, and is right by coincidence until `price` next moves. Hence the
 * `charged` column below: it applies the correct formula per table, and it is
 * the only number in the output worth acting on.
 *
 * READ ONLY. It never writes. Changing a price goes through the product's own
 * API so the audit log records who did it.
 *
 * ---------------------------------------------------------------------------
 * WHAT IT FOUND, 22 August 2026
 * ---------------------------------------------------------------------------
 *
 * Nothing. There is no "Advance Learn" and nothing charges ten thousand
 * rupees. Written down here so the next person asked to make that change does
 * not repeat the search.
 *
 * Three independent sweeps, all empty:
 *
 *   1. This tool, --name advance and --amount 10000, across all six price
 *      tables. No hits. The only priced items in the database are 2,499,
 *      1,499 and 999, and the ported `courses` and `bootcamps` tables have
 *      zero rows.
 *   2. `find-text.mjs advance` beside this file -- every text column of all
 *      134 tables. Three hits, none of them it: a seeded course called
 *      "Advanced Database Systems" (price 0, access batch), its lesson bodies,
 *      and the UI translation phrase "Advanced".
 *   3. A literal grep for "advance learn" across all four repositories. The
 *      only match is this file.
 *
 * So the request could not be carried out, and nothing was changed. Either the
 * programme is named something else in the data, or it lives in a system this
 * codebase does not reach. The tool stays because the question recurs and the
 * answer should be reproducible rather than remembered.
 *
 *   node tools/onyx/price-audit.mjs --name advance
 *   node tools/onyx/price-audit.mjs --amount 10000
 *   node tools/onyx/price-audit.mjs --name advance --amount 10000
 */
import { connect } from '../db/connect.mjs';

const args = process.argv.slice(2);
const argOf = (flag) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : null;
};
const NAME = argOf('--name');
const AMOUNT = argOf('--amount') ? Number(argOf('--amount')) : null;

if (!NAME && AMOUNT === null) {
  console.error('Give it something to look for:\n'
    + '  --name advance      a title or fee-head name containing this\n'
    + '  --amount 10000      a price of this many RUPEES, wherever it is stored');
  process.exit(1);
}

/**
 * The six places a price can be.
 *
 * `minor` says whether the columns hold paise (Onyx) or rupees (the ported
 * Laravel tables). `charged` is the SQL that works out what a buyer is actually
 * asked for, in rupees, per that table's own rules.
 */
const SOURCES = [
  {
    table: 'onyx_courses', label: 'Onyx course', minor: true, tenant: true,
    name: 'title',
    charged: 'price_minor / 100.0',
    columns: ['price_minor', 'currency', 'access', 'status'],
  },
  {
    table: 'onyx_domains', label: 'Onyx domain', minor: true, tenant: true,
    name: 'title',
    charged: 'price_minor / 100.0',
    columns: ['price_minor', 'currency', 'status'],
  },
  {
    table: 'onyx_fee_heads', label: 'Onyx fee head', minor: true, tenant: true,
    name: 'name',
    // A head carries no amount; its structure lines do. Reported so a hit by
    // name still points somewhere, with the amount left null on purpose.
    charged: 'NULL',
    columns: ['category'],
  },
  {
    table: 'onyx_fee_structure_lines', label: 'Onyx fee line', minor: true, tenant: true,
    name: null,
    charged: 'amount_minor / 100.0',
    columns: ['amount_minor', 'structure_id', 'head_id'],
  },
  {
    table: 'courses', label: 'Storefront course', minor: false, tenant: false,
    name: 'title',
    // discounted_price IS the price paid.
    charged: 'CASE WHEN discount_flag = 1 THEN discounted_price ELSE price END',
    columns: ['price', 'discount_flag', 'discounted_price'],
  },
  {
    table: 'bootcamps', label: 'Storefront bootcamp', minor: false, tenant: false,
    name: 'title',
    // discounted_price is the amount taken OFF. Not the same thing at all.
    charged: 'CASE WHEN discount_flag = 1 THEN price - discounted_price ELSE price END',
    columns: ['price', 'discount_flag', 'discounted_price'],
  },
];

const money = (n) => (n === null || n === undefined)
  ? '—'
  : Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const client = await connect();
try {
  /** Which of the six actually exist in this database. */
  const { rows: present } = await client.query(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = ANY($1)`,
    [SOURCES.map((s) => s.table)]);
  const live = new Set(present.map((r) => r.table_name));

  const hits = [];

  for (const src of SOURCES) {
    if (!live.has(src.table)) continue;

    const where = [];
    const params = [];

    if (NAME && src.name) {
      params.push('%' + NAME + '%');
      where.push(`"${src.name}" ILIKE $${params.length}`);
    }
    if (AMOUNT !== null && src.charged !== 'NULL') {
      // Compared against what is CHARGED, not against a raw column -- a
      // discounted row whose `price` is 12,000 but which sells for 10,000 is
      // the row somebody means when they say "the ten thousand one".
      //
      // The parameter is pushed only where a placeholder will actually use it:
      // a fee head has a name and no amount, and binding a parameter nothing
      // references is a protocol error rather than a harmless extra.
      params.push(AMOUNT);
      where.push(`(${src.charged}) = $${params.length}`);
      // Also match the stored figure directly, so a row discounted DOWN from
      // the number being searched for is still surfaced.
      if (src.columns.includes('price_minor')) {
        where.push('"price_minor" = ' + (AMOUNT * 100));
      }
    }
    if (!where.length) continue;

    const cols = ['id', src.tenant ? 'tenant_id' : 'NULL::bigint AS tenant_id',
      src.name ? `"${src.name}" AS label` : `'#' || id AS label`,
      `(${src.charged}) AS charged`, ...src.columns.map((c) => `"${c}"`)];

    // OR, not AND: a row that matches either the name or the amount is a lead.
    // Requiring both is how you miss "Adv. Learn" and how you miss a renamed
    // programme that still costs what it always did.
    const sql = `SELECT ${cols.join(', ')} FROM public."${src.table}" WHERE ${where.join(' OR ')}
                 ORDER BY id LIMIT 200`;
    const { rows } = await client.query(sql, params);
    for (const row of rows) hits.push({ src, row });
  }

  const looking = [NAME ? `name like "${NAME}"` : null,
    AMOUNT !== null ? `charging ₹${money(AMOUNT)}` : null].filter(Boolean).join(' or ');
  console.log('\nLooking for anything ' + looking + '.\n');

  if (!hits.length) {
    console.log('  Nothing found in ' + [...live].join(', ') + '.');
  } else {
    for (const { src, row } of hits) {
      const extra = src.columns.map((c) => c + '=' + row[c]).join('  ');
      console.log('  ' + src.label.padEnd(20)
        + ('#' + row.id).padEnd(7)
        + (row.tenant_id ? ('tenant ' + row.tenant_id).padEnd(11) : ''.padEnd(11))
        + String(row.label).slice(0, 40).padEnd(42)
        + 'charged ₹' + money(row.charged));
      console.log(' '.repeat(22) + extra);
    }
    console.log('\n  ' + hits.length + ' row' + (hits.length === 1 ? '' : 's')
      + '. "charged" is what a buyer is asked for, after that table\'s own\n'
      + '  discount rule. It is the number to act on -- setting a column the\n'
      + '  reader does not read changes nothing anybody sees.');
  }

  const skipped = SOURCES.filter((s) => !live.has(s.table)).map((s) => s.table);
  if (skipped.length) console.log('\n  (not in this database: ' + skipped.join(', ') + ')');
  console.log('');
} finally {
  await client.end();
}
