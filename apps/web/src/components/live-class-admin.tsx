'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export interface LiveClass {
  id: number;
  class_topic: string | null;
  provider: string | null;
  class_date_and_time: string | null;
  note: string | null;
  meeting_id: number | string | null;
  join_window: { open: boolean; opensAt: string | null; closesAt: string | null };
}

/** LC-01 -- schedule, reschedule and cancel a class. */
export function LiveClassAdmin({ courseId, mode = 'create', liveClass }: {
  courseId?: number;
  mode?: 'create' | 'row';
  liveClass?: LiveClass;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  if (mode === 'row') {
    return (
      <div className="flex justify-end gap-2 text-xs">
        {liveClass!.join_window.open && (
          <a className="btn-primary px-3 py-1" href={'/live-class/' + liveClass!.id}>Start</a>
        )}
        <button className="btn-ghost px-2 py-1 text-red-600" disabled={busy}
          onClick={async () => {
            if (!confirm('Cancel this class? The meeting is deleted too.')) return;
            setBusy(true);
            const res = await fetch('/api/proxy/manage/live-classes/' + liveClass!.id,
              { method: 'DELETE' });
            setBusy(false);
            if (!res.ok) { setMessage('Could not cancel the class.'); return; }
            router.refresh();
          }}>
          Cancel
        </button>
        {message && <span className="text-red-600">{message}</span>}
      </div>
    );
  }

  return (
    <form className="card space-y-3 p-4"
      onSubmit={async (e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const f = new FormData(form);
        setBusy(true); setMessage('');
        const res = await fetch('/api/proxy/manage/courses/' + courseId + '/live-classes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            class_topic: String(f.get('class_topic') ?? ''),
            provider: String(f.get('provider') ?? 'jitsi'),
            // datetime-local has no zone; treat it as the operator's local time.
            class_date_and_time: new Date(String(f.get('class_date_and_time'))).toISOString(),
            note: String(f.get('note') ?? '') || null,
            duration: Number(f.get('duration') ?? 60),
          }),
        });
        const body = await res.json().catch(() => ({}));
        setBusy(false);
        // A Zoom failure is reported verbatim -- it usually says exactly what
        // is wrong with the credentials or the schedule.
        if (!res.ok) { setMessage(body.message ?? 'Could not schedule the class.'); return; }
        form.reset();
        router.refresh();
      }}>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="block text-sm font-medium">Topic</label>
          <input name="class_topic" required maxLength={255}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="block text-sm font-medium">Provider</label>
          <select name="provider"
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
            <option value="jitsi">Jitsi (no account needed)</option>
            <option value="zoom">Zoom</option>
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium">Starts</label>
          <input name="class_date_and_time" type="datetime-local" required
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="block text-sm font-medium">Minutes</label>
          <input name="duration" type="number" min={5} max={1440} defaultValue={60}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        </div>
      </div>
      <div>
        <label className="block text-sm font-medium">Note for students</label>
        <textarea name="note" rows={2}
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
      </div>
      <button className="btn-primary" disabled={busy} type="submit">
        {busy ? 'Scheduling...' : 'Schedule class'}
      </button>
      {message && <p className="text-sm text-red-600">{message}</p>}
    </form>
  );
}
