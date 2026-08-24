'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { GatewayConfigSummary, PayableGateway } from '@/lib/onyx-campus';
import { completeCheckout } from '@/lib/onyx-checkout-client';

/**
 * CMP-03b -- paying an invoice, and setting up the account it is paid into.
 *
 * The fees page could always tell a learner what they owed and never let them
 * do anything about it, which is the shape of gap that reads as "the feature
 * exists" right up until somebody tries to use it.
 *
 * There is no amount box anywhere here. What is owed is computed by the server
 * from the invoice, and a control that let a payer name their own figure would
 * be a control for paying one rupee against a term's fees.
 */
export function PayInvoice({ invoiceId, gateways, outstanding }: {
  invoiceId: number;
  gateways: PayableGateway[];
  /** Formatted, for the button's label. The number itself is the server's. */
  outstanding: string;
}) {
  const router = useRouter();
  const [gateway, setGateway] = useState(gateways[0]?.identifier ?? '');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (!gateways.length) {
    return (
      <span className="text-xs text-muted">
        Online payment is not set up at this institution yet.
      </span>
    );
  }

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {gateways.length > 1 ? (
        <>
          <label htmlFor={'gw-' + invoiceId} className="sr-only">
            How to pay invoice {invoiceId}
          </label>
          <select
            id={'gw-' + invoiceId} value={gateway}
            onChange={(e) => setGateway(e.target.value)}
            className="rounded-xl border border-slate-300 bg-white px-2 py-1.5 text-sm
                       focus:border-brand-600 focus:outline-none"
          >
            {gateways.map((g) => (
              <option key={g.identifier} value={g.identifier}>{g.title}</option>
            ))}
          </select>
        </>
      ) : null}

      <button
        type="button" disabled={pending || !gateway}
        onClick={() => start(async () => {
          setError(null);
          const res = await fetch('/api/proxy/onyx/invoices/' + invoiceId + '/checkout', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ gateway }),
          });
          const body = await res.json().catch(() => ({ ok: false }));
          if (!body.ok) { setError(body.message ?? 'Could not start the payment.'); return; }

          // Widget first, redirect second, and the reason that order matters
          // lives in the helper -- both this and the course Buy button used to
          // decide it separately, and disagreed.
          const end = await completeCheckout(body.data ?? {});
          if (end.status === 'redirected') return;    // the browser is leaving
          if (end.status === 'failed') { setError(end.message); return; }
          if (end.status === 'dismissed') { setError('You have not been charged.'); return; }
          // The ledger is what this page states, so re-read it either way: a
          // payment the bank has not confirmed yet simply stays due, which is
          // the truth.
          router.refresh();
        })}
        className="rounded-xl bg-brand-600 px-3 py-1.5 text-[13px] font-semibold text-white
                   hover:bg-brand-700 disabled:opacity-60"
      >
        {pending ? 'Opening…' : 'Pay ' + outstanding}
      </button>

      {error ? (
        <p role="alert" className="basis-full text-right text-xs text-rose-700">{error}</p>
      ) : null}
    </div>
  );
}

/**
 * The credential fields each gateway needs.
 *
 * Five of the port's nine providers, being the ones whose credentials are a
 * short list of named strings. The registry behind them handles all nine; a
 * sixth is a row in this table, not a code change anywhere else.
 */
const PROVIDERS: { id: string; label: string; keys: { name: string; label: string }[] }[] = [
  // The webhook secret is a SEPARATE secret from the key secret, generated
  // when the webhook is registered in the Razorpay dashboard. Without it
  // `parseWebhook` returns null at its first line and every webhook is
  // silently ignored -- so a payment whose browser never came back would
  // never settle at all, with nothing anywhere saying why.
  { id: 'razorpay', label: 'Razorpay', keys: [
    { name: 'razorpay_key', label: 'Key id' },
    { name: 'razorpay_secret', label: 'Key secret' },
    { name: 'razorpay_webhook_secret', label: 'Webhook secret' },
  ] },
  { id: 'stripe', label: 'Stripe', keys: [
    { name: 'stripe_key', label: 'Publishable key' },
    { name: 'stripe_secret', label: 'Secret key' },
    { name: 'stripe_webhook_secret', label: 'Webhook signing secret' },
  ] },
  { id: 'paypal', label: 'PayPal', keys: [
    { name: 'paypal_client_id', label: 'Client id' },
    { name: 'paypal_secret', label: 'Secret' },
  ] },
  { id: 'paystack', label: 'Paystack', keys: [
    { name: 'paystack_public_key', label: 'Public key' },
    { name: 'paystack_secret_key', label: 'Secret key' },
  ] },
  { id: 'flutterwave', label: 'Flutterwave', keys: [
    { name: 'flutterwave_public_key', label: 'Public key' },
    { name: 'flutterwave_secret_key', label: 'Secret key' },
  ] },
];

/**
 * The institution's merchant configuration.
 *
 * Credentials go in and never come back: the API returns the *names* of the
 * keys that are set and no values, so this screen can say "already set" and
 * cannot say what it is. Submitting a blank field keeps what is stored, which
 * is what makes changing the currency a safe thing to do without re-entering a
 * live secret.
 */
