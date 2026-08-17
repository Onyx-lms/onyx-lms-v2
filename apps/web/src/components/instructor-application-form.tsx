'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export interface MyApplication {
  id: number; phone: string | null; description: string | null;
  status: number | null; created_at: string | null;
}

/** SET-09 -- apply to teach. */
export function InstructorApplicationForm({ open, note, application }: {
  open: boolean;
  note: string | null;
  application: MyApplication | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  if (!open) {
    return (
      <p className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
        We are not taking instructor applications at the moment.
      </p>
    );
  }

  if (application && !application.status) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        Your request is in process. Please wait for admin to response.
      </div>
    );
  }

  if (application?.status) {
    return (
      <div className="rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-900">
        Your application was approved. You can publish courses now.
      </div>
    );
  }

  return (
    <form className="card max-w-2xl space-y-3 p-5"
      onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        setBusy(true); setMessage('');
        const res = await fetch('/api/proxy/me/instructor-application', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            phone: String(f.get('phone') ?? ''),
            description: String(f.get('description') ?? ''),
            // The file itself is uploaded through the media endpoint first; this
            // records where it landed.
            document: String(f.get('document') ?? ''),
          }),
        });
        const body = await res.json().catch(() => ({}));
        setBusy(false);
        if (!res.ok) { setMessage(body.message ?? 'Could not submit it.'); return; }
        router.refresh();
      }}>
      {note && <p className="text-sm text-slate-600">{note}</p>}
      <div>
        <label className="block text-sm font-medium">Phone</label>
        <input name="phone" required maxLength={255}
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
      </div>
      <div>
        <label className="block text-sm font-medium">Why you want to teach</label>
        <textarea name="description" rows={5} required
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
      </div>
      <div>
        <label className="block text-sm font-medium">Supporting document</label>
        <input name="document" required maxLength={255}
          placeholder="uploads/applications/your-cv.pdf"
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        <p className="mt-1 text-xs text-slate-500">
          Upload the file first, then paste its path here.
        </p>
      </div>
      <button className="btn-primary" disabled={busy} type="submit">
        {busy ? 'Submitting...' : 'Submit application'}
      </button>
      {message && <p className="text-sm text-red-600">{message}</p>}
    </form>
  );
}
