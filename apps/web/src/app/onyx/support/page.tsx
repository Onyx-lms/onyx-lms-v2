import type { Metadata } from 'next';
import { OnyxShell } from '@/components/onyx-shell';
import { OnyxSla } from '@/components/onyx-engage';
import { navFor } from '@/lib/onyx-nav';
import { requireOnyxSession, onyxApi, onyxApiSafe, type Me } from '@/lib/onyx-session';
import type { Ticket } from '@/lib/onyx-campus';
import {
  ActionLink, Banner, Card, Empty, ListRow, Pill, RowList, SectionHead, State, StatTile,
} from '@/components/onyx-ui';

export const metadata: Metadata = { title: 'Support' };

const MENTOR_ROLES = ['admin', 'faculty'];

/** What the API returns from /tickets/breaches. */
interface Breaches { breached: Ticket[]; unowned: number }

const STATUS_TONE = {
  open: 'neutral', assigned: 'brand', answered: 'brand',
  resolved: 'good', closed: 'neutral',
} as const;

const STATUS_LABEL = {
  open: 'Open', assigned: 'Assigned', answered: 'Answered',
  resolved: 'Resolved', closed: 'Closed',
} as const;

/**
 * The chips on a ticket row.
 *
 * Priority only earns a chip when it is above normal -- a column where every
 * row says "normal" is a column nobody reads. Overdue is red AND says the word,
 * because a red pill on its own is a colour and not a fact.
 */
function chipsFor(t: Ticket, mentor: boolean) {
  return (
    <>
      <Pill tone={STATUS_TONE[t.status]}>{STATUS_LABEL[t.status]}</Pill>
      {t.breached && !t.resolved_at ? <Pill tone="late">Overdue</Pill> : null}
      {t.priority === 'urgent' ? <Pill tone="late">Urgent</Pill>
        : t.priority === 'high' ? <Pill tone="soon">High</Pill> : null}
      {mentor && !t.owner_name && !t.resolved_at ? <Pill tone="soon">Unowned</Pill> : null}
    </>
  );
}

/** Who has it, said the same way every time. */
function ownerLine(t: Ticket, mentor: boolean) {
  return (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
      {/* The dot-and-word is fixed width by design, so the name it refers to
          sits outside it and is free to wrap on a narrow screen. */}
      {t.resolved_at
        ? <State tone="on">Answered</State>
        : t.owner_name
          ? <State tone="idle">Claimed</State>
          : <State tone="off">Unclaimed</State>}
      {!t.resolved_at && t.owner_name ? <span className="min-w-0">by {t.owner_name}</span> : null}
      {t.raised_by_name
        ? <span className="min-w-0">· {mentor ? 'from' : 'raised by'} {t.raised_by_name}</span>
        : null}
    </span>
  );
}

/**
 * LRN-06b -- the queue, and what has run out of time.
 *
 * A learner sees their own tickets; a mentor sees the queue, unowned first --
 * that ordering is the acceptance criterion, not a display choice, so it comes
 * straight from the service rather than being re-sorted here.
 *
 * The requirement's words are "a support ticket path with SLA visibility for
 * unresolved questions", and the breach list was the half with no screen: the
 * API could say which tickets had run past their deadline and nothing asked it,
 * so the one thing an SLA is for -- being seen to have been missed -- was
 * invisible. It goes above the queue, because a mentor who has to scroll to
 * find the overdue work is a mentor who finds it late.
 */
