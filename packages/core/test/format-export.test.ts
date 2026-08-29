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
import {
  pdfTable, pdfResume, pdfScript, pdfScriptBundle, pdfCertificate,
} from '../src/format/pdf.ts';
import { isLatin1 } from '../src/onyx/resume.service.ts';

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
  // Catalog, pages, resources, one page + its stream, three fonts.
  //
  // Three because submitted code prints in Courier: a proportional face turns
  // a candidate's indentation into something they did not write. Every
  // document carries the font table whether or not it uses all of it, which
  // costs one object and keeps `serialise` free of per-document branching.
  assert.equal(objects, 8);
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

// ---------------------------------------------------------------------------
// PDF -- the resume
// ---------------------------------------------------------------------------

const RESUME = {
  name: 'Priya Raman',
  headline: 'Final-year computer science student',
  contact: ['priya@demo.onyx', 'priya.example.com'],
  objective: 'A graduate role in backend engineering.',
  sections: [
    { label: 'Education', items: [{
      title: 'BSc Computer Science', subtitle: 'Demo University',
      detail: 'Batch of 2026 · CS-26', when: '2026',
    }] },
    { label: 'Certificates', items: [{
      title: 'Certificate in Data Structures', subtitle: 'Demo University',
      detail: 'a1b2c3', when: '2025',
    }] },
  ],
};

test('a resume is a well-formed PDF whose xref resolves', () => {
  const pdf = pdfResume(RESUME);
  assert.ok(pdf.subarray(0, 8).toString('latin1').startsWith('%PDF-1.4'));
  assert.ok(pdf.toString('latin1').endsWith('%%EOF\n'));
  assert.equal(xrefResolves(pdf).bad, 0,
    'a cross-reference offset does not land on its object');

  const body = pdf.toString('latin1');
  assert.match(body, /\(Priya Raman\)/);
  assert.match(body, /\(EDUCATION\)/);
  // The same operator-separation fault the table had. It is a property of the
  // writer, not of one layout, so every builder in this file has to be checked
  // for it -- a section heading is grey, which is what forces the reset.
  assert.doesNotMatch(body, /ET\d/, 'a text object ran into the next operator');
  assert.doesNotMatch(body, /Tj[^\s]/);
});

test('a long resume paginates instead of writing off the bottom of the page', () => {
  const pdf = pdfResume({
    ...RESUME,
    sections: [{
      label: 'Courses',
      items: Array.from({ length: 120 }, (_, i) => ({
        title: 'Course number ' + i, subtitle: 'CS' + i,
        detail: '4 credits', when: '2025',
      })),
    }],
  });
  const body = pdf.toString('latin1');
  const pages = (body.match(/\/Type \/Page /g) ?? []).length;
  assert.ok(pages >= 2, 'a hundred and twenty items fitted on ' + pages + ' page(s)');
  assert.equal(xrefResolves(pdf).bad, 0);

  // Nothing below the bottom margin. A negative or tiny y does not error -- it
  // renders off the sheet, which is how content disappears from a generated
  // document without anything saying so.
  for (const match of body.matchAll(/([\d.]+) ([\d.]+) Td/g)) {
    assert.ok(Number(match[2]) >= 24, 'text at y=' + match[2] + ' is off the page');
  }
});

test('a name the font cannot set does not throw, and is flagged before it is drawn', () => {
  // Devanagari. The writer is Helvetica/WinAnsi, so this renders as question
  // marks -- which is why ResumeService detects it and the page says so. What
  // is asserted here is only that the writer survives it: a generated document
  // that throws on somebody's name is worse than one that spells it badly.
  const pdf = pdfResume({ ...RESUME, name: 'प्रिया रमन' });
  assert.ok(pdf.subarray(0, 8).toString('latin1').startsWith('%PDF-1.4'));
  assert.equal(xrefResolves(pdf).bad, 0);
  assert.equal(isLatin1('प्रिया रमन'), false);
  assert.equal(isLatin1('Priya Raman'), true);
  // An accented Latin name is inside WinAnsi and must NOT be flagged -- the
  // warning has to mean something, and flagging every non-ASCII name would
  // make it noise.
  assert.equal(isLatin1('José Álvarez'), true);
});

