import Link from 'next/link';
import type { Metadata } from 'next';
import { OnyxShell } from '@/components/onyx-shell';
import { navFor } from '@/lib/onyx-nav';
import { requireOnyxPageRole, onyxApi, onyxApiSafe, type Me } from '@/lib/onyx-session';
import type { Batch, Course, Semester } from '@/lib/onyx-learn';
import type { FacultyAllocation, WorkloadRow } from '@/lib/onyx-campus';
import { CreatePanel } from '@/components/onyx-create';
import { SemesterPicker } from '@/components/onyx-manage';
import {
  Banner, Buckets, Card, DataTable, Empty, EmptyRow, Meter, Pill, SectionHead,
  StackBar, StatTile,
} from '@/components/onyx-ui';

export const metadata: Metadata = { title: 'Teaching allocation' };

const KIND_LABEL: Record<string, string> = {
  lead: 'Lead', assistant: 'Assistant', lab: 'Lab',
};

/**
 * The line the bars are drawn against.
 *
 * A display guide, not a figure the API carries: nothing in the allocation
 * endpoints states a contractual cap, so the number is named in the column
 * heading rather than presented as this institution's policy. It exists
 * because "24" and "4" mean nothing side by side without a scale.
 */
const GUIDE_HOURS = 18;
const LIGHT_HOURS = 12;

function verdict(hours: number): { tone: 'late' | 'good' | 'neutral'; text: string } {
  if (hours === 0) return { tone: 'late', text: 'No allocation' };
  if (hours > GUIDE_HOURS) return { tone: 'late', text: hours - GUIDE_HOURS + ' h over' };
  if (hours >= LIGHT_HOURS) return { tone: 'good', text: 'On target' };
  return { tone: 'neutral', text: LIGHT_HOURS - hours + ' h spare' };
}

/**
 * CMP-01a -- faculty allocation and teaching load.
 *
 * "Programs, batches, faculty allocation and the institutional console that
 * ties them together", against an acceptance criterion of "an institution can
 * run a term without touching the database". Allocation was the one part of
 * that sentence with no screen: the endpoints existed and nothing called them,
 * so assigning a lecturer to a course meant a POST by hand.
 *
 * The page is built around the question a head of department actually asks --
 * who is carrying twenty hours and who is carrying four -- so the workload roll
 * up comes first and the allocation list second. A term is chosen rather than
 * assumed: allocation is always "for this semester", never in general.
 */
