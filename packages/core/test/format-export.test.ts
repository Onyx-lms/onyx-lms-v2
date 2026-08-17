/**
 * The two export formats, tested because both are hand-written.
 *
 * A CSV that quotes wrongly and a PDF whose cross-reference table is a byte out
 * fail the same way: silently for most inputs, and then completely for the one
 * that matters -- a learner whose name has a comma in it, a cohort large enough
 * to need a second page. Neither is covered by an end-to-end test, because an
 * end-to-end test asserts that a file came back, not that it parses.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { csvCell, csvDocument } from '../src/format/csv.ts';
import { pdfTable } from '../src/format/pdf.ts';

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

test('a cell is quoted only when it has to be', () => {
  assert.equal(csvCell('Priya'), 'Priya');
  assert.equal(csvCell(42), '42');
  assert.equal(csvCell(null), '');
  assert.equal(csvCell(undefined), '');
  // The three characters that force quoting, and nothing else.
  assert.equal(csvCell('Rao, Priya'), '"Rao, Priya"');
  assert.equal(csvCell('line\nbreak'), '"line\nbreak"');
  assert.equal(csvCell('say "hello"'), '"say ""hello"""');
});

test('a document is CRLF-terminated, header first', () => {
  const doc = csvDocument(['name', 'score'], [['Priya', 88], ['Rao, A', 71]]);
  assert.equal(doc, 'name,score\r\nPriya,88\r\n"Rao, A",71\r\n');
});

// ---------------------------------------------------------------------------
// PDF
// ---------------------------------------------------------------------------

/**
 * Reads the cross-reference table back and checks every offset lands on the
 * object it claims to. This is the assertion that catches a byte-counting
 * mistake, which is the one bug this writer can plausibly have: a reader that
 * trusts the xref will fetch garbage, and one that repairs the file silently
 * hides the fault until a stricter reader does not.
 */
function xrefResolves(pdf: Buffer): { objects: number; bad: number } {
  const start = Number(/startxref\s+(\d+)/.exec(pdf.toString('latin1'))![1]);
  const table = pdf.subarray(start).toString('latin1');
  const offsets = [...table.matchAll(/(\d{10}) 00000 n/g)].map((m) => Number(m[1]));
  let bad = 0;
  offsets.forEach((offset, i) => {
    const expected = `${i + 1} 0 obj`;
    if (!pdf.subarray(offset, offset + expected.length).toString('latin1').startsWith(expected)) {
      bad += 1;
    }
  });
  return { objects: offsets.length, bad };
}

const COLUMNS = [
  { header: 'Candidate', width: 300 },
  { header: 'Score', width: 80, align: 'right' as const },
];

test('a one-page table is a well-formed PDF whose xref resolves', () => {
  const pdf = pdfTable({
    title: 'Results', subtitle: 'CS101', meta: ['Two candidates'],
    columns: COLUMNS, rows: [['Priya', 88], ['Arun', 71]], footer: 'Demo University',
  });
  assert.ok(pdf.subarray(0, 8).toString('latin1').startsWith('%PDF-1.4'));
  assert.ok(pdf.toString('latin1').endsWith('%%EOF\n'));
  const { objects, bad } = xrefResolves(pdf);
  assert.equal(bad, 0, 'a cross-reference offset does not land on its object');
  // Catalog, pages, resources, one page + its stream, two fonts.
  assert.equal(objects, 7);
});

test('a long table paginates, and every page is numbered against the total', () => {
  const rows = Array.from({ length: 90 }, (_, i) => ['Learner ' + i, i]);
  const pdf = pdfTable({ title: 'Results', columns: COLUMNS, rows });
  const body = pdf.toString('latin1');

  const pages = (body.match(/\/Type \/Page /g) ?? []).length;
  assert.ok(pages >= 3, 'ninety rows should not fit on two pages, got ' + pages);
  assert.match(body, new RegExp('\\(Page 1 of ' + pages + '\\)'));
  assert.match(body, new RegExp('\\(Page ' + pages + ' of ' + pages + '\\)'));
  assert.equal(xrefResolves(pdf).bad, 0);
});

test('every drawing operator is separated, and nothing lands off the page', () => {
  const pdf = pdfTable({
    // Grey text on the page is what forces a colour reset after a text object,
    // which is where the operators used to run together. The sample text is
    // kept free of digits so the assertion below can look for the real fault
    // rather than matching the fixture.
    title: 'Results', meta: ['a grey line of metadata'],
    columns: COLUMNS, rows: [['Priya', 88]], footer: 'Demo University',
  });
  const body = pdf.toString('latin1');

  // `ET0 g` -- a colour reset run together with the end of a text object -- is
  // not an operator, and no reader reports it. It was a real bug here.
  assert.doesNotMatch(body, /ET\d/, 'a text object ran into the next operator');
  assert.doesNotMatch(body, /Tj[^\s]/);

  const stream = /stream\n([\s\S]*?)\nendstream/.exec(body)![1]!;
  const points = [...stream.matchAll(/([\d.]+) ([\d.]+) Td/g)]
    .map((m) => [Number(m[1]), Number(m[2])] as const);
  assert.ok(points.length > 0);
  for (const [x, y] of points) {
    assert.ok(x > 0 && x < 842, 'text at x=' + x + ' is off an A4 landscape page');
    assert.ok(y > 0 && y < 595, 'text at y=' + y + ' is off an A4 landscape page');
  }
});

test('the characters PDF reserves are escaped, and unknown glyphs never break the file', () => {
  const pdf = pdfTable({
    title: 'Results (final)',
    columns: COLUMNS,
    // A backslash and brackets end a string literal early if unescaped; the
    // Devanagari has no glyph in Helvetica and must not be emitted raw.
    rows: [['a\\b (c) d', 1], ['Ünïcodé', 2], ['नाम', 3]],
  });
  const body = pdf.toString('latin1');

  assert.match(body, /\(Results \\\(final\\\)\)/);
  assert.match(body, /a\\\\b \\\(c\\\) d/);
  // Latin-1 survives as an octal escape rather than a raw byte.
  assert.match(body, /\\303|\\334|\\351/);
  // Anything outside the encoding degrades to '?' instead of corrupting the run.
  assert.match(body, /\(\?\?\?\)/);
  assert.equal(xrefResolves(pdf).bad, 0);
});

test('an empty table still produces a readable page rather than nothing', () => {
  const pdf = pdfTable({ title: 'Results', columns: COLUMNS, rows: [] });
  assert.equal((pdf.toString('latin1').match(/\/Type \/Page /g) ?? []).length, 1);
  assert.equal(xrefResolves(pdf).bad, 0);
});
