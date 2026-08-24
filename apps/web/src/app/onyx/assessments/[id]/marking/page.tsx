import Link from 'next/link';
import type { Metadata } from 'next';
import { OnyxShell } from '@/components/onyx-shell';
import { navFor } from '@/lib/onyx-nav';
import { requireOnyxPageRole, onyxApi, type Me, onyxApiRecord } from '@/lib/onyx-session';
import type { Assessment, MarkingQueueRow } from '@/lib/onyx-assess';
import { MarkingQueue } from '@/components/onyx-marking-queue';
import { Icon } from '@/components/onyx-ui';

export const metadata: Metadata = { title: 'Marking' };

/** ASS-03a -- the marking queue, anonymised where the assessment says so. */
export default async function OnyxMarkingPage({ params }: { params: Promise<{ id: string }> }) {
  await requireOnyxPageRole('admin', 'faculty', 'exams');
  const { id } = await params;
  const [me, assessment, queue] = await Promise.all([
    onyxApi<Me>('/api/onyx/me'),
    onyxApiRecord<Assessment>('/api/onyx/assessments/' + id),
    onyxApiRecord<MarkingQueueRow[]>('/api/onyx/assessments/' + id + '/marking'),
  ]);

  return (
    <OnyxShell
      me={me}
      nav={navFor(me.role)}
      title={'Marking: ' + assessment.title}
      subtitle={assessment.anonymous_marking
        ? 'Candidates are not named on this paper.'
        : 'Candidates are named on this paper.'}
    >
      <nav aria-label="Breadcrumb" className="mb-3 flex flex-wrap items-center gap-1.5 text-sm text-muted">
        <Link href="/onyx/assessments" className="font-semibold text-brand-600 hover:underline">
          Assessments
        </Link>
        <Icon name="chevron" className="h-3.5 w-3.5 text-faint" />
        <Link href={'/onyx/assessments/' + id}
          className="truncate font-semibold text-brand-600 hover:underline">
          {assessment.title}
        </Link>
        <Icon name="chevron" className="h-3.5 w-3.5 text-faint" />
        <span>Marking</span>
      </nav>

      <MarkingQueue queue={queue} resultsHref={'/onyx/assessments/' + id + '/results'} />
    </OnyxShell>
  );
}
