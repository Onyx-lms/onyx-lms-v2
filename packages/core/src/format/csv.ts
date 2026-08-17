/**
 * CSV, written out once.
 *
 * Two exports the exams office and the registrar both wanted grew their own
 * copy of the same quoting rule, which is exactly how two exports end up
 * disagreeing about what to do with a learner whose name contains a comma.
 *
 * The rule is RFC 4180's: quote a cell only when it contains a quote, a comma
 * or a line break, and double any quote inside it. Rows are joined with CRLF
 * and the file ends with one, because that is what spreadsheet software on
 * Windows expects and this is a Windows shop.
 */

/** Quotes only where it matters, and doubles embedded quotes as CSV requires. */
export function csvCell(value: unknown): string {
  const s = String(value ?? '');
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

/** A header row and its body, joined into a complete CSV document. */
export function csvDocument(header: readonly unknown[], rows: readonly (readonly unknown[])[]): string {
  return [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
