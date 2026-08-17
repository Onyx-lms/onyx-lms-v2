import type { Metadata } from 'next';
import { OnyxShell } from '@/components/onyx-shell';
import {
  Banner, Empty, Icon, ListRow, Pill, RowList, SectionHead, relativeDue,
} from '@/components/onyx-ui';
import { navFor } from '@/lib/onyx-nav';
import { requireOnyxSession, onyxApi, onyxApiSafe, type Me } from '@/lib/onyx-session';
import { APPLICATION_LABELS, type Application, type JobPost } from '@/lib/onyx-career';
import { CreatePanel } from '@/components/onyx-create';

export const metadata: Metadata = { title: 'Jobs' };

/** How long ago an application went in. A date is a subtraction; this is not. */
function ago(iso: string, now = Date.now()): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const days = Math.round((now - t) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return days + ' days ago';
  if (days < 14) return 'a week ago';
  if (days < 31) return Math.round(days / 7) + ' weeks ago';
  const months = Math.round(days / 30);
  return months <= 1 ? 'a month ago' : months + ' months ago';
}

/**
 * "Closes in 5 days", not "Closes in 5 days" spelled four different ways.
 *
 * `relativeDue` answers "when", and the answers it gives ("Due today",
 * "Tomorrow", "2 days late") do not all slot behind the word Closes. This
 * turns each of them into the sentence a deadline on a job post actually is.
 */
function closesLabel(text: string): string {
  if (text === 'Due today') return 'Closes today';
  if (text === 'Tomorrow') return 'Closes tomorrow';
  if (text.endsWith(' late')) return 'Closed ' + text.replace(/ late$/, ' ago');
  if (text.startsWith('in ')) return 'Closes ' + text;
  return 'Closes ' + text;
}

const STATUS_TONE: Record<string, 'neutral' | 'brand' | 'good' | 'late'> = {
  applied: 'neutral', shortlisted: 'brand', interviewing: 'brand',
  offered: 'good', hired: 'good', rejected: 'late', withdrawn: 'neutral',
};

/**
 * CAR-04b -- the job board.
 *
 * The list itself is scoped by the API: an employer gets their own posts, a
 * learner gets the open ones, placement gets everything. This page renders
 * whichever it was given.
 *
 * Not eligible is stated with a count and never with a greyed-out row. "1 of 4
 * rules not met" is something a learner can act on; a dimmed row is something
 * they assume is broken.
 */
