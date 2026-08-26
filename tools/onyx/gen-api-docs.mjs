/**
 * DOC-01 -- the API reference, generated from the routes.
 *
 *   node tools/onyx/gen-api-docs.mjs        # writes docs/API.md
 *   node tools/onyx/gen-api-docs.mjs --check # fails if it is out of date
 *
 * Generated rather than written, for the same reason the schema is: a
 * hand-maintained endpoint list is accurate on the day it is written and wrong
 * by the end of the sprint. `--check` runs in the gate, so a new route with no
 * documentation fails the build rather than being noticed a year later.
 *
 * What it cannot infer, it does not claim. Request and response shapes are not
 * reverse-engineered from zod schemas here -- a half-right body is worse than a
 * pointer to the route file, which is always right.
 */
import fs from 'node:fs';
import path from 'node:path';

const REPO = path.dirname(path.dirname(new URL('.', import.meta.url).pathname
  .replace(/^[/]([A-Za-z]:)/, '$1')));
const ROUTES = path.join(REPO, 'apps', 'web', 'src', 'server', 'routes', 'onyx');
const OUT = path.join(REPO, 'docs', 'API.md');

/** Which requirement each route file serves, for the section headings. */
const SECTIONS = {
  'tenancy.routes.ts': ['Tenancy, people and audit', 'CMP-05 / F-01 to F-06'],
  'learn.routes.ts': ['Learning', 'LRN-01 to LRN-04'],
  'codelab.routes.ts': ['Code Lab', 'LAB-01 to LAB-05'],
  'assess.routes.ts': ['Assessment', 'ASS-01 to ASS-04'],
  'career.routes.ts': ['Career', 'CAR-01 to CAR-05'],
  'engage.routes.ts': ['Engagement and support', 'LRN-05, LRN-06'],
  'campus.routes.ts': ['Campus operations', 'CMP-01 to CMP-04'],
  'notify.routes.ts': ['Notifications', 'the inbox'],
  'platform.routes.ts': ['Platform console', 'above every institution'],
};

/**
 * The role constants each route file defines, so `...EXAMS` can be reported as
 * the roles it stands for rather than as a variable name nobody can look up
 * from a table.
 */
