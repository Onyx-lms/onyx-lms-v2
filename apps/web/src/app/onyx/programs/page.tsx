import type { Metadata } from 'next';
import { OnyxShell } from '@/components/onyx-shell';
import { navFor } from '@/lib/onyx-nav';
import { requireOnyxPageRole, onyxApi, type Me } from '@/lib/onyx-session';
import type { Batch, Program, Semester } from '@/lib/onyx-learn';
import { CreatePanel } from '@/components/onyx-create';
import {
  Card, Empty, Icon, Meter, Pill, SectionHead, StatTile, State,
} from '@/components/onyx-ui';

export const metadata: Metadata = { title: 'Programmes' };

/**
 * The chip a semester or a batch is listed as.
 *
 * A programme is not one value to compare down a column, so this screen is
 * cards rather than a table -- and inside a card a cohort is a thing you scan,
 * not a row. Neutral by default: nothing here is a state, so nothing here
 * should be carrying a state's colour.
 */
function Chip({ children, count }: { children: React.ReactNode; count?: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-slate-100
                     px-2.5 py-1 text-[12.5px] font-semibold text-slate-700">
      {children}
      {count !== undefined && count !== null
        ? <span className="tabular-nums text-muted">{count}</span> : null}
    </span>
  );
}

/** "from 5 Jan 2026" reads; "2026-01-05" is a thing you decode. */
const on = (iso: string | null) => (iso
  ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
  : null);

/**
 * LRN-01a -- the academic structure.
 *
 * Read-only here: creating programmes, semesters and batches is done through
 * the API, and putting a builder on this page before O07 (Campus operations
 * defines the timetable model) would mean rebuilding it then.
 */
