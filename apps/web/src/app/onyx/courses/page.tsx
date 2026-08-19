import Link from 'next/link';
import type { Metadata } from 'next';
import { OnyxShell } from '@/components/onyx-shell';
import { navFor } from '@/lib/onyx-nav';
import { requireOnyxSession, onyxApi, onyxApiSafe, type Me } from '@/lib/onyx-session';
import { BuyCourseButton } from '@/components/onyx-buy';
import { isStaff, type Course, type Outline, type Program } from '@/lib/onyx-learn';
import { CreatePanel, ActionButton } from '@/components/onyx-create';
import {
  Card, CardGrid, Empty, Icon, Meter, Pill, SectionHead,
} from '@/components/onyx-ui';

/**
 * Two questions, two sections, always both present: "which of these are
 * mine" and "what else is there". My courses is enrolled-in for a learner
 * and taught-by for staff -- never a subset of the other section, because
 * All courses is genuinely all of them, this person's own included. It used
 * to quietly drop whatever was already in My courses ("not repeated here"),
 * which reads fine for a learner's own two or three courses and reads as a
 * missing course the moment anyone goes looking for one they know exists.
 */

export const metadata: Metadata = { title: 'Courses' };

/**
 * LRN-01b -- the catalog, and what this person is enrolled in or teaches.
 *
 * "Where was I" is a learner resuming work, and it wants progress and one
 * button; for staff the equivalent is "which of these do I run", and wants
 * a headcount and a way in to manage it, not a progress bar on lessons they
 * are not the one taking. "What else is there" is the same browsing card
 * for everyone, staff included -- All courses is the whole catalogue, not
 * whatever is left over once My courses has taken its share.
 */
