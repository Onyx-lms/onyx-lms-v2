import Link from 'next/link';
import type { Metadata } from 'next';
import { OnyxShell } from '@/components/onyx-shell';
import { OnyxStartAssessment } from '@/components/onyx-sit';
import { OnyxPublishResults } from '@/components/onyx-marking';
import { AssessmentEditForm } from '@/components/onyx-manage';
import { PaperBuilder } from '@/components/onyx-paper-builder';
import { navFor } from '@/lib/onyx-nav';
import { requireOnyxSession, onyxApi, onyxApiSafe, type Me } from '@/lib/onyx-session';
import { isExamsStaff, type Assessment, type MyAttempt } from '@/lib/onyx-assess';
import {
  ActionLink, BackLink, Card, CardGrid, Icon, SectionHead, StatTile, State, Stepper,
} from '@/components/onyx-ui';
import { ShareLink } from '@/components/onyx-share';

export const metadata: Metadata = { title: 'Assessment' };

/** A label/value line, at the one size the rail uses everywhere. */
function Fact({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-line py-2
                    last:border-0 last:pb-0 first:pt-0">
      <dt className="text-[13px] text-muted">{k}</dt>
      <dd className="min-w-0 text-right text-[13.5px] font-semibold">{v}</dd>
    </div>
  );
}

