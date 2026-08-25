import Link from 'next/link';
import type { Metadata } from 'next';
import { requirePlatformSession } from '@/lib/onyx-platform-session';
import { attempt as read, Unavailable, clockTime, tookFor, ago } from '@/lib/onyx-platform-tenant';
import { Card, Icon, Pill, SectionHead } from '@/components/onyx-ui';

export const metadata: Metadata = { title: 'Attempt' };

interface Question {
  question_id: number; type: string; prompt: string; points: number;
  options: { id: string; text: string }[];
  response: unknown;
  auto_points: number | null; manual_points: number | null; marker_comment: string | null;
}
interface ProctorEvent {
  id: number; kind: string; weight: number; detail: unknown; created_at: string;
}
interface AttemptDetail {
  /** Set when the departure rule stopped this paper. */
  terminated_at?: string | null;
  terminated_reason?: string | null;
  breach_count?: number;
  id: number; assessment_id: number; attempt: number; status: string;
  started_at: string | null; submitted_at: string | null;
  auto_score: number | null; manual_score: number | null;
  score: number | null; max_score: number | null;
  integrity_score: number;
  student: { name: string; email: string } | null;
  assessment: { id: number; title: string } | null;
  questions: Question[];
  proctor_events: ProctorEvent[];
}

/** What the candidate put, in the shape the question was asked in. */
function answerText(q: Question): { text: string; blank: boolean } {
  const r = q.response;
  if (r === null || r === undefined || r === '') {
    return { text: 'Left blank', blank: true };
  }
  const label = (id: unknown) =>
    q.options.find((o) => o.id === String(id))?.text ?? String(id);

  if (q.type === 'single') return { text: label(r), blank: false };
  if (q.type === 'truefalse') return { text: String(r) === 'true' ? 'True' : 'False', blank: false };
  if (q.type === 'multiple') {
    const chosen = Array.isArray(r) ? r : [r];
    return chosen.length
      ? { text: chosen.map(label).join(', '), blank: false }
      : { text: 'Left blank', blank: true };
  }
  if (q.type === 'code') {
    // A code answer is `{ language, source }`. Showing the object would print
    // "[object Object]" on somebody's script.
    const given = r as { language?: string; source?: string };
    return { text: String(given?.source ?? r), blank: false };
  }
  const text = String(r).trim();
  return text ? { text, blank: false } : { text: 'Left blank', blank: true };
}

/**
 * One attempt, as the person who sat it made it.
 *
 * `assessmentAttempt` has returned the answers for as long as it has existed,
 * and there was no screen anywhere on the platform side that showed them. An
 * operator investigating a disputed result could see a total and nothing else.
 *
 * The paper shown is the SNAPSHOT this candidate was dealt, not the current
 * question bank: a question edited since they sat is a different question, and
 * showing today's wording against yesterday's answer is how a review reaches
 * the wrong conclusion.
 */