export default async function OnyxAllocationsPage(
  { searchParams }: { searchParams: Promise<{ semester?: string }> },
) {
  await requireOnyxPageRole('admin', 'faculty');
  const { semester: asked } = await searchParams;

  const [me, semesters, courses, batches, members] = await Promise.all([
    onyxApi<Me>('/api/onyx/me'),
    onyxApi<Semester[]>('/api/onyx/semesters'),
    onyxApiSafe<Course[]>('/api/onyx/courses'),
    onyxApiSafe<Batch[]>('/api/onyx/batches'),
    onyxApiSafe<{ user_id: string; role: string; user: { name: string; email: string } | null }[]>(
      '/api/onyx/members'),
  ]);

  // The asked-for term, if it is one of this institution's; otherwise the
  // newest. Falling back rather than erroring keeps a stale bookmark useful.
  const chosen = semesters.find((s) => String(s.id) === asked)
    ?? [...semesters].sort((a, b) => b.id - a.id)[0];

  const [allocations, workload] = chosen
    ? await Promise.all([
      onyxApiSafe<FacultyAllocation[]>('/api/onyx/allocations?semester_id=' + chosen.id),
      onyxApiSafe<WorkloadRow[]>('/api/onyx/semesters/' + chosen.id + '/workload'),
    ])
    : [null, null];

  const teachers = (members ?? []).filter((m) => m.role === 'faculty' || m.role === 'admin');
  const names = new Map((members ?? []).map((m) => [m.user_id, m.user]));
  const courseById = new Map((courses ?? []).map((c) => [c.id, c]));
  const batchById = new Map((batches ?? []).map((b) => [b.id, b]));

  const rows = workload ?? [];
  const totalHours = rows.reduce((sum, r) => sum + r.hours, 0);
  // Nobody allocated anything is not the same as nobody teaching zero hours,
  // so an unallocated faculty member is listed rather than left out.
  const unallocated = teachers.filter((t) => !rows.some((r) => r.user_id === t.user_id));

  // One list, so the roll call and the distribution cannot disagree: every
  // teaching name this institution has, with the hours it is carrying.
  const load = [
    ...rows.map((r) => ({
      key: 'w-' + r.user_id,
      name: r.name ?? names.get(r.user_id)?.name ?? 'User ' + r.user_id,
      courses: r.courses,
      hours: r.hours,
    })),
    ...unallocated.map((t) => ({
      key: 'n-' + t.user_id,
      name: t.user?.name ?? 'User ' + t.user_id,
      courses: 0,
      hours: 0,
    })),
  ].sort((a, b) => b.hours - a.hours);

  const over = load.filter((r) => r.hours > GUIDE_HOURS);
  const onTarget = load.filter((r) => r.hours >= LIGHT_HOURS && r.hours <= GUIDE_HOURS);
  const light = load.filter((r) => r.hours > 0 && r.hours < LIGHT_HOURS);

  // Median, not mean: one person on twenty-four hours drags an average and
  // makes a department of eights look healthy.
  const sorted = load.map((r) => r.hours).sort((a, b) => a - b);
  const median = sorted.length
    ? (sorted.length % 2
      ? sorted[Math.floor(sorted.length / 2)]!
      : Math.round((sorted[sorted.length / 2 - 1]! + sorted[sorted.length / 2]!) / 2))
    : 0;

  const share = (n: number) => (load.length ? Math.round((n / load.length) * 100) : 0);

  return (
    <OnyxShell
      me={me}
      nav={navFor(me.role)}
      title="Teaching allocation"
      subtitle={chosen
        ? chosen.name + ' · ' + (allocations?.length ?? 0) + ' allocation'
          + ((allocations?.length ?? 0) === 1 ? '' : 's') + ' across ' + load.length
          + ' teaching staff'
        : 'No semesters have been defined yet.'}
      action={chosen ? (
        <CreatePanel
          title="Allocate teaching" cta="Allocate teaching" icon="users"
          endpoint="allocations"
          fields={[
            { name: 'semester_id', label: 'Semester', type: 'select', required: true,
              numeric: true, wide: true, fallback: chosen.id,
              options: semesters.map((s) => ({ value: String(s.id), label: s.name })) },
            { name: 'course_id', label: 'Course', type: 'select', required: true,
              numeric: true, wide: true,
              options: (courses ?? []).map((c) => ({
                value: String(c.id), label: c.code + ' — ' + c.title,
              })) },
            { name: 'user_id', label: 'Who teaches it', type: 'select', required: true,
              numeric: true, wide: true,
              options: teachers.map((m) => ({
                value: String(m.user_id), label: m.user?.name ?? 'User ' + m.user_id,
              })) },
            { name: 'batch_id', label: 'Batch', type: 'select', numeric: true,
              options: (batches ?? []).map((b) => ({ value: String(b.id), label: b.name })),
              help: 'Optional. Leave blank when the whole cohort is taught together.' },
            { name: 'kind', label: 'Role', type: 'select', fallback: 'lead',
              options: ['lead', 'assistant', 'lab']
                .map((k) => ({ value: k, label: KIND_LABEL[k] ?? k })) },
            { name: 'hours_per_week', label: 'Hours per week', type: 'number',
              min: 0, max: 60, fallback: 3,
              help: 'What the workload figures add up.' },
          ]}
        />
      ) : undefined}
    >
      {semesters.length === 0 ? (
        <Empty icon="calendar">
          A term has to exist before anyone can be allocated to it.{' '}
          <Link href="/onyx/programs" className="font-medium text-brand-700 underline">
            Add a semester
          </Link>
        </Empty>
      ) : (
        <>
          {/* Nobody allocated is the one thing on this page that is a fault
              rather than a reading, so it is stated before the numbers and
              names the people it is about. */}
          {unallocated.length > 0 ? (
            <div className="mb-4">
              <Banner tone="warn" icon="alert">
                <strong className="font-bold">
                  {unallocated.length} teaching {unallocated.length === 1 ? 'member' : 'members'}
                  {' '}of staff {unallocated.length === 1 ? 'has' : 'have'} no allocation in
                  {' '}{chosen!.name}.
                </strong>{' '}
                {unallocated.slice(0, 4).map((t) => t.user?.name ?? 'User ' + t.user_id).join(', ')}
                {unallocated.length > 4 ? ' and ' + (unallocated.length - 4) + ' more' : ''}
                {' '}are teaching nothing this term.
              </Banner>
            </div>
          ) : null}

          <div className="mb-5">
            <SemesterPicker
              semesters={semesters.map((s) => ({ id: s.id, name: s.name }))}
              selected={chosen!.id}
            />
          </div>

          <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatTile label="Allocations" value={allocations?.length ?? 0}
              note={'in ' + chosen!.name} />
            <StatTile label="Hours allocated" value={totalHours} note="per week, all staff" />
            <StatTile label="Median load" value={median + ' h'}
              note={'against a ' + LIGHT_HOURS + '–' + GUIDE_HOURS + ' h guide'} />
            <StatTile label="Nobody allocated" value={unallocated.length}
              note="faculty with no teaching this term" />
          </div>

          {/* The distribution before the roll call: a head of department wants
              the shape of the problem before reading eighty-six names, and
              "seven over, four with nothing" is the shape. */}
          <SectionHead title="Load distribution" />
          <Card className="mb-7 p-4">
            <StackBar parts={[
              { value: over.length, className: 'bg-red-600' },
              { value: onTarget.length, className: 'bg-green-600' },
              { value: light.length, className: 'bg-brand-400' },
              { value: unallocated.length, className: 'bg-slate-300' },
            ]} />
            <Buckets rows={[
              { label: 'Over the guide — more than ' + GUIDE_HOURS + ' h',
                dotClass: 'bg-red-600',
                count: over.length + (over.length === 1 ? ' person' : ' people'),
                amount: share(over.length) + '%' },
              { label: 'On target — ' + LIGHT_HOURS + ' to ' + GUIDE_HOURS + ' h',
                dotClass: 'bg-green-600',
                count: onTarget.length + (onTarget.length === 1 ? ' person' : ' people'),
                amount: share(onTarget.length) + '%' },
              { label: 'Light — under ' + LIGHT_HOURS + ' h',
                dotClass: 'bg-brand-400',
                count: light.length + (light.length === 1 ? ' person' : ' people'),
                amount: share(light.length) + '%' },
              { label: 'No allocation at all',
                dotClass: 'bg-slate-300',
                count: unallocated.length + (unallocated.length === 1 ? ' person' : ' people'),
                amount: share(unallocated.length) + '%' },
            ]} />
          </Card>

          <SectionHead title="Teaching load" />
          {/* tabIndex makes the horizontal scroll reachable by keyboard: a
              region that only scrolls with a wheel or a trackpad swipe strands
              anyone on a keyboard at whatever columns happen to fit. */}
          <div className="mb-7 min-w-0" tabIndex={0} role="region"
            aria-label={'Teaching load per person for ' + chosen!.name}>
            <DataTable
              caption={'Teaching load per person for ' + chosen!.name}
              head={
                <>
                  <th scope="col">Who</th>
                  <th scope="col" className="text-right">Courses</th>
                  <th scope="col" className="text-right">Hours a week</th>
                  <th scope="col">Against a {GUIDE_HOURS} h guide</th>
                </>
              }
            >
              {load.map((r) => {
                const v = verdict(r.hours);
                return (
                  <tr key={r.key} className={r.hours === 0 ? 'text-muted' : undefined}>
                    <td className="font-semibold">{r.name}</td>
                    <td className="text-right tabular-nums">{r.courses}</td>
                    <td className="text-right font-bold tabular-nums">{r.hours}</td>
                    <td className="min-w-[190px]">
                      <Meter percent={(r.hours / GUIDE_HOURS) * 100}
                        label={r.name + ' is carrying ' + r.hours + ' hours a week'} />
                      <span className="mt-1.5 inline-block">
                        <Pill tone={v.tone}>{v.text}</Pill>
                      </span>
                    </td>
                  </tr>
                );
              })}
              {load.length === 0 ? (
                <EmptyRow colSpan={4} icon="users">
                  Nobody at this institution holds a teaching role yet.
                </EmptyRow>
              ) : null}
            </DataTable>
          </div>

          <SectionHead title="Allocations" />
          <div className="min-w-0" tabIndex={0} role="region"
            aria-label={'Every allocation in ' + chosen!.name}>
            <DataTable
              caption={'Every allocation in ' + chosen!.name}
              head={
                <>
                  <th scope="col">Course</th>
                  <th scope="col">Who teaches it</th>
                  <th scope="col">Role</th>
                  <th scope="col">Batch</th>
                  <th scope="col" className="text-right">Hours</th>
                </>
              }
            >
              {(allocations ?? []).map((a) => {
                const course = courseById.get(a.course_id);
                return (
                  <tr key={a.id}>
                    <td>
                      {course ? (
                        <Link href={'/onyx/courses/' + a.course_id}
                          className="font-semibold text-brand-700 hover:underline">
                          <span className="font-mono text-[12.5px]">{course.code}</span>
                          {' — '}{course.title}
                        </Link>
                      ) : ('Course ' + a.course_id)}
                    </td>
                    <td>{names.get(a.user_id)?.name ?? 'User ' + a.user_id}</td>
                    <td>
                      <Pill tone={a.kind === 'lead' ? 'brand' : 'neutral'}>
                        {KIND_LABEL[a.kind] ?? a.kind}
                      </Pill>
                    </td>
                    <td className="text-muted">
                      {a.batch_id
                        ? (batchById.get(a.batch_id)?.name ?? 'Batch ' + a.batch_id)
                        : 'All'}
                    </td>
                    <td className="text-right tabular-nums">{a.hours_per_week}</td>
                  </tr>
                );
              })}
              {(allocations ?? []).length === 0 ? (
                <EmptyRow colSpan={5} icon="calendar">
                  Nothing has been allocated for {chosen!.name} yet.
                </EmptyRow>
              ) : null}
            </DataTable>
          </div>
        </>
      )}
    </OnyxShell>
  );
}
