import type { Metadata } from 'next';
import { OnyxShell } from '@/components/onyx-shell';
import {
  Card, Empty, Hero, Icon, ListRow, Meter, Pill, Ring, RowList, Score, SectionHead,
  State, relativeDue,
} from '@/components/onyx-ui';
import { navFor } from '@/lib/onyx-nav';
import { requireOnyxSession, onyxApi, onyxApiSafe, type Me } from '@/lib/onyx-session';
import type { Interview } from '@/lib/onyx-career';

export const metadata: Metadata = { title: 'Mock interviews' };

/** The clock time, once the relative day has already been said. */
const AT = (iso: string) => new Date(iso).toLocaleTimeString(undefined,
  { hour: '2-digit', minute: '2-digit' });

/** How long ago it was. `relativeDue` reads the other direction and would call
 *  a finished interview "5 days late", which is the wrong sentence entirely. */
function ago(iso: string, now = Date.now()): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const days = Math.round((now - t) / 86_400_000);
  if (days <= 0) return 'Earlier today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return days + ' days ago';
  if (days < 14) return 'A week ago';
  if (days < 31) return Math.round(days / 7) + ' weeks ago';
  const months = Math.round(days / 30);
  return months <= 1 ? 'A month ago' : months + ' months ago';
}

/**
 * CAR-02 -- mock interviews.
 *
 * The list carries no feedback, released or not: the detail page is the one
 * place that is decided, and a second place would be a second place to get it
 * wrong. What the list does carry is whether feedback exists yet, because an
 * empty space where a score should be reads as a zero.
 *
 * Upcoming and past are separated because they are read for opposite reasons.
 * The next one is a countdown; the finished ones are a record.
 */
