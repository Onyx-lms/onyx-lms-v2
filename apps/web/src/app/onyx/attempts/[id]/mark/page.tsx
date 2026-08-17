import Link from 'next/link';
import type { Metadata } from 'next';
import { OnyxShell } from '@/components/onyx-shell';
import { OnyxMarker } from '@/components/onyx-marking';
import { navFor } from '@/lib/onyx-nav';
import { requireOnyxPageRole, onyxApi, type Me } from '@/lib/onyx-session';
import type { MarkerPaper } from '@/lib/onyx-assess';
import {
  Card, Icon, Meter, Score, SectionHead, State,
} from '@/components/onyx-ui';

export const metadata: Metadata = { title: 'Mark a paper' };

const ROLE_WORDS: Record<string, string> = {
  first: 'First marker',
  second: 'Second marker',
  moderation: 'Moderator',
};

/** ASS-03a -- one paper to mark. */
export default async function OnyxMarkPaperPage({ params }: { params: Promise<{ id: string }> }) {
  await requireOnyxPageRole('admin', 'faculty', 'exams');
  const { id } = await params;
  const [me, paper] = await Promise.all([
    onyxApi<Me>('/api/onyx/me'),
    onyxApi<MarkerPaper>('/api/onyx/attempts/' + id + '/paper'),
  ]);

  // Where you are in this script, counted off the questions themselves. A
  // marker who loses track re-reads an answer they already marked, and that is
  // the difference between the mark being fair and being roughly fair.
  //
  // Every question is markable now, objective included (see OnyxMarker), so
  // "done" counts objective questions as already scored -- a marker who never
  // opens one hasn't left it undone, the key already scored it -- plus any
  // question, objective or not, that carries a human override.
  const objective = paper.questions.filter((q) => q.objective);
  const written = paper.questions.filter((q) => !q.objective);
  const overridden = paper.questions.filter((q) => q.manual_points !== null).length;
  const done = objective.length + written.filter((q) => q.manual_points !== null).length;
  const percent = paper.questions.length ? (done / paper.questions.length) * 100 : 100;
  const autoMax = objective.reduce((n, q) => n + Number(q.points || 0), 0);
  const auto = objective.reduce((n, q) => n + Number(q.auto_points ?? 0), 0);
  const marked = new Set(paper.grades.map((g) => g.role));

  return (
    <OnyxShell
      me={me}
      nav={navFor(me.role)}
      title="Mark a paper"
      subtitle={paper.anonymous ? 'Anonymous' : 'Candidate ' + paper.user_id}
    >
      <nav aria-label="Breadcrumb" className="mb-3 flex items-center gap-1.5 text-sm text-muted">
        <Link href="/onyx/assessments" className="font-semibold text-brand-600 hover:underline">
          Assessments
        </Link>
        <Icon name="chevron" className="h-3.5 w-3.5 text-faint" />
        <span>Attempt {paper.id}</span>
      </nav>

      <Card className="p-4">
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
          <div className="min-w-0">
            <div className="text-[10.5px] font-bold uppercase tracking-[.08em] text-muted">
              Questions marked
            </div>
            <div className="mt-1 text-[26px] font-extrabold leading-none tabular-nums">
              {done}
              <span className="text-[17px] font-bold text-muted"> / {paper.questions.length}</span>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <span className="flex items-center gap-2 text-[13px] text-muted">
              Auto-graded baseline
              <Score value={auto} outOf={autoMax || undefined} />
            </span>
            {overridden > 0 ? (
              <span className="text-[13px] text-muted">
                {overridden} {overridden === 1 ? 'question' : 'questions'} overridden by hand
              </span>
            ) : null}
            <span className="flex items-center gap-2 text-[13px] text-muted">
              Running total
              <Score value={paper.score ?? auto + Number(paper.manual_score ?? 0)}
                outOf={paper.max_score} />
            </span>
          </div>
        </div>

        <div className="mt-3">
          <Meter percent={percent}
            label={'Marking progress on this script: ' + Math.round(percent) + ' percent'} />
        </div>

        <div className="mt-3.5 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line pt-3.5">
          <State tone={paper.anonymous ? 'on' : 'idle'}>
            {paper.anonymous ? 'Marked anonymously' : 'Candidate named'}
          </State>
          {/* The flag is a link, not an ornament: marking a flagged script
              without reading the timeline first is how a wrong call is made. */}
          {paper.integrity_flags > 0 ? (
            <Link href={'/onyx/attempts/' + id + '/integrity'}
              className="inline-flex min-h-[30px] items-center gap-1.5 whitespace-nowrap
                         rounded-full bg-red-50 px-2.5 text-[12.5px] font-bold text-red-700
                         hover:underline">
              <Icon name="shield" className="h-3.5 w-3.5" />
              {paper.integrity_flags} integrity{' '}
              {paper.integrity_flags === 1 ? 'point' : 'points'} · review
            </Link>
          ) : (
            <State tone="on">No integrity flags</State>
          )}
          <span className="text-[13px] text-muted">
            {marked.size
              ? 'Marked by: ' + [...marked].map((r) => ROLE_WORDS[r] ?? r).join(', ')
              : 'Nobody has recorded marks yet'}
          </span>
        </div>
      </Card>

      {/* Every question is editable here, objective included -- a marker who
          agrees with the auto-grade never has to touch it, but the option to
          override (a bad key, partial credit the key can't express) is
          always there. See OnyxMarker. */}
      <section className="mt-6">
        <SectionHead title="The script" />
        <OnyxMarker paper={paper} />
      </section>
    </OnyxShell>
  );
}
