import Link from 'next/link';
import { apiSafe, type SiteSettings } from '@/lib/api';
import { Icon, type IconName } from '@/components/onyx-ui';

export const revalidate = 60;

/**
 * The front door.
 *
 * Researched against how learning platforms actually open (Kajabi, GitBook,
 * Duolingo, Skillshare, Aboard on Mobbin). Two patterns did the work:
 *
 *   * **Show the product, not a stock photo.** Kajabi and GitBook both put the
 *     real interface beside the headline. So the right-hand panel here is a
 *     course outline drawn in the product's own components -- the same rows,
 *     ticks and progress meter a student sees. It is decorative, so it is
 *     aria-hidden: a screen reader announcing a course nobody is enrolled on
 *     would be worse than silence.
 *   * **Say what is inside, in the product's own words.** Aboard's eyebrow +
 *     headline + card grid, filled with modules that genuinely exist here --
 *     every one maps to a route a signed-in user can reach. No invented
 *     statistics, no testimonials from nobody, no logo wall of institutions
 *     that have not signed. A landing page that lies is found out on day one.
 *
 * Colour follows the contrast rules in tailwind.config.ts rather than reaching
 * for the brightest thing: accent-500 is a FILL (3.17:1, fails AA for text) and
 * accent-700 is the orange that may carry words.
 */

const MODULES: { icon: IconName; title: string; body: string }[] = [
  {
    icon: 'book',
    title: 'Courses and lessons',
    body: 'Modules, video and reading lessons, resources and progress that follows '
      + 'each learner rather than being re-entered every term.',
  },
  {
    icon: 'shield',
    title: 'Assessments and proctoring',
    body: 'Timed papers drawn from question banks, marked anonymously, with camera '
      + 'and screen monitoring that records events — never recordings.',
  },
  {
    icon: 'code',
    title: 'Code Lab',
    body: 'Practice problems with hidden tests, run in a sandbox, plus workspaces '
      + 'where faculty can comment on the code itself.',
  },
  {
    icon: 'calendar',
    title: 'Attendance and timetable',
    body: 'Sessions, check-ins and a timetable that refuses to double-book a room, '
      + 'a batch or a member of staff.',
  },
  {
    icon: 'briefcase',
    title: 'Placements and careers',
    body: 'Employers, drives and rounds, mock interviews and verifiable '
      + 'credentials an employer can check without an account.',
  },
  {
    icon: 'wallet',
    title: 'Fees and finance',
    body: 'Fee structures, invoices and arrears, with a guardian view for the '
      + 'people who actually pay them.',
  },
];

/** Every role the product ships with -- not a wish list. */
const ROLES = ['Student', 'Faculty', 'Admin', 'Exams', 'Placement', 'Guardian', 'Employer'];

