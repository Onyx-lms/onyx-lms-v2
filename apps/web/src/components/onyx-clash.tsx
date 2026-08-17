'use client';

import { useEffect, useState } from 'react';
import { Icon } from '@/components/onyx-ui';

interface Clash { kind: string; detail?: string; slot_id?: number }

/**
 * CMP-01b -- ask before you submit.
 *
 * The POST already refuses a double-booking and names it, so this is not what
 * *enforces* the rule. What it changes is when the registrar finds out: a 409
 * after submitting means re-opening the form and re-choosing, and the person
 * building a term does that forty times in an afternoon.
 *
 * `/api/onyx/timetable/check` existed for exactly this and had no caller. It is
 * the whole reason the endpoint is separate from the POST.
 *
 * Debounced, and it only asks once every field it needs has a value -- a
 * half-filled form has nothing to check and asking anyway would put a request
 * behind every keystroke.
 */
export function ClashCheck({ fields }: {
  fields: {
    semester_id?: string; course_id?: string; batch_id?: string;
    room_id?: string; faculty_id?: string; day_of_week?: string;
    starts_at?: string; ends_at?: string;
  };
}) {
  const [state, setState] = useState<'idle' | 'checking' | 'clear' | 'clash'>('idle');
  const [clashes, setClashes] = useState<Clash[]>([]);

  const ready = Boolean(
    fields.semester_id && fields.course_id && fields.batch_id && fields.room_id
    && fields.faculty_id && fields.day_of_week && fields.starts_at && fields.ends_at,
  );
  const key = JSON.stringify(fields);

  useEffect(() => {
    if (!ready) { setState('idle'); return; }
    let cancelled = false;
    setState('checking');

    const timer = setTimeout(async () => {
      try {
        const res = await fetch('/api/proxy/onyx/timetable/check', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            semester_id: Number(fields.semester_id),
            course_id: Number(fields.course_id),
            batch_id: Number(fields.batch_id),
            room_id: Number(fields.room_id),
            faculty_id: Number(fields.faculty_id),
            day_of_week: Number(fields.day_of_week),
            starts_at: fields.starts_at,
            ends_at: fields.ends_at,
          }),
        });
        const body = await res.json().catch(() => ({ ok: false }));
        if (cancelled) return;
        if (!body.ok) { setState('idle'); return; }
        setClashes(body.data.clashes ?? []);
        setState(body.data.clear ? 'clear' : 'clash');
      } catch {
        // A pre-check that cannot reach the server tells the registrar nothing
        // useful, and the POST will still refuse a clash. Stay quiet.
        if (!cancelled) setState('idle');
      }
    }, 400);

    return () => { cancelled = true; clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, ready]);

  if (state === 'idle') return null;

  if (state === 'checking') {
    return (
      <p className="text-[12.5px] text-muted" aria-live="polite">Checking for clashes…</p>
    );
  }

  if (state === 'clear') {
    return (
      <p className="flex items-center gap-1.5 text-[12.5px] font-semibold text-green-700"
        aria-live="polite">
        <Icon name="check" className="h-4 w-4" />
        The room, the teacher and the batch are all free then.
      </p>
    );
  }

  return (
    <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3 py-2">
      <p className="text-[12.5px] font-bold text-red-800">
        {clashes.length === 1 ? 'That clashes with something' : 'That clashes with ' + clashes.length + ' things'}
      </p>
      <ul className="mt-1 space-y-0.5 text-[12.5px] text-red-900">
        {clashes.map((c, i) => (
          <li key={i}>{c.detail ?? c.kind}</li>
        ))}
      </ul>
    </div>
  );
}
