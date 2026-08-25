/**
 * The page a web question starts from — the one definition, used by both sides.
 *
 * It lives in `@onyx/core` rather than in the web app because BOTH need it and
 * they must not disagree. The editor fills three empty tabs with it; the API
 * seeds it onto a web problem created without files, so a problem authored
 * through the API is publishable rather than a draft nobody can publish. When
 * those two differed, every web problem created outside the browser was
 * refused at publish time with "add index.html" — and the colourful default
 * the client was promised existed only in the client.
 *
 * Imported through the package's own `./web-starter` entry point so a browser
 * bundle gets three strings and not the whole service barrel.
 *
 * It has no imports, and must not gain any.
 */

/** The files a web answer is made of, in the order they are edited. */
export const WEB_FILES = ['index.html', 'index.css', 'index.js'] as const;
export type WebFile = (typeof WEB_FILES)[number];

/**
 * What an empty web page starts as.
 *
 * A finished-looking page, not a blank file and not a bare `<h1>Hello</h1>`.
 * The first thing somebody sees when they open a web question decides whether
 * they believe the tool works, and — more usefully — whether they can tell at
 * a glance which file does what. So the starter demonstrates all three:
 *
 *   * the HTML holds the structure and nothing else, so deleting a line has a
 *     visible, obvious effect;
 *   * the CSS is where every colour, every size and the animation live, and it
 *     is commented in the places somebody would want to change first;
 *   * the JavaScript does one small thing that is plainly running — a counter
 *     wired to a button — so a learner can see the difference between "the
 *     page loaded" and "my script works".
 *
 * It is deliberately editable rather than precious. Everything is named in
 * plain words, the colours sit in custom properties at the top of the
 * stylesheet, and the comment above them says what to do with them.
 */
export const DEFAULT_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Welcome to Onyx EduTech</title>
  </head>
  <body>
    <main class="card">
      <p class="eyebrow">Onyx EduTech</p>

      <h1 class="title">
        Welcome to <span class="shine">Onyx&nbsp;EduTech</span>
      </h1>

      <p class="subtitle">
        This page is yours. Change the words here, the colours in
        <code>index.css</code>, and what the button does in <code>index.js</code>.
      </p>

      <button class="cta" id="cheer" type="button">Give it a try</button>
      <p class="count" id="count">Pressed 0 times</p>
    </main>
  </body>
</html>
`;

export const DEFAULT_CSS = `/* ---------------------------------------------------------------
   Change these four colours first — everything below follows them.
   --------------------------------------------------------------- */
:root {
  --ink: #10233f;
  --start: #6d5efc;   /* the top of the background   */
  --end: #22d3ee;     /* the bottom of the background */
  --accent: #ff7a59;  /* the button                   */
}

* { box-sizing: border-box; }

body {
  margin: 0;
  min-height: 100vh;
  display: grid;
  place-items: center;
  padding: 1.5rem;
  font-family: "Segoe UI", system-ui, -apple-system, sans-serif;
  color: var(--ink);
  background: linear-gradient(140deg, var(--start), var(--end));
}

.card {
  max-width: 34rem;
  padding: 2.5rem 2rem;
  text-align: center;
  background: rgba(255, 255, 255, 0.94);
  border-radius: 1.5rem;
  box-shadow: 0 1.5rem 3rem rgba(16, 35, 63, 0.25);
  animation: rise 0.6s ease-out both;
}

.eyebrow {
  margin: 0 0 0.75rem;
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--start);
}

.title {
  margin: 0;
  font-size: clamp(1.75rem, 6vw, 2.75rem);
  line-height: 1.15;
}

/* The moving gradient on the two words. Delete this rule to see the
   difference it makes. */
.shine {
  background: linear-gradient(90deg, var(--start), var(--accent), var(--end), var(--start));
  background-size: 300% 100%;
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  animation: slide 6s linear infinite;
}

.subtitle {
  margin: 1rem 0 1.75rem;
  font-size: 1rem;
  line-height: 1.6;
  color: #46586f;
}

code {
  padding: 0.1rem 0.35rem;
  border-radius: 0.35rem;
  background: #eef1f6;
  font-size: 0.9em;
}

.cta {
  padding: 0.8rem 1.6rem;
  border: 0;
  border-radius: 999px;
  font: inherit;
  font-weight: 700;
  color: #fff;
  background: var(--accent);
  cursor: pointer;
  transition: transform 0.15s ease, box-shadow 0.15s ease;
  box-shadow: 0 0.5rem 1rem rgba(255, 122, 89, 0.4);
}
.cta:hover { transform: translateY(-2px); box-shadow: 0 0.75rem 1.4rem rgba(255,122,89,.45); }
.cta:active { transform: translateY(0); }

.count {
  margin: 1rem 0 0;
  font-size: 0.9rem;
  color: #6b7a90;
}

@keyframes rise {
  from { opacity: 0; transform: translateY(1rem); }
  to   { opacity: 1; transform: none; }
}
@keyframes slide {
  to { background-position: 300% 0; }
}

/* Somebody who has asked their system to stop animations gets a still page. */
@media (prefers-reduced-motion: reduce) {
  .card, .shine { animation: none; }
}
`;

export const DEFAULT_JS = `// This file runs after the page has loaded.
// Try changing the message, or what the button does.

const button = document.getElementById('cheer');
const label = document.getElementById('count');
let presses = 0;

button.addEventListener('click', () => {
  presses += 1;
  label.textContent = presses === 1
    ? 'Pressed once — now open index.css and change a colour.'
    : 'Pressed ' + presses + ' times';
});
`;


/**
 * The three files a problem starts from, with nothing missing.
 *
 * Anything the author supplied wins; anything they left out falls back to the
 * page above. A problem set only as HTML still gets a stylesheet and a script
 * file to write into, rather than two tabs that cannot be opened.
 */
export function startingFiles(
  starter: Record<string, string | undefined> | null | undefined,
): Record<WebFile, string> {
  const from = starter ?? {};
  return {
    'index.html': typeof from['index.html'] === 'string' ? from['index.html'] : DEFAULT_HTML,
    'index.css': typeof from['index.css'] === 'string' ? from['index.css'] : DEFAULT_CSS,
    'index.js': typeof from['index.js'] === 'string' ? from['index.js'] : DEFAULT_JS,
  };
}
