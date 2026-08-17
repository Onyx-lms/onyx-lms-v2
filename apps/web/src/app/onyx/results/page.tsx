import Link from 'next/link';
import type { Metadata } from 'next';
import { OnyxShell } from '@/components/onyx-shell';
import { navFor } from '@/lib/onyx-nav';
import { requireOnyxSession, onyxApi, onyxApiSafe, type Me } from '@/lib/onyx-session';
import type { ExamMark, Transcript } from '@/lib/onyx-campus';
import type { MyAttempt } from '@/lib/onyx-assess';
import { CreatePanel } from '@/components/onyx-create';
import {
  ActionLink, Card, Empty, Icon, ListRow, Pill, RowList, Score, SectionHead, StatTile,
} from '@/components/onyx-ui';
import { VerifyTranscript } from '@/components/onyx-transcript';

export const metadata: Metadata = { title: 'Results' };

const EXAM_STAFF = ['admin', 'exams'];

/**
 * Which band a mark falls in, read off the grade the examinations office
 * applied rather than guessed from the number.
 *
 * `ExamMark` carries no maximum, so a percentage cannot be computed here and
 * inventing a denominator of 100 would be a lie on any paper marked out of 50.
 * The grade letter is the institution's own banding, and it is shown in words
 * beside the mark -- the colour is never the only signal.
 */
function bandFor(grade: string | null): 'hi' | 'mid' | 'lo' | undefined {
  if (!grade) return undefined;
  const first = grade.trim().charAt(0).toUpperCase();
  if (first === 'A' || first === 'B') return 'hi';
  if (first === 'C' || first === 'D') return 'mid';
  if (first === 'E' || first === 'F') return 'lo';
  return undefined;
}

/**
 * CMP-02c -- your own marks and transcripts.
 *
 * Only published marks ever reach this page: the API enforces that for
 * anyone who is not running examinations, so there is no draft or moderated
 * figure here to be mistaken for a final one. The page says so out loud,
 * because the alternative is leaving an absence to be interpreted -- which is
 * the support ticket this screen exists to prevent.
 */
