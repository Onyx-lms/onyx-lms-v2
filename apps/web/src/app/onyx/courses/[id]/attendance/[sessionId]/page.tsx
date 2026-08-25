import Link from 'next/link';
import type { Metadata } from 'next';
import { OnyxShell } from '@/components/onyx-shell';
import { OnyxCheckIn, OnyxRosterMarking, OnyxSessionCode } from '@/components/onyx-attendance';
import { navFor } from '@/lib/onyx-nav';
import { requireOnyxSession, onyxApi, onyxApiSafe, type Me, onyxApiRecord } from '@/lib/onyx-session';
import { isStaff, type AttendanceRecord, type AttendanceSession } from '@/lib/onyx-learn';
import {
  Banner, Card, Empty, Icon, Meter, SectionHead, State, StatTile,
} from '@/components/onyx-ui';
import { dayNumber } from '@/lib/onyx-time';

export const metadata: Metadata = { title: 'Session' };

/** The pulsing live dot stops moving for anyone who has asked it to. */
const CALM = '[&_i]:motion-reduce:animate-none';

interface RosterResponse {
  session: AttendanceSession;
  roster: { user_id: string; name: string | null; roll_number: string | null;
    record: AttendanceRecord | null }[];
}

/** "40 seconds ago" — the only form in which "when was the last scan" is useful. */
function since(iso: string | null, now: number): string {
  if (!iso) return '—';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '—';
  const secs = Math.max(0, Math.round((now - t) / 1000));
  if (secs < 60) return secs + (secs === 1 ? ' second ago' : ' seconds ago');
  const mins = Math.round(secs / 60);
  if (mins < 60) return mins + (mins === 1 ? ' minute ago' : ' minutes ago');
  const hours = Math.round(mins / 60);
  if (hours < 24) return hours + (hours === 1 ? ' hour ago' : ' hours ago');
  return new Date(t).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

/** When the session is, relative first. */
function when(iso: string, now: number): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return 'No date';
  const clock = new Date(t).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' });
  // Midnight in the institution's zone, not the runtime's -- see
  // `dayNumber` in lib/onyx-time.ts for what that fixed.
  const startOf = (ms: number) => dayNumber(ms) * 86_400_000;
  const d = Math.round((startOf(now) - startOf(t)) / 86_400_000);
  if (d === 0) return 'Today, ' + clock;
  if (d === 1) return 'Yesterday, ' + clock;
  if (d === -1) return 'Tomorrow, ' + clock;
  if (d < 0) return 'In ' + Math.abs(d) + ' days, ' + clock;
  if (d <= 13) return d + ' days ago, ' + clock;
  return new Date(t).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short' })
    + ', ' + clock;
}

/**
 * LRN-03 -- one session, from both sides.
 *
 * Faculty get the rotating code and the roster; a learner gets a box to type
 * the code into. Which one is rendered follows from the role, and the API
 * refuses the other half regardless.
 */
