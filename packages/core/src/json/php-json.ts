/**
 * F-05 -- PHP-compatible JSON codec.
 *
 * Acceptance criterion for F-05 is: "PHP-written JSON read by Node and
 * rewritten produces byte-identical text". Plain JSON.stringify does NOT
 * satisfy that, because PHP's json_encode differs in two ways by default:
 *
 *   1. It escapes forward slashes:  "a/b"  ->  "a\/b"
 *   2. It escapes all non-ASCII:    "café" ->  "café"
 *
 * Getting this wrong is silent and nasty: rows written by Node stop matching
 * rows written by Laravel, and any code still running on the PHP side during a
 * phased cutover sees different bytes for the same logical value.
 */

/** Equivalent of PHP `json_encode($value)` with default flags. */
export function phpJsonEncode(value: unknown): string {
  const raw = JSON.stringify(value);
  if (raw === undefined) return 'null';
  let out = '';
  for (const ch of splitUtf16(raw)) {
    const code = ch.charCodeAt(0);
    if (ch === '/') {
      out += '\\/'; // PHP escapes solidus; JSON.stringify does not.
    } else if (code > 0x7f) {
      // PHP emits \uXXXX per UTF-16 code unit, surrogate pairs included.
      out += '\\u' + code.toString(16).padStart(4, '0');
    } else {
      out += ch;
    }
  }
  return out;
}

/**
 * Equivalent of PHP `json_decode($value, true)`.
 * Returns `fallback` instead of throwing, because Laravel's json_decode
 * returns null on malformed input rather than raising -- and several of these
 * columns contain legacy junk written years ago.
 */
export function phpJsonDecode<T = unknown>(text: string | null | undefined, fallback: T): T {
  if (text === null || text === undefined || text === '') return fallback;
  try {
    const parsed = JSON.parse(text) as T;
    return parsed === null ? fallback : parsed;
  } catch {
    return fallback;
  }
}

/** Iterate a string by UTF-16 code unit (not code point) to mirror PHP output. */
function* splitUtf16(s: string): Generator<string> {
  for (let i = 0; i < s.length; i++) yield s[i]!;
}

/** True when re-encoding `text` reproduces it byte-for-byte. Used by the
 *  parity test and safe to call in dev to catch drift early. */
export function isPhpJsonStable(text: string): boolean {
  return phpJsonEncode(phpJsonDecode(text, null)) === text;
}
