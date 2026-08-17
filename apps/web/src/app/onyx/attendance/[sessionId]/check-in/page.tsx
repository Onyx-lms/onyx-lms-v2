import Link from 'next/link';
import type { Metadata } from 'next';
import { OnyxShell } from '@/components/onyx-shell';
import { OnyxScannedCheckIn } from '@/components/onyx-attendance';
import { navFor } from '@/lib/onyx-nav';
import { requireOnyxSession, onyxApi, onyxApiSafe, type Me } from '@/lib/onyx-session';
import type { AttendanceSession } from '@/lib/onyx-learn';
import { Banner, Card, Icon } from '@/components/onyx-ui';

export const metadata: Metadata = { title: 'Check in' };

/**
 * LRN-03b -- where a scanned attendance QR lands.
 *
 * This route exists because the check-in is a QR rather than a typed code. A
 * phone camera opens a URL outside any app context, so the code arrives here
 * as `?c=`, and the page's whole job is to send it and say what happened.
 *
 * It deliberately sits at `/onyx/attendance/:sessionId/check-in` rather than
 * under `/onyx/courses/:id/attendance/...`, because the QR is generated from
 * the session alone and encoding a course id into it would mean the projector
 * had to know one more thing that the scan could get wrong.
 *
 * Not signed in? `requireOnyxSession` bounces to the login page and back here
 * afterwards, query string intact -- which matters more than usual: a learner
 * scanning in a lecture is often on a phone that logged out days ago, and
 * losing `?c=` in the round trip would send them back to a code that has since
 * rotated.
 */
export default async function OnyxScanCheckInPage(
  { params, searchParams }: {
    params: Promise<{ sessionId: string }>;
    searchParams: Promise<{ c?: string }>;
  },
) {
  const { sessionId } = await params;
  const { c } = await searchParams;
  const code = (c ?? '').trim();
  const id = Number(sessionId);

  // The return path is built here rather than read from headers so that what
  // survives the login round trip is exactly the code that was scanned.
  await requireOnyxSession(
    '/onyx/attendance/' + id + '/check-in'
    + (code ? '?c=' + encodeURIComponent(code) : ''));

  // Safe, not strict: a learner who scans a session they are not enrolled on
  // should be told that in plain words rather than shown an error page.
  const [me, session] = await Promise.all([
    onyxApi<Me>('/api/onyx/me'),
    // Safe, not strict: a learner who scans a session they are not enrolled on
    // should be told so in plain words by the check-in itself, not shown an
    // error page instead of one.
    onyxApiSafe<AttendanceSession>('/api/onyx/attendance/' + id + '/session'),
  ]);

  return (
    <OnyxShell me={me} nav={navFor(me.role)} title="Check in">
      <div className="mx-auto max-w-md">
        <Card className="p-5">
          <div className="mb-3 flex items-center gap-2">
            <Icon name="camera" className="h-5 w-5 text-muted" />
            <h1 className="text-base font-bold">
              {session?.title ?? 'Attendance'}
            </h1>
          </div>

          {code ? (
            <OnyxScannedCheckIn sessionId={id} code={code} />
          ) : (
            <Banner tone="warn">
              This link has no code on it. Scan the code on the screen at the
              front of the room rather than opening this page directly.
            </Banner>
          )}

          <p className="mt-4 border-t border-line pt-3 text-[13px] text-muted">
            <Link href="/onyx/timetable" className="font-semibold underline">
              Back to your timetable
            </Link>
          </p>
        </Card>
      </div>
    </OnyxShell>
  );
}
