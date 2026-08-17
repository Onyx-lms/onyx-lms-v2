'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function ApprovalActions({ courseId }: { courseId: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function decide(approve: boolean) {
    setBusy(true);
    const res = await fetch(`/api/proxy/admin/course-approvals/${courseId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ approve }),
    });
    setBusy(false);
    if (res.ok) router.refresh();
    else alert('Could not update the course.');
  }

  return (
    <div className="flex gap-2">
      <button className="btn-primary" disabled={busy} onClick={() => decide(true)}>Approve</button>
      <button className="btn-ghost" disabled={busy} onClick={() => decide(false)}>Reject</button>
    </div>
  );
}
