import Link from 'next/link';
import type { Metadata } from 'next';
import { Byline } from '@/components/onyx-byline';
import { OnyxShell } from '@/components/onyx-shell';
import { ResourceLink } from '@/components/onyx-player';
import { OnyxAskForm } from '@/components/onyx-engage';
import { navFor } from '@/lib/onyx-nav';
import { requireOnyxSession, onyxApi, onyxApiSafe, type Me, onyxApiRecord } from '@/lib/onyx-session';
import {
  formatDuration, isStaff,
  type Assignment, type AttendanceSession, type Outline, type Resource,
} from '@/lib/onyx-learn';
import { WEEKDAYS, hhmm, type Discussion, type TimetableSlot } from '@/lib/onyx-campus';
import { CreatePanel, ActionButton } from '@/components/onyx-create';
import { LessonComposer } from '@/components/onyx-lesson-composer';
import {
  CourseFacultyManager, CourseRosterManager, CourseSettingsForm, DeleteCourseButton,
  ModuleActions, LessonRemove,
} from '@/components/onyx-manage';
import {
  BackLink, Banner, Card, Empty, Hero, Icon, ListRow, Meter, Pill, RowList, SectionHead, relativeDue, type IconName,
} from '@/components/onyx-ui';
import { ShareLink } from '@/components/onyx-share';
import { ConfirmPayment } from '@/components/onyx-pay-return';
import { BuyCourseButton } from '@/components/onyx-buy';

export const metadata: Metadata = { title: 'Course' };

/**
 * LRN-02a -- one course, end to end.
 *
 * The whole "so every learner always knows what to do next" claim rests on this
 * page: the outline, what is due, and when the next session is, together rather
 * than in three places.
 */
