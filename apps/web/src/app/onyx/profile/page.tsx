import Link from 'next/link';
import type { Metadata } from 'next';
import { OnyxShell } from '@/components/onyx-shell';
import { OnyxReadiness, OnyxSkills } from '@/components/onyx-career';
import { navFor, ROLE_LABELS } from '@/lib/onyx-nav';
import { headers } from 'next/headers';
import { requireOnyxSession, onyxApi, onyxApiSafe, type Me } from '@/lib/onyx-session';
import { ProfileEditor, type ProfileDetails } from '@/components/onyx-profile-editor';
import { IdentityEditor } from '@/components/onyx-identity-editor';
import type { Profile } from '@/lib/onyx-career';
import type { GuardianLink } from '@/lib/onyx-campus';
import type { ExamMark } from '@/lib/onyx-campus';
import type { MyAttempt } from '@/lib/onyx-assess';
import type { Course } from '@/lib/onyx-learn';
import { GuardianConsent } from '@/components/onyx-manage';
import {
  Card, CardGrid, Empty, Icon, ListRow, Pill, RowList, Score, SectionHead, StatTile,
} from '@/components/onyx-ui';

export const metadata: Metadata = { title: 'Your profile' };

/**
 * Which band a mark falls in, read off the grade the examinations office
 * applied rather than guessed from the number -- same rule as the Results
 * page (see its own comment): a grade is the institution's banding, a raw
 * percentage cannot be reconstructed from a mark alone.
 */
function bandFor(grade: string | null): 'hi' | 'mid' | 'lo' | undefined {
  if (!grade) return undefined;
  const first = grade.trim().charAt(0).toUpperCase();
  if (first === 'A' || first === 'B') return 'hi';
  if (first === 'C' || first === 'D') return 'mid';
  if (first === 'E' || first === 'F') return 'lo';
  return undefined;
}

const RECENT = 5;

/**
 * F-07 -- who this account is, in the shape the role actually asks for.
 *
 * One route for every role, same as OnyxShell itself, but not one layout:
 * a student's profile is their record (courses, recent grades, the
 * employability passport underneath); a teacher's is their courses and
 * nothing graded, because nothing here grades them; everyone else -- admin
 * included -- gets exactly what identifies the account and stops, because
 * "readiness score" or "skills passport" printed for an administrator would
 * not be describing them, it would be describing an empty query.
 */
