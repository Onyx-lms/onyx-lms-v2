import Link from 'next/link';
import type { Metadata } from 'next';
import { OnyxShell } from '@/components/onyx-shell';
import { navFor } from '@/lib/onyx-nav';
import { requireOnyxSession, onyxApi, onyxApiSafe, type Me, onyxApiRecord } from '@/lib/onyx-session';
import { isExamsStaff } from '@/lib/onyx-assess';
import { AddQuestion, EditQuestionForm, RetireQuestionButton } from '@/components/onyx-manage';
import {
  CardGrid, DataTable, EmptyRow, Icon, Pill, SectionHead, StatTile,
} from '@/components/onyx-ui';
import { redirect } from 'next/navigation';

export const metadata: Metadata = { title: 'Question bank' };

interface Question {
  id: number;
  type: 'single' | 'multiple' | 'truefalse' | 'short' | 'essay' | 'code' | 'web';
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
  /** Which parallel set it belongs to. Absent means Set 1, which is where
   *  every question written before sets existed lives. */
  set_number?: number | null;
}

const TYPE_LABELS: Record<string, string> = {
  single: 'One answer',
  multiple: 'Several answers',
  truefalse: 'True/false',
  short: 'Short answer',
  essay: 'Essay',
  // 0021 added this type and nothing here was told: a coding question rendered
  // with the raw word "code" in the chip while every other type had a name.
  code: 'Write code',
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

  const [banks, questions, allProblems, setRows] = await Promise.all([
    onyxApi<{ id: number; name: string; description: string | null; course_id: number | null }[]>(
      '/api/onyx/banks'),
    onyxApiRecord<Question[]>('/api/onyx/banks/' + id + '/questions'),
    onyxApiSafe<{
      id: number; title: string; difficulty: string; status: string; kind?: string;
    }[]>('/api/onyx/problems'),
    /*
     * The parallel sets this bank holds.
     *
     * A set is not a row anywhere -- it exists because questions carry a
     * `set_number` -- so "how many sets are there" is a question only this
     * endpoint answers, and this page had never asked. Every question
     * therefore looked like it belonged to one undifferentiated pile, on a
     * bank that might be dealing ten rotating papers.
     */
    onyxApiSafe<{ set_number: number; count: number; marks: number }[]>(
      '/api/onyx/banks/' + id + '/sets'),
  ]);
  /*
   * Published only, and filtered HERE rather than relied on upstream.
   *
   * The comment on this fetch used to claim the endpoint returned published
   * problems only. It does not: `/api/onyx/problems` shows staff the whole
   * bank, drafts included, which is right for the Practice screen and wrong
   * for this picker -- it offered drafts, and binding a question to one is
   * refused by the service with a 422 nobody could have anticipated from the
   * menu. A draft is not an option here because its tests are not finished,
   * and its tests are what mark the question.
   */
  const problems = (allProblems ?? []).filter((p) => p.status === 'published');
  const bank = banks.find((b) => String(b.id) === id);
  const marks = questions.reduce((sum, q) => sum + Number(q.points), 0);
  const objective = questions.filter((q) => OBJECTIVE.has(q.type)).length;
  const revised = questions.filter((q) => q.version > 1).length;

  /*
   * What the sets are, and what the next one would be.
   *
   * `sets` is what exists; `nextSet` is what "add a set" means here. There is
   * no create-a-set call and there should not be: a set BECOMES real when a
   * question is written into it, so offering an empty Set 4 to sit in the bank
   * unfilled would be offering a thing the model cannot hold.
   */
  const sets = (setRows ?? []).map((sx) => ({
    number: Number(sx.set_number), count: Number(sx.count), marks: Number(sx.marks),
  }));
  const nextSet = sets.reduce((n, sx) => Math.max(n, sx.number), 0) + 1;
  const uneven = new Set(sets.map((sx) => sx.count)).size > 1;

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
      {/*
        * QA F7. There was a BackLink to `/onyx/banks` here, and no such page
        * exists -- clicking it produced a 404, and Next's prefetch fired the
        * failed request before anyone clicked, so the console errored on load.
        *
        * Removed rather than repointed: banks are reached from the assessments
        * page, and the breadcrumb immediately below already links there. A
        * BackLink pointing at the same destination would be two controls doing
        * one job.
        */}
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

      {/*
        * The sets, said plainly.
        *
        * A bank of ten sets and a bank of one look identical in a list of
        * questions, and they behave completely differently: ten sets rotate
        * down the register so neighbours never hold the same paper, one set is
        * one paper everybody sits. That distinction decides whether the bank
        * can be scheduled at all, and this page did not mention it.
        */}
      {sets.length ? (
        <section className="mt-5" aria-labelledby="bank-sets-h">
          <h2 id="bank-sets-h" className="text-[12.5px] font-bold uppercase
                                          tracking-[.07em] text-muted">
            Sets
          </h2>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {sets.map((sx) => (
              <span key={sx.number}
                className="inline-flex items-center gap-1.5 rounded-xl border border-line
                           bg-white px-2.5 py-1.5 text-[12.5px]">
                <span className="font-bold">Set {sx.number}</span>
                <span className="tabular-nums text-muted">
                  {sx.count} {sx.count === 1 ? 'question' : 'questions'} · {sx.marks} marks
                </span>
              </span>
            ))}
          </div>
          {uneven ? (
            <p className="mt-2 max-w-[62ch] rounded-xl bg-amber-50 px-3 py-2 text-[12.5px]
                          leading-relaxed text-amber-900">
              These sets are different sizes. Candidates are dealt one set each, so unequal
              sets mean unequal papers — even out the short ones before scheduling.
            </p>
          ) : null}
        </section>
      ) : null}

      {canEdit ? (
        <div className="mt-5">
          {/*
            * `sets` and `nextSet` are what turn "add a question" into "add a
            * question, or start a new set". There is no separate Add-a-set
            * button because there is nothing to add until a question is in it
            * -- so the choice lives where the question is written, and picking
            * "a new set" is what brings one into being.
            */}
          <AddQuestion problems={problems} bankId={Number(id)}
            sets={sets.map((sx) => sx.number)} nextSet={nextSet} />
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
            {sets.length > 1 ? <th scope="col">Set</th> : null}
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
              {sets.length > 1 ? (
                <td className="whitespace-nowrap tabular-nums">
                  <Pill tone="brand">Set {q.set_number ?? 1}</Pill>
                </td>
              ) : null}
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
            <EmptyRow colSpan={(canEdit ? 6 : 5) + (sets.length > 1 ? 1 : 0)} icon="edit">
              Nothing here yet. A question added to this bank can be drawn into any paper.
            </EmptyRow>
          ) : null}
        </DataTable>
      </section>
    </OnyxShell>
  );
}
