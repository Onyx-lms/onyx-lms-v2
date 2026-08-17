'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function OfflineReviewActions({ id }: { id: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function decide(action: 'accept' | 'decline') {
    if (action === 'accept' && !confirm('Accept this payment and enrol the student?')) return;
    setBusy(true);
    const res = await fetch(`/api/proxy/admin/offline-payments/${id}/${action}`, { method: 'POST' });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (res.ok) router.refresh();
    else alert(body.message ?? 'Action failed.');
  }

  return (
    <div className="flex justify-end gap-2 text-xs">
      <button className="btn-primary px-2 py-1" disabled={busy} onClick={() => decide('accept')}>
        Accept
      </button>
      <button className="btn-ghost px-2 py-1" disabled={busy} onClick={() => decide('decline')}>
        Decline
      </button>
    </div>
  );
}