export default async function OnyxCoursePage(
  { params, searchParams }: {
    params: Promise<{ id: string }>;
    // Where a gateway sends a course buyer back to. A provider that redirects
    // rather than opening a widget lands here, and without this the payment
    // was made and nothing on our side ever asked the provider whether it had
    // been -- the enrolment would wait for a webhook that some providers never
    // send at all.
    searchParams?: Promise<{ ref?: string; cancelled?: string }>;
  },
) {
  await requireOnyxSession();
  const { id } = await params;
  const { ref: paymentRef, cancelled } = (await searchParams) ?? {};

  const [me, outline, members, purchases, gateways] = await Promise.all([
    onyxApi<Me>('/api/onyx/me'),
    onyxApiRecord<Outline>('/api/onyx/courses/' + id + '/outline'),
    onyxApiSafe<{ user: { id: string; name: string; email: string } | null; role: string }[]>(
      '/api/onyx/members'),
    /*
     * What this learner owns, and how the institution takes money.
     *
     * The catalogue has asked both of these since locked courses landed. This
     * page had not, and offered every unenrolled learner the same "Join this
     * course" button -- on a locked course too, because buying IS the
     * enrolment and so `self_enroll` is 1 on one. A learner who followed a
     * link straight to a paid course saw a free-looking button, pressed it,
     * and got a 402 with no price anywhere on the screen. The catalogue got
     * this right and the course's own page, which is where a shared link
     * lands, did not.
     *
     * Both are read safely: no gateway configured means the mock, which is
     * what a deployment without a merchant account has always used.
     */
    onyxApiSafe<number[]>('/api/onyx/my/purchases'),
    onyxApiSafe<{ identifier: string; title?: string | null }[]>('/api/onyx/gateways'),
  ]);
  const owned = (purchases ?? []).map(Number).includes(Number(id));
  const gateway = gateways?.[0]?.identifier ?? null;
  const teachers = (members ?? []).filter((m) => m.role === 'faculty' || m.role === 'admin');
  const students = (members ?? []).filter((m) => m.role === 'student');
  const nameOf = new Map((members ?? []).map((m) => [m.user?.id, m.user?.name ?? 'Unknown']));
  const emailOf = new Map((members ?? []).map((m) => [m.user?.id, m.user?.email ?? '']));

  // Who teaches this course, and its roster -- both gated the same way the
  // API gates them (assertCanTeach): an admin always gets these, faculty
  // only for a course they actually teach. A 403 comes back as null, which
  // is also how "hide the section for a faculty member who doesn't teach
  // this course" falls out, with no separate check needed here.
  const [courseFaculty, roster] = isStaff(me.role)
    ? await Promise.all([
      onyxApiSafe<{ user_id: string }[]>('/api/onyx/courses/' + id + '/faculty'),
      onyxApiSafe<{ user_id: string }[]>('/api/onyx/courses/' + id + '/roster'),
    ])
    : [null, null];

  // A learner who is not enrolled sees the catalog view: the shape of the
  // course, and nothing that belongs to the people taking it.
  const visible = outline.enrolled || isStaff(me.role);
  const [assignments, sessions, resources, discussions, timings] = visible
    ? await Promise.all([
      onyxApiSafe<Assignment[]>('/api/onyx/courses/' + id + '/assignments'),
      onyxApiSafe<AttendanceSession[]>('/api/onyx/courses/' + id + '/attendance'),
      onyxApiSafe<Resource[]>('/api/onyx/courses/' + id + '/resources'),
      onyxApiSafe<Discussion[]>('/api/onyx/courses/' + id + '/discussions'),
      // When this course actually meets. It lived only on the institution-wide
      // timetable, so the answer to "when is this class" was on a different
      // page from the class -- and a learner on five courses had to read the
      // whole week to find the three lines that were theirs.
      onyxApiSafe<TimetableSlot[]>('/api/onyx/timetable?course_id=' + id),
    ])
    : [null, null, null, null, null];

  const meets = [...(timings ?? [])]
    .sort((a, b) => a.day_of_week - b.day_of_week
      || a.starts_at.localeCompare(b.starts_at));

  // Every published assignment, not only the ones with a deadline -- this
  // used to filter on `a.due_at` too, so an assignment created with no due
  // date (due_at is optional both in the form and in AssignmentsService)
  // was published, gradable, submittable by a direct link... and never
  // listed anywhere a learner would find it. relativeDue(null) already
  // renders "No due date", so undated ones just sort last instead of
  // vanishing.
  // Staff only: a learner has no use for work that has not been set, and the
  // API does not send them drafts in the first place.
  const drafts = (assignments ?? []).filter((a) => a.status !== 'published');
  const due = (assignments ?? [])
    .filter((a) => a.status === 'published')
    .sort((a, b) => {
      if (!a.due_at && !b.due_at) return 0;
      if (!a.due_at) return 1;
      if (!b.due_at) return -1;
      return Date.parse(a.due_at) - Date.parse(b.due_at);
    });

  // The next thing to do: the first lesson that is neither finished nor locked,
  // in the order the course is taught. This is what the hero's button points
  // at, and it is the difference between "continue" and knowing what continuing
  // means before you click it.
  const lessons = outline.modules.flatMap((m) => m.lessons);
  const next = lessons.find((l) => !l.completed_at && !l.locked) ?? null;
  const finished = lessons.length > 0 && lessons.every((l) => l.completed_at);
  // Which module the next lesson sits in, so the band can say where it is as
  // well as what it is called.
  const nextModule = next
    ? outline.modules.find((m) => m.lessons.some((l) => l.id === next.id)) ?? null
    : null;

  /** Which icon a lesson gets. A row of identical dots tells a learner nothing. */
  const lessonIcon = (type: string): IconName =>
    type === 'video' ? 'play' : type === 'link' ? 'chevron' : 'book';

  /** The word under the title. "reading" is what a learner is deciding between. */
  const lessonKind = (type: string) =>
    type === 'video' ? null : type === 'document' ? 'document'
      : type === 'link' ? 'link' : 'reading';

  return (
    <OnyxShell
      me={me}
      nav={navFor(me.role)}
      title={outline.course.title}
      subtitle={outline.course.code + (outline.course.credits ? ' · ' + outline.course.credits + ' credits' : '')}
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <BackLink href="/onyx/courses" label="All courses" />
        <ShareLink label="Copy public link" path={'/onyx/c/' + outline.course.id} />
      </div>

      {/* What the query string says happened is not evidence. The banner
          reports where the buyer has been; the provider is asked what is
          true, and the enrolment below is what answers it. */}
      {paymentRef ? <ConfirmPayment reference={paymentRef} /> : null}
      {!paymentRef && cancelled ? (
        <div className="mb-4">
          <Banner tone="info" icon="x">
            That payment was cancelled. Nothing has been charged, and the course is still
            here when you want it.
          </Banner>
        </div>
      ) : null}
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_280px] lg:items-start">
        <div className="min-w-0 space-y-6">
          {outline.enrolled ? (
            /* The band a learner came here for. Progress alone tells you where
               you are and not what to do; the point of a course page is the
               next lesson, so that is the button -- and it names the lesson
               rather than saying "continue" and making you find out. */
            <Hero
              eyebrow={finished ? 'Course complete' : next ? 'Up next' : 'Nothing to do yet'}
              title={finished
                ? 'You have finished every lesson.'
                : next?.title ?? 'No lessons have been published on this course.'}
              sub={next
                ? [nextModule?.title, formatDuration(next.duration_seconds)]
                  .filter(Boolean).join(' — ') || undefined
                : undefined}
              actions={next ? (
                <Link
                  href={'/onyx/courses/' + id + '/lessons/' + next.id}
                  className="inline-flex min-h-[44px] shrink-0 items-center gap-2 rounded-2xl
                             bg-white px-4 text-[14.5px] font-bold text-brand-700
                             hover:bg-brand-50 focus-visible:outline-white"
                >
                  <Icon name="play" className="h-4 w-4" />
                  {outline.progress.completed > 0 ? 'Resume' : 'Start'}
                </Link>
              ) : undefined}
            >
              {outline.progress.total > 0 ? (
                <>
                  <Meter percent={outline.progress.percent} tone="light"
                    label={outline.course.title + ' progress'} />
                  <div className="mt-2 flex flex-wrap items-baseline justify-between gap-x-3
                                  text-[13px]">
                    <span className="font-bold tabular-nums">
                      {outline.progress.percent}% complete
                    </span>
                    <span className="tabular-nums text-white/80">
                      {outline.progress.completed} of {outline.progress.total} lessons
                    </span>
                  </div>
                </>
              ) : null}
            </Hero>
          ) : (
            <Banner tone="info" icon="lock"
              /* The same three doors the catalogue offers, because this is the
                 page a shared link lands on: buy it, join it, or be told the
                 programme office handles it. */
              action={me.role !== 'student' ? undefined
                : outline.course.access === 'locked' && !owned ? (
                  <BuyCourseButton courseId={Number(id)} title={outline.course.title}
                    price={Number(outline.course.price_minor ?? 0)}
                    currency={String(outline.course.currency ?? 'INR')}
                    gateway={gateway} compact />
                ) : outline.course.self_enroll || outline.course.access === 'open' || owned ? (
                  <ActionButton endpoint={'courses/' + id + '/enroll'}
                    label={owned ? 'Start — you own this' : 'Join this course'} />
                ) : undefined}
            >
              {outline.course.access === 'locked' && !owned
                ? 'This course is bought rather than joined. Preview lessons are open; '
                  + 'the rest opens as soon as it is paid for.'
                : 'You are not enrolled in this course. Preview lessons are open; '
                  + 'the rest is not.'}
            </Banner>
          )}

          {/* Modules numbered, because a course IS an order -- "02" tells a
              learner where they are in a way a bare title does not. Each lesson
              carries its own state: a check when it is done, the next one
              marked, a lock where it is not open yet. */}
          {outline.modules.map((m, mi) => (
            <section key={m.id}>
              <div className="mb-2.5 flex items-baseline gap-2.5">
                <span className="font-mono text-[13px] font-bold tabular-nums text-accent-700">
                  {String(mi + 1).padStart(2, '0')}
                </span>
                <h2 className="text-[15px] font-bold">{m.title}</h2>
                <span className="ml-auto text-[12.5px] tabular-nums text-muted">
                  {m.lessons.length} {m.lessons.length === 1 ? 'lesson' : 'lessons'}
                </span>
                {/* Renaming and removing, which only the platform console
                    could do. A course's own staff could add a module and then
                    never touch it -- authoring is not half a power. */}
                {isStaff(me.role) ? <ModuleActions module={m} /> : null}
              </div>
              {m.summary ? (
                <p className="-mt-1 mb-2.5 text-[13px] text-muted">{m.summary}</p>
              ) : null}

              {/*
                * Who added the week, for staff only.
                *
                * A learner reading an outline is reading the course, not its
                * edit history, and a byline on every week would be noise in
                * the one place that has to stay legible. Staff are the ones
                * who ask -- "did we put this week in, or did the platform" is
                * a real question, and until 0042 nothing could answer it.
                */}
              {isStaff(me.role) ? (
                <p className="-mt-1 mb-2.5">
                  <Byline author={m.author} verb="Added by" />
                </p>
              ) : null}

              {isStaff(me.role) ? (
                <div className="mb-2.5">
                  {/* Not a CreatePanel: a lesson can be a file, and CreatePanel
                      posts JSON. See onyx-lesson-composer.tsx -- it offers all
                      five kinds the API takes: text, video, document (PDF,
                      slides, word-processor files), image and link. */}
                  <LessonComposer
                    courseId={Number(id)}
                    moduleId={Number(m.id)}
                    moduleTitle={m.title}
                  />
                </div>
              ) : null}

              <RowList label={m.title + ' lessons'}>
                {m.lessons.map((l) => {
                  const isNext = next?.id === l.id;
                  const kind = lessonKind(l.type);
                  return (
                    <li key={l.id}
                      className={'flex items-center gap-3 px-4 py-3 '
                        + (isNext ? 'bg-brand-50/70' : 'hover:bg-brand-50/40')}>
                      {/* The state is carried by the icon AND the pill on the
                          right, never by a colour on its own. The one lesson
                          the page is arranged around is the only solid mark. */}
                      <span className={'grid h-9 w-9 shrink-0 place-items-center rounded-xl '
                        + (l.completed_at ? 'bg-green-50 text-green-700'
                          : l.locked ? 'bg-slate-100 text-muted'
                            : isNext ? 'bg-brand-600 text-white'
                              : 'bg-brand-50 text-brand-700')}>
                        <Icon
                          name={l.completed_at ? 'check' : l.locked ? 'lock' : lessonIcon(l.type)}
                          className="h-[17px] w-[17px]" />
                      </span>

                      <span className="min-w-0 flex-1">
                        {l.locked ? (
                          <span className="text-[14.5px] text-muted">{l.title}</span>
                        ) : (
                          <Link href={'/onyx/courses/' + id + '/lessons/' + l.id}
                            className="text-[14.5px] font-semibold hover:underline">
                            {l.title}
                          </Link>
                        )}
                        <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[12.5px]
                                         text-muted">
                          {l.duration_seconds ? (
                            <span className="tabular-nums">{formatDuration(l.duration_seconds)}</span>
                          ) : null}
                          {kind ? <span>· {kind}</span> : null}
                          {l.is_preview ? <span>· free preview</span> : null}
                        </span>
                      </span>

                      {isNext ? <Pill tone="brand">Next</Pill> : null}
                      {l.completed_at ? <Pill tone="good">Done</Pill> : null}
                      {l.locked ? <Pill tone="neutral">Locked</Pill> : null}
                      {/* Taking one down, which only the console could do. The
                          stored file is left alone: an upload is cheap to keep
                          and impossible to get back, so a lesson removed by
                          mistake is one somebody re-points at the same object
                          rather than re-records. */}
                      {isStaff(me.role) ? <LessonRemove lesson={l} /> : null}
                    </li>
                  );
                })}
                {m.lessons.length === 0 ? (
                  <li><Empty icon="layers">Nothing has been added to this module yet.</Empty></li>
                ) : null}
              </RowList>
            </section>
          ))}

          {outline.modules.length === 0 ? (
            <Card className="p-2">
              <Empty icon="book">
                This course has no content yet.
                {isStaff(me.role) ? ' Add a module below to start building it.' : ''}
              </Empty>
            </Card>
          ) : null}

          {/* LRN-02: content delivery starts with somebody being able to put
              content in. Modules and lessons had no authoring surface. */}
          {isStaff(me.role) ? (
            <div className="mt-4 space-y-3">
              <CreatePanel
                title="New module" cta="Add a module" icon="layers" compact
                endpoint={'courses/' + id + '/modules'}
                fields={[
                  { name: 'title', label: 'Module title', required: true,
                    placeholder: 'Core concepts' },
                  { name: 'summary', label: 'Summary', type: 'textarea', rows: 2 },
                ]}
              />
              {/*
                * The lesson composers used to live here, stacked at the bottom
                * of the page -- one per module, all of them below the outline,
                * so adding a lesson to week two meant scrolling past every
                * week to find the right panel. They now sit INSIDE the module
                * they add to, which is where the console has always put them
                * and where there is no question of which module a file is
                * going into.
                */}
            </div>
          ) : null}

          {visible ? (
            <section>
              <div className="mb-2.5 flex items-center justify-between gap-3">
                <h2 className="text-[11.5px] font-bold uppercase tracking-[.085em] text-muted">
                  Questions
                </h2>
                <OnyxAskForm courseId={Number(id)} />
              </div>
              {/* Resolved threads keep their tick, so the list doubles as the
                  answers people have already found. */}
              <RowList label="Questions on this course">
                {(discussions ?? []).map((d) => (
                  <ListRow
                    key={d.id}
                    icon={d.status === 'resolved' ? 'check' : 'help'}
                    tone={d.status === 'resolved' ? 'good' : 'neutral'}
                    title={d.title}
                    href={'/onyx/discussions/' + d.id}
                    meta={d.reply_count === 1 ? '1 reply' : d.reply_count + ' replies'}
                    trailing={d.status === 'resolved'
                      ? <Pill tone="good">Resolved</Pill>
                      : <Pill tone="soon">Open</Pill>}
                  />
                ))}
                {(discussions ?? []).length === 0 ? (
                  <li>
                    <Empty icon="help">
                      Nobody has asked anything yet. If you are stuck, asking here reaches
                      the people teaching this course.
                    </Empty>
                  </li>
                ) : null}
              </RowList>
            </section>
          ) : null}
        </div>

        <aside className="min-w-0 space-y-6">
          {/* Admin, or this specific course's own faculty -- the PATCH and
              /publish and /close routes all take that same boundary now
              (requireCourseManager), so a faculty member who created their
              own course, or was assigned to an existing one, can finish
              setting it up without an administrator. `roster !== null` is
              the same "do they actually teach this one" signal the roster
              section below already relies on: the fetch behind it 403s for
              a faculty member who does not teach this course, so the
              section simply is not there for them either. */}
          {/* When this course meets, on the page about this course.
              The timings existed only on the institution-wide grid, so a
              learner on five courses had to read the whole week to find the
              three lines that were theirs -- and anyone opening a course to
              ask "when is this" was on the wrong page to find out. Fixed
              weekly slots, so they read as a rule rather than as events. */}
          {meets.length ? (
            <section className="mb-4">
              <SectionHead title="When it meets" />
              <Card className="divide-y divide-line">
                {meets.map((slot) => (
                  <div key={slot.id} className="flex items-baseline justify-between gap-3 px-3.5 py-2.5">
                    <span className="text-[13px] font-bold">
                      {WEEKDAYS[slot.day_of_week - 1] ?? 'Day ' + slot.day_of_week}
                    </span>
                    <span className="text-[12.5px] tabular-nums text-muted">
                      {hhmm(slot.starts_at)}&ndash;{hhmm(slot.ends_at)}
                    </span>
                  </div>
                ))}
                <div className="px-3.5 py-2">
                  <Link href="/onyx/timetable"
                    className="text-[12.5px] font-semibold text-brand-700 underline">
                    See the whole week
                  </Link>
                </div>
              </Card>
            </section>
          ) : null}

          {me.role === 'admin' || (me.role === 'faculty' && roster !== null) ? (
            <section className="mb-4">
              <SectionHead title="Course details" />
              <CourseSettingsForm courseId={Number(id)} course={outline.course} />
            </section>
          ) : null}

          {/* CMP-01 names "faculty allocation" as part of the console. There
              was no way to put a teacher on a course, so a faculty member
              opening one was told "You do not teach this course" with nothing
              they or an administrator could do about it from the product.
              A course is run by one or two people, not a crowd -- capped and
              enforced server-side (AcademicsService.assignFaculty()); this
              is where an admin sees who that is and fixes it if it's wrong.
              Faculty who teach this course see the same list, read-only --
              knowing who else teaches with them, without being able to
              reassign it. */}
          {courseFaculty !== null ? (
            <section className="mb-4">
              <SectionHead title="Teaching" />
              <CourseFacultyManager
                courseId={Number(id)}
                current={courseFaculty.map((f) => ({
                  user_id: f.user_id, name: nameOf.get(f.user_id) ?? 'Unknown',
                }))}
                options={teachers
                  .filter((m) => m.user)
                  .map((m) => ({ id: m.user!.id, name: m.user!.name }))}
                canManage={me.role === 'admin'}
              />
            </section>
          ) : null}

          {/* Enrolling a student is an administrator's act, or this specific
              course's own faculty acting on their own roster -- the same
              boundary learn.routes.ts's requireCourseManager() enforces. A
              faculty member who doesn't teach this course never sees this
              section at all: the roster fetch above 403s for them, which is
              also the correct answer to "should they see who's enrolled". */}
          {roster !== null ? (
            <section className="mb-4">
              <SectionHead title={'Students · ' + roster.length} />
              <CourseRosterManager
                courseId={Number(id)}
                roster={roster.map((r) => ({
                  user_id: r.user_id, name: nameOf.get(r.user_id) ?? 'Unknown',
                  email: emailOf.get(r.user_id) ?? '',
                }))}
                options={students
                  .filter((m) => m.user)
                  .map((m) => ({ id: m.user!.id, name: m.user!.name }))}
                canManage={me.role === 'admin' || me.role === 'faculty'}
              />
            </section>
          ) : null}

          {/* LRN-04: "faculty must create assignments". They could not. */}
          {isStaff(me.role) ? (
            <section>
              <SectionHead title="Set work" />
              <CreatePanel
                title="New assignment" cta="Create an assignment" icon="edit" compact
                endpoint={'courses/' + id + '/assignments'}
                fields={[
                  { name: 'title', label: 'Title', required: true, wide: true,
                    placeholder: 'Number bases worksheet' },
                  { name: 'instructions', label: 'Instructions', type: 'textarea', rows: 4 },
                  { name: 'due_at', label: 'Due', type: 'datetime' },
                  { name: 'total_points', label: 'Marks', type: 'number', min: 1, max: 1000,
                    fallback: 100 },
                  { name: 'late_policy', label: 'If it is late', type: 'select',
                    fallback: 'accept',
                    options: [
                      { value: 'accept', label: 'Accept it' },
                      { value: 'penalty', label: 'Accept with a penalty' },
                      { value: 'reject', label: 'Refuse it' },
                    ] },
                  { name: 'late_penalty_percent', label: 'Penalty %', type: 'number',
                    min: 0, max: 100, fallback: 0 },
                  /*
                   * The choice that makes the rubric builder reachable.
                   *
                   * Setting work published it in the same click, so nothing on
                   * this page was ever a draft -- and the rubric builder opens
                   * only on a draft, because changing what the marks are for
                   * under work already handed in regrades it silently. The
                   * builder was finished, good, and behind a door into a room
                   * the product never let anybody stand in. In practice every
                   * assignment in the institution was marked out of one number.
                   *
                   * Setting it now stays the default, because it is the common
                   * case and it is what this panel already did.
                   */
                  { name: 'visibility', label: 'When it is set', type: 'select',
                    localOnly: true, fallback: 'now', wide: true,
                    options: [
                      { value: 'now', label: 'Set it now — learners see it straight away' },
                      { value: 'draft',
                        label: 'Save as a draft — add marking criteria first' },
                    ] },
                ]}
                thenPost="assignments/:id/publish"
                thenPostUnless={{ field: 'visibility', equals: 'draft' }}
              />
            </section>
          ) : null}

          {/*
            * Drafts, for the people who can act on them.
            *
            * A draft was invisible to everybody: the list below filters to
            * published, so an assignment saved as a draft -- or created as one
            * from the operator console -- existed in the database and appeared
            * on no screen a lecturer could reach. Nothing links here from
            * anywhere else, which is why setting one and never finding it
            * again was the normal outcome.
            */}
          {isStaff(me.role) && drafts.length ? (
            <section>
              <SectionHead title="Drafts" />
              <RowList label="Assignments not yet set">
                {drafts.map((a) => (
                  <ListRow
                    key={a.id}
                    title={a.title}
                    href={'/onyx/assignments/' + a.id}
                    meta={<Pill tone="soon">Not set yet</Pill>}
                  />
                ))}
              </RowList>
              <p className="mt-2 max-w-[62ch] text-[12.5px] leading-relaxed text-muted">
                Open one to say how its marks are earned, then set it. Marking criteria
                are fixed once an assignment is set, so that work already handed in is
                never re-marked against different rules.
              </p>
            </section>
          ) : null}

          {due.length ? (
            <section>
              <SectionHead title="Assignments" />
              <RowList label="Assignments set on this course">
                {due.map((a) => {
                  const when = relativeDue(a.due_at);
                  return (
                    <ListRow
                      key={a.id}
                      title={a.title}
                      href={'/onyx/assignments/' + a.id}
                      // Relative, not a locale timestamp. What a learner scans
                      // a due list for is what is urgent, and
                      // "8/17/2026, 12:00:00 AM" makes that a calculation.
                      meta={<Pill tone={when.tone}>{when.text}</Pill>}
                    />
                  );
                })}
              </RowList>
            </section>
          ) : null}

          {/* LRN-03: "faculty must capture session attendance" -- the QR
              screen existed, but nothing could create the session it needs. */}
          {isStaff(me.role) ? (
            <section>
              <SectionHead title="Attendance" />
              <CreatePanel
                title="New session" cta="Open a session" icon="calendar" compact
                endpoint={'courses/' + id + '/attendance'}
                fields={[
                  { name: 'title', label: 'Session', required: true, wide: true,
                    placeholder: 'Lecture 4' },
                  { name: 'scheduled_at', label: 'When', type: 'datetime', required: true },
                  { name: 'duration_minutes', label: 'Minutes', type: 'number', min: 5,
                    max: 600, fallback: 60 },
                  { name: 'qr_window_seconds', label: 'Code rotates every (s)', type: 'number',
                    min: 10, max: 300, fallback: 15,
                    help: 'The check-in code changes on this cycle. A code is accepted for its own cycle and the next one, so a photograph of the screen is dead within two.' },
                ]}
              />
              {/* LRN-03c: the percentages and the export. Reachable from the
                  course rather than from a menu, because "who is short of
                  attendance" is a question about one course at a time. */}
              <Link
                href={'/onyx/courses/' + id + '/attendance'}
                className="mt-2 inline-flex min-h-[34px] items-center rounded-2xl border
                           border-line px-3 text-sm font-medium text-slate-700 hover:bg-brand-50"
              >
                Attendance report
              </Link>
            </section>
          ) : null}

          {sessions?.length ? (
            <section>
              <SectionHead title="Sessions" />
              {/* An open session is the one you can check in to right now, so
                  it is the only one wearing a green pill. */}
              <RowList label="Sessions on this course">
                {sessions.slice(0, 5).map((s) => (
                  <ListRow
                    key={s.id}
                    title={s.title}
                    href={'/onyx/courses/' + id + '/attendance/' + s.id}
                    // A day and a time, not "11/8/2026, 12:11:13 am". Seconds
                    // have never told anybody when a lecture is.
                    meta={new Date(s.scheduled_at).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'short', day: 'numeric', month: 'short',
                      hour: '2-digit', minute: '2-digit',
                    })}
                    trailing={s.status === 'open'
                      ? <Pill tone="good">Open</Pill>
                      : <Pill tone="neutral">Closed</Pill>}
                  />
                ))}
              </RowList>
            </section>
          ) : null}

          {resources?.length ? (
            <section>
              <SectionHead title="Resources" />
              <Card className="p-4">
                <ul className="space-y-2 text-sm">
                  {resources.map((r) => (
                    <li key={r.id} className="flex min-w-0 items-center gap-2">
                      <span className="shrink-0 text-brand-600">
                        <Icon name="file" className="h-4 w-4" />
                      </span>
                      <ResourceLink resource={r} />
                    </li>
                  ))}
                </ul>
                <p className="mt-3 border-t border-line pt-3 text-xs text-muted">
                  Download links are issued when you click and expire in five minutes.
                </p>
              </Card>
            </section>
          ) : null}

          {/* Down here, not next to "Edit course details" above, same
              reasoning as the exam page's own Danger zone: read past what
              the course actually is before reaching the one control that
              removes it outright. Same boundary as "Course details" above
              -- admin, or this course's own faculty. */}
          {me.role === 'admin' || (me.role === 'faculty' && roster !== null) ? (
            <section>
              <SectionHead title="Danger zone" />
              <Card className="border-red-200 p-4">
                <p className="text-[13px] text-muted">
                  Removes this course and everything on it — modules, lessons, enrolments,
                  assignments, attendance and exams. A bank, assessment or certificate that
                  drew on it survives, unlinked from any one course.
                </p>
                <div className="mt-3 border-t border-red-100 pt-3">
                  <DeleteCourseButton courseId={Number(id)} />
                </div>
              </Card>
            </section>
          ) : null}
        </aside>
      </div>
    </OnyxShell>
  );
}
