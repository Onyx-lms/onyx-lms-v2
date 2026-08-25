import type { Metadata } from 'next';
import { OnyxShell } from '@/components/onyx-shell';
import { OnyxSla, OnyxTicketActions } from '@/components/onyx-engage';
import { navFor } from '@/lib/onyx-nav';
import { requireOnyxSession, onyxApi, type Me, onyxApiRecord } from '@/lib/onyx-session';
import type { TicketDetail } from '@/lib/onyx-campus';

export const metadata: Metadata = { title: 'Ticket' };

const MENTOR_ROLES = ['admin', 'faculty'];

/**
 * LRN-06b -- one ticket, with its trail.
 *
 * A learner sees that things happened and when; the notes between staff about
 * their problem are filtered out server-side, in the service, not here -- this
 * page shows whatever the API sent because trusting a second filter in the UI
 * is how a note leaks the day someone forgets to check the role twice.
 */
export default async function OnyxSupportTicketPage({ params }: { params: Promise<{ id: string }> }) {
  await requireOnyxSession();
  const { id } = await params;
  const [me, ticket] = await Promise.all([
    onyxApi<Me>('/api/onyx/me'),
    onyxApiRecord<TicketDetail>('/api/onyx/tickets/' + id),
  ]);
  const mentor = MENTOR_ROLES.includes(me.role);

  return (
    <OnyxShell
      me={me}
      nav={navFor(me.role)}
      title={ticket.subject}
      subtitle={ticket.priority + ' priority · raised by ' + (ticket.raised_by_name ?? 'someone')}
    >
      <div className="space-y-6">
        <div className="rounded-2xl border border-line p-4">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-sm font-medium">
              {ticket.owner_name ? 'Owned by ' + ticket.owner_name : 'Not yet owned'}
            </span>
            <OnyxSla ticket={ticket} />
          </div>
          <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">{ticket.body}</p>
        </div>

        <section>
          <h2 className="text-sm font-medium uppercase tracking-wide text-muted">History</h2>
          <ul className="mt-2 space-y-2">
            {ticket.events.map((e) => (
              <li key={e.id} className="rounded-lg border border-line p-3 text-sm">
                <div className="flex items-baseline justify-between text-xs text-muted">
                  <span>{e.kind}</span>
                  <span>{new Date(e.created_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}</span>
                </div>
                {e.note ? <p className="mt-1 whitespace-pre-wrap">{e.note}</p> : null}
              </li>
            ))}
          </ul>
        </section>

        {ticket.status !== 'closed' ? (
          <OnyxTicketActions ticket={ticket} canMentor={mentor} />
        ) : null}
      </div>
    </OnyxShell>
  );
}
