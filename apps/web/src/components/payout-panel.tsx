'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export interface Balance {
  earned: number; paid: number; available: number; pending: number; requestable: number;
}
export interface PayoutRow {
  id: number; amount: number; status: number | null;
  payment_method: string | null; created_at: string | null;
  user?: { id: number; name: string | null; email: string | null } | null;
}

/** REV-04 / REV-05 -- request a payout, with the details of how to pay it. */
export function PayoutRequest({ balance, requests }: {
  balance: Balance; requests: PayoutRow[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const pending = requests.find((r) => !r.status);

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <section className="card p-4">
        <h2 className="text-sm font-semibold">Balance</h2>
        <dl className="mt-3 space-y-1 text-sm">
          <div className="flex justify-between"><dt>Earned</dt><dd>{balance.earned}</dd></div>
          <div className="flex justify-between"><dt>Paid out</dt><dd>{balance.paid}</dd></div>
          <div className="flex justify-between text-slate-500">
            <dt>Awaiting payment</dt><dd>{balance.pending}</dd>
          </div>
          <div className="flex justify-between border-t border-slate-200 pt-1 font-medium">
            <dt>You can request</dt><dd>{balance.requestable}</dd>
          </div>
        </dl>

        {pending ? (
          <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            A request for {pending.amount} is in process.
            <button className="ml-2 underline" disabled={busy}
              onClick={async () => {
                if (!confirm('Withdraw this request?')) return;
                setBusy(true);
                const res = await fetch('/api/proxy/instructor/payouts/' + pending.id,
                  { method: 'DELETE' });
                setBusy(false);
                if (res.ok) router.refresh();
              }}>
              Withdraw it
            </button>
          </div>
        ) : (
          <form className="mt-4 space-y-2" onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            setBusy(true); setMessage('');
            const res = await fetch('/api/proxy/instructor/payouts', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                amount: Number(f.get('amount') ?? 0),
                payment_method: String(f.get('payment_method') ?? ''),
                // Kept on the payout row itself; there is no users column for it.
                payment_details: { account: String(f.get('account') ?? '') },
              }),
            });
            const body = await res.json().catch(() => ({}));
            setBusy(false);
            if (!res.ok) { setMessage(body.message ?? 'Could not submit it.'); return; }
            router.refresh();
          }}>
            <input name="amount" type="number" min={1} max={balance.requestable} step="0.01"
              required placeholder="Amount"
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
            <select name="payment_method" required
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm">
              <option value="bank">Bank transfer</option>
              <option value="paypal">PayPal</option>
              <option value="other">Other</option>
            </select>
            <input name="account" required placeholder="Account or email to pay"
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
            <button className="btn-primary" disabled={busy || balance.requestable < 1}
              type="submit">
              {busy ? 'Sending...' : 'Request payout'}
            </button>
            {balance.requestable < 1 && (
              <p className="text-xs text-slate-500">Nothing available to request yet.</p>
            )}
            {message && <p className="text-sm text-red-600">{message}</p>}
          </form>
        )}
      </section>

      <section className="card p-4">
        <h2 className="text-sm font-semibold">History</h2>
        {requests.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">No requests yet.</p>
        ) : (
          <ul className="mt-3 divide-y divide-slate-100 text-sm">
            {requests.map((r) => (
              <li key={r.id} className="flex items-center justify-between py-2">
                <span>
                  {r.amount}
                  <span className="block text-xs text-slate-500">
                    {r.payment_method ?? 'no method'}
                    {r.created_at ? ' - ' + new Date(r.created_at).toLocaleDateString() : ''}
                  </span>
                </span>
                <span className={r.status
                  ? 'rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700'
                  : 'rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700'}>
                  {r.status ? 'Paid' : 'Pending'}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/** REV-04 -- the admin queue. */
export function PayoutQueue({ rows }: { rows: PayoutRow[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  if (rows.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-slate-300 p-10 text-center text-sm text-slate-500">
        No payout requests.
      </p>
    );
  }
  return (
    <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
      {rows.map((r) => (
        <li key={r.id} className="flex items-center justify-between px-4 py-3 text-sm">
          <div>
            <div className="font-medium">{r.user?.name ?? 'Instructor'} - {r.amount}</div>
            <p className="mt-0.5 text-xs text-slate-500">
              {r.user?.email}
              {r.payment_method ? ' - ' + r.payment_method : ''}
              {r.created_at ? ' - ' + new Date(r.created_at).toLocaleDateString() : ''}
            </p>
          </div>
          {r.status ? (
            <span className="text-xs text-green-700">Paid</span>
          ) : (
            <button className="btn-primary px-3 py-1 text-xs" disabled={busy}
              onClick={async () => {
                if (!confirm('Mark this payout as sent?')) return;
                setBusy(true);
                await fetch('/api/proxy/admin/payouts/' + r.id + '/paid', { method: 'POST' });
                setBusy(false); router.refresh();
              }}>
              Mark paid
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}