export default async function OnyxInterviewsPage() {
  const claims = await requireOnyxSession();
  const staff = ['admin', 'faculty', 'placement', 'employer'].includes(claims.tenant_role);
  const [me, mine, conducting] = await Promise.all([
    onyxApi<Me>('/api/onyx/me'),
    onyxApi<Interview[]>('/api/onyx/my/interviews'),
    staff ? onyxApiSafe<Interview[]>('/api/onyx/interviews/mine') : null,
  ]);

  const now = Date.now();
  const isFuture = (i: Interview) => Date.parse(i.scheduled_at) >= now;
  const byDate = (a: Interview, b: Interview) =>
    Date.parse(a.scheduled_at) - Date.parse(b.scheduled_at);

  const upcoming = mine.filter(isFuture).sort(byDate);
  const past = mine.filter((i) => !isFuture(i)).sort(byDate).reverse();
  const next = upcoming[0];

  // How you are scored: the average of what has actually been released, and
  // the same thing per criterion. Three interviewers saying the same thing is
  // a pattern; one is an opinion, so the count is shown beside it.
  const released = mine.filter((i) => i.feedback_released);
  const marks = released.map((i) => i.overall).filter((n): n is number => typeof n === 'number');
  const average = marks.length ? marks.reduce((a, b) => a + b, 0) / marks.length : null;

  const criteria = new Map<string, { total: number; of: number; n: number }>();
  for (const i of released) {
    for (const f of i.feedback ?? []) {
      const row = criteria.get(f.criterion) ?? { total: 0, of: 0, n: 0 };
      row.total += f.score; row.of += f.of || 5; row.n += 1;
      criteria.set(f.criterion, row);
    }
  }
  const criteriaRows = [...criteria.entries()]
    .map(([label, r]) => ({
      label, n: r.n,
      mean: r.total / r.n,
      outOf: r.of / r.n,
      percent: r.of ? (r.total / r.of) * 100 : 0,
    }))
    .sort((a, b) => b.percent - a.percent);

  const list = (title: string, items: Interview[], hint: string, label: string) => (
    <section>
      <SectionHead title={title} />
      <RowList label={label}>
        {items.map((i) => {
          const future = isFuture(i);
          const due = relativeDue(i.scheduled_at);
          return (
            <ListRow
              key={i.id}
              icon={!future && i.feedback_released ? 'award' : 'mic'}
              tone={i.feedback_released ? 'good' : future ? 'brand' : 'neutral'}
              title={i.title}
              href={'/onyx/interviews/' + i.id}
              chips={
                <>
                  {future ? <Pill tone={due.tone}>{due.text}</Pill> : null}
                  {i.feedback_released ? <Pill tone="good">Feedback ready</Pill> : null}
                  {!future && !i.feedback_released
                    ? <Pill tone="soon">Feedback not released</Pill> : null}
                  {i.has_recording ? <Pill tone="neutral">Recording kept</Pill> : null}
                </>
              }
              meta={
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span>{future ? due.text + ', ' + AT(i.scheduled_at) : ago(i.scheduled_at)}</span>
                  <span aria-hidden="true">·</span>
                  <span className="tabular-nums">{i.duration_minutes} min</span>
                  <span aria-hidden="true">·</span>
                  <span className="capitalize">{i.status}</span>
                </span>
              }
              trailing={!future ? (
                i.feedback_released && typeof i.overall === 'number'
                  ? <Score value={i.overall} outOf={5} />
                  : <Score value="—" band="none" />
              ) : null}
              action={{ href: '/onyx/interviews/' + i.id,
                label: i.feedback_released ? 'Read feedback' : 'Open' }}
            />
          );
        })}
        {items.length === 0 ? <li><Empty icon="mic">{hint}</Empty></li> : null}
      </RowList>
    </section>
  );

  return (
    <OnyxShell
      me={me}
      nav={navFor(me.role)}
      title="Mock interviews"
      subtitle="Practice, with structured feedback afterwards."
    >
      {/* The next one is the whole screen for anybody opening this page twenty
          minutes before a call. A countdown and a way in, in a band that
          cannot be scrolled past by accident. */}
      {next ? (
        <div className="mb-6">
          <Hero
            eyebrow="Next interview"
            title={next.title}
            sub={
              <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="font-semibold text-white">
                  {relativeDue(next.scheduled_at).text}, {AT(next.scheduled_at)}
                </span>
                <span aria-hidden="true">·</span>
                <span className="tabular-nums">{next.duration_minutes} minutes</span>
                <span aria-hidden="true">·</span>
                <span className="capitalize">{next.status}</span>
              </span>
            }
            actions={
              <>
                {next.join_url ? (
                  <a href={next.join_url}
                    className="inline-flex min-h-[40px] items-center gap-2 rounded-2xl bg-white
                               px-4 text-[13px] font-bold text-brand-700 hover:bg-brand-50">
                    <Icon name="video" className="h-4 w-4" />
                    Join the call
                  </a>
                ) : null}
                <a href={'/onyx/interviews/' + next.id}
                  className="inline-flex min-h-[40px] items-center gap-2 rounded-2xl border
                             border-white/35 px-4 text-[13px] font-bold text-white
                             hover:bg-white/10">
                  Details
                </a>
              </>
            }
          >
            {/* Said in words, not only by the position of a button: an
                on-campus round has no call to join, and a dead control with
                no explanation reads as a bug rather than a rule about rooms. */}
            <p className="text-sm text-white/85">
              {next.join_url
                ? 'Joining opens shortly before the start. Test your camera and microphone first.'
                : 'No call to join — this one is in person. The placement office holds the room.'}
            </p>
          </Hero>
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-7">
          {list('Upcoming', upcoming,
            'Nothing scheduled for you yet. Interviews an employer books through the '
            + 'placement office appear here, and so do the mocks you arrange yourself.',
            'Your upcoming interviews')}

          {list('Past', past,
            'Nothing finished yet. Once an interview is done its feedback lands here.',
            'Your past interviews')}

          {conducting
            ? list('You are interviewing', conducting, 'Nothing assigned to you.',
              'Interviews you are conducting')
            : null}
        </div>

        {/* ------------------------------------------------------------ rail */}
        <aside className="min-w-0 space-y-6">
          <section>
            <SectionHead title="How you are scored" />
            <Card className="p-4">
              {average !== null ? (
                <>
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-[10.5px] font-bold uppercase tracking-[.08em]
                                      text-muted">
                        Average across {marks.length} released
                      </div>
                      <div className="mt-1 text-[28px] font-extrabold leading-none tabular-nums">
                        {average.toFixed(1)}
                        <span className="ml-1 text-[15px] font-bold text-muted">/ 5</span>
                      </div>
                    </div>
                    <Ring percent={(average / 5) * 100} size={58}
                      label={'Average ' + average.toFixed(1) + ' out of 5'} />
                  </div>

                  {criteriaRows.length ? (
                    <ul className="mt-4 space-y-3 border-t border-line pt-4">
                      {criteriaRows.map((c) => (
                        <li key={c.label}>
                          <div className="flex items-baseline justify-between gap-2 text-[13px]">
                            <span className="min-w-0 truncate font-bold">{c.label}</span>
                            <span className="shrink-0 tabular-nums text-muted">
                              {c.mean.toFixed(1)} / {Math.round(c.outOf)}
                            </span>
                          </div>
                          <div className="mt-1.5">
                            <Meter percent={c.percent}
                              label={c.label + ', ' + c.mean.toFixed(1) + ' out of '
                                + Math.round(c.outOf)} />
                          </div>
                          <div className="mt-1 text-[11.5px] text-muted">
                            {c.n === 1 ? 'One interviewer' : c.n + ' interviewers'}
                          </div>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </>
              ) : (
                <Empty icon="chart">
                  No feedback has been released yet. Once it is, the average and the
                  breakdown behind it appear here.
                </Empty>
              )}
            </Card>
          </section>

          <section>
            <SectionHead title="Before you join" />
            <Card className="p-4">
              <ul className="space-y-2.5 text-[13.5px]">
                <li className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 text-muted">Recording</span>
                  <State tone="idle">Only with your consent</State>
                </li>
                <li className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 text-muted">Private notes</span>
                  <State tone="off">Never shown to you</State>
                </li>
                <li className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 text-muted">Feedback</span>
                  <State tone="on">Yours once released</State>
                </li>
              </ul>
              <p className="mt-4 border-t border-line pt-3 text-xs text-muted">
                Cannot make a slot? Tell the placement office more than a day ahead &mdash;
                a no-show is recorded against the drive, not against you.
              </p>
            </Card>
          </section>
        </aside>
      </div>
    </OnyxShell>
  );
}
