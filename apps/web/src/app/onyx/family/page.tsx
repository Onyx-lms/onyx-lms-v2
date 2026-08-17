import type { Metadata } from 'next';
import { OnyxShell } from '@/components/onyx-shell';
import {
  Card, DataTable, Empty, Icon, Pill, Ring, Score, SectionHead, StatTile,
  relativeDue,
} from '@/components/onyx-ui';
import { navFor } from '@/lib/onyx-nav';
import { requireOnyxPageRole, onyxApi, type Me } from '@/lib/onyx-session';
import { money, type FamilyChild } from '@/lib/onyx-campus';

export const metadata: Metadata = { title: 'Your family' };

/** Two letters from a name, for the mark beside it. */
function initials(name: string | null, fallback: number): string {
  if (!name) return '#' + String(fallback).slice(-2);
  return name.split(/\s+/).filter(Boolean).slice(0, 2)
    .map((w) => w[0]!.toUpperCase()).join('') || '?';
}

/**
 * The four things a guardian is never shown, whatever a learner turns on.
 *
 * Written down rather than left to inference. A parent portal that says what
 * it does NOT show is the difference between a portal and surveillance, and
 * the person who decides the first three is the learner -- not the university
 * and not this account.
 */
const NEVER = [
  'Coursework and submissions',
  'Discussions and messages',
  'Job applications',
  'Support tickets and wellbeing',
];

/**
 * CMP-04 -- a guardian's whole world.
 *
 * Every switch a child has not turned on shows as "Not shared" rather than
 * being left off the page, so a parent never mistakes silence for nothing to
 * report -- the page says which it is. Shared and not-shared are carried by a
 * glyph and a word as well as a colour, because roughly one man in twelve
 * reads the green and the grey as much the same thing.
 */
