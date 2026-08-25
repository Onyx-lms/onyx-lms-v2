import type { Metadata } from 'next';
import { OnyxShell } from '@/components/onyx-shell';
import { navFor } from '@/lib/onyx-nav';
import { requireOnyxPageRole, onyxApi, type Me } from '@/lib/onyx-session';
import { DataTable, EmptyRow, Icon, Pill, StatTile } from '@/components/onyx-ui';

export const metadata: Metadata = { title: 'Audit log' };

interface Entry {
  id: number;
  action: string;
  entity_type: string;
  entity_id: number | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  ip: string | null;
  created_at: string;
  actor: { id: number; name: string; email: string } | null;
}

/**
 * What actually changed, rendered as fields rather than as a JSON blob.
 *
 * The old column printed `{"fees":false} → {"fees":true}` and left the reader
 * to diff two objects by eye. An audit log is read when something has gone
 * wrong and somebody is under time pressure, which is the worst moment to ask
 * for that. The raw values are still exactly what the API returned -- nothing
 * is summarised away, only laid out.
 */
function changedFields(e: Entry): { key: string; from: string | null; to: string | null }[] {
  const keys = [...new Set([
    ...Object.keys(e.before ?? {}),
    ...Object.keys(e.after ?? {}),
  ])];
  const show = (v: unknown) =>
    v === undefined ? null : typeof v === 'string' ? v : JSON.stringify(v);
  return keys.map((key) => ({
    key,
    from: show((e.before ?? {})[key]),
    to: show((e.after ?? {})[key]),
  }));
}

/**
 * The verb, coloured by what it does.
 *
 * Every action in this log is `noun.verb`, and the verb is the part that says
 * whether somebody made something, changed something or took something away.
 * Two hundred rows of identical grey monospace hides exactly the row you came
 * looking for.
 */
function actionTone(action: string): 'good' | 'soon' | 'late' | 'brand' | 'neutral' {
  const verb = action.split('.')[1] ?? '';
  if (/^(created|issued|linked|granted|scheduled|asked|raised|recorded|entered|allocated)$/.test(verb)) {
    return 'good';
  }
  if (/^(published|released|resolved|generated|marked|returned|graded|moderated)$/.test(verb)) {
    return 'brand';
  }
  if (/^(removed|revoked|deleted|written_off|suspended)$/.test(verb)) return 'late';
  if (/^(changed|updated|amended|role_changed|consent_changed|configured|assigned)$/.test(verb)) {
    return 'soon';
  }
  return 'neutral';
}

/**
 * Whether this entry is one somebody would come here looking for after a
 * scare -- a sign-in, a session, a permission, a suspension, a key.
 *
 * It is marked three ways in the table: the shield in the first column, the
 * word inside the action pill, and the tone of the pill. Anyone who reads the
 * red and the grey as the same colour still has two of the three, which is the
 * whole point of not letting colour carry a state alone.
 */
function securityRelevant(action: string): boolean {
  return /^(auth|session|permission|gateway|token)\./.test(action)
    || /\.(suspended|removed|revoked|granted|role_changed|configured|deleted)$/.test(action);
}

const DAY = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

const TIME = (iso: string) => new Date(iso).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' });

/**
 * F-05 -- who changed what.
 *
 * Administrators only, and only ever this institution's log: the rows have RLS
 * with no select policy, so the API is the sole way to read them.
 *
 * Grouped by day, because the date was repeated on all two hundred rows and
 * carried no information after the first -- `11/8/2026, 2:09:03 am` on every
 * line, when what a reader needs is "this happened on Tuesday, at 02:09".
 */