export default async function OnyxJobsPage() {
  const claims = await requireOnyxSession();
  const [me, jobs] = await Promise.all([
    onyxApi<Me>('/api/onyx/me'),
    onyxApi<JobPost[]>('/api/onyx/jobs'),
  ]);
  // CAR-04: a post belongs to an employer, and there was no way to record one.
  // `GET /employers` lists every company at the institution, so it is the
  // placement office's read, not an employer contact's -- an employer calling
  // it got a 403 and, with it, an empty "Employer" dropdown that made this
  // form unusable for the one role it names in its own title. `/employers/mine`
  // is the one record they are actually allowed to know about: their own.
  const canPost = me.role === 'placement' || me.role === 'admin' || me.role === 'employer';
  // Adding an employer record is the placement office's job, not an
  // employer contact's: `POST /employers` is placement/admin-only, and an
  // employer clicking "Add an employer" got as far as the form and then a
  // 403 -- a button that could never once have worked for the role it was
  // shown to.
  const canManageEmployers = me.role === 'placement' || me.role === 'admin';
  const employers = me.role === 'employer'
    ? await onyxApiSafe<{ id: number; name: string }>('/api/onyx/employers/mine')
      .then((e) => (e ? [e] : null))
    : canPost
      ? await onyxApiSafe<{ id: number; name: string }[]>('/api/onyx/employers')
      : null;
  const mine = claims.tenant_role === 'student'
    ? await onyxApiSafe<Application[]>('/api/onyx/my/applications')
    : null;
  const applied = new Set((mine ?? []).map((a) => a.job_id));

  const open = jobs.filter((j) => j.status === 'open');
  // Eligibility only exists on a post when the API worked it out for this
  // person. Counted rather than assumed, so a board with no rules on it does
  // not claim everything is a match.
  const rated = jobs.filter((j) => j.eligibility);
  const eligible = rated.filter((j) => j.eligibility!.eligible).length;
  const live = (mine ?? []).filter(
    (a) => !['rejected', 'withdrawn'].includes(a.status)).length;

  return (
    <OnyxShell
      me={me}
      nav={navFor(me.role)}
      title="Jobs"
      subtitle={me.role === 'employer'
        ? 'Your posts at ' + me.tenant.name + '.'
        : 'Openings shared with this institution.'}
    >
      {/* CAR-04: "employers must post jobs". The placement office keeps the
          employer records, so both can open a post -- but only the office
          adds a company in the first place. */}
      {canPost ? (
        <div className={'mb-6 grid gap-3' + (canManageEmployers ? ' lg:grid-cols-2' : '')}>
          {canManageEmployers ? (
            <CreatePanel
              title="New employer" cta="Add an employer" icon="building" compact
              endpoint="employers"
              fields={[
                { name: 'name', label: 'Company', required: true, wide: true,
                  placeholder: 'Acme Corp' },
                { name: 'contact_name', label: 'Contact' },
                { name: 'contact_email', label: 'Contact email' },
                { name: 'website', label: 'Website', placeholder: 'https://acme.example' },
              ]}
            />
          ) : null}
          {/* A post is created as a draft, and a draft is invisible to the
              learners it is for. Opening it is the point of posting it, so it
              happens in the same action rather than as a second step nobody
              knew about. */}
          <CreatePanel
            title="New opening" cta="Post a job" icon="briefcase" compact
            endpoint="jobs" thenPost="jobs/:id/publish"
            fields={[
              { name: 'employer_id', label: 'Employer', type: 'select', required: true,
                numeric: true, wide: true,
                options: (employers ?? []).map((e) => ({ value: String(e.id), label: e.name })),
                help: me.role === 'employer' && !(employers ?? []).length
                  ? 'No employer record is linked to your account yet -- ask the placement '
                    + 'office to add one.' : undefined },
              { name: 'title', label: 'Role', required: true, wide: true,
                placeholder: 'Junior Developer' },
              { name: 'description', label: 'Description', type: 'textarea', rows: 3 },
              { name: 'location', label: 'Location', placeholder: 'Bengaluru' },
              { name: 'openings', label: 'Openings', type: 'number', min: 1, max: 1000,
                fallback: 1 },
              { name: 'closes_at', label: 'Closes', type: 'datetime' },
            ]}
          />
        </div>
      ) : null}

      {/* Eligibility is the number every rule on this page is checked against,
          so it is stated above the board rather than discovered one row at a
          time. Only shown when the API actually rated the posts. */}
      {rated.length ? (
        <div className="mb-5">
          <Banner tone={eligible ? 'info' : 'warn'} icon="target">
            <strong className="font-bold">
              {eligible} of {rated.length} {rated.length === 1 ? 'role matches' : 'roles match'}
              {' '}your record.
            </strong>
            <span className="mt-0.5 block">
              {eligible === rated.length
                ? 'You meet every rule on every post here.'
                : 'The ones that do not say which rule is missing, on the row and on the post.'}
            </span>
          </Banner>
        </div>
      ) : null}

      {/* A job post is something you read and apply to, so the row leads with
          the role and ends with the action. "Applied" is the state that
          changes what a learner does next, so it is a chip, not grey text. */}
      <section>
        <SectionHead title={'Open roles' + (open.length ? ' · ' + open.length : '')} />
        <RowList label="Open roles">
          {jobs.map((j) => {
            const has = applied.has(j.id);
            const rules = j.eligibility?.checks ?? [];
            const unmet = rules.filter((c) => !c.met);
            const ok = j.eligibility?.eligible ?? null;
            const closes = relativeDue(j.closes_at);
            return (
              <ListRow
                key={j.id}
                icon={has ? 'check' : ok === false ? 'alert' : 'briefcase'}
                tone={has ? 'good' : ok === false ? 'neutral' : 'brand'}
                title={j.title}
                href={'/onyx/jobs/' + j.id}
                chips={
                  <>
                    {has ? <Pill tone="good">Applied</Pill> : null}
                    {/* Met and not-met never ride on the colour alone: each
                        carries a glyph and the count that produced it. */}
                    {!has && ok === true ? (
                      <Pill tone="good">
                        <span className="inline-flex items-center gap-1">
                          <Icon name="check" className="h-3.5 w-3.5" />
                          Eligible
                        </span>
                      </Pill>
                    ) : null}
                    {!has && ok === false ? (
                      <Pill tone="soon">
                        <span className="inline-flex items-center gap-1">
                          <Icon name="x" className="h-3.5 w-3.5" />
                          {unmet.length} of {rules.length}{' '}
                          {rules.length === 1 ? 'rule' : 'rules'} not met
                        </span>
                      </Pill>
                    ) : null}
                    {j.status === 'open' && j.closes_at ? (
                      <Pill tone={closes.tone}>{closesLabel(closes.text)}</Pill>
                    ) : null}
                    {j.status !== 'open' ? (
                      <Pill tone="neutral">{j.status[0]!.toUpperCase() + j.status.slice(1)}</Pill>
                    ) : null}
                  </>
                }
                meta={
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span>{j.location ?? 'Location not stated'}</span>
                    {j.compensation ? (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="tabular-nums">{j.compensation}</span>
                      </>
                    ) : null}
                    <span aria-hidden="true">·</span>
                    <span className="tabular-nums">
                      {j.openings} {j.openings === 1 ? 'opening' : 'openings'}
                    </span>
                    {ok === false && unmet[0] ? (
                      <>
                        <span aria-hidden="true">·</span>
                        <span>needs {unmet[0].rule} {unmet[0].required}</span>
                      </>
                    ) : null}
                  </span>
                }
                action={{ href: '/onyx/jobs/' + j.id,
                  label: has ? 'View' : 'See the role' }}
              />
            );
          })}
          {jobs.length === 0 ? (
            <li>
              <Empty icon="briefcase">
                Nothing is open at the moment. Roles your institution shares appear here.
              </Empty>
            </li>
          ) : null}
        </RowList>
      </section>

      {/* The half of this screen a learner comes back for. The platform's own
          words are used for the outcome -- "Not taken forward" rather than
          "Rejected", because the second one is a verdict on a person. */}
      {mine?.length ? (
        <section className="mt-8">
          <SectionHead title={'Your applications' + (live ? ' · ' + live + ' live' : '')} />
          <RowList label="Your applications">
            {mine.map((a) => (
              <ListRow
                key={a.id}
                icon={a.status === 'offered' || a.status === 'hired' ? 'award'
                  : a.status === 'rejected' ? 'flag' : 'briefcase'}
                tone={a.status === 'offered' || a.status === 'hired' ? 'good'
                  : a.status === 'rejected' ? 'late' : 'brand'}
                title={a.job?.title ?? 'A role'}
                href={'/onyx/jobs/' + a.job_id}
                chips={
                  <Pill tone={STATUS_TONE[a.status] ?? 'neutral'}>
                    {APPLICATION_LABELS[a.status] ?? a.status}
                  </Pill>
                }
                meta={
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span>Applied {ago(a.created_at)}</span>
                    {a.readiness_at_apply !== null ? (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="tabular-nums">
                          readiness {a.readiness_at_apply} when you applied
                        </span>
                      </>
                    ) : null}
                  </span>
                }
                action={{ href: '/onyx/jobs/' + a.job_id, label: 'Open' }}
              />
            ))}
          </RowList>
        </section>
      ) : null}
    </OnyxShell>
  );
}