// ---------------------------------------------------------------- scripts

/** One script, with every kind of question a paper can carry. */
function script(over: Record<string, unknown> = {}) {
  return {
    institution: 'Demo University',
    assessment: 'Programming Fundamentals — Final',
    course: 'CS101 — Programming',
    candidate: 'Priya Sharma',
    rollNumber: 'CS-2024-018',
    attemptNumber: 1,
    startedAt: '25 Aug 2026, 1:35 pm',
    submittedAt: '25 Aug 2026, 2:20 pm',
    score: 7,
    maxScore: 10,
    status: 'published',
    questions: [
      { number: 1, type: 'Multiple choice', prompt: 'Which keyword declares a constant?',
        answer: 'B.  const', expected: 'B.  const', code: '', awarded: 2, points: 2,
        comment: '' },
      { number: 2, type: 'Descriptive', prompt: 'Explain garbage collection.',
        answer: 'It frees memory nothing points at any more.', expected: '', code: '',
        awarded: 3, points: 5, comment: 'Correct, but says nothing about when it runs.' },
      { number: 3, type: 'Programming', prompt: 'Add two numbers.', answer: '', expected: '',
        code: '// python\ndef add(a, b):\n    return a + b\n', awarded: 2, points: 3,
        comment: '' },
    ],
    ...over,
  };
}

test('a script is a well-formed PDF that names the candidate and their mark', () => {
  const pdf = pdfScript(script());
  assert.ok(pdf.subarray(0, 8).toString('latin1').startsWith('%PDF-1.4'));
  assert.ok(pdf.toString('latin1').endsWith('%%EOF\n'));
  const { bad } = xrefResolves(pdf);
  assert.equal(bad, 0, 'a cross-reference offset does not land on its object');

  const body = pdf.toString('latin1');
  assert.ok(body.includes('Priya Sharma'), 'the candidate is not on their own script');
  assert.ok(body.includes('CS-2024-018'), 'the roll number is missing');
  assert.ok(body.includes('7 / 10'), 'the mark is missing');
});

test('a script prints submitted code in the monospaced face, unwrapped', () => {
  // A proportional face turns a candidate's indentation into something they
  // did not write, and reflowing on word boundaries produces code they did
  // not submit.
  const pdf = pdfScript(script()).toString('latin1');
  assert.ok(/\/F3 /.test(pdf), 'code is not set in Courier');
  // Parentheses are escaped in a PDF string, so the source appears as
  // `def add\(a, b\):`. Asserting the raw form would pass only on code that
  // happens to contain no brackets.
  assert.ok(pdf.includes(String.raw`def add\(a, b\):`),
    'the submitted source is not in the document');
  // The claim that matters: leading whitespace survives. Reflowing a
  // submission on word boundaries produces code the candidate did not write.
  assert.ok(pdf.includes('(    return a + b)'), 'indentation was not preserved');
});

test('a script shows a marker comment, which is the part worth reading', () => {
  const pdf = pdfScript(script()).toString('latin1');
  assert.ok(/says nothing about when it runs/.test(pdf),
    'the marker note is missing from the script');
});

test('a script withholds the key when the caller passed none', () => {
  // The entitlement is decided upstream: `expected` is empty on a candidate's
  // copy while they still have a sitting left. The builder must not invent it.
  const withheld = script({
    questions: [{
      number: 1, type: 'Multiple choice', prompt: 'Which keyword declares a constant?',
      answer: 'A.  let', expected: '', code: '', awarded: 0, points: 2, comment: '',
    }],
  });
  const pdf = pdfScript(withheld).toString('latin1');
  assert.ok(!/Correct answer/.test(pdf),
    'a script with no key printed a "Correct answer" heading anyway');
});

test('an unmarked question prints a dash, not a zero', () => {
  // Zero is a mark somebody was given. A question nobody has marked has no
  // mark at all, and printing 0 tells a candidate they scored nothing.
  const pdf = pdfScript(script({
    score: null,
    questions: [{
      number: 1, type: 'Descriptive', prompt: 'Explain.', answer: 'Words.',
      expected: '', code: '', awarded: null, points: 5, comment: '',
    }],
  })).toString('latin1');
  assert.ok(/Not marked yet/.test(pdf), 'an unmarked script does not say so');
});

