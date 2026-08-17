/**
 * A very small PDF writer, for the exports that have to be printable.
 *
 * ASS-04b asks for "CSV and PDF exports of results for faculty and
 * institutional stakeholders", and CMP-02b for printable seating plans and
 * attendance sheets. A CSV is not printable and an HTML page is not a document
 * somebody signs and files, so a real file has to come out of the server.
 *
 * **Why this rather than a library.** The repository has two runtime
 * dependencies. A results sheet is a title, some metadata and a table with
 * rules on it -- perhaps three hundred lines of PDF 1.4 -- and the alternative
 * was pulling a general-purpose document engine into the dependency tree of a
 * product whose whole security story is that it is small. This does the one
 * thing, and does not grow: if a future export needs images or vector graphics,
 * that is the moment to reach for a library, not before.
 *
 * **The one real limitation, stated plainly.** Text is set in Helvetica, which
 * is one of the fourteen faces every PDF reader is required to have, so nothing
 * is embedded and the files stay a few kilobytes. The price is WinAnsi
 * encoding: it covers Latin-1 and nothing else. A name in Devanagari, Tamil or
 * Han cannot be drawn by a font that has no such glyphs, and no amount of
 * encoding work here changes that. Such characters are transliterated where
 * there is an obvious equivalent and replaced with '?' where there is not --
 * and every PDF export in this product is offered beside a CSV, which is UTF-8
 * and loses nothing. If PDFs in an Indic script become a requirement, the fix
 * is embedding a font with those glyphs, and that is a deliberate piece of work
 * rather than a tweak to this file.
 */

/** Landscape A4 in points, which is what a wide table needs. */
export const A4_LANDSCAPE = { width: 842, height: 595 } as const;
export const A4_PORTRAIT = { width: 595, height: 842 } as const;

export interface PdfColumn {
  header: string;
  /** Width in points. The caller decides; the sum should fit the page body. */
  width: number;
  align?: 'left' | 'right';
}

export interface PdfTableDocument {
  title: string;
  subtitle?: string;
  /** Lines of context under the subtitle: who ran it, when, what it covers. */
  meta?: string[];
  columns: PdfColumn[];
  rows: (string | number | null | undefined)[][];
  /** Printed at the foot of every page, beside the page number. */
  footer?: string;
  page?: { width: number; height: number };
}

const MARGIN = 36;
const TITLE_SIZE = 16;
const SUBTITLE_SIZE = 10;
const META_SIZE = 8.5;
const HEAD_SIZE = 8.5;
const BODY_SIZE = 9;
const ROW_HEIGHT = 15;

/**
 * Builds the whole document.
 *
 * Everything is laid out first and serialised second, because a PDF's trailer
 * has to state the byte offset of every object and you cannot know those until
 * the bytes exist.
 */
export function pdfTable(doc: PdfTableDocument): Buffer {
  const page = doc.page ?? A4_LANDSCAPE;
  const bodyTop = page.height - MARGIN;
  const bodyBottom = MARGIN + 24;

  // How far down the first page the table starts, once the heading block has
  // had its say. Later pages repeat only the column headers.
  const headingHeight = TITLE_SIZE + 8
    + (doc.subtitle ? SUBTITLE_SIZE + 6 : 0)
    + (doc.meta?.length ? doc.meta.length * (META_SIZE + 3) + 4 : 0);

  const firstPageRows = Math.max(1, Math.floor(
    (bodyTop - headingHeight - ROW_HEIGHT - bodyBottom) / ROW_HEIGHT));
  const laterPageRows = Math.max(1, Math.floor(
    (bodyTop - ROW_HEIGHT - bodyBottom) / ROW_HEIGHT));

  const pages: (typeof doc.rows)[] = [];
  let rest = doc.rows;
  pages.push(rest.slice(0, firstPageRows));
  rest = rest.slice(firstPageRows);
  while (rest.length) {
    pages.push(rest.slice(0, laterPageRows));
    rest = rest.slice(laterPageRows);
  }

  const streams = pages.map((rows, i) =>
    pageStream(doc, rows, { index: i, total: pages.length, page, bodyBottom }));

  return serialise(streams, page);
}

