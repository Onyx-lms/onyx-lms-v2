import Link from 'next/link';
import { Card, DataTable, EmptyRow, Icon, Pill } from '@/components/onyx-ui';
import { Byline, type Author } from '@/components/onyx-byline';

/** A bank as the listing reads it. */
export interface BankListRow {
  id: number;
  name: string;
  course_id: number | null;
  question_count: number;
  set_count?: number;
  needs_marking?: number;
  /** Who built it. Absent on a bank whose author has since been removed. */
  author?: Author | null;
}

/**
 * The banks an institution has built, and what each is ready for.
 *
 * The columns are the questions a setter actually asks about a bank, in the
 * order they ask them:
 *
 *   * **Sets** first, because it decides how the bank behaves. One set is one
 *     paper everybody sits; ten sets rotate down the register so neighbours
 *     never hold the same one. A scheduler picking a bank needs this before
 *     anything else, and it used to require opening the bank and counting.
 *   * **Questions**, and whether the sets are the same size — unequal sets are
 *     not parallel papers, and the candidate on the short one is the one who
 *     notices.
 *   * **Needing a marker**, because an essay or an unkeyed multiple-choice is
 *     what stops a paper releasing at hand-in, and that surprise belongs here
 *     rather than at results time.
 */
export function BankList({ banks, hrefFor, courseName }: {
  banks: BankListRow[];
  /** Where a bank opens to be edited. */
  hrefFor: (bank: BankListRow) => string;
  courseName: (courseId: number | null) => string | null;
}) {
  return (
    <Card className="p-0">
      <DataTable
        caption="Question banks at this institution, and the sets each holds."
        head={
          <>
            <th scope="col">Bank</th>
            <th scope="col">Course</th>
            <th scope="col">Sets</th>
            <th scope="col">Questions</th>
            <th scope="col">Marking</th>
            {/* Last of the informative columns, before the control: it is the
                thing you look up once you have already decided the bank is
                the one you meant. */}
            <th scope="col">Built by</th>
            <th scope="col">&nbsp;</th>
          </>
        }
      >
        {banks.length === 0 ? (
          <EmptyRow colSpan={7} icon="layers">
            No question banks yet. A bank holds the parallel sets an examination is
            scheduled from — build one before scheduling a sitting.
          </EmptyRow>
        ) : banks.map((b) => {
          const sets = Number(b.set_count ?? 1);
          const per = sets ? b.question_count / sets : 0;
          const even = Number.isInteger(per);
          return (
            <tr key={b.id} className="align-top">
              <td>
                <Link href={hrefFor(b)} className="font-semibold hover:underline">
                  {b.name}
                </Link>
              </td>
              <td className="text-[13px] text-muted">
                {courseName(b.course_id) ?? '—'}
              </td>
              <td>
                {sets > 1
                  ? <Pill tone="brand">{sets} sets</Pill>
                  : <Pill tone="neutral">One set</Pill>}
              </td>
              <td className="whitespace-nowrap tabular-nums">
                {b.question_count}
                {sets > 1 ? (
                  <span className="text-[12.5px] text-muted">
                    {even ? ' · ' + per + ' each' : ' · uneven'}
                  </span>
                ) : null}
              </td>
              <td>
                {/* Zero is the good state and reads as one, rather than as an
                    empty cell that could mean "not checked". */}
                {Number(b.needs_marking ?? 0)
                  ? <Pill tone="soon">{b.needs_marking} need a marker</Pill>
                  : <span className="text-[12.5px] text-muted">marks itself</span>}
              </td>
              <td><Byline author={b.author} /></td>
              <td className="text-right">
                <Link href={hrefFor(b)}
                  className="inline-flex min-h-[30px] items-center gap-1 rounded-lg border
                             border-slate-300 px-2.5 text-[12.5px] font-semibold
                             hover:bg-slate-50">
                  <Icon name="edit" className="h-3.5 w-3.5" />
                  Open
                </Link>
              </td>
            </tr>
          );
        })}
      </DataTable>
    </Card>
  );
}
