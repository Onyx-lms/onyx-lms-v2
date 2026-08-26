import type { Metadata } from 'next';
import { requirePlatformSession } from '@/lib/onyx-platform-session';
import { attempt, RosterHeader, type AcademicsPayload } from '@/lib/onyx-platform-tenant';
import { ExamTabs } from '@/lib/onyx-console-exams';
import { BankComposer } from '@/components/onyx-bank-composer';
import { BankList } from '@/components/onyx-bank-list';
import type { ConsoleBank } from '@/components/onyx-platform-forms';

export const metadata: Metadata = { title: 'Exam paper' };

/**
 * The setter's half of Examinations: the banks, and what is in them.
 *
 * A bank is authored long before anything is scheduled from it, and usually by
 * somebody else — so it gets its own screen rather than sharing one with the
 * calendar. Nothing here is dated: a bank is not a sitting, and giving it a
 * "when" column is what made the old single page confusing.
 */
export default async function OnyxPlatformExamPapersPage(
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
      <ExamTabs tenantId={tenantId} scheduled={(academics?.exams ?? []).length}
        papers={rows.length} />

      <div className="space-y-4">
        <RosterHeader count={rows.length} noun="question bank"
          action={(
            <BankComposer
              basePath={'onyx/platform/tenants/' + tenantId + '/banks'}
              courses={courses.map((c) => ({ id: c.id, label: c.code + ' — ' + c.title }))}
              problems={problems ?? []}
            />
          )} />

        {/* One bank has one page. This pointed at /examinations/papers/:id,
            which never existed -- a second dead route for the same object, and
            Next prefetches links in view, so opening this list fired a burst of
            404s before anybody clicked one. */}
        <BankList banks={rows}
          courseName={(cid) => (cid == null ? null : byId.get(Number(cid)) ?? null)}
          hrefFor={(b) => '/onyx/platform/tenants/' + tenantId
            + '/assessments/banks/' + b.id} />
      </div>
    </div>
  );
}