/** ASS-01b -- the front of a paper: what it is, and the button to start it. */
export default async function OnyxAssessmentPage({ params }: { params: Promise<{ id: string }> }) {
  const claims = await requireOnyxSession();
  const { id } = await params;
  const [me, assessment] = await Promise.all([
    onyxApi<Me>('/api/onyx/me'),
    onyxApi<Assessment>('/api/onyx/assessments/' + id),
  ]);
  const staff = isExamsStaff(claims.tenant_role);
  // Only staff, and only for a draft -- the composer needs somewhere to draw
  // from, and a candidate must never be handed the bank list.
  const editable = staff && assessment.status === 'draft';
  const [banks, courses] = await Promise.all([
    editable ? onyxApiSafe<{ id: number; name: string }[]>('/api/onyx/banks') : null,
    editable ? onyxApiSafe<{ id: number; title: string }[]>('/api/onyx/courses') : null,
  ]);
  const mine = staff ? null : await onyxApiSafe<MyAttempt[]>('/api/onyx/my/assessments');
  const attempts = (mine ?? []).filter((a) => a.assessment_id === Number(id));
  const live = attempts.find((a) => a.status === 'in_progress');
  const now = Date.now();
  const open = (!assessment.opens_at || Date.parse(assessment.opens_at) <= now)
    && (!assessment.closes_at || Date.parse(assessment.closes_at) >= now);

  const released = Boolean(assessment.results_published_at);
  const shut = released || assessment.status === 'closed'
    || (!!assessment.closes_at && Date.parse(assessment.closes_at) < now);

  // Draft > Published > Closed > Released is a sequence, and a status chip
  // alone throws away where in it you are and what comes next. Every rung is
  // read off `status` and `results_published_at` -- nothing is inferred.
  const rungs = [
    { label: 'Draft', reached: true },
    { label: 'Published', reached: assessment.status !== 'draft' },
    { label: 'Closed', reached: shut },
    { label: 'Released', reached: released },
  ];
  const steps = rungs.map((r, i) => ({
    label: r.label,
    state: (!r.reached ? 'todo' : rungs[i + 1]?.reached ? 'done' : 'current') as
      'done' | 'current' | 'todo',
  }));

  const stamp = (iso: string | null) => iso
    ? new Date(iso).toLocaleString(undefined,
      { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
    : null;
  const drawn = (assessment.sections ?? []).reduce((n, s) => n + Number(s.take || 0), 0);

  return (
    <OnyxShell
      me={me}
      nav={navFor(me.role)}
      title={assessment.title}
      subtitle={assessment.duration_minutes + ' minutes'
        + (assessment.pass_mark !== null ? ', pass mark ' + assessment.pass_mark : '')}
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <BackLink href="/onyx/assessments" label="All papers" />
        <ShareLink label="Copy link for students" />
      </div>
      <nav aria-label="Breadcrumb" className="mb-3 flex items-center gap-1.5 text-sm text-muted">
        <Link href="/onyx/assessments" className="font-semibold text-brand-600 hover:underline">
          Assessments
        </Link>
        <Icon name="chevron" className="h-3.5 w-3.5 text-faint" />
        <span className="truncate">{assessment.title}</span>
      </nav>

      <Stepper steps={steps} />

      <div className="mt-5 grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
        <div className="min-w-0 space-y-6">
          {/* Four facts about the paper itself. Candidate counts belong to the
              marking queue and the results report, and are not invented here. */}
          <CardGrid min="10.5rem">
            <StatTile label="Duration" value={assessment.duration_minutes} note="minutes, server timed" />
            <StatTile label="Attempts" value={assessment.attempts_allowed}
              note={assessment.attempts_allowed === 1 ? 'one sitting only' : 'per candidate'} />
            <StatTile label="Pass mark"
              value={assessment.pass_mark === null ? '—' : assessment.pass_mark}
              note={assessment.pass_mark === null ? 'no pass mark set' : 'marks to pass'} />
            {/* Staff only, and not because the count is secret -- because for
                a candidate there is no count yet. Questions are drawn at the
                moment an attempt starts, and `sections` is deliberately
                withheld from candidates because it names the banks a paper
                draws from. Rendering the absent field anyway turned "not
                decided yet, and not yours to see" into a confident "0
                sections", which read as a broken paper on the screen
                immediately before Start. The paper being genuinely empty is a
                real condition, and one the server already refuses at
                publish, at deal and at start. */}
            {staff ? (
              <StatTile label="Questions drawn" value={drawn || '—'}
                note={(assessment.sections?.length ?? 0) + ' section'
                  + ((assessment.sections?.length ?? 0) === 1 ? '' : 's')} />
            ) : null}
          </CardGrid>

          {assessment.instructions ? (
            <section>
              <SectionHead title="Instructions" />
              <Card className="p-4">
                <article className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700">
                  {assessment.instructions}
                </article>
              </Card>
            </section>
          ) : null}

          {/* Sections are kept as sections because that is how the paper was
              set: each names its bank and how many questions it draws, so two
              candidates did not sit the same twenty questions. */}
          {assessment.sections?.length ? (
            <section>
              <SectionHead title="The paper" />
              <ul className="space-y-2.5">
                {assessment.sections.map((s) => (
                  <li key={s.id}>
                    <Card className="flex flex-wrap items-center gap-x-4 gap-y-2 p-4">
                      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl
                                       bg-brand-50 text-brand-700">
                        <Icon name="layers" className="h-[18px] w-[18px]" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[15px] font-semibold">{s.title}</div>
                        <div className="mt-0.5 text-[13px] text-muted">
                          <span className="tabular-nums">{s.take}</span>{' '}
                          {s.take === 1 ? 'question' : 'questions'} drawn per candidate
                        </div>
                      </div>
                      {staff ? (
                        <Link href={'/onyx/banks/' + s.bank_id}
                          className="text-[13px] font-semibold text-brand-600 hover:underline">
                          Open the bank
                        </Link>
                      ) : null}
                    </Card>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {staff ? (
            <section>
              <SectionHead title="Run the paper" />
              <Card className="space-y-4 p-4">
                <div className="flex flex-wrap gap-2.5">
                  <ActionLink href={'/onyx/assessments/' + id + '/marking'} label="Marking queue" />
                  <ActionLink href={'/onyx/assessments/' + id + '/results'}
                    label="Results and item analysis" tone="quiet" />
                </div>
                {/* While it is a draft, the whole composition is editable --
                    sections, settings, the lot. Once published it is fixed
                    under any attempt already sitting it, so only the title,
                    window and pass mark remain, which is what the smaller
                    form covers. */}
                {assessment.status === 'draft' ? (
                  <div className="border-t border-line pt-4">
                    <PaperBuilder
                      label="Edit the whole paper"
                      banks={(banks ?? []).map((b) => ({
                        id: Number(b.id), name: b.name, course_id: null }))}
                      courses={(courses ?? []).map((c) => ({
                        id: Number(c.id), title: c.title }))}
                      existing={{
                        id: Number(id),
                        title: assessment.title,
                        course_id: assessment.course_id ?? null,
                        instructions: assessment.instructions ?? null,
                        opens_at: assessment.opens_at ?? null,
                        closes_at: assessment.closes_at ?? null,
                        duration_minutes: assessment.duration_minutes,
                        attempts_allowed: assessment.attempts_allowed,
                        pass_mark: assessment.pass_mark ?? null,
                        sections: assessment.sections ?? null,
                        shuffle_questions: assessment.shuffle_questions,
                        shuffle_options: assessment.shuffle_options,
                        proctoring: assessment.proctoring,
                        require_camera: assessment.require_camera,
                        require_screen: assessment.require_screen,
                        anonymous_marking: assessment.anonymous_marking,
                        moderation_required: assessment.moderation_required,
                      }}
                    />
                  </div>
                ) : null}
                <div className="border-t border-line pt-4">
                  <AssessmentEditForm assessmentId={Number(id)} assessment={assessment} />
                </div>
                <div className="border-t border-line pt-4">
                  <OnyxPublishResults
                    assessmentId={Number(id)}
                    published={Boolean(assessment.results_published_at)}
                    moderationRequired={Boolean(assessment.moderation_required)}
                  />
                </div>
              </Card>
            </section>
          ) : (
            <section>
              <SectionHead title="Your attempt" />
              <Card className="p-4">
                {live ? (
                  <ActionLink href={'/onyx/attempts/' + live.attempt_id}
                    label="Carry on with your attempt" />
                ) : attempts.length >= assessment.attempts_allowed ? (
                  <p className="text-sm text-muted">
                    You have used all your attempts.
                    {attempts.some((a) => a.results_published)
                      ? ' Your result is on the assessments page.'
                      : ' Results will appear once they are published.'}
                  </p>
                ) : !open ? (
                  <p className="text-sm text-muted">
                    {assessment.opens_at && Date.parse(assessment.opens_at) > now
                      ? 'This opens ' + new Date(assessment.opens_at).toLocaleString() + '.'
                      : 'This assessment has closed.'}
                  </p>
                ) : (
                  <OnyxStartAssessment assessment={assessment} />
                )}
              </Card>
            </section>
          )}
        </div>

        <aside className="min-w-0 space-y-6">
          <section>
            <SectionHead title="Settings" />
            <Card className="p-4">
              <dl>
                <Fact k="Opens" v={stamp(assessment.opens_at) ?? 'Any time'} />
                <Fact k="Closes" v={stamp(assessment.closes_at) ?? 'No close date'} />
                <Fact k="Duration"
                  v={<span className="tabular-nums">{assessment.duration_minutes} min</span>} />
                <Fact k="Attempts allowed"
                  v={<span className="tabular-nums">{assessment.attempts_allowed}</span>} />
                <Fact k="Pass mark" v={assessment.pass_mark === null
                  ? 'None set'
                  : <span className="tabular-nums">{assessment.pass_mark}</span>} />
              </dl>

              {/* Each rule as a dot AND a word. A row of green ticks would say
                  the same thing to most people and nothing to the rest. */}
              <ul className="mt-4 space-y-2 border-t border-line pt-4">
                <li className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <State tone={assessment.proctoring ? 'on' : 'idle'}>
                    {assessment.proctoring ? 'Monitored' : 'Not monitored'}
                  </State>
                  {assessment.proctoring ? (
                    <span className="text-[13px] text-muted">
                      {assessment.require_camera ? 'camera required' : 'no camera'}
                      {assessment.require_screen ? ', screen required' : ', screen not required'}
                    </span>
                  ) : null}
                </li>
                <li className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <State tone={assessment.anonymous_marking ? 'on' : 'idle'}>
                    {assessment.anonymous_marking ? 'Marked anonymously' : 'Names shown'}
                  </State>
                </li>
                <li className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <State tone={assessment.moderation_required ? 'on' : 'idle'}>
                    {assessment.moderation_required ? 'Moderated' : 'Not moderated'}
                  </State>
                  {assessment.moderation_required ? (
                    <span className="text-[13px] text-muted">before results are released</span>
                  ) : null}
                </li>
              </ul>
            </Card>
          </section>

          <section>
            <SectionHead title="Results" />
            <Card className="p-4">
              <p className="text-[13px] leading-relaxed text-muted">
                {released
                  ? 'Released. Every candidate can see their score, their rubric comments and '
                    + 'whether they passed.'
                  : 'Releasing closes marking for good and shows every candidate their score, '
                    + 'their rubric comments and whether they passed. It cannot be undone.'}
              </p>
              <p className="mt-3 flex items-center gap-2 text-[13px]">
                <Icon name={released ? 'eye' : 'lock'} className="h-4 w-4 shrink-0 text-muted" />
                <State tone={released ? 'on' : 'idle'}>
                  {released ? 'Visible to candidates' : 'Not visible to candidates'}
                </State>
              </p>
            </Card>
          </section>
        </aside>
      </div>
    </OnyxShell>
  );
}
