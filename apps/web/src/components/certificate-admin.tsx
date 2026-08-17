'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function CertificateAdmin({ mode = 'create', certificateId, identifier }: {
  mode?: 'create' | 'row';
  certificateId?: number;
  identifier?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [level, setLevel] = useState<'error' | 'success'>('success');
  const [students, setStudents] = useState<{ id: number; name: string; email: string }[]>([]);

  if (mode === 'row') {
    return (
      <div className="flex justify-end gap-2 text-xs">
        <a href={'/verify/certificate/' + identifier} className="btn-ghost px-2 py-1">Verify</a>
        <button className="btn-ghost px-2 py-1 text-red-600" disabled={busy}
          onClick={async () => {
            if (!confirm('Delete this certificate? The student loses their proof.')) return;
            setBusy(true);
            await fetch('/api/proxy/admin/certificates/' + certificateId, { method: 'DELETE' });
            setBusy(false);
            router.refresh();
          }}>
          Delete
        </button>
      </div>
    );
  }

  /** Only enrolled students without a certificate are offered. */
  async function loadStudents(courseId: string) {
    setStudents([]);
    if (!courseId) return;
    const res = await fetch('/api/proxy/admin/certificates/eligible/' + courseId);
    const body = await res.json().catch(() => ({}));
    if (res.ok) setStudents(body.data ?? []);
  }

  async function issue(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true); setMessage('');
    const f = new FormData(e.currentTarget);
    const res = await fetch('/api/proxy/admin/certificates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        course_id: Number(f.get('course_id')), user_id: Number(f.get('user_id')),
      }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    setLevel(res.ok ? 'success' : 'error');
    setMessage(body.message ?? (res.ok ? 'Issued.' : 'Could not issue.'));
    if (res.ok) router.refresh();
  }

  return (
    <form onSubmit={issue} className="card flex flex-wrap items-end gap-3 p-4">
      <div>
        <label className="block text-sm font-medium">Course id</label>
        <input name="course_id" type="number" required
          onChange={(e) => loadStudents(e.target.value)}
          className="mt-1 w-32 rounded-lg border border-slate-300 px-3 py-2 text-sm" />
      </div>
      <div>
        <label className="block text-sm font-medium">Student</label>
        <select name="user_id" required
          className="mt-1 w-64 rounded-lg border border-slate-300 px-3 py-2 text-sm">
          {students.length === 0 && <option value="">Enter a course id first</option>}
          {students.map((s) => (
            <option key={s.id} value={s.id}>{s.name} ({s.email})</option>
          ))}
        </select>
      </div>
      <button className="btn-primary" disabled={busy || students.length === 0}>
        {busy ? 'Issuing' : 'Issue certificate'}
      </button>
      {message && (
        <p className={'w-full text-sm ' + (level === 'error' ? 'text-red-600' : 'text-green-700')}>
          {message}
        </p>
      )}
    </form>
  );
}
