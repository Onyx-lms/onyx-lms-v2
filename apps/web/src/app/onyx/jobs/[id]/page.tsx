import Link from 'next/link';
import type { Metadata } from 'next';
import { OnyxShell } from '@/components/onyx-shell';
import { OnyxApplicants, OnyxApply } from '@/components/onyx-career';
import {
  Card, Empty, Icon, Pill, SectionHead, StatTile, State, Stepper, relativeWhen,
} from '@/components/onyx-ui';
import { navFor } from '@/lib/onyx-nav';
import { requireOnyxSession, onyxApi, onyxApiSafe, type Me, onyxApiRecord } from '@/lib/onyx-session';
import {
  APPLICATION_LABELS, isPlacementStaff, type Application, type JobPost,
} from '@/lib/onyx-career';
import { ActionButton } from '@/components/onyx-create';

export const metadata: Metadata = { title: 'Job' };

/** What a learner's application has been through, and what is left of it. */
const PIPELINE = ['Applied', 'Shortlisted', 'Interviewed', 'Decision'] as const;
const STAGE: Record<string, number> = {
  applied: 0, shortlisted: 1, interviewing: 2,
  offered: 3, hired: 3, rejected: 3, withdrawn: 3,
};

/** The post's own lifecycle. A chip says where you are; this says what is next. */
const LIFECYCLE = ['Draft', 'Open', 'Closed'] as const;
const POST_STAGE: Record<string, number> = { draft: 0, open: 1, closed: 2 };

function steps(labels: readonly string[], at: number) {
  return labels.map((label, i) => ({
    label,
    state: (i < at ? 'done' : i === at ? 'current' : 'todo') as 'done' | 'current' | 'todo',
  }));
}

