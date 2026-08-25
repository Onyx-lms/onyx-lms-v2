import type { Metadata } from 'next';
import { OnyxShell } from '@/components/onyx-shell';
import { navFor } from '@/lib/onyx-nav';
import { requireOnyxPageRole, onyxApi, onyxApiSafe, type Me } from '@/lib/onyx-session';
import type { Course } from '@/lib/onyx-learn';
import { FacultyAssessmentTabs } from '@/lib/onyx-console-exams';
import { BankComposer } from '@/components/onyx-bank-composer';
import { BankList, type BankListRow } from '@/components/onyx-bank-list';

export const metadata: Metadata = { title: 'Assessment question bank' };

/**
 * The setter's half of Assessments, on the institution's own screens.
 *
 * A bank is written weeks before anything is scheduled from it, so it gets its
 * own screen rather than a row of chips under a scheduling form — which is
 * what it was: a list of names with no way to see how many questions were in
 * one, how many sets it held, or whether any of it needed a marker, short of
 * opening it.
 *
 * The composer here offers ONE PAPER as well as parallel sets, and starts on
 * it. A class test is usually one set of questions everybody sits, and making
 * a lecturer build "Set 1" of one is ceremony for nothing; an examination is
 * the other way round, so its own screen does not offer the choice.
 */
export default async function OnyxAssessmentBanksPage() {
  await requireOnyxPageRole('admin', 'faculty', 'exams');

  const [me, banks, courses, papers, problems] = await Promise.all([
    onyxApi<Me>('/api/onyx/me'),
    onyxApiSafe<BankListRow[]>('/api/onyx/banks'),
    onyxApiSafe<Course[]>('/api/onyx/courses'),
    onyxApiSafe<{ id: number }[]>('/api/onyx/assessments'),
    onyxApiSafe<{ id: number; title: string; status: string }[]>('/api/onyx/problems'),
  ]);

  const rows = banks ?? [];
  const byId = new Map((courses ?? []).map((c) => [Number(c.id), c.code + ' — ' + c.title]));

  return (
    <OnyxShell
      me={me}
      nav={navFor(me.role)}
      title="Assessments"
      subtitle="Questions live in a bank. A paper draws from one — a bank is not a paper and nobody sits it."
    >
      <FacultyAssessmentTabs scheduled={(papers ?? []).length} banks={rows.length} />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <p className="text-[13px] font-semibold text-muted">
          {rows.length} {rows.length === 1 ? 'question bank' : 'question banks'}
        </p>
        <span className="flex-1" />
        <BankComposer
          basePath="onyx/banks"
          courses={(courses ?? []).map((c) => ({ id: Number(c.id), label: c.code + ' — ' + c.title }))}
          problems={problems ?? []}
          singleSetOption
          noun="assessment"
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