/** One row of the illustrative outline. */
function LessonRow({ title, meta, state }: {
  title: string; meta: string; state: 'done' | 'now' | 'todo';
}) {
  return (
    <div className={'flex items-center gap-3 px-4 py-3 ' + (state === 'now' ? 'bg-brand-50' : '')}>
      <span className={'grid h-8 w-8 shrink-0 place-items-center rounded-lg '
        + (state === 'done' ? 'bg-brand-100 text-brand-700'
          : state === 'now' ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-400')}>
        <Icon name={state === 'done' ? 'check' : state === 'now' ? 'play' : 'book'}
          className="h-4 w-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className={'block truncate text-[13.5px] '
          + (state === 'todo' ? 'text-slate-500' : 'font-semibold text-ink')}>{title}</span>
        <span className="block text-[11.5px] tabular-nums text-muted">{meta}</span>
      </span>
      {state === 'now'
        ? <span className="shrink-0 text-[11px] font-bold uppercase tracking-wide text-brand-700">Now</span>
        : null}
    </div>
  );
}

interface PublicCourse {
  id: number; code: string; title: string; description: string | null; credits: number;
  access: 'open' | 'locked'; price_minor: number; currency: string;
  institution: { name: string; slug: string };
}

export default async function HomePage() {
  const settings = await apiSafe<SiteSettings>('/api/settings');
  // Real courses somebody can actually join, from institutions that have opened
  // registration. Empty is a legitimate answer -- the section is not rendered
  // at all rather than showing an empty grid with a filter bar, which is what
  // the storefront catalogue does and the reason it was never worth linking to
  // from the hero.
  const catalogue = (await apiSafe<PublicCourse[]>('/api/onyx/catalogue')) ?? [];
  const name = settings?.system_title ?? 'Onyx LMS';

  return (
    <>
      {/* ---------------------------------------------------------------- hero */}
      <section className="relative overflow-hidden border-b border-line bg-gradient-to-b
                          from-brand-50 via-white to-white">
        {/* A soft wash behind the panel so the hero has depth without an image
            to download. Pointer-events-none so it can never eat a click. */}
        <div aria-hidden
          className="pointer-events-none absolute -right-32 -top-40 h-[520px] w-[520px] rounded-full
                     bg-brand-100/60 blur-3xl" />
        <div aria-hidden
          className="pointer-events-none absolute -left-40 top-40 h-[420px] w-[420px] rounded-full
                     bg-accent-100/50 blur-3xl" />

        <div className="container-page relative grid items-center gap-12 py-16 lg:grid-cols-[1.05fr_1fr]
                        lg:py-24">
          <div className="min-w-0">
            <span className="inline-flex items-center gap-2 rounded-full border border-brand-200
                             bg-white/80 px-3 py-1 text-[12.5px] font-semibold text-brand-700
                             shadow-card backdrop-blur">
              <Icon name="building" className="h-3.5 w-3.5" />
              One platform, seven roles
            </span>

            <h1 className="mt-5 text-[34px] font-extrabold leading-[1.1] tracking-tight text-ink
                           sm:text-[44px] lg:text-[52px]">
              From attendance to{' '}
              {/* accent-700, not accent-500: the bright logo orange is a fill
                  colour and does not clear AA for words, even large ones. */}
              <span className="text-accent-700">employability</span>
              <span className="block">— one system.</span>
            </h1>

            {/* Deliberately NOT settings.meta_description. That value is the
                tagline the headline above is built from, so rendering it here
                printed the same sentence twice, one line apart. The subhead's
                job is to say what the headline does not. */}
            <p className="mt-5 max-w-[54ch] text-[16.5px] leading-relaxed text-muted">
              Courses, assessments with proctoring, code practice, attendance, placements and
              fees — joined up, so nothing has to be reconciled by hand at the end of term.
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link href="/onyx/login"
                className="inline-flex min-h-[48px] items-center gap-2 rounded-2xl bg-brand-600
                           px-6 text-[15px] font-bold text-white shadow-lift transition
                           hover:bg-brand-700 focus:outline-none focus-visible:ring-2
                           focus-visible:ring-brand-600 focus-visible:ring-offset-2">
                Sign in
                <Icon name="arrow" className="h-4 w-4" />
              </Link>
              {/* Second, and a real destination: "Browse courses" pointed at the
                  storefront catalogue, which is empty on this deployment -- a
                  first click that lands on "nothing matches those filters" is
                  the worst thing a landing page can do. Learners are the people
                  arriving here without an account, so the second action is the
                  one they need. */}
              <Link href="/onyx/signup"
                className="inline-flex min-h-[48px] items-center gap-2 rounded-2xl border
                           border-line bg-white px-6 text-[15px] font-bold text-slate-700
                           transition hover:border-brand-300 hover:bg-brand-50
                           focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600
                           focus-visible:ring-offset-2">
                Create a student account
              </Link>
            </div>

            <p className="mt-5 flex items-center gap-2 text-[13px] text-muted">
              <Icon name="lock" className="h-3.5 w-3.5 shrink-0" />
              Learners register with the email their institution issued. Institutions
              themselves are set up by the {name} platform team.
            </p>
          </div>

          {/* The product, rather than a photograph of somebody at a laptop.
              aria-hidden: it is an illustration of the interface, and its
              contents are not real for the person reading the page. */}
          <div aria-hidden className="min-w-0">
            <div className="relative mx-auto w-full max-w-[430px]">
              <div className="overflow-hidden rounded-xl2 border border-line bg-white shadow-lift">
                <div className="flex items-center gap-2 border-b border-line bg-slate-50 px-4 py-3">
                  <span className="h-2.5 w-2.5 rounded-full bg-red-300" />
                  <span className="h-2.5 w-2.5 rounded-full bg-amber-300" />
                  <span className="h-2.5 w-2.5 rounded-full bg-green-300" />
                  <span className="ml-2 truncate text-[12px] font-semibold text-muted">
                    Data Structures and Algorithms
                  </span>
                </div>

                <div className="px-4 pt-4">
                  <div className="flex items-baseline justify-between">
                    <span className="text-[11px] font-bold uppercase tracking-[.08em] text-muted">
                      Course content
                    </span>
                    <span className="text-[12px] font-bold tabular-nums text-brand-700">43%</span>
                  </div>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100">
                    {/* accent-500 as a FILL, which is exactly what it is for. */}
                    <div className="h-full w-[43%] rounded-full bg-accent-500" />
                  </div>
                </div>

                <div className="mt-3 divide-y divide-line">
                  <LessonRow title="Why algorithms matter" meta="8:00 · video" state="done" />
                  <LessonRow title="Big-O notation" meta="10:00 · reading" state="done" />
                  <LessonRow title="Arrays in memory" meta="12:00 · video" state="now" />
                  <LessonRow title="Linked lists" meta="11:00 · reading" state="todo" />
                  <LessonRow title="Trees and heaps" meta="10:00 · video" state="todo" />
                </div>

                {/* A quiet footer strip, and the reason it exists: the floating
                    card below overlaps the panel for depth, and without
                    something expendable to land on it covered a lesson row and
                    read as a rendering fault rather than a flourish. */}
                <div className="flex items-center justify-end border-t border-line bg-slate-50
                                px-4 py-4 text-[11.5px] text-muted sm:py-8">
                  <span>12 lessons · 4 modules</span>
                </div>
              </div>

              {/* A second, smaller card overlapping the first: the depth cue
                  Kajabi and GitBook both use to make a flat mock feel real. */}
              <div className="absolute -bottom-6 -left-6 hidden w-[220px] rounded-2xl border
                              border-line bg-white p-3.5 shadow-lift sm:block">
                <div className="flex items-center gap-2">
                  <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand-600 text-white">
                    <Icon name="shield" className="h-4 w-4" />
                  </span>
                  <div className="min-w-0">
                    <div className="truncate text-[12.5px] font-bold text-ink">Monitored exam</div>
                    <div className="text-[11px] text-muted">Camera and screen on</div>
                  </div>
                </div>
                <div className="mt-2.5 flex items-center gap-1.5 text-[11px] font-semibold text-brand-700">
                  <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
                  3 candidates sitting now
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------- modules */}
      <section className="container-page py-16 lg:py-20">
        <div className="mx-auto max-w-[46rem] text-center">
          <span className="text-[12px] font-bold uppercase tracking-[.12em] text-brand-700">
            What&rsquo;s inside
          </span>
          <h2 className="mt-3 text-[28px] font-extrabold leading-tight tracking-tight text-ink
                         sm:text-[34px]">
            Six systems most institutions run separately
          </h2>
          <p className="mt-3 text-[15.5px] leading-relaxed text-muted">
            Each one is a module here, sharing the same roster, the same calendar and the same
            record of who did what.
          </p>
        </div>

        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {MODULES.map((m) => (
            <div key={m.title}
              className="group min-w-0 rounded-xl2 border border-line bg-white p-5 shadow-card
                         transition hover:-translate-y-0.5 hover:border-brand-200 hover:shadow-lift">
              <span className="grid h-11 w-11 place-items-center rounded-xl bg-brand-50
                               text-brand-700 transition group-hover:bg-brand-600
                               group-hover:text-white">
                <Icon name={m.icon} className="h-5 w-5" />
              </span>
              <h3 className="mt-4 text-[16.5px] font-bold text-ink">{m.title}</h3>
              <p className="mt-1.5 text-[14px] leading-relaxed text-muted">{m.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* --------------------------------------------------------------- roles */}
      <section className="border-y border-line bg-canvas">
        <div className="container-page py-14">
          <div className="grid items-center gap-8 lg:grid-cols-[1fr_1.2fr]">
            <div className="min-w-0">
              <h2 className="text-[24px] font-extrabold leading-tight tracking-tight text-ink
                             sm:text-[28px]">
                One account, whichever hat you wear
              </h2>
              <p className="mt-3 max-w-[46ch] text-[15px] leading-relaxed text-muted">
                People belong to institutions, not the other way round. Teach at one and study at
                another and it is still one sign-in — you choose which on the way in, and switch
                whenever you like.
              </p>
            </div>
            <ul className="flex flex-wrap gap-2.5">
              {ROLES.map((r) => (
                <li key={r}
                  className="inline-flex items-center gap-2 rounded-full border border-line
                             bg-white px-4 py-2 text-[14px] font-semibold text-slate-700
                             shadow-card">
                  <span className="h-1.5 w-1.5 rounded-full bg-brand-500" />
                  {r}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------ catalogue */}
      {catalogue.length ? (
        <section className="border-t border-line bg-canvas">
          <div className="container-page py-16 lg:py-20">
            <p className="text-center text-[12px] font-bold uppercase tracking-[.14em] text-muted">
              Open for enrolment
            </p>
            <h2 className="mx-auto mt-3 max-w-[22ch] text-center text-[26px] font-extrabold
                           leading-tight tracking-tight sm:text-[32px]">
              Courses you can start right now
            </h2>
            <p className="mx-auto mt-3 max-w-[52ch] text-center text-[15.5px] leading-relaxed
                          text-muted">
              Register with the address your institution gave you, and free courses open
              immediately. Paid ones open the moment they are bought.
            </p>

            <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {catalogue.slice(0, 6).map((c) => (
                <article key={c.id}
                  className="flex min-w-0 flex-col gap-2.5 rounded-2xl border border-line bg-white
                             p-5 shadow-card">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[12px] font-bold text-muted">{c.code}</span>
                    {c.access === 'locked' ? (
                      <span className="rounded-full bg-accent-50 px-2 py-0.5 text-[11.5px]
                                       font-bold text-accent-700">Paid</span>
                    ) : (
                      <span className="rounded-full bg-brand-50 px-2 py-0.5 text-[11.5px]
                                       font-bold text-brand-700">Free</span>
                    )}
                  </div>
                  <h3 className="text-[16px] font-bold leading-snug">
                    <Link href={'/onyx/c/' + c.id} className="hover:underline">{c.title}</Link>
                  </h3>
                  {c.description ? (
                    <p className="line-clamp-2 text-[13px] leading-relaxed text-muted">
                      {c.description}
                    </p>
                  ) : null}
                  <p className="mt-auto flex items-center gap-1.5 pt-2 text-[12.5px] text-muted">
                    <Icon name="building" className="h-3.5 w-3.5" />
                    <span className="truncate">{c.institution.name}</span>
                  </p>
                  <div className="flex items-center justify-between gap-3 border-t border-line
                                  pt-3">
                    {/* The price, on the card. A catalogue that makes somebody
                        click to find out what a course costs is a catalogue
                        they close. */}
                    <span className="text-[17px] font-extrabold tabular-nums">
                      {c.access === 'locked'
                        ? c.currency + ' ' + Math.floor(c.price_minor / 100).toLocaleString('en-IN')
                        : 'Free'}
                    </span>
                    {/* To the course, not to a form. Somebody deciding whether
                        to register wants to see what they would be registering
                        for; the page they land on asks for the account when
                        they have decided. */}
                    <Link href={'/onyx/c/' + c.id}
                      className="inline-flex min-h-[38px] items-center rounded-xl bg-brand-600
                                 px-3.5 text-[13px] font-bold text-white hover:bg-brand-700">
                      View course
                    </Link>
                  </div>
                </article>
              ))}
            </div>

            {catalogue.length > 6 ? (
              <p className="mt-6 text-center text-[13px] text-muted">
                and {catalogue.length - 6} more once you are signed in.
              </p>
            ) : null}
          </div>
        </section>
      ) : null}

      {/* ----------------------------------------------------------- closing CTA */}
      <section className="container-page py-16 lg:py-20">
        <div className="relative overflow-hidden rounded-xl2 bg-gradient-to-br from-brand-700
                        to-brand-900 px-6 py-14 text-center shadow-lift sm:px-12">
          <div aria-hidden
            className="pointer-events-none absolute -right-20 -top-24 h-72 w-72 rounded-full
                       bg-white/10 blur-2xl" />
          <h2 className="relative text-[26px] font-extrabold leading-tight tracking-tight text-white
                         sm:text-[32px]">
            Ready when you are
          </h2>
          <p className="relative mx-auto mt-3 max-w-[48ch] text-[15.5px] leading-relaxed text-white/80">
            Sign in to your institution, register with the address it gave you, or check a
            credential somebody has shown you — that last one needs no account at all.
          </p>
          <div className="relative mt-7 flex flex-wrap justify-center gap-3">
            <Link href="/onyx/login"
              className="inline-flex min-h-[48px] items-center gap-2 rounded-2xl bg-white px-6
                         text-[15px] font-bold text-brand-700 transition hover:bg-brand-50
                         focus:outline-none focus-visible:ring-2 focus-visible:ring-white
                         focus-visible:ring-offset-2 focus-visible:ring-offset-brand-800">
              Sign in
              <Icon name="arrow" className="h-4 w-4" />
            </Link>
            <Link href="/onyx/signup"
              className="inline-flex min-h-[48px] items-center rounded-2xl border border-white/30
                         px-6 text-[15px] font-bold text-white transition hover:bg-white/10
                         focus:outline-none focus-visible:ring-2 focus-visible:ring-white
                         focus-visible:ring-offset-2 focus-visible:ring-offset-brand-800">
              Create a student account
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
