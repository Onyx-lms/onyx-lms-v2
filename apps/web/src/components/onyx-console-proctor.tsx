'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Icon } from '@/components/onyx-ui';

/**
 * Clear or uphold one attempt's integrity case, from the console.
 *
 * A verdict on somebody's examination is not a thing to record by accident, so
 * it takes two clicks and the second one is labelled with the decision rather
 * than "OK". Upholding also asks for a note, because "upheld" with no reason
 * attached is a sentence nobody can defend a month later — and the note is
 * where the reason belongs, not in somebody's memory.
 *
 * Clearing does not require one: "there was nothing in it" is a complete
 * account, and demanding prose for the innocent case is how flags come to be
 * left open instead of dismissed.
 */
export function AttemptVerdict({ tenantId, attemptId, settled }: {
  tenantId: number;
  attemptId: number;
  /** Whether somebody has already ruled on it. */
  settled: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState<'cleared' | 'upheld' | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const send = (decision: 'cleared' | 'upheld') => start(async () => {
    setError(null);
    const res = await fetch('/api/proxy/onyx/platform/tenants/' + tenantId
      + '/attempts/' + attemptId + '/integrity', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision, note: note.trim() || null }),
    });
    const body = await res.json().catch(() => ({ ok: false }));
    if (!body.ok) { setError(body.message ?? 'That did not work.'); return; }
    setOpen(null);
    setNote('');
    router.refresh();
  });

  const quiet = 'inline-flex min-h-[30px] items-center gap-1 rounded-lg border border-line '
    + 'px-2.5 text-[12.5px] font-semibold hover:bg-brand-50 disabled:opacity-60';

  if (open) {
    return (
      <div className="min-w-[16rem] space-y-2 text-left">
        {error ? <p role="alert" className="text-[12.5px] text-red-700">{error}</p> : null}
        <label className="block">
          <span className="block text-[12px] font-semibold text-slate-700">
            {open === 'upheld' ? 'Why it is upheld' : 'Note (optional)'}
          </span>
          <textarea
            value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={5000}
            className="mt-1 w-full rounded-xl border border-line bg-white px-2.5 py-1.5
                       text-[12.5px] focus:border-brand-500 focus:outline-none"
            placeholder={open === 'upheld'
              ? 'What was seen, and when.'
              : 'Anything worth recording.'}
          />
        </label>
        <div className="flex flex-wrap gap-1.5">
          <button type="button" disabled={pending || (open === 'upheld' && !note.trim())}
            onClick={() => send(open)}
            className={'inline-flex min-h-[30px] items-center rounded-lg px-2.5 text-[12.5px] '
              + 'font-bold text-white disabled:opacity-60 '
              + (open === 'upheld' ? 'bg-rose-700 hover:bg-rose-800'
                : 'bg-emerald-700 hover:bg-emerald-800')}>
            {pending ? 'Recording…' : open === 'upheld' ? 'Uphold it' : 'Clear it'}
          </button>
          <button type="button" disabled={pending} onClick={() => { setOpen(null); setNote(''); }}
            className={quiet}>
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5">
      <button type="button" onClick={() => setOpen('cleared')} className={quiet}>
        <Icon name="check" className="h-3.5 w-3.5" />
        {settled ? 'Re-clear' : 'Clear'}
      </button>
      <button type="button" onClick={() => setOpen('upheld')}
        className={quiet + ' text-rose-700'}>
        <Icon name="alert" className="h-3.5 w-3.5" />
        Uphold
      </button>
    </span>
  );
}
