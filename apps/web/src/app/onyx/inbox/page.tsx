import Link from 'next/link';
import type { Metadata } from 'next';
import { OnyxShell } from '@/components/onyx-shell';
import { navFor } from '@/lib/onyx-nav';
import { requireOnyxSession, onyxApi, onyxApiSafe, type Me } from '@/lib/onyx-session';
import { MarkAllRead } from '@/components/onyx-inbox';
import {
  Banner, Empty, Icon, type IconName, Pill, SectionHead,
} from '@/components/onyx-ui';
import { dayNumber } from '@/lib/onyx-time';

export const metadata: Metadata = { title: 'Inbox' };

interface Notification {
  id: number; kind: string; title: string; body: string | null;
  link: string | null; read_at: string | null; created_at: string;
}

interface Mention {
  id: number; discussion_id: number; title: string | null;
  read_at: string | null; created_at: string; resolved: boolean;
}

/** One icon per kind, so an inbox of thirty is scannable rather than uniform. */
const ICON: Record<string, IconName> = {
  'membership.invited': 'users',
  'employer.invited': 'briefcase',
  'guardian.linked': 'users',
  'guardian.consent_changed': 'shield',
  'ticket.assigned': 'help',
  'ticket.answered': 'help',
  'ticket.overdue': 'flag',
  'assignment.returned': 'edit',
  'results.published': 'award',
  'certificate.issued': 'award',
  'invoice.issued': 'wallet',
  'discussion.mentioned': 'help',
};

/**
 * How long ago, in words.
 *
 * `relativeDue` is the forward-facing half of this and says "2 days late" for
 * anything in the past, which is the wrong sentence for something that has
 * already happened. An inbox is entirely history, so it gets its own reading
 * of the same idea: what a person scans for is how recent, not the timestamp.
 */
function ago(iso: string, now = Date.now()): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const mins = Math.max(0, Math.round((now - t) / 60_000));
  if (mins < 1) return 'Just now';
  if (mins < 60) return mins === 1 ? 'A minute ago' : mins + ' minutes ago';
  const hours = Math.round(mins / 60);
  if (hours < 24) return hours === 1 ? 'An hour ago' : hours + ' hours ago';
  const days = Math.round(hours / 24);
  if (days === 1) return 'Yesterday';
  if (days < 7) return days + ' days ago';
  const weeks = Math.round(days / 7);
  if (weeks === 1) return 'A week ago';
  if (days < 31) return weeks + ' weeks ago';
  const months = Math.round(days / 30);
  return months === 1 ? 'A month ago' : months + ' months ago';
}

/** Today, this week, earlier -- the three buckets an inbox is actually read in. */
function bucketOf(iso: string, now = Date.now()): 'Today' | 'This week' | 'Earlier' {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return 'Earlier';
  const startOf = (ms: number) => {
    // Institution midnight, not the runtime's -- see lib/onyx-time.ts.
    return dayNumber(ms) * 86_400_000;
  };
  const days = Math.round((startOf(now) - startOf(t)) / 86_400_000);
  if (days <= 0) return 'Today';
  if (days < 7) return 'This week';
  return 'Earlier';
}

const BUCKETS = ['Today', 'This week', 'Earlier'] as const;

/**
 * Everything this institution has told you.
 *
 * Onyx had no outbound channel at all until now, and it showed in four
 * requirements that describe somebody being told something: a new member being
 * invited, an employer being given access, a guardian link needing the
 * learner's consent, and an escalated question reaching a named owner. Each of
 * those happened in the database and nowhere else.
 *
 * Mentions are folded in rather than given their own page. `/api/onyx/mentions`
 * existed with no screen, and building it a second inbox would have meant a
 * person checking two places to find out whether anybody wanted them.
 *
 * Grouped by how recent rather than paged: an inbox is read from the top and
 * abandoned partway down, so the boundary between "this needs me today" and
 * "this is history" has to be a heading somebody can stop at.
 */