export default async function OnyxSessionPage(
  { params }: { params: Promise<{ id: string; sessionId: string }> },
) {
  const claims = await requireOnyxSession();
  const { id, sessionId } = await params;
  const staff = isStaff(claims.tenant_role);

  const [me, sessions, rosterData, members] = await Promise.all([
    onyxApi<Me>('/api/onyx/me'),
    onyxApiRecord<AttendanceSession[]>('/api/onyx/courses/' + id + '/attendance'),
    staff ? onyxApiSafe<RosterResponse>('/api/onyx/attendance/' + sessionId + '/roster') : null,
    staff ? onyxApiSafe<{ user_id: string; user: { name: string; email: string } | null }[]>(
      '/api/onyx/members') : null,
  ]);

  const session = sessions.find((s) => String(s.id) === sessionId);
  if (!session) {
    return (
      <OnyxShell me={me} nav={navFor(me.role)} title="Session">
        <Card className="p-0">
          <Empty icon="alert">
            That session is not part of this course.{' '}
            <Link href={'/onyx/courses/' + id + '/attendance'}
              className="font-semibold text-brand-600 underline">
              Back to attendance
            </Link>
          </Empty>
        </Card>
      </OnyxShell>
    );
  }

  const names = new Map((members ?? []).map((m) => [m.user_id, m.user]));
  // The API resolves the name and the roll number and returns the roster in
  // roll order, so this no longer re-sorts or re-looks-up -- the members map is
  // only a fallback for an account that has since gone.
  const roster = (rosterData?.roster ?? []).map((r) => ({
    user_id: r.user_id,
    name: r.name ?? names.get(r.user_id)?.name ?? ('User ' + r.user_id),
    email: names.get(r.user_id)?.email ?? '',
    roll_number: r.roll_number,
    record: r.record,
  }));

  const now = Date.now();
  // Derived server-side, not `status === 'open'`. `status` only changes when
  // faculty press Close, so a lecture nobody closed kept projecting a live
  // code and kept offering learners an enabled check-in box days afterwards.
  // This gates both panels -- the projector and the learner's -- so the two
  // cannot disagree, and neither can disagree with what check-in accepts.
  const open = session.check_in_open;

  // Every count below is read off the roster the API already returned. Nothing
  // here asks the server anything it was not asked before.
  const marked = roster.filter((r) => r.record);
  const count = (status: AttendanceRecord['status']) =>
    marked.filter((r) => r.record?.status === status).length;
  const present = count('present');
  const late = count('late');
  const excused = count('excused');
  const notYet = roster.length - marked.length;
  const byQr = marked.filter((r) => r.record?.method === 'qr').length;
  const byHand = marked.length - byQr;
  const lastAt = marked
    .map((r) => r.record?.marked_at ?? null)
    .filter((v): v is string => Boolean(v))
    .sort()
    .pop() ?? null;

  return (
    <OnyxShell
      me={me}
      nav={navFor(me.role)}
      title={session.title}
      subtitle={when(session.scheduled_at, now) + ' · ' + session.duration_minutes + ' minutes'}
    >
      <nav aria-label="Breadcrumb"
        className="mb-4 flex flex-wrap items-center gap-1.5 text-[13px] text-muted">
        <Link href={'/onyx/courses/' + id}
          className="font-semibold text-brand-600 hover:underline">
          Course
        </Link>
        <Icon name="chevron" className="h-3 w-3 text-faint" />
        <Link href={'/onyx/courses/' + id + '/attendance'}
          className="font-semibold text-brand-600 hover:underline">
          Attendance
        </Link>
        <Icon name="chevron" className="h-3 w-3 text-faint" />
        <span className="truncate">{session.title}</span>
      </nav>

      {staff ? (
        <div className="space-y-7">
          <div className="grid gap-5 lg:grid-cols-2 lg:items-start">
            {/* The code panel is the front of the room: it gets projected, so
                everything on it has to read from the back row. The rotation is
                what makes it worth doing at all — a screenshot passed to
                somebody in a café stops working before they can use it — so the
                countdown is stated by the panel itself, not implied. */}
            {open ? (
              <Card className="min-w-0 p-4">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <span className={CALM}><State tone="live">Check-in open</State></span>
                  <span className="text-[13px] text-muted">
                    Rotates every {session.qr_window_seconds} s
                  </span>
                </div>
                <OnyxSessionCode sessionId={session.id} />
                <div className="mt-4 flex items-start gap-2 border-t border-line pt-3
                                text-[13px] text-muted">
                  <Icon name="shield" className="mt-0.5 h-4 w-4 shrink-0" />
                  <span className="min-w-0 flex-1">
                    Learners enter it from this session on their own device.
                  </span>
                </div>
              </Card>
            ) : (
              <Card className="min-w-0 p-4">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <State tone="idle">Check-in closed</State>
                  <span className="text-[13px] text-muted">
                    {when(session.scheduled_at, now)}
                  </span>
                </div>
                <p className="text-[13px] text-muted">
                  The register is final. Anyone left unmarked when a session closes is
                  recorded absent.
                </p>
              </Card>
            )}

            <div className="min-w-0 space-y-4">
              {/* "Not yet" rather than "absent": nobody is absent while the door
                  is still open, and calling them absent early is how a register
                  ends up wrong and a learner ends up appealing it. */}
              <div className="grid gap-3 sm:grid-cols-3">
                <StatTile label="Present" value={present}
                  note={'of ' + roster.length + ' enrolled'} />
                <StatTile label="Late" value={late} note="after the start" />
                <StatTile
                  label={open ? 'Not yet' : 'Absent'}
                  value={open ? notYet : notYet + count('absent')}
                  note={open
                    ? (count('absent') > 0
                      ? count('absent') + ' already marked absent'
                      : excused + ' already excused')
                    : excused + ' excused'} />
              </div>

              <Card className="p-4">
                <div className="flex items-baseline justify-between gap-2 text-[13px]">
                  <span className="font-bold">Checked in</span>
                  <span className="tabular-nums text-muted">
                    {marked.length} of {roster.length}
                  </span>
                </div>
                <div className="mt-2">
                  <Meter
                    percent={roster.length ? (marked.length / roster.length) * 100 : 0}
                    label={'Candidates present at ' + session.title} />
                </div>
                <dl className="mt-4 divide-y divide-line border-t border-line text-[13.5px]">
                  <div className="flex items-center justify-between gap-3 py-2.5">
                    <dt className="text-muted">By code</dt>
                    <dd className="font-bold tabular-nums">{byQr}</dd>
                  </div>
                  <div className="flex items-center justify-between gap-3 py-2.5">
                    <dt className="text-muted">Marked by hand</dt>
                    <dd className="font-bold tabular-nums">{byHand}</dd>
                  </div>
                  <div className="flex items-center justify-between gap-3 py-2.5">
                    <dt className="text-muted">Last check-in</dt>
                    <dd className="font-semibold">{since(lastAt, now)}</dd>
                  </div>
                </dl>
              </Card>

              {open && notYet > 0 ? (
                <Banner tone="info" icon="shield">
                  {notYet === 1
                    ? 'One learner has not checked in yet.'
                    : notYet + ' learners have not checked in yet.'}{' '}
                  Nobody is absent while the door is open — mark the register below once
                  the room has settled.
                </Banner>
              ) : null}
            </div>
          </div>

          <section>
            <SectionHead title="Register"
              action={{ href: '/onyx/courses/' + id + '/attendance',
                label: 'Course attendance' }} />
            <OnyxRosterMarking session={session} roster={roster} />
          </section>
        </div>
      ) : (
        <div className="max-w-md">
          {open ? (
            <Card className="p-5">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <span className={CALM}><State tone="live">Check-in open</State></span>
                <span className="text-[13px] text-muted">
                  Changes every {session.qr_window_seconds} s
                </span>
              </div>
              <p className="mb-3 text-sm text-muted">
                Enter the code on screen. It changes every {session.qr_window_seconds} seconds,
                so type the one that is up now rather than one from a photograph.
              </p>
              <OnyxCheckIn sessionId={session.id} />
            </Card>
          ) : (
            <Card className="p-0">
              <Empty icon="lock">
                This session is closed, so check-in is no longer open. Your attendance for it
                is on the course page.
              </Empty>
            </Card>
          )}
        </div>
      )}
    </OnyxShell>
  );
}
