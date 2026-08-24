import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { OnyxShell } from '@/components/onyx-shell';
import { navFor } from '@/lib/onyx-nav';
import { requireOnyxSession, onyxApi, onyxApiSafe, type Me, onyxApiRecord } from '@/lib/onyx-session';
import type { Exam } from '@/lib/onyx-campus';
import type { MarkingQueueRow } from '@/lib/onyx-assess';
import { MarkingQueue } from '@/components/onyx-marking-queue';
import { Icon } from '@/components/onyx-ui';

export const metadata: Metadata = { title: 'Marking' };

const EXAM_STAFF = ['admin', 'exams'];

/**
 * CMP-02c -- an exam's own marking queue.
 *
 * An exam sat online is, underneath, an assessment attempt -- so the scripts
 * being marked here are the exact same rows `/onyx/assessments/:id/marking`
 * shows. What this page changes is everything around them: the breadcrumb
 * says Examinations, not Assessments, "see the results" sends you back to
 * this exam rather than a separate assessment results page, and getting
 * here at all only ever required knowing the exam -- not knowing, or caring,
 * that a CBT paper sits behind it. Marking an exam should feel like marking
 * an exam.
 */
export default async function OnyxExamMarkingPage({ params }: { params: Promise<{ id: string }> }) {
  await requireOnyxSession();
  const { id } = await params;
  const [me, exam] = await Promise.all([
    onyxApi<Me>('/api/onyx/me'),
    onyxApiRecord<Exam>('/api/onyx/exams/' + id),
  ]);

  // Same course-scoped trust as the exam page itself: the examinations
  // office institution-wide, or this exam's own course faculty.
  const staff = EXAM_STAFF.includes(me.role);
  const myCourses = me.role === 'faculty'
    ? await onyxApiSafe<{ id: number }[]>('/api/onyx/my/courses') : null;
  const teachesThisCourse = (myCourses ?? []).some((c) => Number(c.id) === Number(exam.course_id));
  const canMark = staff || (me.role === 'faculty' && teachesThisCourse);
  // Nothing to mark without an online paper, and nobody to show it to
  // without the right to mark it -- either sends back to the exam itself
  // rather than a bare denial, since that page explains why.
  if (!canMark || !exam.assessment_id) redirect('/onyx/exams/' + id);

  const queue = await onyxApiRecord<MarkingQueueRow[]>('/api/onyx/assessments/' + exam.assessment_id + '/marking');

  return (
    <OnyxShell
      me={me}
      nav={navFor(me.role)}
      title={'Marking: ' + exam.title}
      subtitle="Sat online as this exam's paper, locked to its scheduled slot."
    >
      <nav aria-label="Breadcrumb" className="mb-3 flex flex-wrap items-center gap-1.5 text-sm text-muted">
        <Link href="/onyx/exams" className="font-semibold text-brand-600 hover:underline">
          Examinations
        </Link>
        <Icon name="chevron" className="h-3.5 w-3.5 text-faint" />
        <Link href={'/onyx/exams/' + id}
          className="truncate font-semibold text-brand-600 hover:underline">
          {exam.title}
        </Link>
        <Icon name="chevron" className="h-3.5 w-3.5 text-faint" />
        <span>Marking</span>
      </nav>

      <MarkingQueue queue={queue} resultsHref={'/onyx/exams/' + id} />
    </OnyxShell>
  );
}