export default async function OnyxInboxPage() {
  await requireOnyxSession();

  const [me, inbox, mentions] = await Promise.all([
    onyxApi<Me>('/api/onyx/me'),
    onyxApi<{ items: Notification[]; unread: number }>('/api/onyx/notifications'),
    onyxApiSafe<Mention[]>('/api/onyx/mentions'),
  ]);

  const unreadMentions = (mentions ?? []).filter((m) => !m.read_at);
  const groups = BUCKETS
    .map((label) => ({ label, items: inbox.items.filter((n) => bucketOf(n.created_at) === label) }))
    .filter((g) => g.items.length > 0);

  return (
    <OnyxShell
      me={me}
      nav={navFor(me.role)}
      title="Inbox"
      subtitle={inbox.unread
        ? inbox.unread + (inbox.unread === 1 ? ' unread notification' : ' unread notifications')
        : 'Nothing unread.'}
      action={inbox.unread ? <MarkAllRead /> : undefined}
    >
      {unreadMentions.length ? (
        <section className="mb-7">
          <SectionHead title="You were mentioned" />
          <ul aria-label="Unread mentions"
            className="divide-y divide-line overflow-hidden rounded-2xl border border-line
                       bg-white shadow-card">
            {unreadMentions.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 bg-brand-50/30
                                        px-4 py-3.5 hover:bg-brand-50/50">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl
                                 bg-brand-50 text-brand-700">
                  <Icon name="help" className="h-[18px] w-[18px]" />
                </span>
                <span className="min-w-0 flex-1">
                  {/* A deleted thread still shows. "Somebody named you in
                      something that is gone" is true; dropping the row would
                      be a silent hole. */}
                  {m.title ? (
                    <Link href={'/onyx/discussions/' + m.discussion_id}
                      className="block truncate text-[15px] font-bold hover:underline">
                      {m.title}
                    </Link>
                  ) : (
                    <span className="block text-[15px] font-semibold text-muted">
                      A discussion that has since been removed
                    </span>
                  )}
                  <span className="mt-0.5 block text-[12.5px] text-muted">
                    {ago(m.created_at)}
                  </span>
                </span>
                {m.resolved ? <Pill tone="good">Resolved</Pill> : null}
                <span aria-hidden="true"
                  className="h-2.5 w-2.5 shrink-0 rounded-full bg-brand-600" />
                <span className="sr-only">Unread</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {groups.map((group) => (
        <section key={group.label} className="mb-7 last:mb-0">
          <SectionHead title={group.label} />
          <ul aria-label={group.label}
            className="divide-y divide-line overflow-hidden rounded-2xl border border-line
                       bg-white shadow-card">
            {group.items.map((n) => {
              const unread = !n.read_at;
              const row = (
                <>
                  <span className={'grid h-10 w-10 shrink-0 place-items-center rounded-xl '
                    + (unread ? 'bg-brand-50 text-brand-700' : 'bg-slate-100 text-muted')}>
                    <Icon name={ICON[n.kind] ?? 'bell'} className="h-[18px] w-[18px]" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={'block truncate text-[15px] '
                      + (unread ? 'font-bold' : 'font-semibold text-slate-700')}>
                      {n.title}
                    </span>
                    {n.body ? (
                      <span className="mt-0.5 block text-[13px] leading-relaxed text-muted">
                        {n.body}
                      </span>
                    ) : null}
                    <span className="mt-0.5 block text-[12px] text-muted">
                      {ago(n.created_at)}{unread ? '' : ' · read'}
                    </span>
                  </span>
                  {/* Unread is carried by weight AND a dot AND a word a screen
                      reader can hear. Weight alone is a difference nobody
                      notices in a list where most rows are unread. */}
                  {unread ? (
                    <>
                      <span aria-hidden="true"
                        className="h-2.5 w-2.5 shrink-0 rounded-full bg-brand-600" />
                      <span className="sr-only">Unread</span>
                    </>
                  ) : null}
                </>
              );

              return (
                <li key={n.id} className={unread ? 'bg-brand-50/30' : undefined}>
                  {n.link ? (
                    <Link href={n.link}
                      className="flex items-center gap-3 px-4 py-3.5 hover:bg-brand-50/50">
                      {row}
                    </Link>
                  ) : (
                    <div className="flex items-center gap-3 px-4 py-3.5">{row}</div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      {inbox.items.length === 0 ? (
        <div className="overflow-hidden rounded-2xl border border-line bg-white shadow-card">
          <Empty icon="bell">
            Nothing yet. Anything this institution needs to tell you — an invitation,
            a returned assignment, a result, a question assigned to you — lands here.
          </Empty>
        </div>
      ) : null}

      {/* Kept as a note rather than a settings page of its own: someone who
          wonders why they were told something wants the answer here, not two
          screens away. */}
      <div className="mt-7">
        <Banner tone="info" icon="bell">
          Results, fees, interviews and anything a mentor sends you always arrive here.
          Email is a copy of this, not the other way round.
        </Banner>
      </div>
    </OnyxShell>
  );
}
