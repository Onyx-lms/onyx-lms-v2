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

import { ONYX_MARK } from './pdf-mark.ts';

/** Landscape A4 in points, which is what a wide table needs. */
export const A4_LANDSCAPE = { width: 842, height: 595 } as const;
export const A4_PORTRAIT = { width: 595, height: 842 } as const;

/**
 * A palette image, already deflated, ready to become an /Indexed XObject.
 *
 * The header above says that an export needing images is the moment to reach
 * for a library. This is the narrow exception that did not justify one: a
 * single logo, opaque, with its palette and samples prepared ahead of time by
 * `tools/onyx/build-pdf-mark.mjs`. Nothing here decodes, scales or converts,
 * so it adds no dependency and no surface. Anything more than a logo -- a
 * photograph, a chart, an alpha channel -- is where the header's advice
 * stands.
 */
export interface IndexedImage {
  width: number;
  height: number;
  /** Number of palette entries; the /Indexed hival is one less. */
  colours: number;
  /** Base64 of the deflated colours x 3 RGB lookup table. */
  palette: string;
  /** Base64 of the deflated one-byte-per-pixel indices, top row first. */
  data: string;
}

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

/**
 * A line of code, in the monospaced face.
 *
 * Separate from `text` rather than a flag on it, because everything else about
 * a code line differs too: it is never wrapped on whitespace, never fitted to a
 * width by dropping words, and never shaded. Folding those into `text` would
 * put four unrelated branches in the one function every other builder uses.
 */
