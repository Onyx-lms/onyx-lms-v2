import Link from 'next/link';
import type { Metadata } from 'next';
import { requireSession, apiAuth } from '@/lib/session';
import { LiveClassRoom, type JoinPayload } from '@/components/live-class-room';

export const metadata: Metadata = { title: 'Tuition session' };
export const dynamic = 'force-dynamic';

/**
 * TB-06 -- the session room.
 *
 * The API decides host vs participant from the booking. Laravel sent both the
 * tutor AND the student to Zoom's start_url, which is a host credential.
 */
export default async function TuitionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireSession();

  let join: JoinPayload;
  try {
    join = await apiAuth<JoinPayload>(
      '/api/tutor-bookings/' + encodeURIComponent(id) + '/join');
  } catch (e) {
    return (
      <div className="container-page max-w-lg py-16 text-center">
        <h1 className="text-xl font-semibold">You cannot join this session</h1>
        <p className="mt-3 text-sm text-slate-600">
          {e instanceof Error ? e.message : 'Something went wrong.'}
        </p>
        <Link href="/my-bookings" className="btn-primary mt-6 inline-block">My sessions</Link>
      </div>
    );
  }
  return <LiveClassRoom join={join} />;
}
