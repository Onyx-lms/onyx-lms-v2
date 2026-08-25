/**
 * Three files, one page — composed the same way everywhere it is shown.
 *
 * A web answer is `index.html`, `index.css` and `index.js`. Nothing on the
 * server renders them: the preview is built here as a single document string
 * and handed to an iframe's `srcdoc`, which means the candidate's page runs in
 * the reader's own browser and never touches ours.
 *
 * **Written once because it must not differ.** A candidate previews their page
 * while they build it, a marker previews the same files an hour later, and an
 * operator previews them again from the console. If those three composed the
 * document differently — one injecting the stylesheet in the body, another
 * running the script before the DOM exists — the mark would be given for a
 * page the candidate never saw. So there is one function and three callers.
 */

/*
 * The files, and the page they start as, come from one place.
 *
 * `@onyx/core/web-starter` has no imports of its own, so pulling it into a
 * browser bundle costs three strings rather than the service barrel. Both
 * sides need these -- the editor to fill empty tabs, the API to seed a web
 * problem created without files -- and when they were two copies, a problem
 * authored through the API could never be published.
 */
export {
  WEB_FILES, startingFiles, DEFAULT_HTML, DEFAULT_CSS, DEFAULT_JS, type WebFile,
} from '@onyx/core/web-starter';
import { WEB_FILES as FILES, type WebFile as File } from '@onyx/core/web-starter';

export type WebFiles = Partial<Record<File, string>> & Record<string, string | undefined>;

/** What each file is for, in the words shown above its editor. */
export const WEB_FILE_HINT: Record<string, string> = {
  'index.html': 'The page itself. This is what the preview opens.',
  'index.css': 'Styling. Linked into the page for you — no <link> tag needed.',
  'index.js': 'Behaviour. Run after the page has loaded — no <script> tag needed.',
};

/**
 * The sandbox the preview runs under, and the reason for each omission.
 *
 * `allow-scripts` is the only permission granted, because a web question is
 * partly a JavaScript question and a preview that cannot run script would
 * assess half of it.
 *
 * What is deliberately NOT granted matters more:
 *
 *   * **`allow-same-origin` is absent**, which is the whole security story.
 *     Without it the frame gets an opaque origin: the page inside cannot read
 *     our cookies, cannot reach `parent.document`, cannot call our API as the
 *     signed-in user. A candidate's submission is untrusted code that a marker
 *     opens while holding an administrator's session, and this is what makes
 *     that safe. Granting both `allow-scripts` and `allow-same-origin` would
 *     let the frame remove its own sandbox attribute — the browser warns about
 *     exactly this pairing, and it must never be added here.
 *   * `allow-top-navigation` is absent, so a submitted page cannot redirect
 *     the marker away mid-marking.
 *   * `allow-modals` is absent, so an `alert()` in a loop cannot lock the tab
 *     somebody is marking thirty scripts in.
 *   * `allow-popups` and `allow-forms` are absent: neither is part of what is
 *     being assessed, and both are ways to take a reader somewhere else.
 */
export const PREVIEW_SANDBOX = 'allow-scripts';

/**
 * A Content-Security-Policy for the composed document.
 *
 * Belt and braces over the sandbox: the page may use what it was given and
 * nothing off the network. A submission that quietly fetches a stylesheet from
 * a CDN would render differently for the candidate and the marker depending on
 * who had it cached — and a submission that beacons out is exfiltrating the
 * paper. `data:` is allowed for images so an inline SVG or a small embedded
 * picture still works, which is a normal thing to teach.
 */
const PREVIEW_CSP = [
  "default-src 'none'",
  "style-src 'unsafe-inline'",
  "script-src 'unsafe-inline'",
  "img-src data:",
  "font-src data:",
].join('; ');

const escapeClose = (text: string) => text.replace(/<\/(script|style)/gi, '<\\/$1');

/**
 * Builds the document an iframe renders.
 *
 * The CSS goes at the end of `<head>` so it applies before first paint and a
 * candidate's own `<style>` block still wins where they wrote one. The JS goes
 * at the end of `<body>` so the DOM it manipulates already exists — putting it
 * in the head is the single most common reason a beginner's page "does not
 * work", and having the preview reproduce that would be assessing our
 * scaffolding rather than their code.
 *
 * A fragment with no `<html>` is wrapped rather than refused: a first lesson
 * in HTML is often three tags, and refusing to render that would be refusing
 * to render the thing being taught.
 */
export function composePreview(files: WebFiles, entry = 'index.html'): string {
  const html = files[entry] ?? files['index.html'] ?? '';
  const css = files['index.css'] ?? '';
  const js = files['index.js'] ?? '';

  const style = css.trim() ? '<style>\n' + escapeClose(css) + '\n</style>' : '';
  const script = js.trim() ? '<script>\n' + escapeClose(js) + '\n</script>' : '';
  const meta = '<meta http-equiv="Content-Security-Policy" content="' + PREVIEW_CSP + '">';

  const looksWhole = /<html[\s>]/i.test(html);
  if (!looksWhole) {
    return '<!doctype html><html><head><meta charset="utf-8">' + meta + style
      + '</head><body>' + html + script + '</body></html>';
  }

  let out = html;
  // Injected where they belong, or appended if the document has no such tag --
  // a page can legally omit </head>, and a preview that silently dropped the
  // stylesheet because of it would be blamed on the candidate.
  out = /<\/head>/i.test(out)
    ? out.replace(/<\/head>/i, meta + style + '</head>')
    : out.replace(/<html([^>]*)>/i, '<html$1><head>' + meta + style + '</head>');
  out = /<\/body>/i.test(out)
    ? out.replace(/<\/body>/i, script + '</body>')
    : out + script;
  return out;
}

/** True when a response is a web answer rather than a code one or a string. */
export function isWebAnswer(value: unknown): value is WebFiles {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const files = (value as { files?: unknown }).files ?? value;
  if (!files || typeof files !== 'object') return false;
  return FILES.some((path) => typeof (files as Record<string, unknown>)[path] === 'string');
}

/** The files out of a stored response, whichever shape it arrived in. */
export function filesOf(value: unknown): Record<File, string> {
  const source = (value && typeof value === 'object'
    ? ((value as { files?: unknown }).files ?? value)
    : {}) as WebFiles;
  return {
    'index.html': typeof source['index.html'] === 'string' ? source['index.html'] : '',
    'index.css': typeof source['index.css'] === 'string' ? source['index.css'] : '',
    'index.js': typeof source['index.js'] === 'string' ? source['index.js'] : '',
  };
}