export default async function OnyxProgramsPage() {
  await requireOnyxPageRole('admin', 'faculty');
  const [me, programs, semesters, batches] = await Promise.all([
    onyxApi<Me>('/api/onyx/me'),
    onyxApi<Program[]>('/api/onyx/programs'),
    onyxApi<Semester[]>('/api/onyx/semesters'),
    onyxApi<Batch[]>('/api/onyx/batches'),
  ]);

  // `status` is the only lifecycle the API carries for a programme: anything
  // else on this page ("places filled", "admissions close") would be invented.
  const live = programs.filter((p) => p.status).length;
  const drafts = programs.length - live;

  return (
    <OnyxShell
      me={me}
      nav={navFor(me.role)}
      title="Programmes"
      subtitle="What this institution teaches, and the cohorts taking it."
    >
      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Programmes" value={programs.length}
          note={live + ' live · ' + drafts + ' draft'} />
        <StatTile label="Semesters" value={semesters.length} note="defined across all programmes" />
        <StatTile label="Batches" value={batches.length} note="cohorts on the books" />
        <StatTile label="Not yet live" value={drafts}
          note={drafts === 0 ? 'everything is published' : 'still invisible to learners'} />
      </div>

      {/* CMP-01: "manage programs, batches, timetables and faculty
          allocation from a central console". The console listed them and
          could create none of them. */}
      <SectionHead title="Add to the structure" />
      <div className="mb-7 grid gap-3 lg:grid-cols-3">
        <CreatePanel
          title="New programme" cta="Add a programme" icon="building" compact
          endpoint="programs"
          fields={[
            { name: 'name', label: 'Programme', required: true, wide: true,
              placeholder: 'Computer Science' },
            { name: 'code', label: 'Code', required: true, placeholder: 'CS' },
            { name: 'duration_semesters', label: 'Semesters', type: 'number', min: 1,
              max: 20, fallback: 6 },
            { name: 'description', label: 'Description', type: 'textarea', rows: 2 },
          ]}
        />
        <CreatePanel
          title="New semester" cta="Add a semester" icon="calendar" compact
          rules={[{ kind: 'before', field: 'starts_on', than: 'ends_on',
            message: 'That semester ends before it starts.' }]}
          endpoint="semesters"
          fields={[
            { name: 'program_id', label: 'Programme', type: 'select', required: true, numeric: true,
              options: programs.map((p) => ({ value: String(p.id), label: p.name })) },
            { name: 'name', label: 'Name', required: true, placeholder: 'Term 1 2026' },
            { name: 'number', label: 'Number', type: 'number', min: 1, max: 20, fallback: 1 },
            { name: 'starts_on', label: 'Starts', type: 'date' },
            { name: 'ends_on', label: 'Ends', type: 'date' },
          ]}
        />
        <CreatePanel
          title="New batch" cta="Add a batch" icon="users" compact
          endpoint="batches"
          fields={[
            { name: 'program_id', label: 'Programme', type: 'select', required: true, numeric: true,
              options: programs.map((p) => ({ value: String(p.id), label: p.name })) },
            { name: 'name', label: 'Batch', required: true, placeholder: 'Batch A 2026' },
            { name: 'code', label: 'Code', required: true, placeholder: 'BA26' },
            { name: 'year', label: 'Year', type: 'number', min: 1900, max: 2200 },
          ]}
        />
      </div>

      <SectionHead title="Programmes" />
      {programs.length === 0 ? (
        <Card>
          <Empty icon="building">
            A programme needs a name, a code and how many semesters it runs for. Semesters and
            batches can follow once it exists.
          </Empty>
        </Card>
      ) : (
        <ul className="space-y-4">
          {programs.map((p) => {
            const theirs = [...semesters.filter((s) => s.program_id === p.id)]
              .sort((a, b) => a.number - b.number);
            const cohorts = batches.filter((b) => b.program_id === p.id);
            // The one honest progress figure on this page: how much of the
            // declared shape has actually been built. "Places filled" needs an
            // enrolment cap, and the API does not carry one.
            const built = p.duration_semesters
              ? Math.min(100, (theirs.length / p.duration_semesters) * 100)
              : 0;

            return (
              <Card as="li" key={p.id} className="overflow-hidden">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line
                                bg-slate-50/70 px-4 py-3">
                  <h3 className="min-w-0 truncate text-[15.5px] font-bold">{p.name}</h3>
                  <Pill tone={p.status ? 'brand' : 'neutral'}>{p.code}</Pill>
                  <span className="ml-auto">
                    {p.status
                      ? <State tone="on">Live</State>
                      : <State tone="idle">Draft</State>}
                  </span>
                </div>

                <div className="p-4">
                  {p.description ? (
                    <p className="text-[13.5px] text-muted">{p.description}</p>
                  ) : null}

                  <div className="mt-3 grid min-w-0 gap-5 sm:grid-cols-2">
                    <div className="min-w-0">
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="text-[13px] font-bold">Calendar built</span>
                        <span className="text-[13px] tabular-nums text-muted">
                          {theirs.length} of {p.duration_semesters} semester
                          {p.duration_semesters === 1 ? '' : 's'}
                        </span>
                      </div>
                      <div className="mt-1.5">
                        <Meter percent={built}
                          label={theirs.length + ' of ' + p.duration_semesters
                            + ' semesters defined for ' + p.name} />
                      </div>
                      <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1
                                      text-[12.5px] text-muted">
                        <span className="inline-flex items-center gap-1.5">
                          <Icon name="calendar" className="h-[15px] w-[15px]" />
                          {p.duration_semesters} semester{p.duration_semesters === 1 ? '' : 's'} long
                        </span>
                        <span className="inline-flex items-center gap-1.5">
                          <Icon name="users" className="h-[15px] w-[15px]" />
                          {cohorts.length === 0 ? 'no batches'
                            : cohorts.length + ' batch' + (cohorts.length === 1 ? '' : 'es')}
                        </span>
                      </div>

                      {/* A draft with nothing under it is the state that needs
                          a decision, so the card says what is missing rather
                          than leaving it to be worked out from two empty
                          lists. */}
                      {!p.status ? (
                        <ul className="mt-3 space-y-1 text-[12.5px] text-muted">
                          {[
                            { ok: theirs.length > 0, text: 'Semesters defined' },
                            { ok: cohorts.length > 0, text: 'At least one batch' },
                          ].map((c) => (
                            <li key={c.text} className="flex items-center gap-1.5">
                              <span className={c.ok ? 'text-green-700' : 'text-muted'}>
                                <Icon name={c.ok ? 'check' : 'x'} className="h-[14px] w-[14px]" />
                              </span>
                              {c.text}
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </div>

                    <div className="min-w-0">
                      <h4 className="text-[10.5px] font-bold uppercase tracking-[.08em] text-muted">
                        Semesters
                      </h4>
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {theirs.map((s) => (
                          <Chip key={s.id} count={on(s.starts_on) ?? undefined}>
                            {s.number}. {s.name}
                          </Chip>
                        ))}
                        {theirs.length === 0
                          ? <span className="text-[13px] text-muted">None defined.</span> : null}
                      </div>

                      <h4 className="mt-3 text-[10.5px] font-bold uppercase tracking-[.08em]
                                     text-muted">
                        Batches
                      </h4>
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {cohorts.map((b) => (
                          <Chip key={b.id} count={b.year ?? undefined}>{b.name}</Chip>
                        ))}
                        {cohorts.length === 0
                          ? <span className="text-[13px] text-muted">None yet.</span> : null}
                      </div>
                    </div>
                  </div>
                </div>
              </Card>
            );
          })}
        </ul>
      )}
    </OnyxShell>
  );
}