test('a bundle carries every script, each starting on its own sheet', () => {
  const two = pdfScriptBundle([
    script({ candidate: 'Priya Sharma' }),
    script({ candidate: 'Arun Mehta' }),
  ]);
  const body = two.toString('latin1');
  assert.ok(body.includes('Priya Sharma') && body.includes('Arun Mehta'));
  // Two scripts, so at least two pages -- a bundle that concatenated onto one
  // sheet would run one candidate's answers into the next.
  const pages = (body.match(/\/Type \/Page[^s]/g) ?? []).length;
  assert.ok(pages >= 2, 'the bundle collapsed two scripts onto one page');
});

test('an empty bundle is a readable document, not an unopenable file', () => {
  // "Nobody has sat this yet" is a real and common answer, and a zero-page
  // PDF is one a reader cannot open to find that out.
  const pdf = pdfScriptBundle([]);
  assert.ok(pdf.subarray(0, 8).toString('latin1').startsWith('%PDF-1.4'));
  assert.equal(xrefResolves(pdf).bad, 0);
  assert.ok(pdf.toString('latin1').includes('No submissions yet'));
});

/* ----------------------------------------------------------- certificates */

const CERTIFICATE = {
  issuer: 'Meridian Institute of Technology',
  holder: 'Priya Raman',
  title: 'Applied Algorithms',
  kind: 'course',
  credentialId: '70A4CEBD5640BFBC1865F5029A90C5D7',
  issuedAt: '27 August 2026',
  expiresAt: null,
  verifyUrl: 'https://onyx.example/onyx/verify/70A4CEBD5640BFBC1865F5029A90C5D7',
};

test('a certificate is a well-formed PDF whose xref survives the embedded mark', () => {
  const pdf = pdfCertificate(CERTIFICATE);
  assert.ok(pdf.subarray(0, 8).toString('latin1').startsWith('%PDF-1.4'));
  assert.ok(pdf.toString('latin1').endsWith('%%EOF\n'));

  /*
   * The reason this test exists at all.
   *
   * Every other document in this file is text, and a byte offset over text is
   * hard to get wrong. The mark is deflated binary carried through the object
   * table as latin1, and latin1 is the only encoding that maps it byte for
   * byte -- one `utf8` anywhere on that path silently doubles the length of
   * every high byte, every offset after the image lands mid-object, and the
   * file opens as a blank page in some readers and not at all in others.
   */
  const { objects, bad } = xrefResolves(pdf);
  assert.equal(bad, 0, 'a cross-reference offset does not land on its object');
  // Catalog, pages, resources, one page + its stream, three fonts, the image
  // and its palette.
  assert.equal(objects, 10);
});

test('the mark is an indexed image, declared where the page can reach it', () => {
  const body = pdfCertificate(CERTIFICATE).toString('latin1');
  assert.match(body, /\/XObject << \/Im0 \d+ 0 R >>/,
    'the resource dictionary has to name the image, or /Im0 Do draws nothing');
  assert.match(body, /\/Subtype \/Image/);
  // Indexed over a palette that is itself an object, which is what keeps a
  // 64-colour logo to a few kilobytes instead of a quarter of a megabyte.
  assert.match(body, /\/ColorSpace \[\/Indexed \/DeviceRGB 63 \d+ 0 R\]/);
  assert.match(body, /q [\d.]+ 0 0 [\d.]+ [\d.]+ [\d.]+ cm \/Im0 Do Q/);
});

test('the verification URL is printed exactly as a reader must type it', () => {
  const body = pdfCertificate(CERTIFICATE).toString('latin1');
  // The whole job of the document. A truncated, wrapped or ellipsised URL is
  // a certificate that cannot be checked, which is the same as a forged one.
  assert.ok(body.includes('(Verify at ' + CERTIFICATE.verifyUrl + ')'),
    'the URL is printed in full, unwrapped');
  assert.ok(body.includes('(CREDENTIAL ' + CERTIFICATE.credentialId + ')'));
  assert.ok(!/127\.0\.0\.1|localhost/.test(body),
    'no certificate should ever carry a loopback address to verify at');
});
