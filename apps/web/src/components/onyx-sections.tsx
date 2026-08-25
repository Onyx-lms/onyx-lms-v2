'use client';

import { useState, useTransition } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';

/** A teaching division, as every screen here reads one. */
export interface SectionRow {
  id: number;
  name: string;
  code: string;
  sort: number;
  status: number;
  /** Only the console's own listing carries this. */
  member_count?: number;
}

const field = 'rounded-xl border border-line bg-white px-3 py-2 text-[13px] '
  + 'focus:border-brand-500 focus:outline-none';
const label = 'block text-[12.5px] font-semibold text-slate-700';
const button = 'rounded-lg bg-brand-600 px-3.5 py-2 text-[13px] font-semibold text-white '
  + 'hover:bg-brand-700 disabled:opacity-60';

async function send(path: string, body?: unknown, method = 'POST') {
  const res = await fetch('/api/proxy/' + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const parsed = await res.json().catch(() => ({ ok: false }));
  if (res.status === 401) {
    window.location.assign('/onyx/platform/login?expired=1&next='
      + encodeURIComponent(window.location.pathname));
    return { ok: false, message: 'Your session expired.' };
  }
  return parsed as { ok: boolean; message?: string; data?: Record<string, unknown> };
}

/**
 * Narrow a roll to one teaching division.
 *
 * A query-string filter rather than component state, for two reasons that both
 * matter on a roster: the filtered list is a link somebody can send to a
 * colleague, and the page re-reads from the server so the count beside the
 * heading counts the same set the rows are drawn from.
 *
 * "No section" is offered as deliberately as the sections themselves. It is
 * the list somebody works from at the start of a term, and a filter that could
 * only name a division would make the people who most need moving the hardest
 * to find.
 */
export function SectionFilter({ sections, current }: {
  sections: SectionRow[];
  current?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  if (!sections.length) return null;

  return (
    <label className="flex items-center gap-2">
      <span className="text-[12.5px] font-semibold text-slate-700">Section</span>
      <select
        value={current ?? ''}
        aria-label="Filter by section"
        className={field}
        onChange={(e) => {
          const next = new URLSearchParams(params.toString());
          if (e.target.value) next.set('section', e.target.value);
          else next.delete('section');
          router.push(pathname + (next.toString() ? '?' + next.toString() : ''));
        }}
      >
        <option value="">Every section</option>
        {sections.map((sx) => (
          <option key={sx.id} value={sx.id}>{sx.name}</option>
        ))}
        <option value="none">In no section</option>
      </select>
    </label>
  );
}

/**
 * Which section one person is in, changed in place.
 *
 * On the row rather than behind an edit dialog: moving somebody between
 * divisions is the single most common thing done to a roll at the start of a
 * term, and a dialog per person turns a morning's work into an afternoon's.
 * It is not destructive — the worst case is somebody in the wrong group for a
 * moment, fixed by the same control.
 */
export function SectionPicker({ basePath, membershipId, sections, current }: {
  /** Where the member lives: the console's path, or the institution's own. */
  basePath: string;
  membershipId: number;
  sections: SectionRow[];
  current: number | null;
}) {
  const router = useRouter();
  const [value, setValue] = useState(current === null ? '' : String(current));
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (!sections.length) return <span className="text-[12.5px] text-muted">—</span>;

  return (
    <span className="inline-flex flex-col gap-1">
      <select
        value={value}
        disabled={pending}
        aria-label="Section for this person"
        className={field + ' py-1 text-[12.5px]'}
        onChange={(e) => {
          const next = e.target.value;
          setValue(next);
          start(async () => {
            setError(null);
            const res = await send(basePath + '/' + membershipId + '/section',
              { section_id: next ? Number(next) : null }, 'PUT');
            if (!res.ok) {
              setError(res.message ?? 'That did not save.');
              // Put the control back to what is actually stored, rather than
              // leaving it showing a change that did not happen.
              setValue(current === null ? '' : String(current));
              return;
            }
            router.refresh();
          });
        }}
      >
        <option value="">No section</option>
        {sections.map((sx) => (
          <option key={sx.id} value={sx.id}>{sx.name}</option>
        ))}
      </select>
      {error ? <span role="alert" className="text-[11.5px] text-red-700">{error}</span> : null}
    </span>
  );
}

/**
 * The divisions an institution runs, and the controls to change them.
 *
 * Retiring rather than deleting is the default action once anybody is in a
 * section, and the screen says why: the row is part of the record of who sat
 * what. Deleting stays available for a section nobody has used, which is the
 * one somebody has just created by mistake.
 */
export function SectionManager({ basePath, sections, canSeed = false }: {
  basePath: string;
  sections: SectionRow[];
  /** Offer the starter set, for an institution that has none. */
  canSeed?: boolean;
}) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const act = (run: () => Promise<{ ok: boolean; message?: string }>) => start(async () => {
    setError(null);
    const res = await run();
    if (!res.ok) { setError(res.message ?? 'That did not work.'); return; }
    setName('');
    setCode('');
    router.refresh();
  });

  return (
    <div className="space-y-3">
      {sections.length === 0 ? (
        <div className="rounded-xl bg-amber-50 p-3">
          <p className="text-[13px] font-semibold text-amber-900">
            This institution runs no sections yet.
          </p>
          <p className="mt-1 text-[12.5px] leading-relaxed text-amber-800">
            Until it does, a student joining cannot say which division they are in, and every
            paper is set for the whole cohort.
          </p>
          {canSeed ? (
            <div className="mt-2.5 flex flex-wrap gap-2">
              <button type="button" disabled={pending} className={button}
                onClick={() => act(() => send(basePath + '/seed', { preset: 'letters' }))}>
                Add Section A, B and C
              </button>
              <button type="button" disabled={pending}
                className="rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-[13px]
                           font-semibold"
                onClick={() => act(() => send(basePath + '/seed', { preset: 'greek' }))}>
                Add Alpha, Beta and Gamma
              </button>
            </div>
          ) : null}
        </div>
      ) : (
        <ul className="space-y-1.5">
          {sections.map((sx) => (
            <li key={sx.id}
              className={'flex flex-wrap items-center justify-between gap-2 rounded-xl border '
                + 'border-line px-3 py-2 ' + (sx.status === 1 ? '' : 'bg-slate-50 opacity-70')}>
              <span className="min-w-0">
                <span className="text-[13.5px] font-semibold text-ink">{sx.name}</span>
                <span className="ml-2 font-mono text-[12px] text-muted">{sx.code}</span>
                {sx.status === 1 ? null : (
                  <span className="ml-2 text-[12px] font-semibold text-muted">retired</span>
                )}
                <span className="block text-[12px] text-muted">
                  {sx.member_count === undefined ? null
                    : sx.member_count + (sx.member_count === 1 ? ' person' : ' people')}
                </span>
              </span>
              <span className="flex shrink-0 gap-1.5">
                <button type="button" disabled={pending}
                  className="rounded-lg border border-slate-300 bg-white px-2.5 py-1
                             text-[12.5px] font-semibold"
                  onClick={() => act(() => send(basePath + '/' + sx.id,
                    { status: sx.status === 1 ? 0 : 1 }, 'PATCH'))}>
                  {sx.status === 1 ? 'Retire' : 'Bring back'}
                </button>
                {/* Offered always; refused by the server while anybody is in
                    it, with the reason. Hiding it would make "why can I not
                    delete this" a question with no answer on screen. */}
                <button type="button" disabled={pending}
                  className="rounded-lg border border-slate-300 bg-white px-2.5 py-1
                             text-[12.5px] font-semibold text-red-700"
                  onClick={() => act(() => send(basePath + '/' + sx.id, undefined, 'DELETE'))}>
                  Remove
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}

      <form
        className="flex flex-wrap items-end gap-2 border-t border-line pt-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim()) { setError('A section needs a name.'); return; }
          act(() => send(basePath, { name: name.trim(), code: code.trim() || undefined }));
        }}
      >
        <div className="min-w-[10rem]">
          <label className={label} htmlFor="sec-name">Add a section</label>
          <input id="sec-name" value={name} maxLength={80} placeholder="Delta"
            onChange={(e) => setName(e.target.value)} className={field + ' mt-1 w-full'} />
        </div>
        <div className="w-28">
          <label className={label} htmlFor="sec-code">Short code</label>
          <input id="sec-code" value={code} maxLength={20} placeholder="delta"
            onChange={(e) => setCode(e.target.value)} className={field + ' mt-1 w-full'} />
        </div>
        <button type="submit" disabled={pending} className={button}>
          {pending ? 'Saving…' : 'Add'}
        </button>
      </form>

      {error ? <p role="alert" className="text-[13px] text-red-700">{error}</p> : null}
    </div>
  );
}
