'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Card, Icon, Pill } from '@/components/onyx-ui';
import { ROLE_LABELS } from '@/lib/onyx-nav';
import type { Role } from '@/lib/onyx-session';

export interface CapabilityRow {
  key: string;
  area: string;
  label: string;
  detail: string;
  defaults: Role[];
  holders: Role[];
  holders_now: Role[];
  changed: boolean;
}

/**
 * The permission matrix, as a screen.
 *
 * Rendered as one grid per area rather than a single 40-row table: an
 * administrator arrives with a question about one part of the institution
 * ("should the exams office be able to add students?"), and a flat list of
 * every capability in the product makes them read all of it to answer that.
 *
 * Three things the design is deliberate about:
 *
 *   * Administrator is a column of ticks that cannot be clicked. It says out
 *     loud that the role holds everything, which is the fact somebody needs
 *     when deciding what to delegate -- and it is not a control, because an
 *     administrator who can revoke their own last capability has locked the
 *     institution out of itself.
 *   * A role that may never hold a capability shows a dash, not an unchecked
 *     box. An empty box says "you could turn this on"; the dash says "this is
 *     not a thing that role can be". Guardians and employers are absent from
 *     the grid entirely for the same reason -- they hold nothing at all.
 *   * Nothing saves until Save is pressed, and the count of what changed is on
 *     the button. Toggling a permission per click would mean an institution
 *     that half-changed its mind is left half-changed.
 */
