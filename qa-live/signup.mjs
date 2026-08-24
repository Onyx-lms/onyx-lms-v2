/**
 * Signing up as a learner, and reading the mail that arrives.
 *
 * The quality report carried this as an open item nobody could close from
 * here: a code is demonstrably SENT -- the API says so and GoTrue does not
 * complain -- but whether the mail a person opens actually contains the digits
 * depends on the Magic Link template carrying `{{ .Token }}`, and a template
 * with only a link delivers a message with nothing to type into the form.
 *
 * So this signs up to a throwaway mailbox whose contents can be read back over
 * HTTP, and looks at the message. "Sent" and "usable" stop being the same
 * claim.
 *
 * Nothing here is a fixture: the institution, its open registration and its
 * accepted domain are set up through the product's own API as an
 * administrator, and torn down at the end.
 *
 *   node qa-live/signup.mjs
 */
const BASE = process.env.QA_BASE ?? 'https://onyx-lms-v2.vercel.app';
const RUN = Date.now().toString(36);
const PW = 'QaSignUp#2026!';

const results = [];
function check(label, pass, detail = '') {
  results.push({ label, pass: Boolean(pass), detail });
  console.log((pass ? 'ok    ' : 'FAIL  ') + label.padEnd(52), detail);
  return pass;
}

async function call(path, { method = 'GET', token, body } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const parsed = await res.json().catch(() => ({}));
  return { status: res.status, data: parsed?.data, message: parsed?.message };
}

/*
 * A mailbox that can be read over HTTP.
 *
 * Supabase checks that a domain has MX records before it will send to it, so
 * a `.test` address is refused outright -- the mailbox has to be real. These
 * are ordinary throwaway-mail services; the first that answers is used, and if
 * none does the run says so rather than guessing.
 */
const MAILBOXES = [
  {
    name: '1secmail',
    address: (user) => user + '@1secmail.com',
    async messages(user) {
      const res = await fetch('https://www.1secmail.com/api/v1/?action=getMessages'
        + '&login=' + user + '&domain=1secmail.com');
      if (!res.ok) throw new Error('1secmail ' + res.status);
      return (await res.json()).map((m) => ({ id: m.id, subject: m.subject }));
    },
    async body(user, id) {
      const res = await fetch('https://www.1secmail.com/api/v1/?action=readMessage'
        + '&login=' + user + '&domain=1secmail.com&id=' + id);
      const m = await res.json();
      return String(m.textBody || m.body || m.htmlBody || '');
    },
  },
  {
    name: 'mail.tm',
    address: null,           // needs an account; set up in `open()` below
    async open(user) {
      const domains = await (await fetch('https://api.mail.tm/domains')).json();
      const domain = domains['hydra:member']?.[0]?.domain;
      if (!domain) throw new Error('mail.tm has no domains');
      const address = user + '@' + domain;
      await fetch('https://api.mail.tm/accounts', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address, password: PW }),
      });
      const auth = await (await fetch('https://api.mail.tm/token', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address, password: PW }),
      })).json();
      if (!auth.token) throw new Error('mail.tm would not issue a token');
      return { address, token: auth.token };
    },
    async messages(_user, ctx) {
      const res = await fetch('https://api.mail.tm/messages',
        { headers: { Authorization: 'Bearer ' + ctx.token } });
      const json = await res.json();
      return (json['hydra:member'] ?? []).map((m) => ({ id: m.id, subject: m.subject }));
    },
    async body(_user, id, ctx) {
      const m = await (await fetch('https://api.mail.tm/messages/' + id,
        { headers: { Authorization: 'Bearer ' + ctx.token } })).json();
      return String(m.text || m.html || '');
    },
  },
];

const user = 'onyxqa' + RUN;
let mailbox = null;
let mailCtx = {};
let address = null;

