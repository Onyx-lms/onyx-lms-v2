import type { Metadata } from 'next';
import { Icon, Pill, State, type IconName } from '@/components/onyx-ui';
import { appOrigin } from '@/lib/app-origin';

export const metadata: Metadata = {
  title: 'Verify a transcript',
  // Not something to index: each page is about one named person.
  robots: { index: false, follow: false },
};

const API = appOrigin();

interface PublicVerification {
  found: boolean;
  serial?: string;
  holder?: string | null;
  issuer?: string | null;
  issued_at?: string | null;
  revoked_at?: string | null;
  gpa?: number | null;
  credits_earned?: number | null;
  intact?: boolean;
  current?: boolean;
  lines?: number;
}

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
 * The verdict, as a colour AND a word AND a mark -- same discipline as
 * /onyx/verify/[credentialId], and for the same reason: a screenshot of a
 * green tile is exactly what a forged one copies.
 *
 * Four states rather than certificates' three, because a transcript answers
 * two independent questions and collapsing them would make a routine remark
 * look like fraud, and fraud look like a remark:
 *   * **intact** -- the stored document still hashes to its own checksum.
 *   * **current** -- what was sealed still equals the register today.
 * Revoked is checked first regardless of either, the same as a certificate.
 */
const VERDICTS = {
  valid: {
    headline: 'This transcript is valid',
    icon: 'check' as IconName,
    state: 'Seal intact, matches the register',
    tone: 'on' as const,
    panel: 'border-green-300', band: 'border-green-300 bg-green-50', text: 'text-green-900',
  },
  stale: {
    headline: 'This transcript was genuinely issued',
    icon: 'clock' as IconName,
    state: 'A mark has changed since — normal after a remark',
    tone: 'idle' as const,
    panel: 'border-amber-300', band: 'border-amber-300 bg-amber-50', text: 'text-amber-900',
  },
  tampered: {
    headline: 'This document does not match its own seal',
    icon: 'alert' as IconName,
    state: 'The record has been altered',
    tone: 'off' as const,
    panel: 'border-red-300', band: 'border-red-300 bg-red-50', text: 'text-red-900',
  },
  revoked: {
    headline: 'This transcript has been revoked',
    icon: 'x' as IconName,
    state: 'Withdrawn by the issuer',
    tone: 'off' as const,
    panel: 'border-red-300', band: 'border-red-300 bg-red-50', text: 'text-red-900',
  },
  not_found: {
    headline: 'No such transcript',
    icon: 'search' as IconName,
    state: 'Nothing is registered under that serial',
    tone: 'idle' as const,
    panel: 'border-line', band: 'border-line bg-slate-50', text: 'text-ink',
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
 * CMP-02c -- the public verification page.
 *
 * The counterpart to /onyx/verify/[credentialId] for a transcript rather than
 * a certificate. No session, by design, and for the identical reason: the
 * person checking a transcript is an employer with no Onyx account, so there
 * is no shell, no sidebar and nothing here they cannot reach.
 */
export default async function OnyxVerifyTranscriptPage({ params }: {
  params: Promise<{ serial: string }>;
}) {
  const { serial } = await params;
  let result: PublicVerification = { found: false };
  try {
    const res = await fetch(API + '/api/onyx/verify/transcript/' + encodeURIComponent(serial),
      { cache: 'no-store' });
    const body = await res.json();
    if (body.ok) result = body.data as PublicVerification;
  } catch {
    // A verifier gets an answer either way; "we could not check" is not one of
    // the answers a transcript holder should have to explain.
    result = { found: false };
  }

  const verdictKey = !result.found ? 'not_found'
    : result.revoked_at ? 'revoked'
      : !result.intact ? 'tampered'
        : !result.current ? 'stale'
          : 'valid';
  const v = VERDICTS[verdictKey];

  return (
    // No <main> and no id here: the root layout already opens one, and a
    // second #main would give a screen reader two landmarks with the same name.
    <div className="mx-auto w-full max-w-[580px] px-4 pb-16 pt-10">
      <div className="mb-5 flex items-center justify-center gap-2.5">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/onyx-mark.png" alt="" className="h-7 w-auto" />
        <span className="text-[13px] text-muted">Transcript check · Onyx</span>
      </div>

      <div className={'overflow-hidden rounded-2xl border bg-white shadow-card ' + v.panel}>
        <div className={'border-b px-5 py-7 text-center ' + v.band}>
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
          {!result.found ? (
            <p className="mx-auto max-w-[40ch] text-center text-sm text-muted">
              Nothing is registered under that serial. Check it was copied in full, including
              anything that fell after a line break.
            </p>
          ) : (
            <>
              <dl className="space-y-4">
                {/* The holder's name and nothing else about them, matching
                    certificate verification: no student number, no email, no
                    date of birth. */}
                <Field label="Awarded to">{result.holder ?? 'Unknown'}</Field>
                <Field label="Issued by">
                  {result.issuer ?? 'Unknown'}
                  <span className="mt-0.5 block text-[13px] font-normal text-muted">
                    Registered awarding institution
                  </span>
                </Field>
                <Field label="Issued">{ago(result.issued_at)}</Field>
                <Field label="Results on it">{result.lines ?? 0}</Field>
                <Field label="GPA">{result.gpa ?? '—'}</Field>
                {result.revoked_at ? (
                  <Field label="Revoked">
                    <span className="text-red-700">{ago(result.revoked_at)}</span>
                  </Field>
                ) : null}
              </dl>

              {verdictKey === 'tampered' ? (
                <div className="mt-5 flex items-start gap-3 rounded-2xl border border-red-200
                                bg-red-50 px-4 py-3 text-sm text-red-900">
                  <Icon name="alert" className="mt-0.5 h-[18px] w-[18px] shrink-0" />
                  <p className="min-w-0 flex-1">
                    The stored document no longer hashes to its own checksum. That is not a
                    remark — the record itself has been altered, and it should be reported to
                    the issuing institution's registrar.
                  </p>
                </div>
              ) : null}

              {verdictKey === 'stale' ? (
                <div className="mt-5 flex items-start gap-3 rounded-2xl border border-amber-200
                                bg-amber-50 px-4 py-3 text-sm text-amber-900">
                  <Icon name="clock" className="mt-0.5 h-[18px] w-[18px] shrink-0" />
                  <p className="min-w-0 flex-1">
                    The seal is good, so this is genuinely the document that was issued — but a
                    mark has changed since. That is normal after a remark. Ask the holder for a
                    fresh transcript if the current record matters to you.
                  </p>
                </div>
              ) : null}

              {verdictKey === 'revoked' ? (
                <div className="mt-5 flex items-start gap-3 rounded-2xl border border-red-200
                                bg-red-50 px-4 py-3 text-sm text-red-900">
                  <Icon name="alert" className="mt-0.5 h-[18px] w-[18px] shrink-0" />
                  <p className="min-w-0 flex-1">
                    This transcript was withdrawn by the issuing institution and should not be
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
            Serial{' '}
            <code className="font-mono text-[12.5px] [overflow-wrap:anywhere]">{serial}</code>
          </span>
          {!result.found ? <Pill tone="neutral">Not found</Pill> : null}
        </div>
      </div>

      <p className="mx-auto mt-4 max-w-[46ch] text-center text-xs text-muted">
        This page shows only what the issuing institution's register says today. Nothing here
        can be edited by the holder.
      </p>
    </div>
  );
}
