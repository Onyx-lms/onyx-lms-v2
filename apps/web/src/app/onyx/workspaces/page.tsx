import Link from 'next/link';
import type { Metadata } from 'next';
import { OnyxShell } from '@/components/onyx-shell';
import {
  ActionLink, Card, CardGrid, Empty, Icon, Pill, SectionHead,
} from '@/components/onyx-ui';
import { OnyxNewWorkspace } from '@/components/onyx-workspace-new';
import { navFor } from '@/lib/onyx-nav';
import { requireOnyxSession, onyxApi, onyxApiSafe, type Me } from '@/lib/onyx-session';
import type { Course } from '@/lib/onyx-learn';
import type { Workspace } from '@/lib/onyx-codelab';

export const metadata: Metadata = { title: 'Workspaces' };

/**
 * A past date, said the way a person says it.
 *
 * `relativeDue` in the kit reads forwards -- "tomorrow", "2 days late" -- which
 * is the wrong tense for "when did I last touch this". Same principle, other
 * direction: what someone scans this list for is which project is still warm,
 * and `8/17/2026, 12:00:00 AM` makes that a calculation.
 */
function since(iso: string, now = Date.now()): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return 'Never opened';
  const mins = Math.round((now - t) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return mins + (mins === 1 ? ' minute ago' : ' minutes ago');
  const hours = Math.round(mins / 60);
  if (hours < 24) return hours + (hours === 1 ? ' hour ago' : ' hours ago');
  const days = Math.round(hours / 24);
  if (days === 1) return 'yesterday';
  if (days < 7) return days + ' days ago';
  const weeks = Math.round(days / 7);
  if (weeks === 1) return 'last week';
  if (weeks < 5) return weeks + ' weeks ago';
  const months = Math.round(days / 30);
  if (months < 12) return months === 1 ? 'a month ago' : months + ' months ago';
  return new Date(t).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric' });
}

/**
 * The filters the monitoring table understands.
 *
 * They apply to the STAFF table only, never to "your workspaces" above it: a
 * lecturer narrowing the institution's list to one learner did not also mean
 * to hide their own projects, and a filter that silently empties two lists is
 * a filter people stop trusting.
 */
interface Query {
  owner?: string; course?: string; language?: string; search?: string;
}

/** Only the filters that were actually set, so the URL stays readable. */
function monitorQuery(q: Query): URLSearchParams {
  const out = new URLSearchParams();
  if (q.owner?.trim()) out.set('user_id', q.owner.trim());
  // 'none' is a value, not a blank: "personal projects, on no course" is a
  // real thing to look for and has to survive the round trip.
  if (q.course?.trim()) out.set('course_id', q.course.trim());
  if (q.language?.trim()) out.set('language', q.language.trim());
  if (q.search?.trim()) out.set('search', q.search.trim());
  return out;
}

const control = 'mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm '
  + 'focus:border-brand-600 focus:outline-none';
const filterLabel = 'block text-[12px] font-semibold text-slate-700';

