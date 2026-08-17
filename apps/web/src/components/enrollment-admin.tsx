'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function EnrollmentAdmin({ mode = 'create', enrollmentId }: {
  mode?: 'create' | 'delete';
  enrollmentId?: number;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [level, setLevel] = useState<'error' | 'success'>('success');

  if (mode === 'delete') {
    return (
      <button className="text-xs text-red-600 hover:underline disabled:opacity-50" disabled={busy}
        onClick={async () => {
          if (!confirm('Remove this enrolment? The student loses access.')) return;
          setBusy(true);
          await fetch(`/api/proxy/admin/enrollments/${enrollmentId}`, { method: 'DELETE' });
          setBusy(false);
          router.refresh();
        }}>
        Remove
      </button>
    );
  }

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true); setMessage('');
    const f = new FormData(e.currentTarget);
    const res = await fetch('/api/proxy/admin/enrollments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        course_id: Number(f.get('course_id')),
        user_id: Number(f.get('user_id')),
      }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    setLevel(res.ok ? 'success' : 'error');
    setMessage(body.message ?? (res.ok ? 'Enrolled.' : 'Could not enrol.'));
    if (res.ok) { e.currentTarget.reset(); router.refresh(); }
  }

  return (
    <form onSubmit={submit} className="card flex flex-wrap items-end gap-3 p-4">
      <div>
        <label className="block text-sm font-medium">Course id</label>
        <input name="course_id" type="number" required
          className="mt-1 w-32 rounded-lg border border-slate-300 px-3 py-2 text-sm" />
      </div>
      <div>
        <label className="block text-sm font-medium">Student id</label>
        <input name="user_id" type="number" required
          className="mt-1 w-32 rounded-lg border border-slate-300 px-3 py-2 text-sm" />
      </div>
      <button className="btn-primary" disabled={busy}>{busy ? 'Enrolling' : 'Enrol student'}</button>
      {message && (
        <p className={`w-full text-sm ${level === 'error' ? 'text-red-600' : 'text-green-700'}`}>
          {message}
        </p>
      )}
    </form>
  );
}