export default async function OnyxAuditPage() {
  await requireOnyxPageRole('admin');
  const [me, entries] = await Promise.all([
    onyxApi<Me>('/api/onyx/me'),
    onyxApi<Entry[]>('/api/onyx/audit?limit=200'),
  ]);

  const days: { day: string; rows: Entry[] }[] = [];
  for (const e of entries) {
    const day = DAY(e.created_at);
    const last = days[days.length - 1];
    if (last?.day === day) last.rows.push(e);
    else days.push({ day, rows: [e] });
  }

  const actors = new Set(entries.map((e) => e.actor?.id ?? 0)).size;
  const security = entries.filter((e) => securityRelevant(e.action)).length;

  return (
    <OnyxShell
      me={me}
      nav={navFor(me.role)}
      title="Audit log"
      subtitle="Sensitive actions across this institution, newest first."
    >
      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Entries" value={entries.length}
          note={entries.length === 200 ? 'the most recent 200' : 'everything on record'} />
        <StatTile label="People" value={actors} note="acted in this window" />
        <StatTile label="Days" value={days.length} note="with activity" />
        <StatTile label="Security relevant" value={security}
          note="permissions, sign-ins, suspensions" />
      </div>

      <div className="space-y-7">
        {days.map(({ day, rows }) => (
          <section key={day}>
            <div className="mb-2.5 flex items-baseline justify-between gap-3">
              <h2 className="text-[11.5px] font-bold uppercase tracking-[.085em] text-muted">
                {day}
              </h2>
              <span className="text-[12.5px] tabular-nums text-muted">
                {rows.length} {rows.length === 1 ? 'entry' : 'entries'}
              </span>
            </div>
            {/* tabIndex makes the horizontal scroll reachable by keyboard: a
                region that only scrolls with a wheel or a trackpad swipe
                strands anyone on a keyboard at whatever columns happen to fit. */}
            <div tabIndex={0} role="region" aria-label={'Audit entries for ' + day}>
              <DataTable
                caption={'Audit entries for ' + day}
                head={
                  <>
                    {/* `relative` is load-bearing: `sr-only` is absolutely
                        positioned, and without a positioned ancestor it takes
                        its static position far along a sideways-scrolling
                        table and drags the page's scroll width out with it. */}
                    <th scope="col" className="relative !px-2">
                      <span className="sr-only">Security relevant</span>
                    </th>
                    <th scope="col">Time</th>
                    <th scope="col">Who</th>
                    <th scope="col">Action</th>
                    <th scope="col">Subject</th>
                    <th scope="col">What changed</th>
                    <th scope="col">IP</th>
                  </>
                }
              >
                {rows.map((e) => {
                  const fields = changedFields(e);
                  const sensitive = securityRelevant(e.action);
                  return (
                    <tr key={e.id} className="align-top">
                      <td className="!px-2">
                        {sensitive ? (
                          // `relative` for the same reason as the header cell:
                          // an absolutely positioned label with no positioned
                          // ancestor takes its static position far along a
                          // sideways-scrolling table.
                          <span className="relative inline-flex text-red-700">
                            <Icon name="shield" className="h-[15px] w-[15px]" />
                            <span className="sr-only">Security relevant</span>
                          </span>
                        ) : null}
                      </td>
                      <td className="whitespace-nowrap font-semibold tabular-nums">
                        {TIME(e.created_at)}
                      </td>
                      <td className="whitespace-nowrap">
                        {e.actor?.name ?? <span className="text-muted">System</span>}
                      </td>
                      <td>
                        <Pill tone={actionTone(e.action)}>{e.action}</Pill>
                      </td>
                      <td className="whitespace-nowrap text-muted">
                        {e.entity_type}{e.entity_id ? ' #' + e.entity_id : ''}
                      </td>
                      <td>
                        {fields.length === 0 ? (
                          <span className="text-muted">&mdash;</span>
                        ) : (
                          <ul className="space-y-0.5">
                            {fields.map((f) => (
                              <li key={f.key} className="text-[12.5px]">
                                <span className="font-semibold">{f.key}</span>
                                {f.from !== null && f.to !== null ? (
                                  <>
                                    {' '}
                                    <span className="font-mono text-muted line-through">
                                      {f.from}
                                    </span>
                                    {' → '}
                                    <span className="font-mono font-semibold">{f.to}</span>
                                  </>
                                ) : (
                                  <>
                                    {' '}
                                    <span className="font-mono text-muted">
                                      {f.to ?? f.from}
                                    </span>
                                  </>
                                )}
                              </li>
                            ))}
                          </ul>
                        )}
                      </td>
                      <td className="whitespace-nowrap font-mono text-[12px] text-muted">
                        {e.ip ?? '—'}
                      </td>
                    </tr>
                  );
                })}
              </DataTable>
            </div>
          </section>
        ))}

        {entries.length === 0 ? (
          <DataTable
            caption="Audit entries"
            head={<><th scope="col">Time</th><th scope="col">Who</th><th scope="col">Action</th></>}
          >
            <EmptyRow colSpan={3} icon="flag">
              Nothing has been recorded yet. Grade changes, role changes, fee edits and result
              publication all leave an entry here.
            </EmptyRow>
          </DataTable>
        ) : null}
      </div>
    </OnyxShell>
  );
}
