import { OnyxMark } from '@/components/onyx-brand';
import { Icon, type IconName } from '@/components/onyx-ui';

/**
 * The shape both sign-in doors wear.
 *
 * Researched against how strong products open (Origin, WRITER, Greptile, Fabric
 * and YNAB on Mobbin): the form sits on a calm white column and the colour goes
 * in a panel beside it. Origin and WRITER do the bit worth copying — the panel
 * carries a short claim and a small piece of the product, not a stock photo.
 * Colour that says something beats colour that merely fills space.
 *
 * The panel is decoration and reassurance, so on a narrow screen it is not
 * shrunk, it is dropped: a phone gets the form immediately rather than a
 * screenful of gradient to scroll past to reach it. What survives on mobile is
 * the compact brand bar, because the one thing this layout must never lose is
 * WHICH DOOR you are at.
 *
 * That is the whole reason `tone` exists. /onyx/login and /onyx/platform/login
 * are one path segment apart, and the consequence of confusing them is not
 * symmetrical: every other screen acts on one institution, the platform console
 * acts on all of them. So the two differ in colour AND in a word, on every
 * breakpoint.
 */
export type AuthTone = 'institution' | 'platform';

const TONES: Record<AuthTone, {
  badge: string;
  panel: string;
  glow: string;
  bar: string;
  /** The short rule above the claim -- where the brand's second colour goes. */
  rule: string;
}> = {
  institution: {
    badge: 'Institution',
    panel: 'bg-gradient-to-br from-brand-700 via-brand-800 to-brand-900',
    // Teal, not orange. A blurred accent-500 bloom over a teal panel mixes to
    // olive across the whole upper third and reads as a smudge rather than a
    // deliberate warm light. The logo's orange still appears here -- as the
    // crisp rule below, where it is a shape rather than a tint.
    glow: 'bg-brand-400/30',
    bar: 'bg-gradient-to-br from-brand-700 to-brand-900',
    rule: 'bg-accent-500',
  },
  platform: {
    badge: 'Platform',
    panel: 'bg-gradient-to-br from-slate-900 via-ink to-slate-900',
    glow: 'bg-white/10',
    bar: 'bg-ink',
    rule: 'bg-white/40',
  },
};

export function OnyxAuthSplit({
  tone, title, subtitle, claim, points, note, children, footer,
}: {
  tone: AuthTone;
  /** The heading above the fields. */
  title: string;
  subtitle: string;
  /** The one sentence the coloured panel exists to say. */
  claim: string;
  /** Three short truths about this door. Not features — reassurance. */
  points: { icon: IconName; text: string }[];
  /** The quiet line at the foot of the panel. Per-door: what reassures an
   *  institution's staff is not what an operator needs reminding of. */
  note: string;
  /** The form itself, untouched by this component. */
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const t = TONES[tone];

  return (
    <div className="grid min-h-[100dvh] lg:grid-cols-[1fr_1.05fr]">
      {/* ---------------------------------------------------------- the form */}
      <div className="flex min-w-0 flex-col bg-white">
        {/* Mobile only: the door, named, before anything else. */}
        <div className={'flex items-center gap-2.5 px-5 py-4 text-white lg:hidden ' + t.bar}>
          <OnyxMark className="h-7 w-auto shrink-0" />
          <span className="text-[15px] font-bold tracking-tight">Onyx</span>
          <span className="ml-auto rounded-full border border-white/25 bg-white/10 px-2.5 py-1
                           text-[10.5px] font-bold uppercase tracking-[.08em]">
            {t.badge}
          </span>
        </div>

        <div className="flex flex-1 items-center justify-center px-5 py-10 sm:px-8">
          <div className="w-full max-w-[400px]">
            {/* Desktop only: the mark leads, since the panel carries the badge. */}
            <div className="mb-7 hidden items-center gap-2.5 lg:flex">
              <OnyxMark className="h-8 w-auto shrink-0" />
              <span className="text-[17px] font-bold tracking-tight text-ink">Onyx</span>
            </div>

            <h1 className="text-[26px] font-extrabold leading-tight tracking-tight text-ink">
              {title}
            </h1>
            <p className="mt-2 text-[14.5px] leading-relaxed text-muted">{subtitle}</p>

            <div className="mt-7">{children}</div>

            {footer ? <div className="mt-6">{footer}</div> : null}
          </div>
        </div>
      </div>

      {/* --------------------------------------------------------- the panel */}
      {/* aria-hidden: every word in here is restated in the form column or is
          pure reassurance. A screen-reader user should reach the email field,
          not a marketing paragraph placed after it in the DOM. */}
      <div aria-hidden
        className={'relative hidden overflow-hidden lg:flex lg:flex-col lg:justify-between ' + t.panel}>
        <div className={'pointer-events-none absolute -right-24 -top-24 h-[420px] w-[420px] '
          + 'rounded-full blur-3xl ' + t.glow} />
        <div className="pointer-events-none absolute -bottom-32 -left-24 h-[380px] w-[380px]
                        rounded-full bg-white/10 blur-3xl" />

        <div className="relative flex items-center gap-2.5 px-10 pt-10 text-white">
          <OnyxMark className="h-8 w-auto shrink-0" />
          <span className="text-[16px] font-bold tracking-tight">Onyx</span>
          <span className="ml-auto rounded-full border border-white/25 bg-white/10 px-3 py-1
                           text-[11px] font-bold uppercase tracking-[.08em]">
            {t.badge}
          </span>
        </div>

        <div className="relative px-10 py-12">
          <span className={'mb-6 block h-1 w-12 rounded-full ' + t.rule} />
          <p className="max-w-[22ch] text-[34px] font-extrabold leading-[1.15] tracking-tight
                        text-white xl:text-[40px]">
            {claim}
          </p>

          <ul className="mt-9 space-y-3.5">
            {points.map((p) => (
              <li key={p.text} className="flex items-start gap-3">
                <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-xl
                                 border border-white/20 bg-white/10 text-white">
                  <Icon name={p.icon} className="h-4 w-4" />
                </span>
                {/* white/85 rather than white/60: this is body-sized text on a
                    dark fill and it still has to clear AA. */}
                <span className="min-w-0 pt-1.5 text-[14.5px] leading-snug text-white/85">
                  {p.text}
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div className="relative px-10 pb-10 text-[12.5px] text-white/70">
          {note}
        </div>
      </div>
    </div>
  );
}