export default async function OnyxSupportPage() {
  await requireOnyxSession();
  const me = await onyxApi<Me>('/api/onyx/me');
  const mentor = MENTOR_ROLES.includes(me.role);

  const [tickets, breaches] = await Promise.all([
    onyxApi<Ticket[]>('/api/onyx/tickets'),
    // Staff only, and the API says so -- absent rather than fatal for a learner.
    mentor ? onyxApiSafe<Breaches>('/api/onyx/tickets/breaches') : null,
  ]);

  const overdue = breaches?.breached ?? [];
  const open = tickets.filter((t) => t.status !== 'resolved' && t.status !== 'closed');
  const settled = tickets.length - open.length;

  return (
    <OnyxShell
      me={me}
      nav={navFor(me.role)}
      title={mentor ? 'Mentor queue' : 'Your tickets'}
      subtitle={mentor
        ? 'Unowned first. Every ticket has a deadline, whether or not it has an owner yet.'
        : open.length
          ? open.length + (open.length === 1 ? ' question open' : ' questions open')
            + (settled ? ' · ' + settled + ' settled' : '')
          : 'Escalated questions and anything you have raised directly.'}
    >
      {mentor ? (
        <div className="mb-6 grid gap-3 sm:grid-cols-3">
          <StatTile label="Open" value={open.length} note="not yet resolved" />
          <StatTile label="Past their deadline" value={overdue.length}
            note={overdue.length ? 'needs an answer now' : 'nothing overdue'} />
          <StatTile label="Nobody owns" value={breaches?.unowned ?? 0}
            note="of the overdue ones" />
        </div>
      ) : null}

      {mentor && overdue.length ? (
        <section className="mb-7">
          <SectionHead title="Past their deadline" />
          <div className="mb-2.5">
            <Banner tone="late" icon="flag">
              <strong className="font-bold">
                {overdue.length === 1
                  ? 'One question has run past the time it was promised in.'
                  : overdue.length + ' questions have run past the time they were promised in.'}
              </strong>
              <span className="mt-0.5 block">
                An unowned one has nobody to chase, so claim it before answering it.
              </span>
            </Banner>
          </div>
          <RowList label="Tickets past their deadline">
            {overdue.map((t) => (
              <ListRow
                key={t.id}
                icon="flag"
                tone="late"
                title={t.subject}
                href={'/onyx/support/' + t.id}
                chips={chipsFor(t, true)}
                meta={ownerLine(t, true)}
                trailing={<OnyxSla ticket={t} />}
                action={{ href: '/onyx/support/' + t.id, label: 'Answer' }}
              />
            ))}
          </RowList>
        </section>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
        <section className="min-w-0">
          {mentor ? <SectionHead title="The queue" /> : <SectionHead title="Your questions" />}
          <RowList label={mentor ? 'The mentor queue' : 'Your tickets'}>
            {tickets.map((t) => (
              <ListRow
                key={t.id}
                icon={t.resolved_at ? 'check' : t.breached ? 'flag' : 'help'}
                tone={t.resolved_at ? 'good' : t.breached ? 'late' : t.owner_name ? 'brand' : 'neutral'}
                title={t.subject}
                href={'/onyx/support/' + t.id}
                chips={chipsFor(t, mentor)}
                meta={ownerLine(t, mentor)}
                trailing={<OnyxSla ticket={t} />}
                action={{ href: '/onyx/support/' + t.id,
                  label: mentor && !t.resolved_at ? 'Answer' : 'Open' }}
              />
            ))}
            {tickets.length === 0 ? (
              <li>
                <Empty icon="help">
                  {mentor
                    ? 'The queue is empty. Escalated questions and tickets raised directly land here.'
                    : 'You have no open tickets. Asking on a course and escalating creates one.'}
                </Empty>
              </li>
            ) : null}
          </RowList>
        </section>

        {/* ------------------------------------------------------------ rail */}
        <aside className="min-w-0 space-y-6">
          {mentor ? null : (
            <section>
              <SectionHead title="Before you raise one" />
              <Card className="p-4">
                <p className="text-sm leading-relaxed text-slate-700">
                  Most questions are about one specific piece of work. Asking on the course
                  discussion reaches the person who set it, and it is the faster of the two
                  routes &mdash; a ticket is a promise about time, not a queue jump.
                </p>
                <div className="mt-4 border-t border-line pt-3.5">
                  <ActionLink href="/onyx/courses" label="Ask on your course" />
                </div>
              </Card>
            </section>
          )}

          <section>
            <SectionHead title="How a ticket runs" />
            <Card className="p-4">
              <ul className="space-y-2.5 text-[13.5px]">
                <li className="flex items-center gap-2">
                  <State tone="off">Unowned</State>
                  <span className="min-w-0 flex-1 text-muted">
                    Raised, and nobody has claimed it yet.
                  </span>
                </li>
                <li className="flex items-center gap-2">
                  <State tone="idle">Claimed</State>
                  <span className="min-w-0 flex-1 text-muted">
                    A named person is answering it.
                  </span>
                </li>
                <li className="flex items-center gap-2">
                  <State tone="on">Answered</State>
                  <span className="min-w-0 flex-1 text-muted">
                    Closed, with the whole thread kept.
                  </span>
                </li>
              </ul>
              <p className="mt-4 border-t border-line pt-3 text-xs text-muted">
                Every ticket carries a deadline from the moment it is raised. The time
                left is shown on each row, and a missed one is said out loud rather
                than quietly dropped.
              </p>
            </Card>
          </section>
        </aside>
      </div>
    </OnyxShell>
  );
}