/** LAB-05 -- a learner's project workspaces. */
export default async function OnyxWorkspacesPage(
  { searchParams }: { searchParams: Promise<Query> },
) {
  await requireOnyxSession();
  const q = await searchParams;
  const [me, workspaces, courses] = await Promise.all([
    onyxApi<Me>('/api/onyx/me'),
    onyxApi<Workspace[]>('/api/onyx/workspaces'),
    onyxApi<Course[]>('/api/onyx/my/courses'),
  ]);

  // Neither an administrator nor faculty create workspaces here -- they
  // monitor whoever does. An admin's `/all` is every project at the
  // institution; a faculty member's is the same route narrowed server-side
  // to workspaces attached to a course they actually teach (see the route's
  // own comment) -- never the whole institution's. `/members` is
  // admin-and-faculty already; `?all=1` so a course only a faculty member's
  // own draft is still named correctly rather than falling back to an id.
  const staff = me.role === 'admin' || me.role === 'faculty';
  // The filters go to the server, not to a `.filter()` on the response: what
  // comes back is already scoped to what this person may see (an admin's whole
  // institution, a lecturer's own classes), and narrowing it there keeps that
  // boundary the one place it is decided.
  const monitor = monitorQuery(q);
  const [everyProject, members] = staff
    ? await Promise.all([
      onyxApiSafe<Workspace[]>(
        '/api/onyx/workspaces/all' + (monitor.size ? '?' + monitor : '')),
      onyxApiSafe<{ user_id: string; roll_number: string | null;
        user: { id: string; name: string; email: string } | null }[]>(
        '/api/onyx/members'),
    ])
    : [null, null];
  const filtering = monitor.size > 0;
  // Keyed as a string on both sides: an account id is a uuid (0014), and a
  // Map keyed by one type and read with another silently misses every row.
  const ownerOf = new Map((members ?? [])
    .filter((m) => m.user)
    .map((m) => [String(m.user!.id), m.user!]));
  const allCourses = staff
    ? await onyxApiSafe<Course[]>('/api/onyx/courses?all=1')
    : null;
  const courseByIdAll = new Map((allCourses ?? []).map((c) => [c.id, c]));

  const courseById = new Map(courses.map((c) => [c.id, c]));
  const attached = workspaces.filter((w) => w.course_id !== null).length;
  const languages = [...new Set(workspaces.map((w) => w.language).filter(Boolean))];
  // Newest first without mutating the response: a project you touched an hour
  // ago is the one you came back for.
  const recent = [...workspaces].sort(
    (a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at));

  return (
    <OnyxShell
      me={me}
      nav={navFor(me.role)}
      title="Workspaces"
      subtitle="Multi-file projects, with snapshots you can go back to."
    >
      <OnyxNewWorkspace courses={courses} />

      {workspaces.length ? (
        <div className="mt-6">
          <CardGrid min="12rem">
            <Stat label="Projects" value={workspaces.length}
              note={attached ? attached + ' attached to a course' : 'None on a course'} />
            <Stat label="Languages" value={languages.length}
              note={languages.join(', ')} />
            <Stat label="Last worked on" value={since(recent[0]!.updated_at)}
              note={recent[0]!.title} />
          </CardGrid>
        </div>
      ) : null}

      {/* A card grid rather than a row list: a project is recognised by its
          name and its language together, and the language is the thing being
          scanned for -- "where is my Python one" -- which a single-line row
          buries at the end of the line. */}
      <div className="mt-6">
        <SectionHead title={'Your workspaces · ' + workspaces.length} />

        {recent.length ? (
          <ul className="grid list-none gap-3.5"
            aria-label="Your workspaces"
            style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(min(17rem, 100%), 1fr))' }}>
            {recent.map((w) => {
              const course = w.course_id === null ? null : courseById.get(w.course_id);
              return (
                // The cards stretch to a common height in each row, so the
                // footer sits on the bottom rather than floating under
                // whichever card happened to have the shortest body.
                <Card key={w.id} as="li" className="flex min-w-0 flex-col">
                  <div className="min-w-0 flex-1 p-4">
                    <div className="flex items-start justify-between gap-2">
                      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl
                                       bg-brand-50 text-brand-700">
                        <Icon name="layers" className="h-[18px] w-[18px]" />
                      </span>
                      <Pill>{w.language}</Pill>
                    </div>

                    <h3 className="mt-3 text-[15.5px] font-bold">
                      <Link href={'/onyx/workspaces/' + w.id}
                        className="hover:underline">{w.title}</Link>
                    </h3>
                    <p className="mt-0.5 truncate text-[13px] text-muted">
                      {course
                        ? course.code + ' ' + course.title
                        : 'Personal project · no course'}
                    </p>

                    <dl className="mt-3 grid gap-2">
                      <div className="flex items-baseline justify-between gap-3">
                        <dt className="text-[12.5px] text-muted">Entry file</dt>
                        <dd className="min-w-0 truncate font-mono text-[13px] font-semibold">
                          {w.entry_path}
                        </dd>
                      </div>
                    </dl>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 border-t border-line
                                  px-4 py-3">
                    <span className="min-w-0 flex-1 text-[13px] text-muted">
                      Opened {since(w.updated_at)}
                    </span>
                    <ActionLink href={'/onyx/workspaces/' + w.id} label="Open" tone="quiet" />
                  </div>
                </Card>
              );
            })}
          </ul>
        ) : (
          <Card>
            <Empty icon="layers">
              No projects yet. Start one above and it keeps its own files and snapshots.
            </Empty>
          </Card>
        )}
      </div>

      {/* Neither an administrator nor faculty build here -- they oversee
          whoever does. Reachable because WorkspaceService lets admin open
          any project and faculty open one attached to a course they teach
          (view and comment only; the editor, run and delete stay
          owner-only regardless of role). */}
      {staff && everyProject !== null ? (
        <div className="mt-9">
          <SectionHead title={(me.role === 'admin'
            ? 'Every project at ' + me.tenant.name
            : 'Every project on your courses') + ' · ' + everyProject.length} />

          {/* A GET form, so a narrowed view is a URL somebody can send. The
              language menu is built from what came back rather than from a
              fixed list: once a filter is on, it lists what is in front of you,
              which is the honest set to widen from. */}
          <Card className="mb-4 p-4">
            <form method="GET" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="sm:col-span-2">
                <label className={filterLabel} htmlFor="w-search">Search</label>
                <input id="w-search" name="search" defaultValue={q.search ?? ''}
                  placeholder="Project name" className={control} />
              </div>
              <div>
                <label className={filterLabel} htmlFor="w-owner">Owner</label>
                <select id="w-owner" name="owner" defaultValue={q.owner ?? ''}
                  className={control}>
                  <option value="">Anyone</option>
                  {(members ?? []).filter((m) => m.user).map((m) => (
                    <option key={m.user_id} value={m.user_id}>
                      {m.roll_number ? m.roll_number + ' · ' : ''}{m.user!.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={filterLabel} htmlFor="w-course">Course</label>
                <select id="w-course" name="course" defaultValue={q.course ?? ''}
                  className={control}>
                  <option value="">Any course</option>
                  {/* Only offered to an administrator: for faculty this list is
                      course-attached work by definition, so "no course" is an
                      empty answer rather than a useful filter. */}
                  {me.role === 'admin'
                    ? <option value="none">Personal projects (no course)</option>
                    : null}
                  {(allCourses ?? []).map((c) => (
                    <option key={c.id} value={c.id}>{c.code} — {c.title}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className={filterLabel} htmlFor="w-language">Language</label>
                <select id="w-language" name="language" defaultValue={q.language ?? ''}
                  className={control}>
                  <option value="">Any language</option>
                  {[...new Set([
                    ...everyProject.map((w) => w.language),
                    ...(q.language ? [q.language] : []),
                  ].filter(Boolean))].sort().map((l) => (
                    <option key={l} value={l}>{l}</option>
                  ))}
                </select>
              </div>
              <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-4">
                <button type="submit"
                  className="rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-bold text-white
                             hover:bg-brand-700">
                  Show these
                </button>
                {filtering ? (
                  <Link href="/onyx/workspaces"
                    className="rounded-xl border border-line px-4 py-2.5 text-sm font-semibold
                               hover:bg-canvas">
                    Clear
                  </Link>
                ) : null}
              </div>
            </form>
          </Card>
          {everyProject.length === 0 ? (
            <Card>
              <Empty icon="layers">
                {filtering
                  ? 'No project matches those filters. Widen them or clear them.'
                  : me.role === 'admin'
                    ? 'Nobody has started a project yet.'
                    : 'No student has started a project on a course you teach yet.'}
              </Empty>
            </Card>
          ) : (
            <div tabIndex={0} role="region"
              aria-label={me.role === 'admin'
                ? 'Every project at this institution' : 'Every project on your courses'}
              className="relative min-w-0 max-w-full overflow-x-auto rounded-2xl border
                         border-line bg-white shadow-card">
              <table className="w-full text-sm">
                <caption className="sr-only">
                  {me.role === 'admin'
                    ? 'Every project workspace at this institution'
                    : 'Every project workspace on a course you teach'}
                </caption>
                <thead>
                  <tr className="border-b border-line bg-slate-50 text-left text-[11px]
                                 uppercase tracking-[.06em] text-muted [&>th]:whitespace-nowrap
                                 [&>th]:px-4 [&>th]:py-2.5 [&>th]:font-bold">
                    <th scope="col">Project</th>
                    <th scope="col">Owner</th>
                    <th scope="col">Course</th>
                    <th scope="col">Language</th>
                    <th scope="col">Last touched</th>
                    <th scope="col"><span className="sr-only">Open</span></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {[...everyProject]
                    .sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at))
                    .map((w) => {
                      const owner = ownerOf.get(String(w.user_id));
                      const course = w.course_id === null ? null : courseByIdAll.get(w.course_id);
                      return (
                        <tr key={w.id} className="hover:bg-brand-50/40">
                          <td className="px-4 py-3 font-semibold">{w.title}</td>
                          <td className="px-4 py-3">
                            {owner ? (
                              <>
                                <div>{owner.name}</div>
                                <div className="text-xs text-muted">{owner.email}</div>
                              </>
                            ) : 'Unknown'}
                          </td>
                          <td className="px-4 py-3 text-muted">
                            {course ? course.code + ' — ' + course.title : 'Personal project'}
                          </td>
                          <td className="px-4 py-3"><Pill>{w.language}</Pill></td>
                          <td className="px-4 py-3 text-muted">{since(w.updated_at)}</td>
                          <td className="px-4 py-3 text-right">
                            <ActionLink href={'/onyx/workspaces/' + w.id} label="Open" tone="quiet" />
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : null}
    </OnyxShell>
  );
}

/** A stat tile. Not `StatTile` from the kit: the value here is sometimes a
 *  phrase ("2 hours ago") rather than a numeral, so it is set smaller. */
function Stat({ label, value, note }: {
  label: string; value: string | number; note?: string;
}) {
  return (
    <Card className="p-3.5">
      <div className="text-[10.5px] font-bold uppercase tracking-[.08em] text-muted">{label}</div>
      <div className="mt-1.5 text-[19px] font-extrabold leading-tight tabular-nums">{value}</div>
      {note ? <div className="mt-1 truncate text-xs text-muted" title={note}>{note}</div> : null}
    </Card>
  );
}