for (const candidate of MAILBOXES) {
  try {
    if (candidate.open) {
      const opened = await candidate.open(user);
      address = opened.address;
      mailCtx = opened;
    } else {
      address = candidate.address(user);
      await candidate.messages(user, mailCtx);      // prove it answers
    }
    mailbox = candidate;
    break;
  } catch (err) {
    console.log('      (' + candidate.name + ' unavailable: '
      + String(err).split('\n')[0] + ')');
  }
}
check('a readable mailbox is available', Boolean(mailbox),
  mailbox ? mailbox.name + ' — ' + address : 'none answered; the mail cannot be read');
if (!mailbox) process.exit(1);

// ---------------------------------------------------------------------------

const domain = address.split('@')[1];
const pt = (await call('/api/onyx/platform/login', { method: 'POST',
  body: { email: 'superadmin@onyx.platform', password: 'Platform#2026!' } })).data?.token;

const slug = 'qs-' + RUN;
const adminEmail = 'qs.' + RUN + '.admin@onyx.test';
const made = await call('/api/onyx/tenants', { method: 'POST', token: pt,
  body: { name: 'SignUp QA ' + RUN, slug,
    admin: { name: 'Ada', email: adminEmail, password: PW } } });
check('an institution to register with', made.status === 200, made.message ?? made.status);

const at = (await call('/api/onyx/auth/login',
  { method: 'POST', body: { email: adminEmail, password: PW } })).data?.token;

const opened = await call('/api/onyx/tenant/settings', {
  method: 'PATCH', token: at,
  body: { student_signup: true, signup_domains: domain, signup_mode: 'domain' },
});
check('it opens registration to its own domain', opened.status === 200,
  opened.message ?? opened.status);

// The rule that made this feature worth having.
const personal = await call('/api/onyx/auth/signup/start',
  { method: 'POST', body: { email: 'someone@gmail.com' } });
check('a personal address is refused before any mail is sent',
  personal.status >= 400, personal.status + ' ' + (personal.message ?? ''));

const started = await call('/api/onyx/auth/signup/start',
  { method: 'POST', body: { email: address } });
check('a code is sent to the institutional address',
  started.status === 200, started.status + ' ' + (started.message ?? ''));

// --------------------------------------------------------- reading the mail

let mail = null;
for (let i = 0; i < 40 && !mail; i += 1) {
  await new Promise((r) => setTimeout(r, 3_000));
  const list = await mailbox.messages(user, mailCtx).catch(() => []);
  if (list.length) mail = list[0];
}
check('the mail actually arrives', Boolean(mail),
  mail ? 'subject: ' + mail.subject : 'nothing after two minutes');
if (!mail) process.exit(1);

const text = await mailbox.body(user, mail.id, mailCtx);
const code = (text.match(/\b(\d{4,10})\b/) ?? [])[1] ?? null;
check('and it contains a code somebody can type', Boolean(code),
  code ? code.length + ' digits' : 'NO DIGITS IN THE MAIL — the Magic Link template '
    + 'is missing {{ .Token }}');

if (code) {
  const done = await call('/api/onyx/auth/signup/verify', {
    method: 'POST',
    body: {
      name: 'Sam Signup', email: address, password: PW, code,
      phone: '9845127384', roll_number: 'R' + RUN.slice(-4),
    },
  });
  check('the code completes the registration', done.status === 200,
    done.status + ' ' + (done.message ?? ''));
  check('and they are signed in as a student of that institution',
    done.data?.role === 'student' && Boolean(done.data?.token),
    'role=' + done.data?.role + ' tenant=' + (done.data?.tenant?.slug ?? '-'));

  const wrong = await call('/api/onyx/auth/signup/verify', {
    method: 'POST',
    body: { name: 'Impostor', email: address, password: PW, code: '00000000' },
  });
  check('a wrong code is refused', wrong.status >= 400,
    wrong.status + ' ' + (wrong.message ?? ''));
}

// ---------------------------------------------------------------------------

console.log('\n' + '='.repeat(64));
const passed = results.filter((r) => r.pass).length;
const failed = results.filter((r) => !r.pass);
console.log(passed + ' pass, ' + failed.length + ' fail, of ' + results.length);
for (const f of failed) console.log('  FAIL ' + f.label + ' -- ' + f.detail);
console.log('SLUG ' + slug + '  MAILBOX ' + address);