/** The content stream for one page: text and rules, in drawing order. */
function pageStream(
  doc: PdfTableDocument,
  rows: PdfTableDocument['rows'],
  ctx: { index: number; total: number; page: { width: number; height: number }; bodyBottom: number },
): string {
  const out: string[] = [];
  const right = ctx.page.width - MARGIN;
  let y = ctx.page.height - MARGIN;

  if (ctx.index === 0) {
    y -= TITLE_SIZE;
    out.push(text(MARGIN, y, doc.title, TITLE_SIZE, true));
    y -= 8;
    if (doc.subtitle) {
      y -= SUBTITLE_SIZE;
      out.push(text(MARGIN, y, doc.subtitle, SUBTITLE_SIZE, false));
      y -= 6;
    }
    for (const line of doc.meta ?? []) {
      y -= META_SIZE;
      out.push(shaded(0.35, text(MARGIN, y, line, META_SIZE, false)));
      y -= 3;
    }
    if (doc.meta?.length) y -= 4;
  }

  // Column headers, then a rule under them. The rule is what makes a run of
  // numbers read as a table rather than as a paragraph of digits.
  y -= ROW_HEIGHT;
  let x = MARGIN;
  for (const col of doc.columns) {
    out.push(cell(col, x, y, col.header, HEAD_SIZE, true));
    x += col.width;
  }
  out.push(rule(MARGIN, y - 4, right, 0.8, 0.2));

  for (const row of rows) {
    y -= ROW_HEIGHT;
    x = MARGIN;
    doc.columns.forEach((col, i) => {
      out.push(cell(col, x, y, stringify(row[i]), BODY_SIZE, false));
      x += col.width;
    });
    out.push(rule(MARGIN, y - 4, right, 0.4, 0.85));
  }

  // The foot: what this is on the left, where you are on the right. A page
  // number without a total is no use to somebody holding a stack of paper.
  const footY = ctx.bodyBottom - 14;
  if (doc.footer) {
    out.push(shaded(0.4, text(MARGIN, footY, doc.footer, META_SIZE, false)));
  }
  const label = 'Page ' + (ctx.index + 1) + ' of ' + ctx.total;
  out.push(shaded(0.4, text(right - width(label, META_SIZE), footY, label, META_SIZE, false)));

  return out.join('\n');
}

function cell(col: PdfColumn, x: number, y: number, value: string, size: number, bold: boolean): string {
  const padded = fit(value, col.width - 6, size, bold);
  const at = col.align === 'right'
    ? x + col.width - 6 - width(padded, size, bold)
    : x + 2;
  return text(at, y, padded, size, bold);
}

function text(x: number, y: number, value: string, size: number, bold: boolean): string {
  const font = bold ? '/F2' : '/F1';
  return 'BT ' + font + ' ' + num(size) + ' Tf '
    + num(x) + ' ' + num(y) + ' Td (' + escapeText(value) + ') Tj ET';
}

function rule(x1: number, y: number, x2: number, lineWidth: number, shade: number): string {
  return num(lineWidth) + ' w ' + num(shade) + ' G '
    + num(x1) + ' ' + num(y) + ' m ' + num(x2) + ' ' + num(y) + ' l S 0 G';
}

/**
 * Wraps a drawing operation in a fill colour and puts black back afterwards.
 *
 * A function rather than two loose strings the caller concatenates: written
 * that way the reset ran straight into the preceding `ET` and produced the
 * token `ET0`, which is not an operator. Content streams are whitespace
 * separated and nothing warns you -- the file simply renders wrong, or not at
 * all, in whichever reader is strictest.
 */
function shaded(level: number, body: string): string {
  return num(level) + ' g ' + body + ' 0 g';
}

function num(n: number): string {
  return (Math.round(n * 100) / 100).toString();
}

function stringify(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value);
}

/**
 * Helvetica's own advance widths, so a column can be measured before it is
 * drawn. Approximated in three bands rather than carried as a 256-entry table:
 * the only decisions that rest on it are where to put a right-aligned number
 * and where to truncate, and both survive being a point or two out.
 */
