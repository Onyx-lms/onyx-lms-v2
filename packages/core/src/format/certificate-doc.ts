/**
 * CAR-03 -- the credential on the institution's own certificate artwork.
 *
 * The previous document (pdfCertificate, in pdf.ts) was drawn from nothing by
 * this repository's own dependency-free PDF writer. That writer can place text
 * and one indexed-palette logo, and its header says plainly that full-colour
 * artwork is the point at which to reach for a library. The supplied templates
 * are full-colour: five accreditation marks, a gold seal, a QR block and a
 * two-tone border. So this renders on top of the supplied PDF with pdf-lib
 * rather than trying to redraw it.
 *
 * WHAT COMES FROM THE TEMPLATE, AND WHAT IS DRAWN
 *
 * The artwork carries everything constant: the marks, the border, ONYXEDUTECH,
 * "THIS CERTIFICATE IS PRESENTED TO", the rule the name sits on, #startupindia
 * and the VERIFIED badge. Drawn per credential: the title, the holder's name,
 * the sentence naming what was achieved, the dates, the validation id and the
 * QR code.
 *
 * THREE THINGS IN THE SUPPLIED ARTWORK ARE DELIBERATELY PAINTED OVER
 *
 *   * **The title.** One template is stored, not four; the title is what
 *     distinguishes them and it sits on plain white, so it is drawn.
 *
 *   * **The body sentence.** Every one of the four supplied templates reads
 *     "recognises the successful internship competition on" -- correct for
 *     none of them but the internship, and "competition" is a slip for
 *     "completion". A course certificate that says a learner completed an
 *     internship is wrong on the one line a reader actually reads, so the
 *     sentence is drawn per kind instead.
 *
 *   * **The QR code.** The artwork's QR is a fixed image and points wherever
 *     it pointed when the file was made. On a product whose whole claim is
 *     that a stranger can check a credential, shipping a code that resolves to
 *     the wrong place -- or to nothing -- is worse than shipping no code. It is
 *     replaced with one encoding this credential's own verification URL.
 *
 * COORDINATES were measured off a 1600px render of the supplied PDF and
 * converted at 1600/842.25 px per point, with the MediaBox offset already in
 * them: the render's bottom edge IS y=8.58, so a measured 385.6 is 385.6 in
 * the page's own space. pdf-lib draws in that same raw space, so nothing is
 * added on top -- doing so once put every painted-out region ~9pt high and
 * left a ghost of the original title showing beneath the new one.
 */
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import QRCode from 'qrcode';
import { CERTIFICATE_TEMPLATE_B64 } from './certificate-template.ts';

/** Horizontal centre of the artwork's composition, not of the trim. */
const CENTRE = 431;

const INK = rgb(0.05, 0.05, 0.08);
const WHITE = rgb(1, 1, 1);

/**
 * What each certificate kind is called, and how its one sentence reads.
 *
 * `kind` is a varchar with no constraint behind it, so an unknown value is a
 * real possibility rather than a type error -- it falls back to the course
 * wording rather than rendering a certificate with an empty title.
 */
interface KindCopy {
  title: string;
  /** Reads as: "This certificate recognises {sentence} “{subject}”." */
  sentence: string;
  /**
   * The design this kind prints on, named the way a person would say it.
   *
   * Several kinds share one design -- a contest placing and an assessment
   * result both print as a Performance certificate -- so this is what a
   * register should show and filter by. `title` is the shouty line ON the
   * document; this is the name OF the document.
   */
  template: string;
}

const KINDS: Record<string, KindCopy> = {
  course: { title: 'COURSE COMPLETION CERTIFICATE', sentence: 'the successful completion of', template: 'Course completion' },
  program: { title: 'COURSE COMPLETION CERTIFICATE', sentence: 'the successful completion of', template: 'Course completion' },
  internship: { title: 'INTERNSHIP CERTIFICATE', sentence: 'the successful completion of an internship in', template: 'Internship' },
  project: { title: 'PROJECT COMPLETION CERTIFICATE', sentence: 'the successful completion of the project', template: 'Project completion' },
  performance: { title: 'PERFORMANCE CERTIFICATE', sentence: 'outstanding performance in', template: 'Performance' },
  assessment: { title: 'PERFORMANCE CERTIFICATE', sentence: 'outstanding performance in', template: 'Performance' },
  contest: { title: 'PERFORMANCE CERTIFICATE', sentence: 'outstanding performance in', template: 'Performance' },
};

export function certificateCopy(kind: string | null | undefined): KindCopy {
  return KINDS[String(kind ?? 'course')] ?? KINDS.course!;
}

/** Every kind this document can render, for a picker and a schema to share. */
export const CERTIFICATE_KINDS = [
  'course', 'internship', 'project', 'performance',
  'assessment', 'contest', 'program',
] as const;

export type CertificateKind = (typeof CERTIFICATE_KINDS)[number];

