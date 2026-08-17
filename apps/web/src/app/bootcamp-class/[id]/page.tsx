import Link from 'next/link';
import type { Metadata } from 'next';
import { requireSession, apiAuth } from '@/lib/session';
import { LiveClassRoom, type JoinPayload } from '@/components/live-class-room';

export const metadata: Metadata = { title: 'Workshop session' };
export const dynamic = 'force-dynamic';

/** BC-05 -- join a workshop session. The API decides host vs participant. */
export default async function BootcampClassPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireSession();

  let join: JoinPayload;
  try {
    join = await apiAuth<JoinPayload>(
      '/api/bootcamp-live-classes/' + encodeURIComponent(id) + '/join');
  } catch (e) {
    return (
      <div className="container-page max-w-lg py-16 text-center">
        <h1 className="text-xl font-semibold">You cannot join this session</h1>
        <p className="mt-3 text-sm text-slate-600">
          {e instanceof Error ? e.message : 'Something went wrong.'}
        </p>
        <Link href="/my-bootcamps" className="btn-primary mt-6 inline-block">My workshops</Link>
      </div>
    );
  }
  return <LiveClassRoom join={join} />;
}