function width(value: string, size: number, bold = false): number {
  let units = 0;
  for (const ch of value) {
    if (ch === ' ') units += 278;
    else if (/[ilj.,:;'`!|]/.test(ch)) units += 250;
    else if (/[A-Z@%&mwMW]/.test(ch)) units += 700;
    else units += 545;
  }
  return (units / 1000) * size * (bold ? 1.04 : 1);
}

/** Truncates with an ellipsis rather than letting a long name cross a column. */
function fit(value: string, available: number, size: number, bold: boolean): string {
  if (available <= 0) return '';
  if (width(value, size, bold) <= available) return value;
  let out = value;
  while (out.length > 1 && width(out + '...', size, bold) > available) {
    out = out.slice(0, -1);
  }
  return out + '...';
}

/**
 * The two jobs a PDF string literal needs: the characters PDF reserves have to
 * be escaped, and anything the font cannot draw has to become something it can.
 */
const TRANSLITERATE: Record<string, string> = {
  '‘': "'", '’': "'", '“': '"', '”': '"',
  '–': '-', '—': '-', '…': '...', ' ': ' ',
  '•': '-', '′': "'", '″': '"',
};

function escapeText(value: string): string {
  let out = '';
  for (const ch of value) {
    const mapped = TRANSLITERATE[ch] ?? ch;
    for (const c of mapped) {
      const code = c.codePointAt(0)!;
      if (c === '\\' || c === '(' || c === ')') out += '\\' + c;
      // Printable ASCII, and the Latin-1 range that WinAnsi shares with it.
      else if (code >= 32 && code <= 126) out += c;
      else if (code >= 160 && code <= 255) out += '\\' + code.toString(8).padStart(3, '0');
      // Anything else -- an Indic or Han name, an emoji -- has no glyph in a
      // standard font. The CSV beside this export is the lossless one.
      else out += '?';
    }
  }
  return out;
}

/**
 * Objects, xref and trailer.
 *
 * Offsets are counted in BYTES. Building the file as strings and measuring with
 * `.length` would be right only until the first accented character, at which
 * point every offset after it is wrong and readers reject the file.
 */
function serialise(streams: string[], page: { width: number; height: number }): Buffer {
  const pageIds = streams.map((_, i) => 4 + i * 2);
  const objects: string[] = [];

  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[2] = '<< /Type /Pages /Kids [' + pageIds.map((id) => id + ' 0 R').join(' ')
    + '] /Count ' + streams.length + ' >>';
  objects[3] = '<< /Font << /F1 ' + (4 + streams.length * 2) + ' 0 R /F2 '
    + (5 + streams.length * 2) + ' 0 R >> >>';

  streams.forEach((stream, i) => {
    const id = pageIds[i]!;
    objects[id] = '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 '
      + num(page.width) + ' ' + num(page.height) + '] /Resources 3 0 R /Contents '
      + (id + 1) + ' 0 R >>';
    objects[id + 1] = '<< /Length ' + Buffer.byteLength(stream, 'latin1')
      + ' >>\nstream\n' + stream + '\nendstream';
  });

  objects[4 + streams.length * 2] =
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
  objects[5 + streams.length * 2] =
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>';

  const chunks: Buffer[] = [Buffer.from('%PDF-1.4\n', 'latin1')];
  let offset = chunks[0]!.length;
  const offsets: number[] = [];

  for (let id = 1; id < objects.length; id += 1) {
    offsets[id] = offset;
    const body = Buffer.from(id + ' 0 obj\n' + objects[id] + '\nendobj\n', 'latin1');
    chunks.push(body);
    offset += body.length;
  }

  const count = objects.length;
  let xref = 'xref\n0 ' + count + '\n0000000000 65535 f \n';
  for (let id = 1; id < count; id += 1) {
    xref += String(offsets[id]).padStart(10, '0') + ' 00000 n \n';
  }
  xref += 'trailer\n<< /Size ' + count + ' /Root 1 0 R >>\nstartxref\n' + offset + '\n%%EOF\n';
  chunks.push(Buffer.from(xref, 'latin1'));

  return Buffer.concat(chunks);
}

/* ----------------------------------------------------------- certificates */

export interface PdfCertificate {
  /** The institution issuing it. */
  issuer: string;
  /** Who holds it. */
  holder: string;
  /** What it certifies, in the issuer's own words. */
  title: string;
  /** "course" | "assessment" | "contest" | "program". */
  kind?: string;
  credentialId: string;
  issuedAt: string;
  expiresAt?: string | null;
  /** Where a stranger can check it. Printed in full so it survives paper. */
  verifyUrl: string;
}

/**
 * CAR-03 -- the credential as a document.
 *
 * "Verifiable, shareable skill certificates." The verification page delivered
 * *verifiable* from the first day and *shareable* only in the sense that a URL
 * is shareable -- there was no artefact a graduate could attach to a job
 * application, which is the form in which people actually share a credential.
 *
 * The design follows from what the thing is for. A certificate is read twice:
 * once by a person deciding whether they are impressed, and once by a person
 * deciding whether it is real. So the holder's name is the largest thing on the
 * page, and the credential id and the full verification URL are printed at the
 * foot in a size that survives a photocopy -- not as a QR code, which is
 * unreadable if the print is poor and tells a reader nothing about where they
 * are being sent.
 *
 * **It is not the evidence.** A PDF can be edited by anyone with a text editor,
 * which is exactly why the verification page exists and why this document's job
 * is to carry people to it rather than to be believed on its own. The wording
 * on the page says so.
 */
export function pdfCertificate(cert: PdfCertificate): Buffer {
  const page = A4_LANDSCAPE;
  const mid = page.width / 2;
  const out: string[] = [];

  /** Centred, because a certificate is a symmetrical object. */
  const centre = (y: number, value: string, size: number, bold: boolean) =>
    text(mid - width(value, size, bold) / 2, y, value, size, bold);

  // A double rule inset from the trim, which is what makes a page read as a
  // certificate rather than as a letter.
  out.push(box(28, 28, page.width - 28, page.height - 28, 1.4, 0.15));
  out.push(box(34, 34, page.width - 34, page.height - 34, 0.6, 0.45));

  let y = page.height - 96;
  out.push(shaded(0.35, centre(y, cert.issuer.toUpperCase(), 12, true)));

  y -= 46;
  out.push(centre(y, 'Certificate of Achievement', 26, true));

  y -= 40;
  out.push(shaded(0.4, centre(y, 'This is to certify that', 11, false)));

  y -= 40;
  out.push(centre(y, cert.holder, 30, true));

  y -= 30;
  out.push(shaded(0.4, centre(y, 'has completed', 11, false)));

  y -= 32;
  // Long titles wrap rather than run off the page or get an ellipsis: the one
  // sentence saying what was achieved is not the place to truncate.
  for (const line of wrap(cert.title, page.width - 200, 17, true)) {
    out.push(centre(y, line, 17, true));
    y -= 24;
  }

  y -= 14;
  const issued = 'Issued ' + cert.issuedAt
    + (cert.expiresAt ? '   ·   Valid until ' + cert.expiresAt : '');
  out.push(shaded(0.4, centre(y, issued, 10, false)));

  // The foot: what makes it checkable. Printed large enough to be typed in
  // from a photocopy, because that is how a certificate is often verified.
  const footY = 74;
  out.push(rule(120, footY + 34, page.width - 120, 0.6, 0.75));
  out.push(shaded(0.35, centre(footY + 16, 'CREDENTIAL ' + cert.credentialId, 11, true)));
  out.push(shaded(0.45, centre(footY, 'Verify at ' + cert.verifyUrl, 9.5, false)));
  out.push(shaded(0.55, centre(footY - 14,
    'This document is a record. The page above is the evidence.', 8.5, false)));

  return serialise([out.join('\n')], page);
}

/** A rectangle, stroked. Two of them nested is the certificate's border. */
function box(x1: number, y1: number, x2: number, y2: number,
  lineWidth: number, shade: number): string {
  return num(lineWidth) + ' w ' + num(shade) + ' G '
    + num(x1) + ' ' + num(y1) + ' m ' + num(x2) + ' ' + num(y1) + ' l '
    + num(x2) + ' ' + num(y2) + ' l ' + num(x1) + ' ' + num(y2) + ' l h S 0 G';
}

/** Greedy wrap on whole words, so a long title breaks where a reader would. */
function wrap(value: string, available: number, size: number, bold: boolean): string[] {
  const words = value.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const next = line ? line + ' ' + word : word;
    if (width(next, size, bold) > available && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [''];
}
