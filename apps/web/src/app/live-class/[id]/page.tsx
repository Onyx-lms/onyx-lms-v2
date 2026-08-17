import type { Metadata } from 'next';
import Link from 'next/link';
import { requireSession, apiAuth } from '@/lib/session';
import { LiveClassRoom, type JoinPayload } from '@/components/live-class-room';

export const metadata: Metadata = { title: 'Live class' };
// Join payloads are per-user and short-lived; never cache them.
export const dynamic = 'force-dynamic';

export default async function LiveClassPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireSession();

  let join: JoinPayload;
  try {
    join = await apiAuth<JoinPayload>('/api/live-classes/' + encodeURIComponent(id) + '/join');
  } catch (e) {
    // The window guard and the enrolment guard both land here; the API message
    // says which, and it is the useful thing to show.
    return (
      <div className="container-page max-w-lg py-16 text-center">
        <h1 className="text-xl font-semibold">You cannot join this class</h1>
        <p className="mt-3 text-sm text-slate-600">
          {e instanceof Error ? e.message : 'Something went wrong.'}
        </p>
        <Link href="/my-courses" className="btn-primary mt-6 inline-block">Back to my courses</Link>
      </div>
    );
  }

  return <LiveClassRoom join={join} />;
}