function mono(x: number, y: number, value: string, size: number): string {
  return 'BT /F3 ' + num(size) + ' Tf 1 0 0 1 ' + num(x) + ' ' + num(y)
    + ' Tm (' + escapeText(value) + ') Tj ET';
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
function serialise(streams: string[], page: { width: number; height: number },
  image?: IndexedImage): Buffer {
  const pageIds = streams.map((_, i) => 4 + i * 2);
  const objects: string[] = [];

  // The three fonts sit immediately after the pages, and anything else after
  // them. Written as one arithmetic base rather than repeated offsets: the
  // image made this the fourth place that had to agree about where the font
  // objects start, and the fourth place is where they stop agreeing.
  const fontsAt = 4 + streams.length * 2;
  const imageAt = fontsAt + 3;
  const paletteAt = fontsAt + 4;

  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[2] = '<< /Type /Pages /Kids [' + pageIds.map((id) => id + ' 0 R').join(' ')
    + '] /Count ' + streams.length + ' >>';
  // F3 is Courier, for submitted code. A proportional face turns aligned
  // columns and indentation into something the candidate did not write, and
  // indentation is the one thing a reader of code needs intact.
  objects[3] = '<< /Font << /F1 ' + fontsAt + ' 0 R /F2 '
    + (fontsAt + 1) + ' 0 R /F3 ' + (fontsAt + 2) + ' 0 R >>'
    + (image ? ' /XObject << /Im0 ' + imageAt + ' 0 R >>' : '') + ' >>';

  streams.forEach((stream, i) => {
    const id = pageIds[i]!;
    objects[id] = '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 '
      + num(page.width) + ' ' + num(page.height) + '] /Resources 3 0 R /Contents '
      + (id + 1) + ' 0 R >>';
    objects[id + 1] = '<< /Length ' + Buffer.byteLength(stream, 'latin1')
      + ' >>\nstream\n' + stream + '\nendstream';
  });

  objects[fontsAt] =
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
  objects[fontsAt + 1] =
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>';
  objects[fontsAt + 2] =
    '<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>';

  /*
   * The one raster this writer can carry, and deliberately only one shape of
   * it: an /Indexed image whose lookup table and samples both arrive already
   * deflated. That is the whole of the image support -- no colour conversion,
   * no filtering, no soft mask -- because the only thing being drawn is a
   * logo, and a logo composited onto white on its way in needs none of them.
   *
   * The bytes go through as latin1, which maps 0..255 to 0..255 without
   * touching them; every other encoding this file could use would corrupt a
   * deflate stream on the way out.
   */
  if (image) {
    const data = Buffer.from(image.data, 'base64').toString('latin1');
    const table = Buffer.from(image.palette, 'base64').toString('latin1');
    objects[imageAt] = '<< /Type /XObject /Subtype /Image'
      + ' /Width ' + image.width + ' /Height ' + image.height
      + ' /ColorSpace [/Indexed /DeviceRGB ' + (image.colours - 1) + ' ' + paletteAt + ' 0 R]'
      + ' /BitsPerComponent 8 /Filter /FlateDecode'
      + ' /Length ' + Buffer.byteLength(data, 'latin1') + ' >>\nstream\n' + data + '\nendstream';
    objects[paletteAt] = '<< /Filter /FlateDecode /Length '
      + Buffer.byteLength(table, 'latin1') + ' >>\nstream\n' + table + '\nendstream';
  }

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

  /*
   * The mark, above the issuer's name and centred with everything else.
   *
   * Whose logo, and why this one. The institution's name is the largest thing
   * in the heading block and stays so; the mark underneath it is Onyx's,
   * because Onyx is what a reader has to trust when they go to check the
   * credential. The verification page is Onyx-branded and says so at its top,
   * and a document that carries a reader there should look like it came from
   * the same place -- otherwise the page they land on reads as an unrelated
   * third party asking them to believe it.
   */
  const markWidth = 74;
  const markHeight = markWidth * (ONYX_MARK.height / ONYX_MARK.width);
  let y = page.height - 78 - markHeight;
  out.push(image(mid - markWidth / 2, y, markWidth, markHeight));

  y -= 26;
  out.push(shaded(0.35, centre(y, cert.issuer.toUpperCase(), 12, true)));

  y -= 44;
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

  return serialise([out.join('\n')], page, ONYX_MARK);
}

/**
 * Draws the one image, scaled to `w` x `h` with its bottom-left at (x, y).
 *
 * PDF has no "draw at size" operator: an XObject is always painted into the
 * unit square, so the size and position are a transform matrix applied before
 * it. `q`/`Q` bracket that so the rest of the page is drawn in page
 * coordinates rather than in the logo's.
 */
function image(x: number, y: number, w: number, h: number): string {
  return 'q ' + num(w) + ' 0 0 ' + num(h) + ' ' + num(x) + ' ' + num(y)
    + ' cm /Im0 Do Q';
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

/**
 * A resume, as the document somebody attaches to an application.
 *
 * Deliberately not `pdfTable`. A table paginates on fixed-height rows and
 * repeats column headers at the top of every page, which is right for a mark
 * sheet and wrong for this: a resume's items are different heights, its
 * sections carry headings rather than columns, and a repeated header band on
 * page two would read as a second document. `pdfCertificate` already proved a
 * second layout can live in this file; this is the third, and it reuses every
 * private helper -- text, rule, wrap, fit, width, escapeText, serialise --
 * without exporting any of them or adding a dependency.
 *
 * A4 portrait, one column, dates right-aligned. The conventional shape, on
 * purpose: a resume is scanned in seconds by somebody who has read a hundred
 * others, and an inventive layout costs the reader time that the content
 * should be getting.
 *
 * **The Latin-1 limitation is real and is not hidden.** The writer is
 * Helvetica/WinAnsi, so a Devanagari or Han name renders as question marks.
 * `ResumeService` detects that before it happens and the page says so rather
 * than handing somebody a document that misspells their own name. Embedding a
 * font is the eventual fix and is a different piece of work.
 */
export interface PdfResumeSection {
  label: string;
  items: { title: string; subtitle: string; detail: string; when: string }[];
}

export interface PdfResume {
  name: string;
  headline: string;
  /** Email, phone, website -- whatever the holder chose to show. Joined for print. */
  contact: string[];
  objective: string;
  sections: PdfResumeSection[];
}

export function pdfResume(resume: PdfResume): Buffer {
  const page = A4_PORTRAIT;
  const left = MARGIN + 12;
  const right = page.width - MARGIN - 12;
  const inner = right - left;
  /** The date column, right-aligned, kept clear of the text that runs into it. */
  const dateWidth = 62;

  const pages: string[][] = [];
  let out: string[] = [];
  let y = 0;

  /**
   * A new sheet when the current one is full.
   *
   * Checked before every write rather than after, so nothing is ever drawn
   * below the bottom margin -- a line placed at a negative y does not error,
   * it simply renders off the page, which is how content silently disappears
   * from a generated document.
   */
  const room = (needed: number) => {
    if (y - needed >= MARGIN + 24) return;
    pages.push(out);
    out = [];
    y = page.height - MARGIN - 12;
  };

  // ---- the head: who this is ----------------------------------------------
  y = page.height - MARGIN - 24;
  out.push(text(left, y, resume.name, 18, true));

  if (resume.headline) {
    y -= 16;
    out.push(shaded(0.3, text(left, y, fit(resume.headline, inner, 10.5, false), 10.5, false)));
  }

  const contact = resume.contact.filter(Boolean).join('   ·   ');
  if (contact) {
    y -= 13;
    out.push(shaded(0.42, text(left, y, fit(contact, inner, 9, false), 9, false)));
  }

  y -= 10;
  out.push(rule(left, y, right, 0.8, 0.6));

  // ---- the sections -------------------------------------------------------
  for (const section of resume.sections) {
    if (!section.items.length) continue;

    // The heading and its first item stay together. A section title alone at
    // the foot of a page is the one pagination fault a reader notices.
    room(46);
    y -= 22;
    out.push(text(left, y, section.label.toUpperCase(), 10.5, true));
    y -= 5;
    out.push(rule(left, y, right, 0.5, 0.78));

    for (const item of section.items) {
      // An item with no title is a prose block -- the experience section is
      // one paragraph, not a list, and forcing it into title/detail would put
      // an empty bold line above it.
      if (!item.title) {
        for (const line of wrap(item.detail, inner, 9.5, false)) {
          room(13);
          y -= 13;
          out.push(text(left, y, line, 9.5, false));
        }
        continue;
      }

      room(15);
      y -= 15;
      out.push(text(left, y, fit(item.title, inner - dateWidth - 8, 10, true), 10, true));
      if (item.when) {
        // Right-aligned, measured rather than padded: a proportional font
        // makes a column of spaces a column of different widths.
        out.push(shaded(0.4,
          text(right - width(item.when, 9, false), y, item.when, 9, false)));
      }

      const meta = [item.subtitle, item.detail].filter(Boolean).join('   ·   ');
      if (meta) {
        for (const line of wrap(meta, inner - 4, 9, false)) {
          room(12);
          y -= 12;
          out.push(shaded(0.38, text(left, y, line, 9, false)));
        }
      }
    }
  }

  pages.push(out);
  return serialise(pages.map((p) => p.join('\n')), page);
}

/** One question on a script: what was asked, what was answered, what was right. */
export interface PdfScriptQuestion {
  /** 1-based, as it was printed on the paper. */
  number: number;
  type: string;
  prompt: string;
  /** What the candidate put. Already rendered to text by the caller. */
  answer: string;
  /**
   * The correct answer, or empty where there is none to show.
   *
   * Empty for an essay, and empty on a candidate's own copy while the paper
   * still allows them another attempt -- handing over the key early makes the
   * second attempt meaningless, and banks are shared between papers.
   */
  expected: string;
  /** Code submissions print as written. Empty for every other type. */
  code: string;
  awarded: number | null;
  points: number;
  /** A marker's note, where one was written. */
  comment: string;
}

export interface PdfScript {
  institution: string;
  assessment: string;
  course: string;
  /** Who sat it. Empty where the paper is marked anonymously. */
  candidate: string;
  rollNumber: string;
  attemptNumber: number;
  startedAt: string;
  submittedAt: string;
  score: number | null;
  maxScore: number;
  status: string;
  questions: PdfScriptQuestion[];
}

/**
 * One candidate's script: what they were asked, what they answered, what was
 * right, and what it earned.
 *
 * Deliberately not `pdfTable`. A table paginates on fixed-height rows and
 * repeats column headers; a script is prose of wildly varying length -- a
 * one-word short answer beside forty lines of submitted code -- and the only
 * sane pagination is "start a new sheet when this one is full", checked before
 * every write rather than after. A line placed below the bottom margin does not
 * error; it renders off the page, which is how content silently disappears from
 * a generated document.
 *
 * Code is printed in the monospaced face and NOT wrapped on whitespace. Wrapping
 * a submission on word boundaries reflows it into something the candidate did
 * not write, and indentation is the one thing a reader of code needs intact --
 * so long lines are cut at the margin with a marker rather than folded.
 *
 * The same builder serves the candidate's own copy and the marker's, because
 * they are the same document with different fields filled in: `expected` and
 * `comment` are simply empty where the reader may not see them. Two builders
 * would be two chances for one of them to leak a key the other withholds.
 */
export function pdfScript(script: PdfScript): Buffer {
  return serialise(scriptPages(script).map((page) => page.join('\n')), A4_PORTRAIT);
}

/**
 * Every script in one document, for the whole cohort.
 *
 * One file rather than a zip: a zip needs a compressor this project does not
 * have and gives a marker forty files to open. Each script starts on a fresh
 * sheet, so the bundle prints and reads exactly as the individual reports do.
 */
export function pdfScriptBundle(scripts: PdfScript[]): Buffer {
  const pages: string[][] = [];
  for (const script of scripts) pages.push(...scriptPages(script));
  if (!pages.length) {
    // A document that says why it is empty, rather than an unopenable file of
    // zero pages. "Nobody has sat this yet" is a real and common answer.
    const y = A4_PORTRAIT.height - MARGIN - 40;
    pages.push([text(MARGIN + 12, y, 'No submissions yet.', 14, true)]);
  }
  return serialise(pages.map((page) => page.join('\n')), A4_PORTRAIT);
}

/** The pages of one script, so a bundle can concatenate what a single report is. */
function scriptPages(script: PdfScript): string[][] {
  const page = A4_PORTRAIT;
  const left = MARGIN + 12;
  const right = page.width - MARGIN - 12;
  const inner = right - left;

  const pages: string[][] = [];
  let out: string[] = [];
  let y = page.height - MARGIN - 24;

  const room = (needed: number) => {
    if (y - needed >= MARGIN + 24) return;
    pages.push(out);
    out = [];
    y = page.height - MARGIN - 12;
  };
  const line = (value: string, size: number, bold: boolean, shade?: number) => {
    room(size + 4);
    y -= size + 4;
    out.push(shade === undefined
      ? text(left, y, value, size, bold)
      : shaded(shade, text(left, y, value, size, bold)));
  };

  // ---- the head: whose script this is, and what it scored -----------------
  out.push(text(left, y, script.assessment, 16, true));
  y -= 15;
  out.push(shaded(0.35, text(left, y,
    fit([script.course, script.institution].filter(Boolean).join('   ·   '), inner, 10, false),
    10, false)));

  y -= 15;
  const who = [
    script.candidate || 'Anonymous',
    script.rollNumber,
    'Attempt ' + script.attemptNumber,
  ].filter(Boolean).join('   ·   ');
  out.push(text(left, y, fit(who, inner, 10.5, true), 10.5, true));

  y -= 13;
  const when = [
    script.startedAt ? 'Started ' + script.startedAt : '',
    script.submittedAt ? 'Handed in ' + script.submittedAt : '',
    script.status,
  ].filter(Boolean).join('   ·   ');
  out.push(shaded(0.42, text(left, y, fit(when, inner, 9, false), 9, false)));

  // The mark, right-aligned against the rule below it: it is the first thing
  // read on a returned script and should not be hunted for.
  const mark = script.score === null
    ? 'Not marked yet'
    : String(script.score) + ' / ' + String(script.maxScore);
  out.push(text(right - width(mark, 13, true), y + 13, mark, 13, true));

  y -= 10;
  out.push(rule(left, y, right, 0.8, 0.6));

  // ---- the questions ------------------------------------------------------
  for (const q of script.questions) {
    // The number and the first line of the prompt stay together: a question
    // number alone at the foot of a page is the pagination fault a reader
    // notices.
    room(52);
    y -= 20;
    const head = String(q.number) + '.  ' + q.type;
    out.push(text(left, y, head, 10, true));
    const earned = q.awarded === null
      ? '— / ' + String(q.points)
      : String(q.awarded) + ' / ' + String(q.points);
    out.push(text(right - width(earned, 10, true), y, earned, 10, true));

    for (const l of wrap(q.prompt, inner, 10, false)) line(l, 10, false);

    if (q.answer) {
      line('Answer', 8.5, true, 0.45);
      for (const l of wrap(q.answer, inner - 10, 9.5, false)) line(l, 9.5, false);
    } else if (!q.code) {
      line('Not answered', 9.5, false, 0.5);
    }

    if (q.code) {
      line('Submitted code', 8.5, true, 0.45);
      /*
       * Not wrapped on whitespace.
       *
       * Reflowing a submission on word boundaries produces something the
       * candidate did not write, and indentation is the one thing a reader of
       * code needs intact. Long lines are cut at the margin with a marker, so
       * what is shown is always a true prefix of what was submitted.
       */
      for (const raw of q.code.split('\n')) {
        room(12);
        y -= 12;
        const shown = width(raw, 8.5, false) > inner - 12
          ? fit(raw, inner - 20, 8.5, false) + ' …'
          : raw;
        out.push(mono(left + 8, y, shown, 8.5));
      }
    }

    if (q.expected) {
      line('Correct answer', 8.5, true, 0.45);
      for (const l of wrap(q.expected, inner - 10, 9.5, false)) line(l, 9.5, false);
    }

    if (q.comment) {
      line('Marker', 8.5, true, 0.45);
      for (const l of wrap(q.comment, inner - 10, 9.5, false)) line(l, 9.5, false, 0.25);
    }

    room(8);
    y -= 8;
    out.push(rule(left, y, right, 0.4, 0.85));
  }

  pages.push(out);
  return pages;
}
