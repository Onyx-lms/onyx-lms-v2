import type { Metadata } from 'next';
import { requirePlatformSession } from '@/lib/onyx-platform-session';
import { attempt, RosterHeader, type AcademicsPayload } from '@/lib/onyx-platform-tenant';
import { AssessmentTabs } from '@/lib/onyx-console-exams';
import { BankComposer } from '@/components/onyx-bank-composer';
import { BankList } from '@/components/onyx-bank-list';
import type { ConsoleBank } from '@/components/onyx-platform-forms';

export const metadata: Metadata = { title: 'Assessment question bank' };

/**
 * The setter's half of Assessments: the banks, and what is in them.
 *
 * The same screen as Exam paper, with one difference that matters: an
 * assessment bank may be a SINGLE paper. A class test is usually one set of
 * questions everybody sits, and making a setter build "Set 1" of one is
 * ceremony. So the composer here offers the choice and starts on one paper;
 * the examination side does not offer it, because parallel sets are the point
 * of an examination.
 */
export default async function OnyxPlatformAssessmentBanksPage(
  { params }: { params: Promise<{ id: string }> },
) {
  await requirePlatformSession();
  const { id } = await params;
  const tenantId = Number(id);
  const base = '/api/onyx/platform/tenants/' + encodeURIComponent(id);

  const [academics, problems, banks] = await Promise.all([
    attempt<AcademicsPayload>(base + '/academics?limit=200'),
    attempt<{ id: number; title: string; status: string }[]>(base + '/problems'),
    attempt<ConsoleBank[]>(base + '/banks'),
  ]);

  const courses = academics?.courses ?? [];
  const rows = banks ?? [];
  const byId = new Map(courses.map((c) => [Number(c.id), c.code + ' — ' + c.title]));

  return (
    <div className="min-w-0">
      <AssessmentTabs tenantId={tenantId} scheduled={(academics?.assessments ?? []).length}
        banks={rows.length} />

      <div className="space-y-4">
        <RosterHeader count={rows.length} noun="question bank"
          action={(
            <BankComposer
              basePath={'onyx/platform/tenants/' + tenantId + '/banks'}
              courses={courses.map((c) => ({ id: c.id, label: c.code + ' — ' + c.title }))}
              problems={problems ?? []}
              singleSetOption
              noun="assessment"
            />
          )} />

        <BankList banks={rows}
          courseName={(cid) => (cid == null ? null : byId.get(Number(cid)) ?? null)}
          hrefFor={(b) => '/onyx/platform/tenants/' + tenantId + '/assessments/banks/' + b.id} />
      </div>
    </div>
  );
}