/**
 * The four supplied designs, in the order the picker offers them.
 *
 * Derived from the map rather than written out again: a kind added above
 * without a design here would otherwise be filterable to an empty list.
 */
export const CERTIFICATE_TEMPLATES: string[] =
  [...new Set(CERTIFICATE_KINDS.map((k) => KINDS[k]!.template))];

/** Which kinds print on a given design. */
export function kindsForTemplate(template: string): string[] {
  return CERTIFICATE_KINDS.filter((k) => KINDS[k]!.template === template);
}

export interface BrandedCertificate {
  /** The institution issuing it. Printed under the name, above the sentence. */
  issuer: string;
  holder: string;
  /** What it certifies -- the course, project or internship subject. */
  title: string;
  kind?: string | null;
  credentialId: string;
  /** Already formatted for a reader, e.g. "3 September 2026". */
  issuedAt: string;
  /** The period the work covered, if the issuer recorded one. */
  from?: string | null;
  to?: string | null;
  /** Where a stranger checks it. Encoded in the QR and printed as text. */
  verifyUrl: string;
}

/** Paints out a region of the artwork so something else can go there. */
function clear(page: PDFPage, x: number, y: number, w: number, h: number) {
  page.drawRectangle({ x, y, width: w, height: h, color: WHITE });
}

/** Draws `value` centred on `cx`, shrinking it until it fits `maxWidth`. */
function centred(
  page: PDFPage, font: PDFFont, value: string,
  cx: number, y: number, size: number, maxWidth: number, colour = INK,
) {
  let s = size;
  while (s > 6 && font.widthOfTextAtSize(value, s) > maxWidth) s -= 0.5;
  const w = font.widthOfTextAtSize(value, s);
  page.drawText(value, { x: cx - w / 2, y, size: s, font, color: colour });
  return s;
}

export async function renderBrandedCertificate(cert: BrandedCertificate): Promise<Buffer> {
  const doc = await PDFDocument.load(Buffer.from(CERTIFICATE_TEMPLATE_B64, 'base64'));
  const page = doc.getPage(0);
  const serif = await doc.embedFont(StandardFonts.TimesRoman);
  const serifBold = await doc.embedFont(StandardFonts.TimesRomanBold);
  const copy = certificateCopy(cert.kind);

  // ---- title ---------------------------------------------------------------
  // The stored artwork carries the course-completion title; paint it out and
  // draw whichever of the four this credential is.
  clear(page, 145, 381, 570, 30);
  centred(page, serifBold, copy.title, CENTRE, 386, 28, 520);

  // ---- the holder, on the rule --------------------------------------------
  // The largest thing on the page, because it is what the certificate is for.
  centred(page, serifBold, cert.holder, 432.7, 310, 26, 350);

  // ---- the sentence, and what it was for ----------------------------------
  // Covers the supplied "successful internship competition on" line and the
  // quoted blank beneath it. Kept clear of "From Onyx Edutech Pvt.Ltd." above
  // (which ends at y 267) and the "The participant has demonstrated" line
  // below (which starts at y 217).
  clear(page, 176, 223, 500, 42);
  centred(page, serif, 'This certificate recognises ' + copy.sentence, CENTRE, 249, 13.5, 375);
  centred(page, serif, '“' + cert.title + '”.', CENTRE, 234, 13.5, 375);

  // ---- the period ----------------------------------------------------------
  // Drawn just above the supplied rules rather than replacing them: the rules
  // are part of the artwork, and a date sitting on one reads as filled in.
  // With no period recorded, the issue date goes on the first rule and the
  // second is left blank rather than inventing an end.
  const from = cert.from ?? cert.issuedAt;
  const to = cert.to ?? '';
  if (from) centred(page, serif, from, 330, 161, 12, 172);
  if (to) centred(page, serif, to, 525, 161, 12, 160);

  // ---- validation id -------------------------------------------------------
  // Replaces the artwork's XXXXXXXXXX. The "Validation ID" label beneath it is
  // part of the template and stays, so the clear stops short of it.
  clear(page, 358, 104, 150, 17);
  centred(page, serifBold, cert.credentialId, 430, 107, 10.5, 145);

  // ---- the QR that actually resolves --------------------------------------
  // Stops above the VERIFIED badge (which ends at y 91) so the badge survives.
  // Measured off the artwork a row at a time: its QR occupies y 105-152 and
  // the VERIFIED badge y 84-99, with clear space between. Clearing below 103
  // clips the badge; clearing above 152 leaves the old code's top rows.
  clear(page, 641, 103, 78, 51);
  const png = await QRCode.toBuffer(cert.verifyUrl, {
    type: 'png', errorCorrectionLevel: 'M', margin: 0, scale: 8,
    color: { dark: '#0d1220ff', light: '#ffffffff' },
  });
  const qr = await doc.embedPng(png);
  // Same 47pt square, in the same place, as the code it replaces.
  const size = 47;
  page.drawImage(qr, { x: 656, y: 105, width: size, height: size });

  const bytes = await doc.save();
  return Buffer.from(bytes);
}
