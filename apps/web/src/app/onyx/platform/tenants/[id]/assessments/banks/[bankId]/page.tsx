import type { Metadata } from 'next';
import Link from 'next/link';
import { requirePlatformSession } from '@/lib/onyx-platform-session';
import { attempt, SCROLLER, Unavailable } from '@/lib/onyx-platform-tenant';
import { Card, DataTable, EmptyRow, Icon, Pill, SectionHead, StatTile, CardGrid } from '@/components/onyx-ui';

export const metadata: Metadata = { title: 'Question bank' };

/**
 * One question bank, from the console.
 *
 * **The dead link this page ends.** Both console listings -- Examinations ›
 * Papers and Assessments › Banks -- rendered every bank row as a link to a
 * route that did not exist, so all nineteen returned Page not found. Because
 * Next prefetches links in the viewport, simply OPENING either list fired a
 * burst of 404s before anybody clicked one. An operator could build a bank and
 * never open it again.
 *
 * Read-only, deliberately. The console can already CREATE a bank with its
 * questions and its parallel sets, and an operator inspecting somebody else's
 * question bank is answering "is this ready to be sat" -- how many sets, are
 * they the same size, is anything waiting on a marker -- rather than rewriting
 * a lecturer's questions from two levels away. The institution's own screen at
 * /onyx/banks/[id] is where a bank is edited, by the people whose bank it is.
 */
interface Question {
  id: number;
  type: string;
  prompt: string;
  points: number;
  difficulty: string;
  version: number;
  status: string;
  set_number?: number | null;
}

interface SetRow { set_number: number; count: number; marks: number }
interface Bank { id: number; name: string; description: string | null; course_id: number | null }

/** The label a person reads, rather than the value the database stores. */
const TYPE_LABELS: Record<string, string> = {
  single: 'One answer',
  multiple: 'Several answers',
  truefalse: 'True/false',
  short: 'Short answer',
  essay: 'Essay',
  code: 'Write code',
  web: 'Build a page',
};

export default async function OnyxPlatformBankPage(
  { params }: { params: Promise<{ id: string; bankId: string }> },
) {
  await requirePlatformSession();
  const { id, bankId } = await params;
  const base = '/api/onyx/platform/tenants/' + encodeURIComponent(id);

  const [banks, questions, setRows] = await Promise.all([
    attempt<Bank[]>(base + '/banks'),
    attempt<Question[]>(base + '/banks/' + encodeURIComponent(bankId) + '/questions'),
    attempt<SetRow[]>(base + '/banks/' + encodeURIComponent(bankId) + '/sets'),
  ]);

  if (questions === null) return <Unavailable what="question bank" />;

  const bank = (banks ?? []).find((b) => String(b.id) === String(bankId)) ?? null;
  const sets = (setRows ?? []).map((s) => ({
    number: Number(s.set_number), count: Number(s.count), marks: Number(s.marks),
  }));
  const marks = questions.reduce((n, q) => n + Number(q.points ?? 0), 0);
  const uneven = new Set(sets.map((s) => s.count)).size > 1;

  return (
    <div className="min-w-0 space-y-5">
      <nav aria-label="Breadcrumb"
        className="flex flex-wrap items-center gap-1.5 text-[13px] text-muted">
        <Link href={'/onyx/platform/tenants/' + id + '/assessments/banks'}
          className="font-semibold text-brand-600 hover:underline">
          All question banks
        </Link>
        <Icon name="chevron" className="h-3.5 w-3.5 text-faint" />
        <span className="truncate">{bank?.name ?? 'Bank ' + bankId}</span>
      </nav>

      <div>
        <h1 className="text-[19px] font-extrabold tracking-tight">
          {bank?.name ?? 'Question bank'}
        </h1>
        {bank?.description ? (
          <p className="mt-1 max-w-[62ch] text-[13px] leading-relaxed text-muted">
            {bank.description}
          </p>
        ) : null}
      </div>

      <CardGrid min="11rem">
        <StatTile label="Questions" value={questions.length}
          note={marks + ' marks in the bank'} />
        <StatTile label="Sets" value={sets.length || 1}
          note={sets.length > 1 ? 'parallel papers' : 'one paper for everybody'} />
        <StatTile label="Retired" value={questions.filter((q) => q.status === 'retired').length}
          note="kept, not drawn" />
        <StatTile label="Revised" value={questions.filter((q) => Number(q.version) > 1).length}
          note="earlier versions kept" />
      </CardGrid>

      {/* The fact that decides whether this bank can be scheduled at all. Ten
          sets rotate down the register so neighbours never hold the same
          paper; one set is one paper everybody sits. */}
      {sets.length ? (
        <section aria-labelledby="sets-h">
          <h2 id="sets-h"
            className="text-[12.5px] font-bold uppercase tracking-[.07em] text-muted">
            Sets
          </h2>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {sets.map((s) => (
              <span key={s.number}
                className="inline-flex items-center gap-1.5 rounded-xl border border-line
                           bg-white px-2.5 py-1.5 text-[12.5px]">
                <span className="font-bold">Set {s.number}</span>
                <span className="tabular-nums text-muted">
                  {s.count} {s.count === 1 ? 'question' : 'questions'} · {s.marks} marks
                </span>
              </span>
            ))}
          </div>
          {uneven ? (
            <p className="mt-2 max-w-[62ch] rounded-xl bg-amber-50 px-3 py-2 text-[12.5px]
                          leading-relaxed text-amber-900">
              These sets are different sizes. Candidates are dealt one set each, so unequal
              sets mean unequal papers.
            </p>
          ) : null}
        </section>
      ) : null}

      <section>
        <SectionHead title="Questions" />
        <div tabIndex={0} role="region" aria-label="Questions in this bank" className={SCROLLER}>
          <DataTable
            caption="Every question in this bank, its type and what it is worth."
            head={<>
              <th scope="col" className="w-10">#</th>
              <th scope="col">Question</th>
              {sets.length > 1 ? <th scope="col">Set</th> : null}
              <th scope="col">Type</th>
              <th scope="col">Difficulty</th>
              <th scope="col" className="text-right">Marks</th>
            </>}
          >
            {questions.length === 0 ? (
              <EmptyRow colSpan={sets.length > 1 ? 6 : 5} icon="edit">
                Nothing in this bank yet. A paper drawn from it would deal no questions.
              </EmptyRow>
            ) : questions.map((q, i) => (
              <tr key={q.id} className="align-top">
                <td className="tabular-nums text-muted">{i + 1}</td>
                <td className="min-w-[18rem]">
                  <span className="font-semibold">{q.prompt}</span>
                  <span className="mt-0.5 block text-[12.5px] text-muted">
                    v{q.version}
                    {q.status && q.status !== 'active' && q.status !== 'published'
                      ? ' · ' + q.status : ''}
                  </span>
                </td>
                {sets.length > 1 ? (
                  <td className="whitespace-nowrap tabular-nums">
                    <Pill tone="brand">Set {q.set_number ?? 1}</Pill>
                  </td>
                ) : null}
                <td><Pill>{TYPE_LABELS[q.type] ?? q.type}</Pill></td>
                <td><Pill><span className="capitalize">{q.difficulty}</span></Pill></td>
                <td className="text-right font-bold tabular-nums">{q.points}</td>
              </tr>
            ))}
          </DataTable>
        </div>
        <p className="mt-2 text-[12.5px] leading-relaxed text-muted">
          Questions are written and edited by the institution, on its own question bank
          screen. This is the operator&rsquo;s view of what is in one.
        </p>
      </section>
    </div>
  );
}