export default async function OnyxProfilePage() {
  await requireOnyxSession();
  const me = await onyxApi<Me>('/api/onyx/me');
  // The half of the profile only its owner writes, and the origin the shareable
  // link is built from -- read from the request rather than hard-coded, so the
  // address shown is the one the person is actually on.
  const details = await onyxApiSafe<ProfileDetails>('/api/onyx/my/profile-details');
  const head = await headers();
  const origin = (head.get('x-forwarded-proto') ?? 'https') + '://'
    + (head.get('host') ?? 'onyx-lms-v2.vercel.app');
  const isStudent = me.role === 'student';
  // Deliberately not admin: an admin's profile is the identity card and
  // nothing under it. Admin can teach a course (assertCanTeach lets them
  // past that check unconditionally), but "which courses am I dealing with"
  // is not an identity fact about being an administrator the way it is
  // about being faculty -- an admin who also teaches shows up on the
  // Courses page, not folded into an account summary that is otherwise just
  // "who are you and what institution is this".
  const isFaculty = me.role === 'faculty';

  const [profile, guardians, myCourses, examMarks, myAttempts] = await Promise.all([
    isStudent ? onyxApi<Profile>('/api/onyx/my/profile') : Promise.resolve(null),
    isStudent ? onyxApiSafe<GuardianLink[]>('/api/onyx/guardians') : Promise.resolve(null),
    (isStudent || isFaculty) ? onyxApiSafe<Course[]>('/api/onyx/my/courses') : Promise.resolve(null),
    isStudent ? onyxApiSafe<ExamMark[]>('/api/onyx/results') : Promise.resolve(null),
    isStudent ? onyxApiSafe<MyAttempt[]>('/api/onyx/my/assessments') : Promise.resolve(null),
  ]);

  // Oldest-first from the API (see marksFor()); reversed here rather than
  // asking the endpoint to sort two different ways for two different callers.
  const recentExams = [...(examMarks ?? [])].reverse().slice(0, RECENT);
  // myAttempts() is already newest-first; only published, scored ones read as
  // a "grade" to a candidate -- an in-progress or ungraded attempt is not one.
  const recentAssessments = (myAttempts ?? [])
    .filter((a) => a.results_published && a.score !== null)
    .slice(0, RECENT);

  const displayName = me.name ?? me.email;
  const initials = displayName.slice(0, 2).toUpperCase();
  const evidence = profile ? profile.skills.reduce((n, s) => n + s.evidence_count, 0) : 0;

  return (
    <OnyxShell
      me={me}
      nav={navFor(me.role)}
      title="Your profile"
      subtitle={isStudent
        ? 'What you have done here, and what it adds up to.'
        : 'Who this account is, at ' + me.tenant.name + '.'}
    >
      {/* What you say about yourself, before what the system says about you.
          Everything below this is derived -- courses, marks, awarded skills --
          and none of it was ever a profile: it is a record. This is the part a
          person writes, and the part worth sending somebody a link to. */}
      {/* Name, number and picture come FIRST, above the public profile.
          They are the things every other screen shows about this person -- a
          register, a results sheet, a certificate -- and until now they were
          the only parts of a profile its owner could not change. Somebody
          arriving to fix a misspelled name should not have to scroll past a
          bio to find where. */}
      {details ? (
        <section className="mb-6">
          <IdentityEditor
            identity={{
              name: me.name ?? '',
              email: me.email,
              phone: details.phone ?? '',
              photo_url: me.photo_url ?? null,
            }}
            institution={me.tenant.name}
          />
        </section>
      ) : null}

      {/* Name, number and picture come FIRST, above the public profile.
          They are the things every other screen shows about this person -- a
          register, a results sheet, a certificate -- and until now they were
          the only parts of a profile its owner could not change. Somebody
          arriving to fix a misspelled name should not have to scroll past a
          bio to find where. */}
      {details ? (
        <section className="mb-6">
          <IdentityEditor
            identity={{
              name: me.name ?? '',
              email: me.email,
              phone: details.phone ?? '',
              photo_url: me.photo_url ?? null,
            }}
            institution={me.tenant.name}
          />
        </section>
      ) : null}

      {details ? (
        <section className="mb-6">
          <SectionHead title="Your public profile" />
          <ProfileEditor details={details} role={me.role} origin={origin} />
        </section>
      ) : null}

      {/* Identity first, and it is the institution's record of you rather than
          a profile you fill in. Only what the session actually holds is shown:
          a programme or a batch printed from nothing would be the one place a
          learner most needs to be able to trust. */}
      <Card className="p-4 sm:p-5">
        <div className="flex flex-wrap items-start gap-3.5">
          <span aria-hidden="true"
            className="grid h-14 w-14 shrink-0 place-items-center rounded-full
                       bg-gradient-to-br from-brand-500 to-brand-700 text-[18px] font-bold
                       text-white">
            {initials}
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="break-words text-[17px] font-extrabold leading-snug">{displayName}</h2>
            {me.name ? (
              <p className="break-all text-[13px] text-muted">{me.email}</p>
            ) : null}
            <p className="mt-0.5 text-[13px] text-muted">
              {ROLE_LABELS[me.role]} · {me.tenant.name}
            </p>
            {/* The number the institution actually calls this person by. It is
                what goes at the top of a script and on a hall ticket, so it
                belongs where they can read it off their own profile rather
                than off a printed list somebody else is holding. */}
            {me.roll_number ? (
              <p className="mt-1 text-[13px]">
                <span className="text-muted">Roll / staff no.</span>{' '}
                <span className="font-mono font-bold">{me.roll_number}</span>
              </p>
            ) : null}
            <div className="mt-2.5 flex flex-wrap items-center gap-2">
              <Pill tone="brand">{ROLE_LABELS[me.role]}</Pill>
              <Pill tone="neutral">{me.tenant.name}</Pill>
              {me.memberships.length > 1 ? (
                <Pill tone="neutral">{me.memberships.length} institutions</Pill>
              ) : null}
            </div>
          </div>
        </div>
      </Card>

      {/* The figures that gate things -- a placement application, a resit, a
          scholarship -- as numbers rather than buried in a report. Student
          only: a readiness score is a claim about a candidate, and nobody
          else on this product is one. */}
      {isStudent && profile ? (
        <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatTile label="Readiness" value={profile.readiness.score} note="of 100" />
          <StatTile label="Skills" value={profile.skills.length}
            note="on the passport" />
          <StatTile label="Evidence" value={evidence}
            note={evidence === 1 ? 'piece, all derived' : 'pieces, all derived'} />
          <StatTile label="Credentials" value={profile.certificates.length}
            note="issued to you" />
        </div>
      ) : null}

      {/* Courses -- enrolled in, or teaching. Same endpoint either way
          (GET /my/courses already unions both), so the only thing that
          changes with role is the label and which action sits beside it. */}
      {myCourses ? (
        <section className="mt-6">
          <SectionHead title={isStudent ? 'Your courses' : 'Courses you teach'} />
          {myCourses.length ? (
            <RowList label={isStudent ? 'Courses you are enrolled in' : 'Courses you teach'}>
              {myCourses.map((c) => (
                <ListRow
                  key={c.id}
                  icon="book"
                  title={c.title}
                  href={'/onyx/courses/' + c.id}
                  meta={c.code + (c.credits ? ' · ' + c.credits + ' credits' : '')}
                />
              ))}
            </RowList>
          ) : (
            <Card className="p-4">
              <p className="text-sm text-muted">
                {isStudent
                  ? 'Not enrolled in anything yet.'
                  : 'Not assigned to teach anything yet.'}
              </p>
            </Card>
          )}
        </section>
      ) : null}

      {/* Recent grades -- exam marks and assessment results side by side,
          capped and linking out to the full Results page rather than
          reproducing it. Student only: a mark here belongs to the person it
          was awarded to, not to whoever marked it. */}
      {isStudent ? (
        <section className="mt-6">
          <div className="mb-2.5 flex flex-wrap items-center justify-between gap-3">
            <SectionHead title="Recent grades" />
            <Link href="/onyx/results"
              className="text-[13px] font-semibold text-brand-700 hover:underline">
              All results &rarr;
            </Link>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <h3 className="mb-1.5 text-[11px] font-bold uppercase tracking-[.08em] text-muted">
                Examinations
              </h3>
              <RowList label="Your most recent exam marks">
                {recentExams.map((m) => (
                  <ListRow
                    key={m.id}
                    icon="award"
                    tone="brand"
                    title={'Exam #' + m.exam_id}
                    meta={m.grade ? 'Grade ' + m.grade : 'No grade band was applied'}
                    trailing={<Score value={m.final_marks} band={bandFor(m.grade)} />}
                  />
                ))}
                {recentExams.length === 0 ? (
                  <li><Empty icon="award">No exam marks published yet.</Empty></li>
                ) : null}
              </RowList>
            </div>
            <div>
              <h3 className="mb-1.5 text-[11px] font-bold uppercase tracking-[.08em] text-muted">
                Assessments
              </h3>
              <RowList label="Your most recent assessment results">
                {recentAssessments.map((a) => (
                  <ListRow
                    key={a.attempt_id}
                    icon="target"
                    tone={a.passed ? 'good' : 'brand'}
                    title={a.title}
                    href={'/onyx/assessments/' + a.assessment_id}
                    meta={a.passed === null ? 'No pass mark set' : a.passed ? 'Passed' : 'Not passed'}
                    trailing={<Score value={a.score ?? 0} outOf={a.max_score} />}
                  />
                ))}
                {recentAssessments.length === 0 ? (
                  <li><Empty icon="target">No assessment results published yet.</Empty></li>
                ) : null}
              </RowList>
            </div>
          </div>
        </section>
      ) : null}

      {isStudent && profile ? (
      <div className="mt-6 grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
        <div className="min-w-0 space-y-8">
          <section>
            <SectionHead title="Skills passport" />
            <p className="-mt-1 mb-3 text-[12.5px] text-muted">
              Derived from evidence, never self-declared. Each skill opens onto the evidence
              that produced it &mdash; nothing here is typed in by hand, which is the only
              reason an employer should believe any of it.
            </p>
            <OnyxSkills skills={profile.skills} />
          </section>

          {/* A certificate is a thing you hand to somebody, so the two actions
              that matter -- a link they can check and a file they can attach to
              an application -- are both on the card rather than behind it. */}
          <section>
            <SectionHead title="Credentials" />
            {profile.certificates.length ? (
              <CardGrid min="18rem">
                {profile.certificates.map((c) => (
                  <Card key={c.credential_id} className="flex min-w-0 flex-col gap-2.5 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl
                                       bg-brand-50 text-brand-700">
                        <Icon name="award" className="h-[18px] w-[18px]" />
                      </span>
                      {c.kind ? <Pill tone="neutral">{c.kind}</Pill> : null}
                    </div>

                    <div className="min-w-0">
                      <div className="text-[15px] font-bold leading-snug">{c.title}</div>
                      <div className="mt-0.5 text-[12.5px] text-muted">
                        Issued {new Date(c.issued_at).toLocaleDateString(undefined,
                          { day: 'numeric', month: 'short', year: 'numeric' })}
                      </div>
                    </div>

                    <div className="truncate font-mono text-[12px] text-muted"
                      title={c.credential_id}>
                      {c.credential_id}
                    </div>

                    <div className="mt-auto flex flex-wrap gap-2 pt-1">
                      {c.id ? (
                        <a
                          href={'/api/proxy/onyx/certificates/' + c.id + '/document.pdf'}
                          download
                          className="inline-flex min-h-[38px] shrink-0 items-center gap-1.5
                                     rounded-2xl bg-brand-600 px-3.5 text-[13px] font-bold
                                     text-white hover:bg-brand-700"
                        >
                          <Icon name="download" className="h-3.5 w-3.5" />
                          Download
                        </a>
                      ) : null}
                      <Link href={'/onyx/verify/' + c.credential_id}
                        className="inline-flex min-h-[38px] shrink-0 items-center gap-1.5
                                   rounded-2xl border border-line px-3.5 text-[13px] font-bold
                                   text-slate-700 hover:bg-brand-50">
                        <Icon name="external" className="h-3.5 w-3.5" />
                        Verify
                      </Link>
                    </div>
                  </Card>
                ))}
              </CardGrid>
            ) : (
              <Card className="p-4">
                <p className="text-sm text-muted">
                  Nothing issued yet. Credentials appear here as you finish courses,
                  assessments and contests.
                </p>
              </Card>
            )}
          </section>
        </div>

        {/* ---------------- rail ---------------- */}
        <aside className="min-w-0 space-y-8">
          {/* Readiness decides whether a job post will even accept an
              application, so it is shown with its arithmetic open. A score
              whose components are hidden is one a learner can only argue with,
              never improve. */}
          <section>
            <SectionHead title="Placement readiness" />
            <OnyxReadiness readiness={profile.readiness} />
          </section>

          <section>
            <SectionHead title="Who follows your progress" />
            {/* Consent that cannot be withdrawn from the screen it was
                granted on is not consent. */}
            <GuardianConsent links={guardians ?? []} />
          </section>
        </aside>
      </div>
      ) : null}
    </OnyxShell>
  );
}