export default async function OnyxPlatformAttemptPage(
  { params }: { params: Promise<{ id: string; attemptId: string }> },
) {
  await requirePlatformSession();
  const { id, attemptId } = await params;
  const tenantId = Number(id);
  const a = await read<AttemptDetail>(
    '/api/onyx/platform/tenants/' + encodeURIComponent(id)
    + '/attempts/' + encodeURIComponent(attemptId));

  if (a === null) return <Unavailable what="attempt" />;

  return (
    <div className="min-w-0 space-y-5">
      <Link
        href={'/onyx/platform/tenants/' + tenantId + '/assessments/' + a.assessment_id}
        className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-brand-700
                   hover:underline"
      >
        <Icon name="chevron" className="h-4 w-4 rotate-180" />
        Back to {a.assessment?.title ?? 'the paper'}
      </Link>

      <Card className="p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-[19px] font-bold text-ink">{a.student?.name ?? 'Unknown'}</h2>
            <div className="break-all text-[12.5px] text-muted">{a.student?.email ?? ''}</div>
            <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[12.5px] text-muted">
              <span>attempt {a.attempt}</span>
              <span>·</span>
              <span>{a.status}</span>
            </div>
            {/* The three times on their own line, because this is the record
                somebody opens an attempt to check. */}
            <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px]">
              <span className="text-muted">
                started <span className="font-semibold tabular-nums text-ink">
                  {clockTime(a.started_at)}
                </span>
              </span>
              <span className="text-muted">
                handed in <span className="font-semibold tabular-nums text-ink">
                  {a.submitted_at ? clockTime(a.submitted_at) : 'still sitting'}
                </span>
              </span>
              <span className="text-muted">
                took <span className="font-semibold tabular-nums text-ink">
                  {tookFor(a.started_at, a.submitted_at)}
                </span>
              </span>
            </div>
          </div>
          <div className="text-right">
            <div className="text-[24px] font-bold tabular-nums">
              {a.score == null ? '—' : a.score}
              <span className="text-[15px] text-muted"> / {a.max_score ?? '?'}</span>
            </div>
            <div className="text-[12px] text-muted">
              {a.auto_score == null ? '' : 'machine ' + a.auto_score}
              {a.manual_score == null ? '' : ' · marker ' + a.manual_score}
            </div>
          </div>
        </div>
      </Card>

      <section>
        <SectionHead title="What they answered" />
        {a.questions.length === 0 ? (
          <Card className="p-5 text-center text-[13px] text-muted">
            This attempt has no paper recorded against it.
          </Card>
        ) : (
          <ol className="space-y-3">
            {a.questions.map((q, i) => {
              const given = answerText(q);
              const awarded = (Number(q.auto_points ?? 0) + Number(q.manual_points ?? 0));
              const marked = q.auto_points != null || q.manual_points != null;
              return (
                <li key={q.question_id}>
                  <Card className="p-4">
                    <div className="flex items-start gap-3">
                      <span className="mt-0.5 min-w-[26px] font-mono text-[13px] font-bold
                                       tabular-nums text-muted">
                        {String(i + 1).padStart(2, '0')}
                      </span>
                      <div className="min-w-0 flex-1 space-y-2.5">
                        <p className="text-[14px] leading-relaxed text-ink">{q.prompt}</p>
                        <div>
                          <p className="text-[12px] font-semibold uppercase tracking-wide
                                        text-muted">
                            Their answer
                          </p>
                          <div className={'mt-1 rounded-xl px-3 py-2 text-[13.5px] leading-relaxed '
                            + (given.blank ? 'bg-slate-50 italic text-muted'
                              : 'bg-slate-50 text-slate-800')}>
                            {q.type === 'code' || q.type === 'essay' ? (
                              <pre className="overflow-x-auto whitespace-pre-wrap break-words
                                              font-mono text-[12.5px]">{given.text}</pre>
                            ) : given.text}
                          </div>
                        </div>
                        {q.marker_comment ? (
                          <div>
                            <p className="text-[12px] font-semibold uppercase tracking-wide
                                          text-muted">
                              Marker’s comment
                            </p>
                            <div className="mt-1 rounded-xl border border-amber-200 bg-amber-50
                                            px-3 py-2 text-[13.5px] leading-relaxed text-amber-900">
                              {q.marker_comment}
                            </div>
                          </div>
                        ) : null}
                      </div>
                      <div className="shrink-0 text-right">
                        <div className="font-mono text-[13px] font-bold tabular-nums">
                          {marked ? awarded : '—'}
                          <span className="text-muted"> / {q.points}</span>
                        </div>
                        <div className="text-[11.5px] text-muted">{q.type}</div>
                      </div>
                    </div>
                  </Card>
                </li>
              );
            })}
          </ol>
        )}
      </section>

      <section>
        <SectionHead title="Invigilation" />
        {a.proctor_events.length === 0 ? (
          <Card className="p-5 text-center text-[13px] text-muted">
            {/* "Nothing recorded" and "nothing happened" are different facts,
                and only the first one is knowable from here. */}
            Nothing was recorded for this attempt — either it was not monitored, or the
            console saw nothing worth writing down.
          </Card>
        ) : (
          <>
            <p className="mb-2 text-[13px] text-muted">
              {a.proctor_events.length} event{a.proctor_events.length === 1 ? '' : 's'},
              weighing <span className="font-semibold text-ink">{a.integrity_score}</span> in
              total. A weight of zero is informational; anything above it is something an
              invigilator was meant to look at.
            </p>
            <ul className="divide-y divide-line rounded-xl border border-line">
              {a.proctor_events.map((e) => (
                <li key={e.id} className="flex items-center gap-2.5 px-3.5 py-2.5 text-[13px]">
                  <Icon name={e.weight > 0 ? 'alert' : 'check'}
                    className={'h-4 w-4 shrink-0 ' + (e.weight > 0 ? 'text-amber-700' : 'text-muted')} />
                  <span className="min-w-0 flex-1 font-mono text-[12.5px]">{e.kind}</span>
                  {e.weight > 0 ? <Pill tone="late">weight {e.weight}</Pill> : null}
                  <span className="shrink-0 text-[12px] text-muted">{ago(e.created_at)}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </div>
  );
}
