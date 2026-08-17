/**
 * Port of slugify() from Common_helper.php.
 *
 * Deliberately NOT a generic slug helper: it keeps letters, marks and numbers
 * from ANY script (Arabic, CJK, accented Latin), because the platform ships
 * four languages and Laravel produced those slugs. A naive ASCII slugifier
 * would turn an Arabic course title into an empty string.
 */
export function slugify(input: string): string {
  const normalized = (input ?? '').normalize('NFC').trim();
  return normalized
    .replace(/[\s-]+/gu, '-')                 // runs of space or hyphen -> one hyphen
    .replace(/[^\p{L}\p{M}\p{N}-]/gu, '')     // drop anything else
    .toLowerCase();
}

/** Laravel appends the new row id, which is what makes duplicates unique. */
export function slugWithId(title: string, id: number): string {
  return slugify(title) + '-' + id;
}
