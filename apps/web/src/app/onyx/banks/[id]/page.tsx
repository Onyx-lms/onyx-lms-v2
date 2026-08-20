import Link from 'next/link';
import type { Metadata } from 'next';
import { OnyxShell } from '@/components/onyx-shell';
import { navFor } from '@/lib/onyx-nav';
import { requireOnyxSession, onyxApi, onyxApiSafe, type Me } from '@/lib/onyx-session';
import { isExamsStaff } from '@/lib/onyx-assess';
import { AddQuestion, EditQuestionForm, RetireQuestionButton } from '@/components/onyx-manage';
import {
  BackLink, CardGrid, DataTable, EmptyRow, Icon, Pill, SectionHead, StatTile,
} from '@/components/onyx-ui';
import { redirect } from 'next/navigation';

export const metadata: Metadata = { title: 'Question bank' };

interface Question {
  id: number;
  type: 'single' | 'multiple' | 'truefalse' | 'short' | 'essay';
  prompt: string;
  options: { id: string; text: string }[] | null;
  /** Fetched but not rendered in the read-only row -- see the page's own
   *  comment. Only reaches the screen inside EditQuestionForm, and only for
   *  a viewer who can actually author this bank (see `canEdit` below). */
  answer: unknown;
  points: number;
  difficulty: string;
  version: number;
  status: string;
}

const TYPE_LABELS: Record<string, string> = {
  single: 'One answer',
  multiple: 'Several answers',
  truefalse: 'True/false',
  short: 'Short answer',
  essay: 'Essay',
};

/** An objective question is scored against a key; the rest are marked by hand. */
const OBJECTIVE = new Set(['single', 'multiple', 'truefalse']);

/**
 * ASS-01a -- one question bank.
 *
 * The answer key is deliberately not rendered. It arrives on this endpoint
 * because setting a paper needs it, but a bank is often open on a projector
 * in a staff room, and there is no reason for the page to put the key on
 * screen when nothing here edits it.
 */
