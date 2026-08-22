import Link from 'next/link';
import type { Metadata } from 'next';
import { OnyxShell } from '@/components/onyx-shell';
import {
  Buckets, Card, DataTable, Empty, EmptyRow, ListRow, Pill, RowList, SectionHead,
  StackBar, StatTile, State, relativeWhen,
} from '@/components/onyx-ui';
import { navFor } from '@/lib/onyx-nav';
import { requireOnyxPageRole, onyxApi, onyxApiSafe, type Me } from '@/lib/onyx-session';
import type { Drive, Employer, JobPost } from '@/lib/onyx-career';
import { CreatePanel } from '@/components/onyx-create';
import { BuildDrive, LinkEmployerAccount } from '@/components/onyx-manage';

export const metadata: Metadata = { title: 'Placement' };

/**
 * CAR-04 -- the placement office's view.
 *
 * Employers, their posts and the drives, in one place. Deliberately not
 * reachable by an employer: the list of every employer at an institution is the
 * institution's, not one company's.
 *
 * Drives are a table and posts are a list, and that is not a stylistic choice.
 * The officer reads down the drives comparing dates and registration counts to
 * decide which one still needs chasing; they read the posts to pick one to
 * open. A table compares, a list chooses.
 */
export default async function OnyxPlacementPage() {
  await requireOnyxPageRole('admin', 'placement');
  const [me, employers, jobs, drives] = await Promise.all([
    onyxApi<Me>('/api/onyx/me'),
    onyxApi<Employer[]>('/api/onyx/employers'),
    onyxApi<JobPost[]>('/api/onyx/jobs'),
    onyxApi<Drive[]>('/api/onyx/drives'),
  ]);
  const byEmployer = new Map(employers.map((e) => [e.id, e]));

  // CAR-02: a skill on the passport is awarded by somebody, against a source.
  // Both lists come from the institution rather than being typed as ids.
  const [skills, members] = await Promise.all([
    onyxApiSafe<{ id: number; name: string }[]>('/api/onyx/skills'),
    onyxApiSafe<{ user_id: string; role: string; user: { name: string } | null }[]>(
      '/api/onyx/members'),
  ]);
  const learners = (members ?? []).filter((m) => m.role === 'student');
  // Accounts that hold the employer role but are not yet the `user_id` on
  // any employer record -- the only ones LinkEmployerAccount may offer,
  // otherwise linking one would silently steal it from another company.
  const linkedUserIds = new Set(employers.map((e) => e.user_id).filter((id) => id !== null));
  const unlinkedEmployerAccounts = (members ?? [])
    .filter((m) => m.role === 'employer' && !linkedUserIds.has(m.user_id))
    .map((m) => ({ user_id: m.user_id, name: m.user?.name ?? 'User ' + m.user_id }));

  const open = jobs.filter((j) => j.status === 'open');
  const draft = jobs.filter((j) => j.status === 'draft');
  const closed = jobs.filter((j) => j.status === 'closed');
  const now = Date.now();
  const upcoming = drives.filter(
    (d) => d.scheduled_at && Date.parse(d.scheduled_at) >= now);
  const unscheduled = drives.filter((d) => !d.scheduled_at);
  const noLogin = employers.filter((e) => !e.user_id);
  const pct = (n: number) => (jobs.length ? Math.round((n / jobs.length) * 100) : 0);

  // Soonest first, and anything without a date at the end -- an unscheduled
  // drive is not urgent, it is unfinished, and it has its own queue below.
  const sorted = [...drives].sort((a, b) => {
    const at = a.scheduled_at ? Date.parse(a.scheduled_at) : Infinity;
    const bt = b.scheduled_at ? Date.parse(b.scheduled_at) : Infinity;
    return at - bt;
  });

  return (
    <OnyxShell
      me={me}
      nav={navFor(me.role)}
      title="Placement"
      subtitle="Employers, posts and drives at this institution."
    >
      {/* The office's three openers. `items-start` rather than the shared
          Toolbar's centring, because each of these expands into a form and a
          centred row would jump when one of them does. */}
      <div className="flex flex-wrap items-start gap-3">
        <BuildDrive employers={employers.map((e) => ({ id: e.id, name: e.name }))}
          jobs={jobs.map((j) => ({ id: j.id, title: j.title }))} />
        <CreatePanel
          title="New skill" cta="Add a skill" icon="award" compact
          endpoint="skills"
          fields={[
            { name: 'name', label: 'Skill', required: true, wide: true,
              placeholder: 'SQL' },
            { name: 'category', label: 'Category', placeholder: 'Data' },
          ]}
        />
        <CreatePanel
          title="Award a skill" cta="Award a skill" icon="award" compact
          endpoint="skills/award"
          fields={[
            { name: 'user_id', label: 'Learner', type: 'select', required: true,
              // A uuid, so NOT numeric: CreatePanel runs Number() over a
              // numeric field and a uuid becomes NaN, which JSON sends as null and
              // the route refuses. Left over from when user ids were bigints.
              wide: true,
              options: learners.map((m) => ({ value: String(m.user_id),
                label: m.user?.name ?? 'User ' + m.user_id })) },
            { name: 'skill_id', label: 'Skill', type: 'select', required: true,
              numeric: true, wide: true,
              options: (skills ?? []).map((s) => ({ value: String(s.id), label: s.name })) },
            { name: 'source_type', label: 'Earned through', type: 'select',
              fallback: 'course',
              options: ['course', 'assessment', 'problem', 'workspace', 'certificate', 'contest']
                .map((t) => ({ value: t, label: t })) },
            { name: 'strength', label: 'Strength', type: 'number', min: 0, max: 100,
              fallback: 60,
              help: 'What the passport shows, and what a job post checks against.' },
          ]}
        />
      </div>

      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Employers" value={employers.length}
          note={noLogin.length
            ? noLogin.length + ' with no login yet'
            : 'all have a login'} />
        <StatTile label="Open posts" value={open.length}
          note={draft.length ? draft.length + ' still in draft' : 'nothing in draft'} />
        <StatTile label="Drives" value={drives.length}
          note={upcoming.length + ' still to run'} />
        <StatTile label="Learners" value={learners.length}
          note="on the register at this institution" />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-7">
          {/* A total then its parts, rather than three tiles that never add up
              to anything: every post this office has ever opened is one of
              these three, and the bar and the rows share an order. */}
          <section>
            <SectionHead title="Where the posts are" />
            <Card className="p-4">
              <div className="flex flex-wrap items-end justify-between gap-4">
                <div>
                  <div className="text-[10.5px] font-bold uppercase tracking-[.08em] text-muted">
                    Posts on the board
                  </div>
                  <div className="mt-1 text-[30px] font-extrabold leading-none tabular-nums">
                    {jobs.length}
                  </div>
                </div>
                <div className="ml-auto w-full min-w-0 max-w-[340px]">
                  <StackBar parts={[
                    { value: open.length, className: 'bg-green-600' },
                    { value: draft.length, className: 'bg-accent-500' },
                    { value: closed.length, className: 'bg-brand-300' },
                  ]} />
                </div>
              </div>
              <Buckets rows={[
                { label: 'Open to applications', dotClass: 'bg-green-600',
                  count: open.length, amount: pct(open.length) + '%' },
                { label: 'Draft — invisible to learners', dotClass: 'bg-accent-500',
                  count: draft.length, amount: pct(draft.length) + '%' },
                { label: 'Closed', dotClass: 'bg-brand-300',
                  count: closed.length, amount: pct(closed.length) + '%' },
              ]} />
              {jobs.length === 0 ? (
                <p className="mt-3 text-sm text-muted">
                  No posts yet. An employer&rsquo;s first opening starts the board.
                </p>
              ) : null}
            </Card>
          </section>

          {/* The date is relative because "in 3 days" is what is being decided
              on, and a calendar date is a subtraction. */}
          <section>
            <SectionHead title="Company drives" />
            <DataTable
              caption="Recruitment drives, soonest first"
              head={
                <>
                  <th scope="col">Drive</th>
                  <th scope="col">When</th>
                  <th scope="col">Stage</th>
                  <th scope="col"><span className="sr-only">Open</span></th>
                </>
              }
            >
              {sorted.map((d) => {
                // "complete"/"cancelled" are over; the countdown is only
                // meaningful for one still planned or running.
                const settled = d.status === 'complete' || d.status === 'cancelled';
                const when = relativeWhen(d.scheduled_at, settled);
                const future = d.scheduled_at ? Date.parse(d.scheduled_at) >= now : false;
                return (
                  <tr key={d.id}>
                    <td>
                      <Link href={'/onyx/drives/' + d.id}
                        className="font-semibold hover:underline">{d.title}</Link>
                      <span className="mt-0.5 block text-xs text-muted">
                        {byEmployer.get(d.employer_id)?.name ?? 'Employer not named'}
                      </span>
                    </td>
                    <td>
                      {d.scheduled_at
                        ? <Pill tone={when.tone}>{when.text}</Pill>
                        : <Pill tone="neutral">Unscheduled</Pill>}
                      {d.venue ? (
                        <span className="mt-1 block text-xs text-muted">{d.venue}</span>
                      ) : null}
                    </td>
                    <td>
                      {!d.scheduled_at
                        ? <State tone="idle">Not yet in the diary</State>
                        : future
                          ? <State tone="on">{d.status}</State>
                          : <State tone="idle">{d.status}</State>}
                    </td>
                    <td className="text-right">
                      <Link href={'/onyx/drives/' + d.id}
                        className="inline-flex min-h-[32px] items-center rounded-xl border
                                   border-line px-3 text-[13px] font-bold text-slate-700
                                   hover:bg-brand-50">
                        Open
                      </Link>
                    </td>
                  </tr>
                );
              })}
              {drives.length === 0 ? (
                <EmptyRow colSpan={4} icon="calendar">
                  No drives yet. A drive is a date in the diary against an employer&rsquo;s
                  post; building one is the button at the top of this page.
                </EmptyRow>
              ) : null}
            </DataTable>
          </section>

          {/* Posts sit below drives because a post is a standing advert and a
              drive is a date in the diary; only one of them can be missed. */}
          <section>
            <SectionHead title="Posts" action={{ href: '/onyx/jobs', label: 'All posts' }} />
            <RowList label="Posts on the board">
              {jobs.map((j) => {
                const closes = relativeWhen(j.closes_at, j.status !== 'open');
                return (
                  <ListRow
                    key={j.id}
                    icon="briefcase"
                    tone={j.status === 'open' ? 'brand' : 'neutral'}
                    title={j.title}
                    href={'/onyx/jobs/' + j.id}
                    chips={
                      <>
                        {j.status === 'draft' ? <Pill tone="soon">Draft</Pill> : null}
                        {j.status === 'closed' ? <Pill tone="neutral">Closed</Pill> : null}
                        {j.status === 'open' && j.closes_at
                          ? <Pill tone={closes.tone}>{closes.text}</Pill> : null}
                      </>
                    }
                    meta={
                      <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span>{byEmployer.get(j.employer_id)?.name ?? 'Employer not named'}</span>
                        <span aria-hidden="true">·</span>
                        <span>{j.location ?? 'Location not stated'}</span>
                        <span aria-hidden="true">·</span>
                        <span className="tabular-nums">
                          {j.openings} {j.openings === 1 ? 'opening' : 'openings'}
                        </span>
                        {j.status === 'draft' ? (
                          <>
                            <span aria-hidden="true">·</span>
                            <span>not visible to learners</span>
                          </>
                        ) : null}
                      </span>
                    }
                    action={{ href: '/onyx/jobs/' + j.id, label: 'Open' }}
                  />
                );
              })}
              {jobs.length === 0 ? (
                <li>
                  <Empty icon="briefcase">
                    No posts yet. Opening one is on the Jobs page.
                  </Empty>
                </li>
              ) : null}
            </RowList>
          </section>
        </div>

        {/* -------------------------------------------------------------- rail */}
        <aside className="min-w-0 space-y-7">
          {/* An employer with no login cannot see their own shortlist, which
              means the office is emailing spreadsheets. Worth a queue. */}
          <section>
            <SectionHead title="Needs the office" />
            <Card>
              <ul className="divide-y divide-line">
                {noLogin.length ? (
                  <li className="px-4 py-3">
                    <div className="text-sm font-bold">
                      {noLogin.length} {noLogin.length === 1 ? 'employer has' : 'employers have'}
                      {' '}no login
                    </div>
                    <p className="mt-0.5 text-[13px] text-muted">
                      Their shortlists have to be sent by hand.
                    </p>
                  </li>
                ) : null}
                {unscheduled.length ? (
                  <li className="px-4 py-3">
                    <div className="text-sm font-bold">
                      {unscheduled.length}{' '}
                      {unscheduled.length === 1 ? 'drive has' : 'drives have'} no date
                    </div>
                    <p className="mt-0.5 text-[13px] text-muted">
                      Nobody can register for a day that has not been set.
                    </p>
                  </li>
                ) : null}
                {draft.length ? (
                  <li className="px-4 py-3">
                    <div className="text-sm font-bold">
                      {draft.length} {draft.length === 1 ? 'post is' : 'posts are'} still a draft
                    </div>
                    <p className="mt-0.5 text-[13px] text-muted">
                      A draft is invisible to the learners it was written for.
                    </p>
                  </li>
                ) : null}
                {!noLogin.length && !unscheduled.length && !draft.length ? (
                  <li>
                    <Empty icon="check">Nothing is waiting on this office.</Empty>
                  </li>
                ) : null}
              </ul>
            </Card>
          </section>

          <section>
            <SectionHead title="Employers" />
            <DataTable
              caption="Employers registered with this institution"
              head={
                <>
                  <th scope="col">Company</th>
                  <th scope="col">Portal access</th>
                </>
              }
            >
              {employers.map((e) => (
                <tr key={e.id}>
                  <td>
                    <span className="block font-semibold">{e.name}</span>
                    {e.contact_name || e.contact_email ? (
                      <span className="mt-0.5 block text-xs text-muted">
                        {e.contact_name ?? ''}
                        {e.contact_name && e.contact_email ? ' · ' : ''}
                        {e.contact_email ?? ''}
                      </span>
                    ) : null}
                  </td>
                  <td>
                    {e.user_id ? (
                      <State tone="on">Has a login</State>
                    ) : (
                      <div className="flex flex-wrap items-center gap-2">
                        <State tone="off">No login yet</State>
                        <LinkEmployerAccount employerId={e.id} candidates={unlinkedEmployerAccounts} />
                      </div>
                    )}
                  </td>
                </tr>
              ))}
              {employers.length === 0 ? (
                <EmptyRow colSpan={2} icon="building">
                  No employers yet. Adding one is on the Jobs page.
                </EmptyRow>
              ) : null}
            </DataTable>
          </section>
        </aside>
      </div>
    </OnyxShell>
  );
}