/** CAR-04b -- one post: the brief, and either applying or the pipeline. */
export default async function OnyxJobPage({ params }: { params: Promise<{ id: string }> }) {
  const claims = await requireOnyxSession();
  const { id } = await params;
  const [me, job] = await Promise.all([
    onyxApi<Me>('/api/onyx/me'),
    onyxApiRecord<JobPost>('/api/onyx/jobs/' + id),
  ]);

  const canSeePipeline = claims.tenant_role === 'employer'
    || isPlacementStaff(claims.tenant_role);
  const [applicants, mine] = await Promise.all([
    canSeePipeline
      ? onyxApiSafe<Application[]>('/api/onyx/jobs/' + id + '/applicants')
      : null,
    claims.tenant_role === 'student'
      ? onyxApiSafe<Application[]>('/api/onyx/my/applications')
      : null,
  ]);

  // The names and emails come with the applicants, not from the roster: an
  // employer must not be able to list the institution's people, only the
  // ones who applied.
  const names = Object.fromEntries((applicants ?? [])
    .map((a) => [a.user_id, a.candidate?.name ?? ('User ' + a.user_id)]));
  const emails = Object.fromEntries((applicants ?? [])
    .filter((a) => a.candidate?.email).map((a) => [a.user_id, a.candidate!.email]));
  const myApplication = (mine ?? []).find((a) => a.job_id === Number(id));
  const alreadyApplied = Boolean(myApplication);

  // A post that is not open is not counting down to anything: a filled or
  // closed one used to read "26 days late", in red, beside a status tile
  // already saying it takes no more applications.
  const closes = relativeWhen(job.closes_at, job.status !== 'open');
  const rules = job.eligibility?.checks ?? [];
  const met = rules.filter((c) => c.met).length;

  return (
    <OnyxShell
      me={me}
      nav={navFor(me.role)}
      title={job.title}
      subtitle={[job.location, job.compensation].filter(Boolean).join(' · ') || undefined}
    >
      <nav aria-label="Breadcrumb" className="mb-4">
        <Link href="/onyx/jobs"
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand-600
                     hover:underline">
          <Icon name="chevron" className="h-3.5 w-3.5 rotate-180" />
          All jobs
        </Link>
      </nav>

      {/* The four facts that decide whether the rest of the page is worth
          reading. The deadline is one of them, and it is the only part of this
          page that expires -- so it is relative, not a date to subtract. */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Band" value={job.compensation ?? 'Not stated'}
          note={job.location ?? 'Location not stated'} />
        <StatTile label="Openings" value={job.openings}
          note={canSeePipeline
            ? (applicants === null
              ? 'Applicants unavailable'
              : applicants.length + (applicants.length === 1 ? ' has applied' : ' have applied'))
            : 'On this post'} />
        <StatTile label="Status"
          value={job.status[0]!.toUpperCase() + job.status.slice(1)}
          note={job.status === 'draft' ? 'Not visible to learners'
            : job.status === 'open' ? 'Open to applications' : 'No new applications'} />
        <StatTile label="Closes" value={job.closes_at ? closes.text : 'No date'}
          note={job.closes_at
            ? new Date(job.closes_at).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'short', day: 'numeric', month: 'short' })
            : 'The office closes this one by hand'} />
      </div>

      {/* CAR-04b: a post that was left a draft, or one that has filled up. */}
      {canSeePipeline ? (
        <Card className="mt-3 p-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="min-w-0 flex-1">
              <Stepper steps={steps(LIFECYCLE, POST_STAGE[job.status] ?? 0)} />
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              {job.status === 'draft' ? (
                <ActionButton endpoint={'jobs/' + id + '/publish'} label="Open applications" />
              ) : null}
              {job.status === 'open' ? (
                <ActionButton endpoint={'jobs/' + id + '/close'} label="Close applications"
                  tone="quiet" confirm="Close this post? Nobody else can apply." />
              ) : null}
            </div>
          </div>
        </Card>
      ) : null}

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-7">
          {/* Where a learner's own application has got to. A status chip alone
              throws away what comes next, which is the thing they opened the
              page to find out. */}
          {myApplication ? (
            <section>
              <SectionHead title="Your application" />
              <Card className="p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <Stepper steps={steps(PIPELINE, STAGE[myApplication.status] ?? 0)} />
                  <Pill tone={myApplication.status === 'offered' || myApplication.status === 'hired'
                    ? 'good' : myApplication.status === 'rejected' ? 'late' : 'brand'}>
                    {APPLICATION_LABELS[myApplication.status] ?? myApplication.status}
                  </Pill>
                </div>
                {myApplication.readiness_at_apply !== null ? (
                  <p className="mt-3.5 border-t border-line pt-3 text-[13px] text-muted">
                    Your readiness was{' '}
                    <span className="font-bold tabular-nums text-ink">
                      {myApplication.readiness_at_apply}
                    </span>{' '}
                    when you applied. That is the figure this employer was given.
                  </p>
                ) : null}
              </Card>
            </section>
          ) : null}

          {job.description ? (
            <section>
              <SectionHead title="About the role" />
              <Card className="p-4 sm:p-5">
                <article className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700">
                  {job.description}
                </article>
              </Card>
            </section>
          ) : null}

          {canSeePipeline ? (
            <section>
              <SectionHead title="Applicants" />
              {/*
                * A REFUSAL IS NOT AN EMPTY TABLE.
                *
                * `onyxApiSafe` returns null when the read fails and [] when it
                * succeeds and there is nobody -- and this page used to collapse
                * both into `applicants ?? []`, so the table said "Nobody has
                * applied yet". A company signed in to its own post was told, as
                * a plain fact, that no one wanted the job. Meanwhile the
                * placement officer looking at the same post could see the
                * candidate. The company has no way to tell the difference
                * between a quiet week and a broken portal, so it reads the
                * first one and stops checking.
                *
                * The cause is almost always the same: the company record was
                * registered before its contact had a login, so `user_id` is
                * null and every ownership check refuses. Placement can fix that
                * in one click on their own screen -- which is why the message
                * says who to ask instead of apologising.
                */}
              {applicants === null ? (
                <Card>
                  <Empty icon="lock">
                    <b className="block text-slate-800">We could not open the applicant list.</b>
                    <span className="mt-1 block max-w-[52ch]">
                      {me.role === 'employer'
                        ? 'This usually means your company record has not been linked to '
                          + 'this sign-in yet. The placement office can connect the two, '
                          + 'and your applicants will appear here straight away.'
                        : 'This post may belong to another institution, or the record may '
                          + 'have been removed.'}
                    </span>
                  </Empty>
                </Card>
              ) : (
                <OnyxApplicants
                  jobId={Number(id)}
                  applicants={applicants.map((a) => ({
                    id: a.id, user_id: a.user_id, status: a.status,
                    created_at: a.created_at, readiness_at_apply: a.readiness_at_apply,
                  }))}
                  names={names}
                  emails={emails}
                />
              )}
            </section>
          ) : null}
        </div>

        {/* -------------------------------------------------------------- rail */}
        <aside className="min-w-0 space-y-6">
          {claims.tenant_role === 'student' ? (
            <section>
              <SectionHead title="Can you apply?" />
              <Card className="p-4">
                {/* A greyed-out button tells somebody nothing, so the count of
                    rules met leads and the rules themselves follow. Never the
                    colour on its own: a word, and a number beside it. */}
                {rules.length ? (
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2
                                  border-b border-line pb-3">
                    {job.eligibility?.eligible
                      ? <State tone="on">You meet every rule</State>
                      : <State tone="off">A rule is not met</State>}
                    <Pill tone={job.eligibility?.eligible ? 'good' : 'soon'}>
                      {met} of {rules.length}
                    </Pill>
                  </div>
                ) : null}
                <OnyxApply job={job} eligibility={job.eligibility} applied={alreadyApplied} />
                <p className="mt-3.5 border-t border-line pt-3 text-xs text-muted">
                  Applying shares your name, email address and readiness score with this
                  employer. Nothing else about you leaves the institution.
                </p>
              </Card>
            </section>
          ) : null}

          <section>
            <SectionHead title="The detail" />
            <Card className="p-4">
              <dl className="divide-y divide-line text-[13.5px]">
                {job.compensation ? (
                  <div className="flex items-center justify-between gap-3 py-2">
                    <dt className="text-muted">Band</dt>
                    <dd className="font-bold tabular-nums">{job.compensation}</dd>
                  </div>
                ) : null}
                <div className="flex items-center justify-between gap-3 py-2">
                  <dt className="text-muted">Location</dt>
                  <dd className="min-w-0 break-words text-right font-bold">{job.location ?? 'Not stated'}</dd>
                </div>
                <div className="flex items-center justify-between gap-3 py-2">
                  <dt className="text-muted">Openings</dt>
                  <dd className="font-bold tabular-nums">{job.openings}</dd>
                </div>
                {job.closes_at ? (
                  <div className="flex items-center justify-between gap-3 py-2">
                    <dt className="text-muted">Closes</dt>
                    <dd><Pill tone={closes.tone}>{closes.text}</Pill></dd>
                  </div>
                ) : null}
                {job.min_readiness !== null ? (
                  <div className="flex items-center justify-between gap-3 py-2">
                    <dt className="text-muted">Readiness</dt>
                    <dd className="font-bold tabular-nums">{job.min_readiness} or above</dd>
                  </div>
                ) : null}
                {job.min_attendance !== null ? (
                  <div className="flex items-center justify-between gap-3 py-2">
                    <dt className="text-muted">Attendance</dt>
                    <dd className="font-bold tabular-nums">{job.min_attendance}% or above</dd>
                  </div>
                ) : null}
                {(job.required_skills ?? []).length ? (
                  <div className="flex items-center justify-between gap-3 py-2">
                    <dt className="text-muted">Skills required</dt>
                    <dd className="font-bold tabular-nums">
                      {job.required_skills.length}
                    </dd>
                  </div>
                ) : null}
              </dl>
              {job.min_readiness === null && job.min_attendance === null
                && !(job.required_skills ?? []).length ? (
                  <p className="mt-3.5 border-t border-line pt-3 text-xs text-muted">
                    No eligibility rules. Open to everyone at this institution.
                  </p>
                ) : (
                  <p className="mt-3.5 border-t border-line pt-3 text-xs text-muted">
                    These are worked out from your record, not typed in by anyone.
                  </p>
                )}
            </Card>
          </section>
        </aside>
      </div>
    </OnyxShell>
  );
}