export default async function OnyxBankPage({ params }: { params: Promise<{ id: string }> }) {
  await requireOnyxSession();
  const { id } = await params;
  const me = await onyxApi<Me>('/api/onyx/me');
  if (!isExamsStaff(me.role)) redirect('/onyx/denied');

  // Published problems only: a code question needs something that can actually
  // mark it, and the service refuses a draft problem anyway.
  const [banks, questions, problems] = await Promise.all([
    onyxApi<{ id: number; name: string; description: string | null; course_id: number | null }[]>(
      '/api/onyx/banks'),
    onyxApi<Question[]>('/api/onyx/banks/' + id + '/questions'),
      onyxApiSafe<{ id: number; title: string; difficulty: string }[]>(
      '/api/onyx/problems'),
  ]);
  const bank = banks.find((b) => String(b.id) === id);
  const marks = questions.reduce((sum, q) => sum + Number(q.points), 0);
  const objective = questions.filter((q) => OBJECTIVE.has(q.type)).length;
  const revised = questions.filter((q) => q.version > 1).length;

  // Same course-ownership rule the API enforces (AssessService#assertCanAuthor):
  // admin and exams author anything, a bank with no course is open to any of
  // this page's staff, and otherwise it takes actually teaching the course.
  // Gating on this here, not just relying on the API to 403, matters because
  // the edit form pre-fills the answer key -- a viewer who cannot save a
  // change to this bank should not see its key rendered either.
  const myCourses = me.role === 'faculty'
    ? await onyxApiSafe<{ id: number }[]>('/api/onyx/my/courses') : null;
  const teachesThisCourse = (myCourses ?? []).some((c) => Number(c.id) === Number(bank?.course_id));
  const canEdit = me.role === 'admin' || me.role === 'exams'
    || !bank?.course_id || teachesThisCourse;

  return (
    <OnyxShell
      me={me}
      nav={navFor(me.role)}
      title={bank?.name ?? 'Question bank'}
      subtitle={questions.length + ' question' + (questions.length === 1 ? '' : 's')
        + ', ' + marks + ' marks in total'}
    >
      <div className="mb-3"><BackLink href="/onyx/banks" label="All question banks" /></div>
      <nav aria-label="Breadcrumb" className="mb-3 flex flex-wrap items-center gap-1.5 text-sm text-muted">
        <Link href="/onyx/assessments" className="font-semibold text-brand-600 hover:underline">
          Assessments
        </Link>
        <Icon name="chevron" className="h-3.5 w-3.5 text-faint" />
        <span>Question banks</span>
        <Icon name="chevron" className="h-3.5 w-3.5 text-faint" />
        <span className="truncate">{bank?.name ?? 'Bank'}</span>
      </nav>

      {bank?.description ? (
        <p className="mb-4 max-w-[62ch] text-sm leading-relaxed text-muted">{bank.description}</p>
      ) : null}

      <CardGrid min="11rem">
        <StatTile label="Questions" value={questions.length}
          note={marks + ' marks available'} />
        <StatTile label="Objective" value={objective}
          note="scored against the key" />
        <StatTile label="Written" value={questions.length - objective}
          note="marked against a rubric" />
        <StatTile label="Revised" value={revised}
          note="earlier versions kept" />
      </CardGrid>

      {canEdit ? (
        <div className="mt-5">
          <AddQuestion problems={problems ?? []} bankId={Number(id)} />
        </div>
      ) : null}

      {/* A table, because building a paper is comparing type, difficulty and
          marks down three columns to avoid setting the cohort the same five
          questions it saw last term. Difficulty is deliberately not colour
          banded: red here would mean "hard", and elsewhere in the product red
          means "overdue" — a tone that means two things means neither. */}
      <section className="mt-6">
        <SectionHead title="Questions" />
        <DataTable
          caption={'Questions in the ' + (bank?.name ?? 'question') + ' bank'}
          head={<>
            <th scope="col" className="w-10">#</th>
            <th scope="col">Question</th>
            <th scope="col">Type</th>
            <th scope="col">Difficulty</th>
            <th scope="col" className="text-right">Marks</th>
            {canEdit ? <th scope="col" className="w-20"><span className="sr-only">Actions</span></th> : null}
          </>}
        >
          {questions.map((q, i) => (
            <tr key={q.id} className="align-top">
              <td className="tabular-nums text-muted">{i + 1}</td>
              <td className="min-w-[16rem]">
                <span className="font-semibold">{q.prompt}</span>
                <span className="mt-0.5 block text-[12.5px] text-muted">
                  {q.options?.length
                    ? q.options.length + (q.options.length === 1 ? ' option' : ' options') + ' · '
                    : ''}
                  v{q.version}
                  {q.version > 1
                    ? ' · earlier versions kept, so a paper already sat still marks against '
                      + 'the wording it was sat with'
                    : ''}
                </span>
                {canEdit ? (
                  <div className="mt-2"><EditQuestionForm questionId={q.id} question={q} /></div>
                ) : null}
              </td>
              <td><Pill>{TYPE_LABELS[q.type] ?? q.type}</Pill></td>
              <td>
                <div className="flex flex-wrap items-center gap-1.5">
                  <Pill><span className="capitalize">{q.difficulty}</span></Pill>
                  {q.status && q.status !== 'active' && q.status !== 'published' ? (
                    <Pill tone="neutral"><span className="capitalize">{q.status}</span></Pill>
                  ) : null}
                </div>
              </td>
              <td className="text-right tabular-nums font-bold">{q.points}</td>
              {canEdit ? (
                <td className="text-right"><RetireQuestionButton questionId={q.id} /></td>
              ) : null}
            </tr>
          ))}
          {questions.length === 0 ? (
            <EmptyRow colSpan={canEdit ? 6 : 5} icon="edit">
              Nothing here yet. A question added to this bank can be drawn into any paper.
            </EmptyRow>
          ) : null}
        </DataTable>
      </section>
    </OnyxShell>
  );
}
