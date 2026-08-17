'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/** TP-03 -- claim a free classroom, or start the paid request. */
export function TeamPackageActions({ packageId, isPaid, isSignedIn, purchased }: {
  packageId: number; isPaid: boolean; isSignedIn: boolean; purchased: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  if (purchased) {
    return <a href="/my-team-packages" className="btn-primary w-full">Open my classroom</a>;
  }
  if (!isSignedIn) {
    return <a href="/login/store" className="btn-primary w-full">Sign in to get this package</a>;
  }

  return (
    <div className="space-y-2">
      <button className="btn-primary w-full disabled:opacity-60" disabled={busy}
        onClick={async () => {
          setBusy(true); setMessage('');
          const res = await fetch('/api/proxy/team-packages/' + packageId
            + (isPaid ? '/purchase' : '/claim-free'), { method: 'POST' });
          const body = await res.json().catch(() => ({}));
          setBusy(false);
          if (!res.ok) { setMessage(body.message ?? 'Something went wrong.'); return; }
          // A paid package waits for review, so say so rather than pretending.
          if (isPaid) { setMessage(body.message ?? 'Your request is in process.'); return; }
          router.push('/my-team-packages');
          router.refresh();
        }}>
        {busy ? 'Working...' : isPaid ? 'Request this package' : 'Claim for free'}
      </button>
      {message && <p className="text-sm text-slate-600">{message}</p>}
    </div>
  );
}