export function PermissionMatrix({ capabilities, areas, canEdit, scope }: {
  capabilities: CapabilityRow[];
  areas: string[];
  /** Read-only for anyone without `settings.manage`. */
  canEdit: boolean;
  /** Where to PUT. The platform console addresses one institution by id. */
  scope: { endpoint: string; institution?: string };
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [notice, setNotice] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);

  // The roles a matrix can talk about at all: whoever any capability may be
  // given to, plus admin, which holds everything.
  const roles = useMemo(() => {
    const seen = new Set<Role>();
    for (const cap of capabilities) for (const r of cap.holders) seen.add(r);
    const order: Role[] = ['faculty', 'exams', 'placement', 'student', 'employer', 'guardian'];
    return order.filter((r) => seen.has(r));
  }, [capabilities]);

  const [granted, setGranted] = useState<Record<string, Role[]>>(
    () => Object.fromEntries(capabilities.map((c) => [c.key, c.holders_now])));

  const has = (key: string, role: Role) => (granted[key] ?? []).includes(role);
  const toggle = (key: string, role: Role) => {
    if (!canEdit) return;
    setGranted((prev) => {
      const now = prev[key] ?? [];
      return { ...prev, [key]: now.includes(role)
        ? now.filter((r) => r !== role)
        : [...now, role] };
    });
  };

  // What differs from what the server last sent -- the number on the button.
  const dirty = capabilities.filter((c) => {
    const now = new Set(granted[c.key] ?? []);
    const was = new Set(c.holders_now);
    return now.size !== was.size || [...now].some((r) => !was.has(r));
  });

  const save = () => start(async () => {
    setNotice(null);
    const res = await fetch(scope.endpoint, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ permissions: granted }),
    });
    const body = await res.json().catch(() => ({}));
    if (!body.ok) { setNotice({ tone: 'bad', text: body.message ?? 'That did not save.' }); return; }
    setNotice({ tone: 'ok', text: 'Saved. Everyone holding those roles is affected immediately.' });
    router.refresh();
  });

  const reset = () => {
    if (!canEdit) return;
    setGranted(Object.fromEntries(capabilities.map((c) => [c.key, ['admin' as Role, ...c.defaults.filter((r) => r !== 'admin')]])));
  };

  return (
    <div className="space-y-5">
      {notice ? (
        <p role="status"
          className={'rounded-xl px-3.5 py-2.5 text-[13px] '
            + (notice.tone === 'ok' ? 'bg-emerald-50 text-emerald-800' : 'bg-rose-50 text-rose-700')}>
          {notice.text}
        </p>
      ) : null}

      <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
        <p className="max-w-prose text-[13px] leading-relaxed text-muted">
          Administrators hold every permission here and always will.
          {scope.institution ? ' You are editing ' + scope.institution + '.' : ''}
          {' '}Each tick lets that role attempt the act; what they may do it <em>to</em> is
          unchanged — a lecturer with “Author content” still only reaches courses they teach.
        </p>
        {canEdit ? (
          <div className="flex shrink-0 items-center gap-2">
            <button type="button" onClick={reset} disabled={pending}
              className="min-h-[40px] rounded-xl border border-line px-3.5 text-[13px]
                         font-semibold hover:border-brand-300 hover:text-brand-700">
              Reset to defaults
            </button>
            <button type="button" onClick={save} disabled={pending || dirty.length === 0}
              className="min-h-[40px] rounded-xl bg-brand-600 px-4 text-[14px] font-bold text-white
                         hover:bg-brand-700 disabled:opacity-45">
              {pending ? 'Saving…'
                : dirty.length ? 'Save ' + dirty.length + ' change'
                  + (dirty.length === 1 ? '' : 's') : 'Saved'}
            </button>
          </div>
        ) : (
          <Pill tone="neutral">Read only</Pill>
        )}
      </Card>

      {areas.map((area) => {
        const rows = capabilities.filter((c) => c.area === area);
        if (!rows.length) return null;
        return (
          <section key={area}>
            <h2 className="mb-2 text-[11.5px] font-bold uppercase tracking-[.085em] text-muted">
              {area}
            </h2>
            <div className="overflow-x-auto rounded-2xl border border-line bg-white shadow-card">
              <table className="w-full text-sm">
                <caption className="sr-only">{area} permissions by role</caption>
                <thead>
                  <tr className="border-b border-line bg-slate-50 text-[11px] uppercase
                                 tracking-[.06em] text-muted">
                    <th scope="col" className="px-4 py-2.5 text-left font-bold">Permission</th>
                    <th scope="col" className="px-3 py-2.5 text-center font-bold">Admin</th>
                    {roles.map((r) => (
                      <th key={r} scope="col"
                        className="whitespace-nowrap px-3 py-2.5 text-center font-bold">
                        {ROLE_LABELS[r]}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {rows.map((cap) => (
                    <tr key={cap.key} className="align-top">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold">{cap.label}</span>
                          {dirty.some((d) => d.key === cap.key)
                            ? <Pill tone="soon">Unsaved</Pill>
                            : cap.changed ? <Pill tone="neutral">Changed</Pill> : null}
                        </div>
                        <div className="mt-0.5 max-w-prose text-[12.5px] text-muted">
                          {cap.detail}
                        </div>
                      </td>
                      <td className="px-3 py-3 text-center">
                        {/* Not a control: the role holds it, always. */}
                        <Icon name="check" className="mx-auto h-4 w-4 text-brand-600" />
                        <span className="sr-only">Administrators always hold this</span>
                      </td>
                      {roles.map((r) => {
                        const allowed = cap.holders.includes(r);
                        if (!allowed) {
                          return (
                            <td key={r} className="px-3 py-3 text-center text-faint">
                              <span aria-hidden="true">—</span>
                              <span className="sr-only">
                                {ROLE_LABELS[r]} cannot hold {cap.label}
                              </span>
                            </td>
                          );
                        }
                        return (
                          <td key={r} className="px-3 py-3 text-center">
                            <input
                              type="checkbox"
                              className="h-4.5 w-4.5 cursor-pointer accent-brand-600
                                         disabled:cursor-default"
                              checked={has(cap.key, r)}
                              disabled={!canEdit || pending}
                              onChange={() => toggle(cap.key, r)}
                              aria-label={ROLE_LABELS[r] + ' — ' + cap.label}
                            />
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}
    </div>
  );
}
