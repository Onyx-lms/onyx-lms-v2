'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export interface Enquiry {
  id: number; name: string | null; email: string | null; phone: string | null;
  address: string | null; message: string | null;
  has_read: number | null; replied: number | null; created_at: string | null;
}

/** M-06 -- reply to an enquiry by email, or delete it. */
export function ContactInbox({ enquiry }: { enquiry: Enquiry }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  return (
    <div className="text-right">
      <div className="flex justify-end gap-2 text-xs">
        <button className="btn-ghost px-2 py-1" onClick={() => setOpen(!open)}>
          {open ? 'Cancel' : 'Reply'}
        </button>
        <button className="btn-ghost px-2 py-1 text-red-600" disabled={busy}
          onClick={async () => {
            if (!confirm('Delete this enquiry?')) return;
            setBusy(true);
            await fetch('/api/proxy/admin/contacts/' + enquiry.id, { method: 'DELETE' });
            setBusy(false); router.refresh();
          }}>
          Delete
        </button>
      </div>

      {open && (
        <form className="mt-2 space-y-2 text-left"
          onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            setBusy(true); setMessage('');
            const res = await fetch('/api/proxy/admin/contacts/' + enquiry.id + '/reply', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                subject: String(f.get('subject') ?? '') || undefined,
                message: String(f.get('message') ?? ''),
              }),
            });
            const body = await res.json().catch(() => ({}));
            setBusy(false);
            // A failed send leaves the enquiry unanswered on purpose, so the
            // error has to be visible rather than swallowed.
            setMessage(body.message ?? (res.ok ? 'Sent.' : 'Could not send the reply.'));
            if (res.ok) { setOpen(false); router.refresh(); }
          }}>
          <input name="subject" placeholder="Subject (optional)"
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
          <textarea name="message" rows={4} required placeholder="Your reply"
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
          <button className="btn-primary" disabled={busy} type="submit">
            {busy ? 'Sending...' : 'Send reply'}
          </button>
        </form>
      )}
      {message && <p className="mt-2 text-left text-sm text-slate-600">{message}</p>}
    </div>
  );
}