export function ConfigureGateways({ configured, tenantId }: {
  configured: GatewayConfigSummary[];
  tenantId: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [identifier, setIdentifier] = useState(PROVIDERS[0]!.id);
  const [values, setValues] = useState<Record<string, string>>({});
  const [testMode, setTestMode] = useState(true);
  const [currency, setCurrency] = useState('INR');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const provider = PROVIDERS.find((p) => p.id === identifier)!;
  const existing = configured.find((g) => g.identifier === identifier);

  return (
    <div className="rounded-2xl border border-line bg-white p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-bold">Online payment</h2>
        <button
          type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open}
          className="rounded-2xl border border-line px-3 py-1.5 text-xs font-medium
                     text-slate-700 hover:bg-brand-50"
        >
          {open ? 'Close' : 'Configure a gateway'}
        </button>
      </div>

      {configured.length ? (
        <ul className="mt-3 space-y-1 text-sm">
          {configured.map((g) => (
            <li key={g.id} className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{g.title}</span>
              <span className="text-xs text-muted">{g.currency}</span>
              {/*
                * The badge follows the KEY, not the flag beside it.
                *
                * Nothing in the Razorpay path reads `test_mode` — `pickKey`
                * falls back to the plain credential name — so the flag decides
                * what the screen says and the key decides whose money moves.
                * A gateway flagged "test" while holding an `rzp_live_` key was
                * therefore charging real cards under an amber "Test mode"
                * badge, which is the one thing this badge exists to prevent.
                */}
              {(g.keys_are_live ?? !g.test_mode) ? (
                <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px]
                                 text-emerald-800">
                  Live
                </span>
              ) : (
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] text-amber-800">
                  Test mode
                </span>
              )}
              {g.keys_are_live != null && g.keys_are_live === Boolean(g.test_mode) ? (
                <span
                  role="alert"
                  className="rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-semibold
                             text-red-800"
                  title={'This gateway is flagged ' + (g.test_mode ? 'test' : 'live')
                    + ' but its key is a ' + (g.keys_are_live ? 'live' : 'test')
                    + ' one. The key is what decides whether real money moves.'}
                >
                  Flag says {g.test_mode ? 'test' : 'live'} — key says
                  {' ' + (g.keys_are_live ? 'live' : 'test')}
                </span>
              ) : null}
              <span className={'text-xs ' + (g.status ? 'text-emerald-700' : 'text-muted')}>
                {g.status ? 'enabled' : 'disabled'}
              </span>
              <span className="text-xs text-muted">
                {g.configured_keys.length
                  ? g.configured_keys.length + ' credentials set'
                  : 'no credentials set'}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-sm text-muted">
          No gateway is set up, so learners cannot pay their invoices online.
        </p>
      )}

      {open ? (
        <form
          className="mt-4 grid gap-3 border-t border-line pt-4 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              setError(null);
              const res = await fetch('/api/proxy/onyx/admin/gateways', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  identifier,
                  title: provider.label,
                  keys: values,
                  currency,
                  test_mode: testMode,
                  status: true,
                }),
              });
              const body = await res.json().catch(() => ({ ok: false }));
              if (!body.ok) { setError(body.message ?? 'That did not work.'); return; }
              setValues({});
              setOpen(false);
              router.refresh();
            });
          }}
        >
          <div className="sm:col-span-2">
            <label htmlFor="gw-provider" className="block text-[13px] font-semibold text-slate-700">
              Gateway
            </label>
            <select
              id="gw-provider" value={identifier}
              onChange={(e) => { setIdentifier(e.target.value); setValues({}); }}
              className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
            >
              {PROVIDERS.map((p) => (
                <option key={p.id} value={p.id}>{p.label}</option>
              ))}
            </select>
          </div>

          {provider.keys.map((k) => (
            <div key={k.name}>
              <label htmlFor={'gw-' + k.name}
                className="block text-[13px] font-semibold text-slate-700">
                {k.label}
              </label>
              <input
                id={'gw-' + k.name} type="password" autoComplete="off"
                value={values[k.name] ?? ''}
                onChange={(e) => setValues({ ...values, [k.name]: e.target.value })}
                placeholder={existing?.configured_keys.includes(k.name)
                  ? 'Already set — leave blank to keep it'
                  : ''}
                className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
              />
            </div>
          ))}

          <div>
            <label htmlFor="gw-currency"
              className="block text-[13px] font-semibold text-slate-700">
              Currency
            </label>
            <input
              id="gw-currency" value={currency} maxLength={3}
              onChange={(e) => setCurrency(e.target.value.toUpperCase())}
              className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
            />
          </div>

          <label className="flex items-end gap-2 text-[13px] font-semibold text-slate-700">
            <input type="checkbox" checked={testMode} className="h-4 w-4"
              onChange={(e) => setTestMode(e.target.checked)} />
            Test mode
          </label>

          <p className="text-xs text-muted sm:col-span-2">
            Point this gateway&rsquo;s webhook at{' '}
            <code className="rounded bg-slate-100 px-1">
              /api/onyx/payments/webhook/{tenantId}/{identifier}
            </code>
            . The institution in that path only chooses which key checks the signature — the
            payment itself is credited to whoever the signed reference says, so a wrong one
            settles nothing. Credentials are stored write-only and are never shown again.
          </p>

          {error ? (
            <p role="alert" className="text-sm text-rose-700 sm:col-span-2">{error}</p>
          ) : null}

          <div className="sm:col-span-2">
            <button type="submit" disabled={pending}
              className="rounded-2xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white
                         hover:bg-brand-700 disabled:opacity-60">
              {pending ? 'Saving…' : 'Save gateway'}
            </button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
