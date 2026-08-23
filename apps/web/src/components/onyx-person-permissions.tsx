'use client';

import { useMemo, useState, useTransition } from 'react';
import { Card, Icon, Pill, SectionHead, State } from '@/components/onyx-ui';

/**
 * Permissions for one person, found by name or roll number.
 *
 * The role matrix beside this answers "what may faculty do". It cannot answer
 * the question institutions actually ask, which is always about somebody in
 * particular: the lecturer who also runs the timetable, the one exams officer
 * trusted with the fee structures, the head of department who needs the audit
 * log and whose colleagues do not. Answering those through the matrix means
 * promoting everybody who shares their role — which is how a permission system
 * quietly becomes "everyone is an administrator".
 *
 * **A grant here can never exceed the capability.** Every capability carries a
 * list of roles it may ever be delegated to, and several are deliberately
 * empty. A switch for something this person's role may never hold is not
 * offered at all, and would be dropped by the API if it were — the screen
 * agrees with the rule rather than restating it.
 *
 * **Three states, not two.** "Their role gives them this", "granted to them by
 * name" and "taken away from them by name" are different facts, and a checkbox
 * can only carry two of them. So each row is a three-way choice, and the
 * default — "follow their role" — is the one that stays correct when the
 * matrix changes.
 */

export interface PersonRow {
  id: number;
  user_id: string;
  role: string;
  name: string | null;
  email: string | null;
  roll_number: string | null;
}

interface CapabilityRow {
  key: string;
  area: string;
  label: string;
  detail: string;
  by_role: boolean;
  personal: boolean | null;
  effective: boolean;
  grantable: boolean;
}

