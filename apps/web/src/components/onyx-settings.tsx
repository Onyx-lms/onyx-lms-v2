'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Card } from '@/components/onyx-ui';

/**
 * F-07 -- one institution-level switch: can faculty schedule an exam
 * themselves, or does every one have to come from admin or the exams
 * office. Admin only, which is who requireOnyxPageRole gates the page to.
 *
 * A plain checkbox would work exactly the same way, but this reads as "on
 * or off for the whole institution" at a glance, which a checkbox styled
 * like a form field does not -- the same reason a light switch and not a
 * checkbox is on the wall.
 */
export function FacultyExamPermissionToggle({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const toggle = () => start(async () => {
    setError(null);
    const res = await fetch('/api/proxy/onyx/tenant/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ faculty_can_schedule_exams: !enabled }),
    });
    const body = await res.json().catch(() => ({}));
    if (!body.ok) { setError(body.message ?? 'Could not change that.'); return; }
    router.refresh();
  });

  return (
    <Card className="p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="text-[15px] font-bold">Faculty can schedule examinations</h3>
          <p className="mt-1 max-w-prose text-[13px] leading-relaxed text-muted">
            {enabled
              ? 'On -- any faculty member can schedule an exam for a course they teach, the '
                + 'same as admin and the examinations office already can.'
              : 'Off -- only admin and the examinations office can schedule an exam. Faculty '
                + 'still mark and publish results for exams exactly as before; this only '
                + 'gates who can put a new one on the calendar.'}
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label="Faculty can schedule examinations"
          disabled={pending}
          onClick={toggle}
          className={'relative h-8 w-14 shrink-0 rounded-full transition-colors disabled:opacity-50 '
            + (enabled ? 'bg-brand-600' : 'bg-slate-300')}
        >
          <span
            aria-hidden="true"
            className={'absolute top-1 h-6 w-6 rounded-full bg-white shadow-sm transition-transform '
              + (enabled ? 'translate-x-7' : 'translate-x-1')}
          />
        </button>
      </div>
      {error ? <p role="alert" className="mt-3 text-sm text-rose-600">{error}</p> : null}
    </Card>
  );
}