export default async function OnyxCoursesPage() {
  await requireOnyxSession();
  // ?all=1 asks for drafts too -- the API only actually honours it for admin
  // and faculty (`canSeeDrafts` in the route), so it is safe to always ask:
  // a student passing it gets exactly the published catalogue they would
  // have gotten anyway. Without it, "All courses" was never actually all of
  // them for staff either, the one role the draft/published distinction is
  // for -- a course sat unpublished and simply was not in the list.
  const [me, courses, mine, programs, purchases] = await Promise.all([
    onyxApi<Me>('/api/onyx/me'),
    onyxApi<Course[]>('/api/onyx/courses?all=1'),
    onyxApi<Course[]>('/api/onyx/my/courses'),
    onyxApi<Program[]>('/api/onyx/programs'),
    // What this learner has already bought: a locked course they own should
    // offer "Start", not "Buy" a second time.
    onyxApiSafe<number[]>('/api/onyx/my/purchases'),
  ]);
  const owned = new Set((purchases ?? []).map(Number));

  // Progress lives on the outline, not on the course row, so a learner's own
  // list costs one request per course. Bounded by how many courses one person
  // takes, and worth it: a list of titles with no progress is the thing this
  // page was already doing badly.
  const outlines = await Promise.all(mine.map((c) =>
    onyxApiSafe<Outline>('/api/onyx/courses/' + c.id + '/outline')));
  const progressFor = new Map(mine.map((c, i) => [c.id, outlines[i]?.progress ?? null]));

  const byProgram = new Map(programs.map((p) => [p.id, p]));
  const enrolled = new Set(mine.map((c) => c.id));
  const staff = isStaff(me.role);

  // `/courses?all=1` already carries enrolment counts and who teaches each
  // one -- My courses comes from a different endpoint (/my/courses) that
  // does not, so this reuses the one bulk read already on the page instead
  // of a second request per course.
  const enrichedById = new Map(courses.map((c) => [c.id, c]));
  const facultyLine = (names: string[]) => names.length === 0
    ? 'No faculty assigned'
    : names.length === 1 ? names[0] : names.join(' & ');

  return (
    <OnyxShell
      me={me}
      nav={navFor(me.role)}
      title="Courses"
      subtitle={staff
        ? courses.length + (courses.length === 1 ? ' course' : ' courses') + ' at ' + me.tenant.name
        : mine.length
          ? 'You are taking ' + mine.length + (mine.length === 1 ? ' course' : ' courses')
          : 'Nothing yet — the catalogue is below.'}
      action={me.role === 'admin' || me.role === 'faculty' ? (
        /* Administrators, or a lecturer standing up their own course: both
           reach POST /api/onyx/courses now. A faculty creator is assigned
           as its faculty in the same request (see the route's own comment)
           and lands on it immediately -- "Courses you teach" below, and the
           dashboard's marking queue and register the moment there is
           anything to mark or register. */
        <CreatePanel
          title="New course" cta="Create a course" icon="book"
          endpoint="courses"
          fields={[
            { name: 'code', label: 'Course code', required: true, placeholder: 'CS101' },
            { name: 'title', label: 'Title', required: true, placeholder: 'Introduction to Programming' },
            { name: 'credits', label: 'Credits', type: 'number', min: 0, max: 60, fallback: 0 },
            { name: 'program_id', label: 'Programme', type: 'select', numeric: true,
              options: [{ value: '', label: 'Not part of a programme' },
                ...programs.map((pr) => ({ value: String(pr.id), label: pr.name }))] },
            { name: 'description', label: 'Description', type: 'textarea',
              placeholder: 'What this course covers.' },
            /* How a learner gets on, as one choice rather than a checkbox plus
               a price that may or may not apply. `self_enroll` is set from
               this on the server (updateCourse), so the two cannot disagree. */
            { name: 'access', label: 'How learners get on', type: 'select',
              options: [
                { value: 'batch', label: 'The institution enrols them' },
                { value: 'open', label: 'Open — anyone here may start it, free' },
                { value: 'locked', label: 'Locked — they buy it first' },
              ],
              help: 'A locked course needs a price below.' },
            { name: 'price_minor', label: 'Price in paise', type: 'number', min: 0,
              help: '149900 is ₹1,499.00. Only used for a locked course.' },
          ]}
          // Created as a draft, then opened -- a course nobody can see is not
          // much use, and publishing is a separate right the API checks.
          thenPost="courses/:id/publish"
        />
      ) : undefined}
    >
      <section className="mb-9">
        <SectionHead title="My courses"
          action={{ href: '/onyx/dashboard', label: 'Your dashboard' }} />
        {mine.length === 0 ? (
          <Card className="p-2">
            <Empty icon="book">
              {staff
                ? 'You are not on any course yet. Create one, or an administrator can put '
                  + 'you on an existing one, below.'
                : 'Nothing yet — join one from All courses below.'}
            </Empty>
          </Card>
        ) : (
          <CardGrid min="20rem">
            {mine.map((c) => {
              const p = progressFor.get(c.id);
              const done = p ? p.completed >= p.total && p.total > 0 : false;
              // /my/courses does not carry these -- pulled from the enriched
              // /courses?all=1 read already on the page wherever this course
              // is also in it (drafts included, so a staff member's own
              // course always is; a self-enrolled learner's course always is
              // too, since the catalogue itself is never role-filtered).
              const meta = enrichedById.get(c.id);
              return (
                <Card key={c.id}
                  className="flex min-w-0 flex-col gap-3 p-4 transition
                             hover:-translate-y-0.5 hover:border-brand-200 hover:shadow-lift">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <Link href={'/onyx/courses/' + c.id}
                        className="block text-[16px] font-bold leading-snug hover:underline">
                        {c.title}
                      </Link>
                      <div className="mt-0.5 text-[13px] text-muted">
                        {c.code}
                        {c.program_id ? ' · ' + (byProgram.get(c.program_id)?.name ?? '') : ''}
                      </div>
                    </div>
                    {staff
                      ? <Pill tone="neutral">{c.status === 1 ? 'Published' : 'Draft'}</Pill>
                      : done ? <Pill tone="good">Complete</Pill> : null}
                  </div>

                  {meta ? (
                    <div className="-mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1
                                    text-[12.5px] text-muted">
                      <span className="inline-flex items-center gap-1.5">
                        <Icon name="users" className="h-3.5 w-3.5" />
                        {meta.enrollment_count ?? 0} enrolled
                      </span>
                      <span className="inline-flex min-w-0 items-center gap-1.5">
                        <Icon name="user" className="h-3.5 w-3.5 shrink-0" />
                        <span className="truncate">
                          {facultyLine((meta.faculty ?? []).map((f) => f.name ?? 'Unknown'))}
                        </span>
                      </span>
                    </div>
                  ) : null}

                  {/* A teacher's own lesson-completion on their own course is
                      not a fact about the course -- it is a fact about
                      whether they have clicked through their own material,
                      which is not what "progress" would be taken to mean
                      here. Staff get what they actually run a course on:
                      whether it is visible to anyone yet. */}
                  {staff ? (
                    <p className="text-[13px] text-muted">
                      {c.status === 1
                        ? 'Open to its roster.'
                        : 'Draft — not visible to learners yet.'}
                    </p>
                  ) : p && p.total > 0 ? (
                    <div>
                      <Meter percent={p.percent} label={c.title + ' progress'} />
                      <div className="mt-1.5 flex items-baseline justify-between text-[12.5px]">
                        <span className="font-bold tabular-nums">{p.percent}%</span>
                        <span className="text-muted tabular-nums">
                          {p.completed} of {p.total} lessons
                        </span>
                      </div>
                    </div>
                  ) : (
                    <p className="text-[13px] text-muted">
                      No lessons have been published on this course yet.
                    </p>
                  )}

                  {/* "Resume" on a course nobody has opened is a small lie, and
                      the kind a learner notices. Staff go to the course page
                      itself -- roster, settings and everything else they can
                      do to it lives there, not a resume/start action that was
                      never theirs to take. */}
                  <Link
                    href={'/onyx/courses/' + c.id}
                    className="mt-auto inline-flex min-h-[40px] w-full items-center justify-center
                               gap-1.5 rounded-2xl bg-brand-600 px-3.5 text-[13px] font-bold
                               text-white hover:bg-brand-700"
                  >
                    <Icon name={staff ? 'edit' : 'play'} className="h-3.5 w-3.5" />
                    {staff ? 'Manage' : p && p.completed > 0 ? 'Resume' : 'Start'}
                  </Link>
                </Card>
              );
            })}
          </CardGrid>
        )}
      </section>

      <section>
        <SectionHead title="All courses" />
        {courses.length === 0 ? (
          <Card className="p-2">
            <Empty icon="book">
              No courses have been published yet.
            </Empty>
          </Card>
        ) : (
          <CardGrid>
            {courses.map((c) => (
              <Card key={c.id}
                className="group relative flex min-w-0 flex-col gap-2.5 p-4 transition
                           hover:-translate-y-0.5 hover:border-brand-200 hover:shadow-lift">
                {/* The whole card reads as one click target -- this link sits
                    over the card and under everything else (z-0), so the
                    title, the join button and any other real control inside
                    stay independently clickable while the empty space around
                    them also opens the course. */}
                <Link href={'/onyx/courses/' + c.id} aria-label={'Open ' + c.title}
                  className="absolute inset-0 z-0 rounded-2xl" />

                <div className="relative z-10 flex items-center gap-2">
                  <span className="font-mono text-[12px] font-bold text-muted">{c.code}</span>
                  {/* Drafts only ever reach this list for staff (?all=1 is a
                      no-op for anyone else), so the pill has nobody but them
                      to confuse. */}
                  {staff && c.status !== 1 ? <Pill tone="neutral">Draft</Pill> : null}
                  {enrolled.has(c.id)
                    ? <Pill tone="good">{staff ? 'Teaching' : 'Enrolled'}</Pill> : null}
                  {/* "Open to join" is a student's question. Staff see the
                      whole register regardless of self_enroll, so the pill
                      told every administrator their own courses were "open
                      to join" -- true, but not theirs to join. */}
                  {c.access === 'locked' && !enrolled.has(c.id)
                    ? <Pill tone="soon">{owned.has(c.id) ? 'Bought' : 'Locked'}</Pill> : null}
                  {c.access !== 'locked' && c.self_enroll && !enrolled.has(c.id)
                    && me.role === 'student'
                    ? <Pill tone="brand">Open to join</Pill> : null}
                </div>

                <Link href={'/onyx/courses/' + c.id}
                  className="relative z-10 text-[15.5px] font-bold leading-snug
                             group-hover:underline">
                  {c.title}
                </Link>

                {c.description ? (
                  // Two lines, then it stops. A card whose height follows its
                  // description makes a grid of them look broken.
                  <p className="line-clamp-2 text-[13px] leading-relaxed text-muted">
                    {c.description}
                  </p>
                ) : null}

                {/* Who teaches it and how many are already on it -- both
                    facts this catalogue used to make somebody click into
                    the course to find out, or ask around for. */}
                <div className="relative z-10 flex flex-wrap items-center gap-x-3 gap-y-1
                                text-[12.5px] text-muted">
                  <span className="inline-flex items-center gap-1.5">
                    <Icon name="users" className="h-3.5 w-3.5" />
                    {c.enrollment_count ?? 0} enrolled
                  </span>
                  <span className="inline-flex min-w-0 items-center gap-1.5">
                    <Icon name="user" className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">
                      {facultyLine((c.faculty ?? []).map((f) => f.name ?? 'Unknown'))}
                    </span>
                  </span>
                </div>

                <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 pt-1
                                text-[12.5px] text-muted">
                  {c.program_id ? (
                    <span className="inline-flex items-center gap-1.5">
                      <Icon name="building" className="h-3.5 w-3.5" />
                      {byProgram.get(c.program_id)?.name ?? '—'}
                    </span>
                  ) : null}
                  {c.credits ? (
                    <span className="tabular-nums">{c.credits} credits</span>
                  ) : null}
                </div>

                {/* LRN-01: "enroll themselves". The catalogue used to say a
                    course was open to join and offer nothing to join it with --
                    and where self-enrolment is off, it said nothing at all,
                    which reads as a broken card rather than a closed door. */}
                {/* Three doors, and the card says which one this is rather
                    than leaving a learner to find out by clicking:
                    bought-and-not-yet-started, for sale, or the institution's
                    to hand out. */}
                {me.role === 'student' && !enrolled.has(c.id) ? (
                  c.access === 'locked' && !owned.has(c.id) ? (
                    <BuyCourseButton courseId={c.id} title={c.title}
                      price={Number(c.price_minor ?? 0)}
                      currency={String(c.currency ?? 'INR')} />
                  ) : c.self_enroll || c.access === 'open' || owned.has(c.id) ? (
                    <div className="relative z-10">
                      <ActionButton endpoint={'courses/' + c.id + '/enroll'}
                        label={owned.has(c.id) ? 'Start — you own this' : 'Join this course'} />
                    </div>
                  ) : (
                    <p className="relative z-10 text-[12.5px] text-muted">
                      Enrolment for this course is handled by the programme office.
                    </p>
                  )
                ) : null}
              </Card>
            ))}
          </CardGrid>
        )}
      </section>
    </OnyxShell>
  );
}