export function PersonPermissions({ people }: { people: PersonRow[] }) {
  const [query, setQuery] = useState('');
  const [chosen, setChosen] = useState<PersonRow | null>(null);
  const [caps, setCaps] = useState<CapabilityRow[] | null>(null);
  const [draft, setDraft] = useState<Record<string, boolean | null>>({});
  const [pending, start] = useTransition();
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  /**
   * Name, roll number or address.
   *
   * Roll number because that is what staff have to hand — a mark sheet and a
   * seating plan are keyed to it, not to somebody's email address. Matching is
   * case- and space-insensitive on all three.
   */
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return people.filter((p) =>
      (p.name ?? '').toLowerCase().includes(q)
      || (p.roll_number ?? '').toLowerCase().includes(q)
      || (p.email ?? '').toLowerCase().includes(q)).slice(0, 8);
  }, [people, query]);

  async function open(person: PersonRow) {
    setChosen(person);
    setCaps(null);
    setNote(null);
    setError(null);
    const res = await fetch('/api/proxy/onyx/members/' + person.id + '/permissions');
    const body = await res.json().catch(() => ({}));
    if (!body.ok) { setError(body.message ?? 'Could not read that person.'); return; }
    setCaps(body.data.capabilities as CapabilityRow[]);
    setDraft(Object.fromEntries(
      (body.data.capabilities as CapabilityRow[]).map((c) => [c.key, c.personal])));
  }

  function save() {
    if (!chosen) return;
    setError(null);
    setNote(null);
    start(async () => {
      // Only the decisions that were actually made. "Follow their role" is the
      // absence of a decision, not a third value to store -- otherwise a row
      // saying "granted, same as the role" would keep its grant after the
      // matrix took it away from the role.
      const permissions: Record<string, boolean> = {};
      for (const [key, value] of Object.entries(draft)) {
        if (typeof value === 'boolean') permissions[key] = value;
      }
      const res = await fetch('/api/proxy/onyx/members/' + chosen.id + '/permissions', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ permissions }),
      });
      const body = await res.json().catch(() => ({}));
      if (!body.ok) { setError(body.message ?? 'That did not save.'); return; }
      // Re-read FIRST, then say so. `open` clears the notice on the way in --
      // it has to, or a stale "Saved." would follow the reader to the next
      // person they looked at -- so setting the notice before it meant the
      // confirmation was wiped a moment after it appeared, and the save looked
      // like it had done nothing.
      await open(chosen);
      setNote('Saved.');
    });
  }

  const areas = useMemo(() => [...new Set((caps ?? []).map((c) => c.area))], [caps]);
  const changed = useMemo(() => (caps ?? []).some((c) => draft[c.key] !== c.personal),
    [caps, draft]);

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-[13px] font-semibold text-slate-700" htmlFor="pp-search">
          Find a person
        </label>
        <input
          id="pp-search" value={query} onChange={(e) => setQuery(e.target.value)}
          placeholder="Name, roll number or email"
          className="mt-1.5 block min-h-[42px] w-full rounded-xl border border-line bg-white
                     px-3.5 text-[14px] focus:border-brand-500 focus:outline-none
                     focus:ring-2 focus:ring-brand-600/20"
        />
        {query.trim() && !matches.length ? (
          <p className="mt-1.5 text-[12.5px] text-muted">Nobody here matches that.</p>
        ) : null}
      </div>

      {matches.length ? (
        <ul className="divide-y divide-line rounded-xl border border-line">
          {matches.map((p) => (
            <li key={p.id}>
              <button type="button" onClick={() => void open(p)}
                className="flex w-full items-center justify-between gap-3 px-3.5 py-2.5
                           text-left hover:bg-brand-50">
                <span className="min-w-0">
                  <span className="block truncate text-[14px] font-semibold text-ink">
                    {p.name ?? p.email ?? 'Member #' + p.id}
                  </span>
                  <span className="block truncate text-[12px] text-muted">
                    {[p.role, p.roll_number, p.email].filter(Boolean).join(' · ')}
                  </span>
                </span>
                <Icon name="chevron" className="h-4 w-4 shrink-0 text-muted" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {chosen ? (
        <Card className="p-4">
          <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[15px] font-bold text-ink">
                {chosen.name ?? chosen.email ?? 'Member #' + chosen.id}
              </p>
              <p className="text-[12.5px] text-muted">
                {[chosen.role, chosen.roll_number, chosen.email].filter(Boolean).join(' · ')}
              </p>
            </div>
            <button type="button" onClick={() => { setChosen(null); setCaps(null); }}
              className="min-h-[34px] rounded-xl border border-line px-3 text-[12.5px]
                         font-semibold">
              Close
            </button>
          </div>

          {error ? (
            <p role="alert" className="mb-3 rounded-xl bg-rose-50 px-3 py-2 text-[13px]
                                       text-rose-700">{error}</p>
          ) : null}
          {note ? (
            <p role="status" className="mb-3 rounded-xl bg-green-50 px-3 py-2 text-[13px]
                                        text-green-800">{note}</p>
          ) : null}

          {!caps ? (
            <p className="text-[13px] text-muted">Reading their permissions…</p>
          ) : (
            <>
              {areas.map((area) => (
                <section key={area} className="mb-4">
                  <SectionHead title={area} />
                  <ul className="divide-y divide-line rounded-xl border border-line">
                    {caps.filter((c) => c.area === area).map((c) => {
                      const value = draft[c.key] ?? null;
                      const effective = value === null ? c.by_role : value;
                      return (
                        <li key={c.key} className="p-3">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div className="min-w-0 flex-1">
                              <p className="text-[13.5px] font-semibold text-ink">{c.label}</p>
                              <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted">
                                {c.detail}
                              </p>
                              <p className="mt-1">
                                <State tone={effective ? 'on' : 'idle'}>
                                  {effective ? 'Can do this' : 'Cannot do this'}
                                </State>
                              </p>
                            </div>

                            {/*
                              * Three choices, not a checkbox. "Follow their
                              * role" is the state that stays right when the
                              * matrix changes, so it is the default and it is
                              * named rather than being the absence of a tick.
                              */}
                            <div className="flex shrink-0 flex-wrap gap-1.5">
                              {([
                                [null, 'Follow role'],
                                [true, 'Allow'],
                                [false, 'Block'],
                              ] as const).map(([option, label]) => {
                                // A capability this role may never hold is not
                                // offered. The API drops such a grant anyway;
                                // showing the switch would be a promise the
                                // save quietly breaks.
                                if (option === true && !c.grantable) return null;
                                const on = value === option;
                                return (
                                  <button
                                    key={String(label)} type="button"
                                    onClick={() => setDraft({ ...draft, [c.key]: option })}
                                    aria-pressed={on}
                                    className={'min-h-[30px] rounded-lg border px-2.5 '
                                      + 'text-[12px] font-semibold '
                                      + (on
                                        ? 'border-brand-600 bg-brand-600 text-white'
                                        : 'border-line text-slate-700 hover:bg-brand-50')}
                                  >
                                    {label}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                          {value !== null ? (
                            <p className="mt-1.5">
                              <Pill tone={value ? 'good' : 'late'}>
                                {value
                                  ? 'Given to them by name'
                                  : 'Taken from them by name'}
                              </Pill>
                            </p>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ))}

              <button type="button" onClick={save} disabled={pending || !changed}
                className="min-h-[40px] rounded-xl bg-brand-600 px-4 text-[14px] font-bold
                           text-white hover:bg-brand-700 disabled:opacity-50">
                {pending ? 'Saving…' : changed ? 'Save their permissions' : 'No changes'}
              </button>
            </>
          )}
        </Card>
      ) : null}
    </div>
  );
}
