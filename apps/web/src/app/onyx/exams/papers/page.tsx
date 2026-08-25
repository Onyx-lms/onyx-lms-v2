import type { Metadata } from 'next';
import { OnyxShell } from '@/components/onyx-shell';
import { navFor } from '@/lib/onyx-nav';
import { requireOnyxPageRole, onyxApi, onyxApiSafe, type Me } from '@/lib/onyx-session';
import type { Course } from '@/lib/onyx-learn';
import { FacultyExamTabs } from '@/lib/onyx-console-exams';
import { BankComposer } from '@/components/onyx-bank-composer';
import { BankList, type BankListRow } from '@/components/onyx-bank-list';

export const metadata: Metadata = { title: 'Exam paper' };

/**
 * The setter's half of Examinations, on the institution's own screens.
 *
 * The same screen the console has, for the same reason: building a bank and
 * scheduling a sitting are different work, done at different times, often by
 * different people, and putting them on one page meant a lecturer scheduling a
 * paper scrolled past a question composer to reach the calendar.
 *
 * No single-paper choice here, unlike Assessments. An examination is set as
 * parallel sets that rotate down the register — that is the whole reason the
 * bank exists — and offering "one paper everybody sits" beside it would offer
 * the thing this arrangement was built to replace.
 */
export default async function OnyxExamPapersPage() {
  await requireOnyxPageRole('admin', 'faculty', 'exams');

  const [me, banks, courses, exams, problems] = await Promise.all([
    onyxApi<Me>('/api/onyx/me'),
    onyxApiSafe<BankListRow[]>('/api/onyx/banks'),
    onyxApiSafe<Course[]>('/api/onyx/courses'),
    onyxApiSafe<{ id: number }[]>('/api/onyx/exams'),
    onyxApiSafe<{ id: number; title: string; status: string }[]>('/api/onyx/problems'),
  ]);

  const rows = banks ?? [];
  const byId = new Map((courses ?? []).map((c) => [Number(c.id), c.code + ' — ' + c.title]));

  return (
    <OnyxShell
      me={me}
      nav={navFor(me.role)}
      title="Examinations"
      subtitle="A bank holds the parallel sets a sitting is set from — roll 1 sits Set 1, roll 11 comes back round."
    >
      <FacultyExamTabs scheduled={(exams ?? []).length} papers={rows.length} />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <p className="text-[13px] font-semibold text-muted">
          {rows.length} {rows.length === 1 ? 'question bank' : 'question banks'}
        </p>
        <span className="flex-1" />
        <BankComposer
          basePath="onyx/banks"
          courses={(courses ?? []).map((c) => ({ id: Number(c.id), label: c.code + ' — ' + c.title }))}
          problems={problems ?? []}
        />
      </div>

      <BankList
        banks={rows}
        courseName={(cid) => (cid == null ? null : byId.get(Number(cid)) ?? null)}
        hrefFor={(b) => '/onyx/banks/' + b.id}
      />
    </OnyxShell>
  );
}
