import type { Metadata } from 'next';
import type { Verification } from '@/lib/onyx-career';
import { Icon, Pill, State, type IconName } from '@/components/onyx-ui';
import { appOrigin } from '@/lib/app-origin';

export const metadata: Metadata = {
  title: 'Verify a credential',
  // Not something to index: each page is about one named person.
  robots: { index: false, follow: false },
};

const API = appOrigin();

/** "2 days ago" beats "8/9/2026" for the one question this page answers. */
function ago(iso: string | null | undefined): string {
  if (!iso) return '—';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '—';
  const startOf = (ms: number) => { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); };
  const d = Math.round((startOf(Date.now()) - startOf(t)) / 86_400_000);
  if (d < 0) {
    const n = Math.abs(d);
    return n === 1 ? 'Tomorrow' : n <= 60 ? 'In ' + n + ' days'
      : n <= 730 ? 'In ' + Math.round(n / 30) + ' months' : 'In ' + Math.round(n / 365) + ' years';
  }
  if (d === 0) return 'Today';
  if (d === 1) return 'Yesterday';
  if (d <= 13) return d + ' days ago';
  if (d <= 60) return Math.round(d / 7) + ' weeks ago';
  if (d <= 730) return Math.round(d / 30) + ' months ago';
  return Math.round(d / 365) + ' years ago';
}

/**
 * The verdict, as a colour AND a word AND a mark.
 *
 * A green tile on its own is exactly the sort of thing a forged screenshot
 * copies, and about one man in twelve would not read it as green anyway. The
 * headline says the answer in words; the tint and the icon only make it fast.
 */
const VERDICTS = {
  valid: {
    headline: 'This credential is valid',
    icon: 'check' as IconName,
    state: 'Checked against the issuer just now',
    tone: 'on' as const,
    panel: 'border-green-300',
    band: 'border-green-300 bg-green-50',
    text: 'text-green-900',
  },
  revoked: {
    headline: 'This credential has been revoked',
    icon: 'x' as IconName,
    state: 'Withdrawn by the issuer',
    tone: 'off' as const,
    panel: 'border-red-300',
    band: 'border-red-300 bg-red-50',
    text: 'text-red-900',
  },
  expired: {
    headline: 'This credential has expired',
    icon: 'clock' as IconName,
    state: 'Lapsed — not withdrawn',
    tone: 'idle' as const,
    panel: 'border-line',
    band: 'border-line bg-slate-50',
    text: 'text-ink',
  },
  not_found: {
    headline: 'No such credential',
    icon: 'search' as IconName,
    state: 'Nothing is registered under that id',
    tone: 'idle' as const,
    panel: 'border-line',
    band: 'border-line bg-slate-50',
    text: 'text-ink',
  },
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[10.5px] font-bold uppercase tracking-[.08em] text-muted">{label}</dt>
      <dd className="mt-0.5 text-[15px] font-semibold">{children}</dd>
    </div>
  );
}

/**
 * CAR-03 -- the public verification page.
 *
 * No session, by design: the person checking a credential is an employer who
 * has no account here and never will. That is the whole point of a verifiable
 * certificate — so there is no shell, no sidebar and no institution navigation
 * on this page either. A menu full of destinations they cannot reach would say
 * "sign in" to somebody who has nothing to sign in with.
 *
 * It calls the API directly rather than through the authenticated helper,
 * because there is no token to send and adding one would quietly make the page
 * useless to the people it exists for.
 */