export default async function OnyxResultsPage() {
  await requireOnyxSession();
  const me = await onyxApi<Me>('/api/onyx/me');
  const staff = EXAM_STAFF.includes(me.role);
  // CMP-02c: issuing a transcript needs somebody to issue it to, and which
  // programme it covers. Both come from the institution, not from a text box.
  const [members, programs] = await Promise.all([
    staff ? onyxApiSafe<{ user_id: number; role: string; user: { name: string } | null }[]>(
      '/api/onyx/members') : null,
    staff ? onyxApiSafe<{ id: number; name: string }[]>('/api/onyx/programs') : null,
  ]);
  const learners = (members ?? []).filter((m) => m.role === 'student');

  const [marks, transcripts, myAttempts] = await Promise.all([
    onyxApi<ExamMark[]>('/api/onyx/results'),
    onyxApi<Transcript[]>('/api/onyx/transcripts'),
    // Marked coursework, alongside marked exams -- the two used to live on
    // separate pages, so a faculty grade on an assessment never reached the
    // one screen a learner (or, through them, a guardian) actually calls
    // "my results". myAttempts() already returns published-only scores.
    onyxApi<MyAttempt[]>('/api/onyx/my/assessments'),
  ]);
  const assessmentResults = myAttempts.filter((a) => a.results_published && a.score !== null);

  // The numbers a learner is actually asked for -- by a scholarship form, by a
  // placement office, by a parent. Every one is read off what the API already
  // returned; nothing here is a second request.
  const live = transcripts.filter((t) => !t.revoked_at);
  const newest = [...live].sort(
    (a, b) => Date.parse(b.issued_at) - Date.parse(a.issued_at))[0] ?? null;
  const average = marks.length
    ? Math.round(marks.reduce((n, m) => n + m.final_marks, 0) / marks.length)
    : null;
  const moderated = marks.filter((m) => m.moderation_delta !== 0).length;

  return (
    <OnyxShell
      me={me}
      nav={navFor(me.role)}
      title="Results"
      subtitle={staff
        ? 'Your own record.'
        : 'Published results only. A mark appears here once the examinations office releases it.'}
      action={me.role === 'student' ? (
        /* "Request", not "Download": a download button that produces nothing is
           the fastest way to get a support ticket. */
        <Link href="/onyx/support"
          className="inline-flex min-h-[40px] items-center gap-2 rounded-2xl border border-line
                     bg-white px-3.5 text-[13px] font-bold text-slate-700 hover:bg-brand-50">
          <Icon name="flag" className="h-4 w-4" />
          Request a transcript
        </Link>
      ) : undefined}
    >
      <div className="space-y-8">
        {marks.length || live.length ? (
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile label="Released" value={marks.length}
              note={marks.length === 1 ? 'mark published' : 'marks published'} />
            <StatTile label="Average mark" value={average ?? '—'}
              note={marks.length ? 'across every released mark' : 'nothing released yet'} />
            <StatTile label="GPA" value={newest?.gpa ?? '—'}
              note={newest ? 'on transcript ' + newest.serial : 'no transcript issued'} />
            <StatTile label="Moderated" value={moderated}
              note={moderated === 1 ? 'mark was adjusted' : 'marks were adjusted'} />
          </div>
        ) : null}

        {staff ? (
          <CreatePanel
            title="Issue a transcript" cta="Issue a transcript" icon="award" compact
            endpoint="transcripts"
            fields={[
              { name: 'user_id', label: 'Learner', type: 'select', required: true,
                numeric: true, wide: true,
                options: learners.map((m) => ({ value: String(m.user_id),
                  label: m.user?.name ?? 'User ' + m.user_id })) },
              { name: 'program_id', label: 'Programme', type: 'select', numeric: true, wide: true,
                options: [{ value: '', label: 'Everything on record' }].concat(
                  (programs ?? []).map((p) => ({ value: String(p.id), label: p.name }))),
                help: 'Published marks only. The document is sealed with a checksum '
                  + 'so it can be verified later without trusting the copy.' },
            ]}
          />
        ) : null}

        <section>
          <SectionHead title="Exam marks" />
          {/* The mark is the thing the page exists for, so it is the largest
              element on the row rather than the middle cell of three. The band
              is never the only signal: the number sits inside it, and the grade
              letter repeats it in words for anyone the green and the red read
              the same to. */}
          <RowList label="Your published exam marks">
            {marks.map((m) => (
              <ListRow
                key={m.id}
                icon="award"
                tone="brand"
                title={'Exam #' + m.exam_id}
                meta={[
                  m.grade ? 'Grade ' + m.grade : 'No grade band was applied',
                  // A mark that moved and does not say it moved is the thing
                  // that generates the appeal.
                  m.moderation_delta
                    ? 'moderated ' + (m.moderation_delta > 0 ? '+' : '') + m.moderation_delta
                    : null,
                ].filter(Boolean).join(' · ')}
                trailing={<Score value={m.final_marks} band={bandFor(m.grade)} />}
              />
            ))}
            {marks.length === 0 ? (
              <li>
                <Empty icon="award">
                  No results have been published yet. A mark appears here only once the
                  examinations office releases it.
                </Empty>
              </li>
            ) : null}
          </RowList>
        </section>

        <section>
          <SectionHead title="Assessment results" />
          {/* Marked coursework -- quizzes, assignments, the online paper of an
              exam sat through the CBT engine. Same rule as the exam marks
              above: a score exists here only once both the attempt and the
              assessment are published, never a mark still open to appeal. */}
          <RowList label="Your published assessment results">
            {assessmentResults.map((a) => (
              <ListRow
                key={a.attempt_id}
                icon="award"
                tone="brand"
                title={a.title}
                meta={a.passed === null ? 'Marked' : a.passed ? 'Passed' : 'Not passed'}
                trailing={<Score value={a.score!} outOf={a.max_score}
                  band={a.passed === false ? 'lo' : undefined} />}
              />
            ))}
            {assessmentResults.length === 0 ? (
              <li>
                <Empty icon="award">
                  No assessment results have been published yet. A score appears here once
                  it is marked and released.
                </Empty>
              </li>
            ) : null}
          </RowList>
        </section>

        {staff ? (
          <section>
            <SectionHead title="Check a transcript" />
            {/* CMP-02c's acceptance criterion is that a transcript reconciles
                with the marks behind it. The API could always answer; nothing
                asked, so the only people who could check were people with a
                database client. */}
            <Card className="p-4">
              <VerifyTranscript />
            </Card>
          </section>
        ) : null}

        <section>
          <SectionHead title="Transcripts" />
          {transcripts.length ? (
            <RowList label="Your transcripts">
              {transcripts.map((t) => (
                <ListRow
                  key={t.id}
                  icon="flag"
                  tone={t.revoked_at ? 'late' : 'good'}
                  title={t.serial}
                  chips={t.revoked_at ? <Pill tone="late">Revoked</Pill> : null}
                  meta={
                    'Issued ' + new Date(t.issued_at).toLocaleDateString(undefined,
                      { day: 'numeric', month: 'short', year: 'numeric' })
                    + ' · ' + t.credits_earned + ' results'
                    + (t.gpa !== null ? ' · GPA ' + t.gpa : '')
                  }
                />
              ))}
            </RowList>
          ) : (
            /* Genuinely empty for most learners until somebody asks, so the
               empty state explains what a transcript is and where it comes
               from rather than shrugging. */
            <Card>
              <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
                <span className="text-muted"><Icon name="flag" className="h-7 w-7" /></span>
                <h3 className="text-[15px] font-bold">None issued yet.</h3>
                <p className="max-w-md text-sm text-muted">
                  A transcript is a sealed document of your published marks, with a checksum
                  anyone can verify without trusting the copy they were sent. The examinations
                  office issues one on request.
                </p>
                {me.role === 'student' ? (
                  <div className="mt-1">
                    <ActionLink href="/onyx/support" label="Request a transcript" />
                  </div>
                ) : null}
              </div>
            </Card>
          )}
        </section>
      </div>
    </OnyxShell>
  );
}
