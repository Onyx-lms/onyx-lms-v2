'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/** BC-06/BC-07 -- enrol, buy, or open a workshop you already have. */
export function BootcampActions({ bootcampId, slug, isPaid, isSignedIn, purchased, owner }: {
  bootcampId: number;
  slug: string;
  isPaid: boolean;
  isSignedIn: boolean;
  purchased: boolean;
  owner: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  if (owner) {
    return <a href={'/my-bootcamps/' + slug} className="btn-primary w-full">Open (you own this)</a>;
  }
  if (purchased) {
    return <a href={'/my-bootcamps/' + slug} className="btn-primary w-full">Go to workshop</a>;
  }
  if (!isSignedIn) {
    return (
      <a href="/login/store" className="btn-primary w-full">
        Sign in to {isPaid ? 'buy this workshop' : 'enrol'}
      </a>
    );
  }

  return (
    <div className="space-y-2">
      <button className="btn-primary w-full disabled:opacity-60" disabled={busy}
        onClick={async () => {
          setBusy(true); setMessage('');
          // Paid workshops go through the same cart and gateway as courses;
          // free ones enrol in one step, as Laravel did.
          const res = await fetch('/api/proxy/bootcamps/' + bootcampId
            + (isPaid ? '/purchase' : '/enrol-free'), { method: 'POST' });
          const body = await res.json().catch(() => ({}));
          setBusy(false);
          if (!res.ok) { setMessage(body.message ?? 'Something went wrong.'); return; }
          router.push('/my-bootcamps');
          router.refresh();
        }}>
        {busy ? 'Working...' : isPaid ? 'Buy this workshop' : 'Enrol for free'}
      </button>
      {message && <p className="text-sm text-red-600">{message}</p>}
    </div>
  );
}
