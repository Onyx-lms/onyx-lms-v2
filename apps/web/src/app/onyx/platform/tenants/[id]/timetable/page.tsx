import type { Metadata } from 'next';
import { requirePlatformSession } from '@/lib/onyx-platform-session';
import { attempt, SCROLLER, TenantBackLink, Unavailable, Workflow } from '@/lib/onyx-platform-tenant';
import { WEEKDAYS, hhmm } from '@/lib/onyx-campus';
import { DataTable, EmptyRow, SectionHead, StatTile } from '@/components/onyx-ui';

export const metadata: Metadata = { title: 'Timetable' };

interface TimetableSlotRow {
  id: number;
  semester: string | null;
  course: { id: number; code: string; title: string } | null;
  room: { id: number; code: string; name: string; kind: string } | null;
  faculty: { id: number; name: string } | null;
  batch: string | null;
  day_of_week: number;
  starts_at: string;
  ends_at: string;
  status: string;
}
interface TimetablePayload {
  semesters: { id: number; name: string }[];
  slots: TimetableSlotRow[];
}

/**
 * CMP-01b, read from outside the institution.
 *
 * The console that builds and publishes a timetable is the institution's own
 * -- this is oversight, not a second door to write through, so there is no
 * create/edit/publish control here, only the grid. Drafts are included and
 * marked, the same as an institution's own admin sees, because a platform
 * operator watching a build-out in progress needs to see that it exists, not
 * only that it is finished.
 */
export default async function OnyxPlatformTimetablePage(
  { params }: { params: Promise<{ id: string }> },
) {
  await requirePlatformSession();
  const { id } = await params;
  const tenantId = Number(id);
  const timetable = await attempt<TimetablePayload>(
    '/api/onyx/platform/tenants/' + encodeURIComponent(id) + '/timetable');
  const slots = timetable?.slots ?? [];
  const drafts = slots.filter((s) => s.status === 'draft').length;
  const roomsUsed = new Set(slots.map((s) => s.room?.id).filter(Boolean)).size;

  return (
    <div className="min-w-0 space-y-4">
      <TenantBackLink tenantId={tenantId} />

      {timetable === null ? <Unavailable what="timetable" /> : (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <StatTile label="Sessions" value={slots.length} note="scheduled at this institution" />
            <StatTile label="Rooms in use" value={roomsUsed} note="carrying at least one session" />
            <StatTile label="Drafts" value={drafts} note="not yet visible to learners" />
          </div>

          <SectionHead title="Every session" />
          <div tabIndex={0} role="region" aria-label="Timetable" className={SCROLLER}>
            <DataTable
              caption="Every timetable slot at this institution, published and draft alike"
              head={
                <>
                  <th scope="col">Course</th>
                  <th scope="col">Faculty</th>
                  <th scope="col">Room</th>
                  <th scope="col">Batch</th>
                  <th scope="col">Day</th>
                  <th scope="col">Time</th>
                  <th scope="col">Semester</th>
                  <th scope="col">Status</th>
                </>
              }
            >
              {slots.length === 0 ? (
                <EmptyRow colSpan={8} icon="calendar">
                  Nothing scheduled yet at this institution.
                </EmptyRow>
              ) : slots.map((s) => (
                <tr key={s.id} className="align-top">
                  <td className="font-semibold">
                    {s.course ? s.course.code + ' — ' + s.course.title
                      : <span className="font-normal text-muted">Course #{s.id}</span>}
                  </td>
                  <td>{s.faculty?.name ?? <span className="text-muted">—</span>}</td>
                  <td className="font-mono text-[12.5px]">
                    {s.room ? s.room.code + ' — ' + s.room.name : <span className="font-sans text-muted">—</span>}
                  </td>
                  <td>{s.batch ?? <span className="text-muted">—</span>}</td>
                  <td>{WEEKDAYS[s.day_of_week - 1] ?? 'Day ' + s.day_of_week}</td>
                  <td className="whitespace-nowrap tabular-nums">
                    {hhmm(s.starts_at)}&ndash;{hhmm(s.ends_at)}
                  </td>
                  <td className="text-[12.5px] text-muted">{s.semester ?? '—'}</td>
                  <td><Workflow status={s.status} /></td>
                </tr>
              ))}
            </DataTable>
          </div>
        </>
      )}
    </div>
  );
}