export default async function OnyxFamilyPage() {
  await requireOnyxPageRole('guardian');
  const [me, family] = await Promise.all([
    onyxApi<Me>('/api/onyx/me'),
    onyxApi<{ children: FamilyChild[] }>('/api/onyx/family'),
  ]);

  return (
    <OnyxShell me={me} nav={navFor(me.role)} title="Your family"
      subtitle="Only what each learner has chosen to share.">
      <div className="space-y-10">
        {family.children.map((c) => {
          const name = c.name ?? 'Learner #' + c.student_user_id;
          const exams = c.shares.results ? (c.results?.exams ?? []) : [];
          const assessments = c.shares.results ? (c.results?.assessments ?? []) : [];
          const courses = c.shares.results ? (c.results?.courses ?? []) : [];
          const attendance = c.shares.attendance ? c.attendance : null;
          const fees = c.shares.fees ? c.fees : null;
          const owed = fees?.outstanding_minor ?? 0;
          // One average across both kinds of published result -- a parent
          // asking "how are they doing" is not asking separately about exams
          // and coursework assessments.
          const percentages = [
            ...exams.map((r) => (r.final_marks / r.max_marks) * 100),
            ...assessments.map((r) => (r.score / r.max_score) * 100),
          ];
          const average = percentages.length
            ? Math.round(percentages.reduce((n, p) => n + p, 0) / percentages.length)
            : null;
          const resultCount = exams.length + assessments.length;

          return (
            <section key={c.link_id} aria-label={name}>
              <Card className="p-4">
                <div className="flex flex-wrap items-center gap-3">
                  <span aria-hidden="true"
                    className="grid h-12 w-12 shrink-0 place-items-center rounded-xl2
                               bg-gradient-to-br from-brand-500 to-brand-700 text-sm
                               font-bold text-white">
                    {initials(c.name, c.student_user_id)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <h2 className="truncate text-[17px] font-extrabold">{name}</h2>
                    <p className="text-[13px] capitalize text-muted">{c.relationship}</p>
                  </div>
                </div>
              </Card>

              {/* The three numbers a parent rings the university about. Fees is
                  the only one that is also a deadline, so it is the only one
                  that ever reads as urgent. */}
              <div className="mt-3 grid gap-3 sm:grid-cols-3">
                <StatTile label="Attendance"
                  value={attendance ? attendance.percent + '%' : 'Not shared'}
                  note={attendance
                    ? attendance.attended + ' of ' + attendance.total + ' sessions'
                    : 'This learner has not shared it'} />
                <StatTile label="Published results"
                  value={c.shares.results ? resultCount : 'Not shared'}
                  note={c.shares.results
                    ? (average !== null ? 'Average ' + average + '%' : 'Nothing published yet')
                    : 'This learner has not shared it'} />
                <StatTile label="Fees outstanding"
                  value={fees ? (owed > 0 ? money(owed) : 'Nothing owed') : 'Not shared'}
                  note={fees
                    ? (owed > 0 ? 'Across the invoices below' : 'Every invoice is settled')
                    : 'This learner has not shared it'} />
              </div>

              <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
                <div className="min-w-0 space-y-6">
                  {/* Fees first: it is the only thing on this page a guardian
                      can do something about, and the something expires. */}
                  {fees ? (
                    <section>
                      <SectionHead title="Fees" />
                      <Card className="p-4">
                        <div className="flex flex-wrap items-end justify-between gap-3">
                          <div>
                            <div className="text-[10.5px] font-bold uppercase tracking-[.08em]
                                            text-muted">
                              Outstanding
                            </div>
                            <div className={'mt-1 text-[28px] font-extrabold leading-none '
                              + 'tabular-nums ' + (owed > 0 ? 'text-red-700' : '')}>
                              {owed > 0 ? money(owed) : money(0)}
                            </div>
                          </div>
                          {owed > 0 ? <Pill tone="late">Payment due</Pill> : (
                            <Pill tone="good">Settled</Pill>
                          )}
                        </div>

                        {fees.invoices.length ? (
                          <ul className="mt-4 divide-y divide-line border-t border-line">
                            {fees.invoices.map((inv) => {
                              const due = relativeDue(inv.due_at);
                              const paid = inv.status === 'paid';
                              return (
                                <li key={inv.id}
                                  className="flex flex-wrap items-center gap-x-3 gap-y-1.5 py-2.5
                                             text-[13px]">
                                  <span className="min-w-0 flex-1">
                                    <span className="font-bold">{inv.number}</span>
                                    <span className="text-muted">
                                      {' · '}{inv.due_at ? due.text : 'no due date'}
                                    </span>
                                  </span>
                                  <Pill tone={paid ? 'good'
                                    : inv.status === 'void' ? 'neutral' : due.tone}>
                                    {paid ? 'Paid'
                                      : inv.status === 'part_paid' ? 'Part paid'
                                        : inv.status === 'void' ? 'Void' : 'Due'}
                                  </Pill>
                                  <span className="min-w-[92px] text-right font-bold tabular-nums">
                                    {money(inv.total_minor, inv.currency)}
                                  </span>
                                </li>
                              );
                            })}
                          </ul>
                        ) : (
                          <p className="mt-3 text-sm text-muted">No invoices have been issued.</p>
                        )}

                        <p className="mt-4 border-t border-line pt-3 text-xs text-muted">
                          Paying an invoice does not give you access to anything else on
                          this account.
                        </p>
                      </Card>
                    </section>
                  ) : null}

                  {/* Grades as a table: a parent reads down the Mark column
                      looking for the outlier, which is what a table is for.
                      The band on the score chip always carries its number.
                      Exams and CBT assessments are two systems underneath but
                      one list here -- a parent asking "how did they do" does
                      not care which office ran the paper. */}
                  {c.shares.results ? (
                    <section>
                      <SectionHead title="Results so far" />
                      <DataTable
                        caption={name + '’s published results, examinations and assessments alike'}
                        head={
                          <>
                            <th scope="col">Paper</th>
                            <th scope="col">Kind</th>
                            <th scope="col">Mark</th>
                            <th scope="col">Band</th>
                          </>
                        }
                      >
                        {exams.map((r) => (
                          <tr key={'exam-' + r.exam_id}>
                            <td>{r.title}</td>
                            <td className="text-[13px] text-muted">Examination</td>
                            <td className="tabular-nums text-muted">
                              {r.final_marks} / {r.max_marks}
                              {r.grade ? ' · ' + r.grade : ''}
                            </td>
                            <td><Score value={r.final_marks} outOf={r.max_marks} /></td>
                          </tr>
                        ))}
                        {assessments.map((r) => (
                          <tr key={'assess-' + r.attempt_id}>
                            <td>{r.title}</td>
                            <td className="text-[13px] text-muted">Assessment</td>
                            <td className="tabular-nums text-muted">
                              {r.score} / {r.max_score}
                            </td>
                            <td>
                              <Score value={r.score} outOf={r.max_score}
                                band={r.passed === false ? 'lo' : undefined} />
                            </td>
                          </tr>
                        ))}
                        {exams.length === 0 && assessments.length === 0 ? (
                          <tr className="hover:!bg-transparent">
                            <td colSpan={4} className="!p-0">
                              <Empty icon="award">
                                Nothing has been published yet. Marks that are still being
                                moderated are not shown to anyone, including {name}.
                              </Empty>
                            </td>
                          </tr>
                        ) : null}
                      </DataTable>
                    </section>
                  ) : null}

                  {/* The list only -- which courses, not the coursework or
                      submissions inside them. See the NEVER list in the rail:
                      that boundary has not moved, this is just the register a
                      parent needs to make sense of the results table above. */}
                  {c.shares.results && courses.length > 0 ? (
                    <section>
                      <SectionHead title="Courses" />
                      <ul className="grid gap-2 sm:grid-cols-2">
                        {courses.map((course) => (
                          <li key={course.course_id}>
                            <Card className="p-3">
                              <div className="text-[13.5px] font-bold">{course.title}</div>
                              <div className="mt-0.5 text-[12px] text-muted">
                                {course.code} · {course.credits} credit
                                {course.credits === 1 ? '' : 's'}
                              </div>
                            </Card>
                          </li>
                        ))}
                      </ul>
                    </section>
                  ) : null}
                </div>

                {/* -------------------------------------------------- rail */}
                <div className="min-w-0 space-y-6">
                  {attendance ? (
                    <section>
                      <SectionHead title="Attendance" />
                      <Card className="p-4">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <div className="text-[28px] font-extrabold leading-none tabular-nums">
                              {attendance.percent}%
                            </div>
                            <div className="mt-1.5 text-xs text-muted">
                              {attendance.attended} of {attendance.total} sessions
                            </div>
                          </div>
                          <Ring percent={attendance.percent} size={58}
                            label={attendance.percent + ' percent attendance'} />
                        </div>
                      </Card>
                    </section>
                  ) : null}

                  <section>
                    <SectionHead title="What you can see" />
                    <Card className="p-4">
                      <ul className="space-y-2.5">
                        {([
                          ['Attendance', c.shares.attendance],
                          ['Courses, marks & assessments', c.shares.results],
                          ['Fees and invoices', c.shares.fees],
                        ] as const).map(([label, on]) => (
                          <li key={label} className="flex items-center gap-2 text-[13.5px]">
                            <span className={on ? 'text-green-700' : 'text-muted'}>
                              <Icon name={on ? 'check' : 'x'} className="h-4 w-4" />
                            </span>
                            <span className={'min-w-0 flex-1 ' + (on ? '' : 'text-muted')}>
                              {label}
                            </span>
                            <Pill tone={on ? 'good' : 'neutral'}>
                              {on ? 'Shared' : 'Not shared'}
                            </Pill>
                          </li>
                        ))}
                        {NEVER.map((label) => (
                          <li key={label} className="flex items-center gap-2 text-[13.5px]">
                            <span className="text-muted">
                              <Icon name="x" className="h-4 w-4" />
                            </span>
                            <span className="min-w-0 flex-1 text-muted">{label}</span>
                            <Pill tone="neutral">Never</Pill>
                          </li>
                        ))}
                      </ul>
                      <p className="mt-4 border-t border-line pt-3 text-xs text-muted">
                        {name.split(' ')[0]} turns each of the first three on or off. You are
                        told when one changes; you cannot change it from here.
                      </p>
                    </Card>
                  </section>
                </div>
              </div>
            </section>
          );
        })}

        {family.children.length === 0 ? (
          <Card>
            <Empty icon="users">
              No learner has linked you as a guardian yet. A link is made by the learner
              and shows here once they have confirmed it.
            </Empty>
          </Card>
        ) : null}
      </div>
    </OnyxShell>
  );
}