export default async function OnyxVerifyPage({ params }: {
  params: Promise<{ credentialId: string }>;
}) {
  const { credentialId } = await params;
  let result: Verification = { valid: false, reason: 'not_found' };
  try {
    const res = await fetch(API + '/api/onyx/verify/' + encodeURIComponent(credentialId),
      { cache: 'no-store' });
    const body = await res.json();
    if (body.ok) result = body.data as Verification;
  } catch {
    // A verifier gets an answer either way; "we could not check" is not one of
    // the answers a certificate holder should have to explain.
    result = { valid: false, reason: 'not_found' };
  }

  const v = VERDICTS[result.valid ? 'valid' : result.reason] ?? VERDICTS.not_found;
  const detail = Object.entries(result.detail ?? {});

  return (
    // No <main> and no id here: the root layout already opens one, and a second
    // #main would give a screen reader two landmarks with the same name.
    <div className="mx-auto w-full max-w-[580px] px-4 pb-16 pt-10">
      <div className="mb-5 flex items-center justify-center gap-2.5">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/onyx-mark.png" alt="" className="h-7 w-auto" />
        <span className="text-[13px] text-muted">Credential check · Onyx</span>
      </div>

      <div className={'overflow-hidden rounded-2xl border bg-white shadow-card ' + v.panel}>
        <div className={'border-b px-5 py-7 text-center ' + v.band}>
          {/* White behind the mark, not the tint: the header and the circle
              would otherwise share a background and the circle would vanish. */}
          <span className={'mx-auto mb-3 grid h-14 w-14 place-items-center rounded-full '
            + 'bg-white shadow-card ' + v.text}>
            <Icon name={v.icon} className="h-7 w-7" />
          </span>
          <h1 className={'text-[23px] font-extrabold leading-snug ' + v.text}>{v.headline}</h1>
          <div className="mt-2 flex justify-center">
            <State tone={v.tone}>{v.state}</State>
          </div>
        </div>

        <div className="px-5 py-5">
          {result.reason === 'not_found' ? (
            <p className="mx-auto max-w-[40ch] text-center text-sm text-muted">
              Nothing is registered under that credential id. Check it was copied in full,
              including anything that fell after a line break.
            </p>
          ) : (
            <>
              <dl className="space-y-4">
                {/* The holder's name is the only thing about them on this page.
                    No student number, no email, no date of birth: a verifier
                    needs to match a name on a CV, not to be handed a record. */}
                <Field label="Awarded to">{result.holder ?? 'Unknown'}</Field>
                <Field label="For">{result.title ?? 'Unknown'}</Field>
                <Field label="Issued by">
                  {result.issuer ?? 'Unknown'}
                  <span className="mt-0.5 block text-[13px] font-normal text-muted">
                    Registered awarding institution
                  </span>
                </Field>
                <Field label="Issued">{ago(result.issued_at)}</Field>
                <Field label="Expires">
                  {result.expires_at ? ago(result.expires_at) : 'Does not expire'}
                </Field>
                {result.revoked_at ? (
                  <Field label="Revoked">
                    <span className="text-red-700">{ago(result.revoked_at)}</span>
                  </Field>
                ) : null}
              </dl>

              {detail.length > 0 ? (
                <>
                  <div className="my-5 border-t border-line" />
                  <div className="text-[10.5px] font-bold uppercase tracking-[.08em] text-muted">
                    What was assessed
                  </div>
                  <ul className="mt-2.5 divide-y divide-line">
                    {detail.map(([k, val]) => (
                      <li key={k} className="flex items-center justify-between gap-3 py-2.5">
                        <span className="min-w-0 text-[13.5px] capitalize">
                          {k.replace(/_/g, ' ')}
                        </span>
                        <span className="shrink-0 text-[13.5px] font-bold tabular-nums">
                          {String(val)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}

              {result.revoked_at ? (
                <div className="mt-5 flex items-start gap-3 rounded-2xl border border-red-200
                                bg-red-50 px-4 py-3 text-sm text-red-900">
                  <Icon name="alert" className="mt-0.5 h-[18px] w-[18px] shrink-0" />
                  {/* Revoked still shows the holder and the award. Saying "no
                      such credential" to somebody holding a real certificate
                      tells them nothing they can act on. */}
                  <p className="min-w-0 flex-1">
                    This credential was withdrawn by the issuing institution and should not be
                    relied on. Contact the registrar if you need to know why.
                  </p>
                </div>
              ) : null}
            </>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line
                        bg-slate-50 px-5 py-3">
          <span className="min-w-0 text-xs text-muted">
            Credential id{' '}
            <code className="font-mono text-[12.5px] [overflow-wrap:anywhere]">
              {credentialId}
            </code>
          </span>
          {result.reason === 'not_found'
            ? <Pill tone="neutral">Not found</Pill>
            : null}
        </div>
      </div>

      <p className="mx-auto mt-4 max-w-[46ch] text-center text-xs text-muted">
        This page shows only what the issuing institution chose to publish. Nothing here can
        be edited by the holder.
      </p>
    </div>
  );
}
