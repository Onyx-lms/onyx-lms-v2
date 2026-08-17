'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/** TB-05 -- claim one slot. The server decides the price and the split. */
export function BookSlot({ scheduleId, isSignedIn }: {
  scheduleId: number; isSignedIn: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  if (!isSignedIn) {
    return <a href="/login/store" className="btn-ghost px-3 py-1 text-xs">Sign in to book</a>;
  }

  return (
    <div className="text-right">
      <button className="btn-primary px-3 py-1 text-xs disabled:opacity-60" disabled={busy}
        onClick={async () => {
          setBusy(true); setMessage('');
          const res = await fetch('/api/proxy/tutor-schedules/' + scheduleId + '/book',
            { method: 'POST' });
          const body = await res.json().catch(() => ({}));
          setBusy(false);
          if (!res.ok) { setMessage(body.message ?? 'Could not book that slot.'); return; }
          router.push('/my-bookings');
          router.refresh();
        }}>
        {busy ? 'Booking...' : 'Book'}
      </button>
      {message && <p className="mt-1 text-xs text-red-600">{message}</p>}
    </div>
  );
}