function roleConstants(src) {
  const out = {};
  const re = /const\s+([A-Z_]+)\s*=\s*\[([^\]]*)\]\s*as const/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    out[m[1]] = m[2].split(',')
      .map((r) => r.trim().replace(/['"]/g, ''))
      .filter(Boolean)
      .join(', ');
  }
  return out;
}

/**
 * Every function declared in a route file, by name, with its body.
 *
 * Route files define their own guard helpers -- `requireCourseManager` wraps
 * `requireOnyx` plus a per-course teaching check, `supportViewerOf` wraps it
 * plus a viewer projection -- and a handler that calls one is guarded just as
 * firmly as one that calls `requireOnyx` directly. Reading only for the
 * literal names meant those handlers looked bare. Bodies are taken by brace
 * matching rather than by regex because a guard helper contains braces.
 */
function localFunctions(src) {
  const out = {};

  /** The body that starts at the first `{` on or after `from`. */
  const bodyAt = (from) => {
    const open = src.indexOf('{', from);
    if (open < 0) return null;
    let depth = 0;
    for (let end = open; end < src.length; end += 1) {
      if (src[end] === '{') depth += 1;
      else if (src[end] === '}') { depth -= 1; if (depth === 0) return src.slice(open, end + 1); }
    }
    return null;
  };

  /*
   * Both spellings. `requireCourseManager` is a declaration and
   * `supportViewerOf` is a const arrow -- reading only the first spelling left
   * the six support endpoints unresolved, which is the same bug one level in.
   */
  const forms = [
    /(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/g,
    /(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\([^)]*\)[^=;{]*=>\s*\{/g,
  ];
  /**
   * The `@guard` line in the doc comment directly above a helper, if it has
   * one.
   *
   * Following a helper down to `requireOnyx` proves a token is required, but
   * it loses the narrowing the helper itself adds -- `requireCourseManager`
   * resolves to "any member" that way, which reads as though a student may
   * delete a course. Understating a guard is a smaller lie than inventing one
   * and still a lie, so a helper that means something narrower says so, next
   * to itself, where the person editing it will see it.
   */
  const tagAbove = (at) => {
    const before = src.slice(0, at);
    const close = before.lastIndexOf('*/');
    if (close < 0 || before.slice(close + 2).trim() !== '') return null;
    const open = before.lastIndexOf('/**', close);
    if (open < 0) return null;
    const tag = before.slice(open, close).match(/@guard\s+([^\n*]+)/);
    return tag ? tag[1].trim() : null;
  };

  for (const re of forms) {
    let m;
    while ((m = re.exec(src)) !== null) {
      const body = bodyAt(re.lastIndex - 1);
      if (body) out[m[1]] = { body, tag: tagAbove(m.index) };
    }
  }
  return out;
}

/**
 * Who may call it, read from the guard inside the handler.
 *
 * Read from the source rather than from a comment: a comment can be wrong and
 * a guard cannot. The first version of this searched too small a window and
 * reported every guarded route as public. The second still did, for a
 * different reason: it knew four guard names by heart, and a route file that
 * wrapped one in a helper of its own fell through to the default. That put
 * thirteen guarded endpoints -- publishing a course, closing it, withdrawing a
 * named learner, the whole support queue -- into this document as **no token**
 * — public by design. Every one of them answers 401; the product was never
 * open, only the document said it was.
 *
 * A security document that says the opposite of the truth is worse than no
 * document, so this version does two things differently. It FOLLOWS local
 * helpers instead of pattern-matching a fixed list of names, and it refuses to
 * call anything public that is not named in PUBLIC below -- an unrecognised
 * guard now fails the build, where before it published a falsehood.
 */
function guardOf(body, constants, locals, seen = new Set()) {
  const spread = body.match(/requireOnyxRole\([\s\S]{0,120}?\.\.\.([A-Z_]+)\s*\)/);
  if (spread) return constants[spread[1]] ?? spread[1].toLowerCase();

  const named = body.match(/requireOnyxRole\(\s*asReq\(req\),\s*ctx\.jwtSecret,\s*([^)]+)\)/);
  if (named) {
    return named[1].split(',')
      .map((r) => r.trim().replace(/['"]/g, ''))
      .filter((r) => r && !r.startsWith('...'))
      .join(', ');
  }

  if (/requirePlatformAdmin|requirePlatformSession/.test(body)) return 'platform admin';
  if (/\bviewerOf\(req\)|requireOnyx\(/.test(body)) return 'any member';

  /*
   * Nothing matched directly, so follow whatever local helper this handler
   * calls. Depth is bounded by `seen`: a helper that calls itself, or two that
   * call each other, must not spin.
   */
  for (const name of Object.keys(locals)) {
    if (seen.has(name)) continue;
    if (!new RegExp('\\b' + name + '\\s*\\(').test(body)) continue;
    seen.add(name);
    const helper = locals[name];
    const via = guardOf(helper.body, constants, locals, seen);
    // The helper proved a token is needed; its own `@guard` says who for.
    if (via !== null) return helper.tag ?? via;
  }
  return null;
}

/**
 * The endpoints that genuinely take no token, and why each one does.
 *
 * An allow-list rather than a fallback. The reasons are here so that adding a
 * line is a decision somebody has to write a sentence to defend, rather than
 * something that happens by forgetting to add a guard.
 */
const PUBLIC = {
  '/api/onyx/auth/login': 'signing in -- there is no token yet',
  '/api/onyx/platform/login': 'the operator sign-in, likewise',
  '/api/onyx/auth/signup/start': 'signing up -- the OTP is the credential',
  '/api/onyx/auth/signup/verify': 'signing up, second leg',
  '/api/onyx/auth/signup/sections': 'the sign-up form has to render before anyone has an account',
  '/api/onyx/auth/signup/institutions': 'likewise -- the institution picker',
  '/api/onyx/auth/signup/institution': 'likewise -- one institution by code',
  '/api/onyx/verify/:credentialId': 'a verifier has no account and never will',
  '/api/onyx/p/:username': 'a public profile is public on purpose',
  '/api/onyx/catalogue': 'the prospectus, read by people deciding whether to enrol',
  '/api/onyx/c/:id': 'one course in that prospectus',
  '/api/onyx/payments/webhook/:tenantId/:gateway':
    'a gateway cannot hold a token -- the tenant comes from an HMAC-signed reference',
};


const files = fs.readdirSync(ROUTES).filter((f) => f.endsWith('.ts')).sort();
const lines = [
  '# Onyx API reference',
  '',
  '<!-- GENERATED by tools/onyx/gen-api-docs.mjs. Do not edit by hand. -->',
  '',
  'Every Onyx endpoint, who may call it, and where its code is. Generated from',
  'the route files, so it cannot drift from what actually ships — `npm run',
  'docs:check` fails the build if it has.',
  '',
  '## The rules that apply to all of them',
  '',
  '- **The tenant comes from the token.** Never from a path, a query or a body.',
  '  A token whose `tenant_id` is missing or malformed is a 401, not a default.',
  '- **Authentication** is `Authorization: Bearer <token>` from',
  '  `POST /api/onyx/auth/login`, or the `onyx_tenant_session` cookie when the',
  '  web app is calling through its own proxy.',
  '- **Responses** are `{ ok, data, message }`. Errors carry `ok: false` and a',
  '  `message` written for the person who will read it.',
  '- **Everything else takes a token.** The endpoints below that do not are',
  '  listed one by one, with the reason each one cannot hold one. That list is',
  '  the only way a route reaches this document as public: a route whose guard',
  '  cannot be read fails `docs:check` rather than being described as open.',
  '',
  ...Object.entries(PUBLIC).map(([route, why]) => '  - `' + route + '` — ' + why),
  '',
];

let total = 0;
const unresolved = [];
for (const file of files) {
  const src = fs.readFileSync(path.join(ROUTES, file), 'utf8');
  const [title, req] = SECTIONS[file] ?? [file.replace('.routes.ts', ''), ''];

  const constants = roleConstants(src);
  const locals = localFunctions(src);
  const rows = [];
  // The handler, not the first line of it. Anchored on the next route
  // registration so a guard three lines down is still inside the window.
  const re = /\.(get|post|put|patch|delete)\(\s*'(\/api\/onyx\/[^']+)'/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const from = m.index;
    const next = src.indexOf('  app.', from + 10);
    const handler = src.slice(from, next === -1 ? src.length : next);
    const resolved = guardOf(handler, constants, locals);
    let who;
    if (resolved !== null) {
      who = resolved;
    } else if (PUBLIC[m[2]]) {
      who = '**no token** \u2014 ' + PUBLIC[m[2]];
    } else {
      /*
       * The case this file exists to never get wrong again. Say so loudly, in
       * the document AND on the way out, rather than guessing "public".
       */
      who = '**UNRESOLVED GUARD** \u2014 read the route before trusting this row';
      unresolved.push(m[1].toUpperCase() + ' ' + m[2] + '  (' + file + ')');
    }
    rows.push({ method: m[1].toUpperCase(), path: m[2], who });
  }
  if (!rows.length) continue;
  total += rows.length;

  lines.push('## ' + title + (req ? ' · _' + req + '_' : ''));
  lines.push('');
  lines.push('`apps/web/src/server/routes/onyx/' + file + '`');
  lines.push('');
  lines.push('| Method | Path | Who may call it |');
  lines.push('| --- | --- | --- |');
  for (const r of rows) {
    lines.push('| `' + r.method + '` | `' + r.path + '` | ' + r.who + ' |');
  }
  lines.push('');
}

lines.push('---');
lines.push('');
lines.push('_' + total + ' endpoints across ' + files.length + ' route files._');
lines.push('');

const rendered = lines.join('\n');

if (unresolved.length) {
  console.error('\nCould not read the guard on ' + unresolved.length + ' route(s):');
  for (const r of unresolved) console.error('  ' + r);
  console.error('\nEither the handler has no guard -- fix that first -- or it uses one'
    + '\nthis script cannot follow. Do not add it to PUBLIC unless it is genuinely'
    + '\nopen to anyone on the internet, and write the reason beside it.');
  process.exitCode = 1;
}

if (process.argv.includes('--check')) {
  const current = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
  if (current !== rendered) {
    console.error('docs/API.md is out of date. Run: node tools/onyx/gen-api-docs.mjs');
    process.exitCode = 1;
  } else {
    console.log('API docs are current (' + total + ' endpoints).');
  }
} else {
  fs.writeFileSync(OUT, rendered);
  console.log('wrote docs/API.md -- ' + total + ' endpoints');
}
