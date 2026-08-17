'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  APPLICATION_LABELS,
  type Eligibility, type JobPost, type Readiness, type SkillEntry,
} from '@/lib/onyx-career';
import { formatDate } from '@/lib/when';

/**
 * CAR-05b -- the readiness score, with its working shown.
 *
 * The acceptance criterion is that the learner can see exactly why their score
 * is what it is, so the weights, the raw figures and the counts behind each are
 * all on the page. A number on its own is a number nobody can act on.
 */
export function OnyxReadiness({ readiness }: { readiness: Readiness }) {
  return (
    <section className="rounded-2xl border border-line p-4">
      <div className="flex items-baseline gap-3">
        <div>
          <div className="text-xs uppercase tracking-wide text-muted">Readiness</div>
          <div className="text-3xl font-semibold tabular-nums">{readiness.score}</div>
        </div>
        <p className="text-xs text-muted">
          Out of 100, from the five things below. The weights are fixed and published.
        </p>
      </div>

      <ul className="mt-4 space-y-3">
        {readiness.breakdown.map((c) => (
          <li key={c.key}>
            <div className="flex items-baseline justify-between text-sm">
              <span>{c.label}</span>
              <span className="tabular-nums text-muted">
                {c.points} <span className="text-xs text-muted">of {c.weight}</span>
              </span>
            </div>
            {/* The bar is decoration; the number beside it is the value, and
                the detail line below is the working. Marked so a screen reader
                does not read an empty div. */}
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100"
              role="presentation">
              <div className="h-full bg-brand-600" style={{ width: (c.raw * 100) + '%' }} />
            </div>
            {/* The counts behind the bar, so "why is it 8 of 20" has an answer. */}
            <div className="mt-1 text-xs text-muted">
              {Object.entries(c.detail)
                .map(([k, v]) => k.replace(/_/g, ' ') + ': ' + v)
                .join(' · ')}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** CAR-05a -- the passport. Every skill opens onto what earned it. */
export function OnyxSkills({ skills }: { skills: SkillEntry[] }) {
  if (!skills.length) {
    return (
      <p className="text-sm text-muted">
        No skills recorded yet. They are added as you finish courses, assessments and projects.
      </p>
    );
  }
  return (
    <ul className="space-y-3">
      {skills.map((s) => (
        <li key={s.skill_id} className="rounded-2xl border border-line p-4">
          <details>
            <summary className="cursor-pointer">
              <span className="font-medium">{s.name}</span>
              {s.category ? <span className="ml-2 text-xs text-muted">{s.category}</span> : null}
              <span className="ml-3 tabular-nums text-muted">{s.level}</span>
              <span className="ml-2 text-xs text-muted">
                from {s.evidence_count} piece{s.evidence_count === 1 ? '' : 's'} of evidence
              </span>
            </summary>
            <ul className="mt-3 space-y-1 text-sm text-muted">
              {s.evidence.map((e, i) => (
                <li key={i}>
                  {e.source_type}
                  {e.source_id ? ' #' + e.source_id : ''}
                  <span className="ml-2 tabular-nums text-xs">{e.strength}</span>
                  <span className="ml-2 text-xs text-muted">
                    {formatDate(e.earned_at)}
                  </span>
                </li>
              ))}
            </ul>
          </details>
        </li>
      ))}
    </ul>
  );
}

/**
 * CAR-04b -- applying, with the reason it is or is not possible.
 *
 * A greyed-out button tells somebody nothing. Every rule is listed with what
 * was required and what they have, whether it passed or not.
 */
export function OnyxApply({ job, eligibility, applied }: {
  job: JobPost; eligibility: Eligibility | undefined; applied: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (applied) {
    return <p className="text-sm text-muted">You have applied for this.</p>;
  }

  return (
    <div className="space-y-3">
      {eligibility?.checks.length ? (
        <ul className="space-y-1 text-sm">
          {eligibility.checks.map((c) => (
            <li key={c.rule} className={c.met ? 'text-emerald-700' : 'text-rose-700'}>
              {c.met ? '✓' : '✗'} {c.rule}: {c.required} — you have {c.actual}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted">This post has no eligibility rules.</p>
      )}

      {error ? <p role="alert" className="text-sm text-rose-600">{error}</p> : null}

      <button
        type="button"
        disabled={pending || (eligibility ? !eligibility.eligible : false)}
        onClick={() => start(async () => {
          setError(null);
          const res = await fetch('/api/proxy/onyx/jobs/' + job.id + '/apply', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
          });
          const body = await res.json().catch(() => ({}));
          if (!body.ok) { setError(body.message ?? 'Could not apply.'); return; }
          router.refresh();
        })}
        className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white
                   hover:bg-brand-700 disabled:opacity-50"
      >
        Apply
      </button>
      {eligibility && !eligibility.eligible ? (
        <p className="text-xs text-muted">
          The requirements above are worked out from your record, not typed in by anyone.
        </p>
      ) : null}
    </div>
  );
}

/** CAR-04b -- the employer's pipeline for one post. */
export function OnyxApplicants({ jobId, applicants, names, emails }: {
  jobId: number;
  applicants: { id: number; user_id: string; status: string; created_at: string;
    readiness_at_apply: number | null }[];
  names: Record<string, string>;
  /** Applying shares a candidate's email with the employer/placement office
   *  reviewing this post -- the same consent that shares their name. */
  emails: Record<string, string>;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const decide = (id: number, status: string) => start(async () => {
    setError(null);
    const res = await fetch('/api/proxy/onyx/applications/' + id, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    const body = await res.json().catch(() => ({}));
    if (!body.ok) { setError(body.message ?? 'That did not work.'); return; }
    router.refresh();
  });

  return (
    <div className="space-y-3">
      {error ? <p role="alert" className="text-sm text-rose-600">{error}</p> : null}
      <div className="overflow-x-auto rounded-2xl border border-line bg-white shadow-card">
        <table className="w-full text-sm">
          <thead className="border-b border-line bg-slate-50 text-left text-[11px] font-bold uppercase tracking-[.06em] text-muted">
            <tr>
              <th className="px-4 py-3">Candidate</th>
              <th className="px-4 py-3">Email</th>
              <th className="px-4 py-3">Applied</th>
              <th className="px-4 py-3">Readiness then</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3"><span className="sr-only">Decide</span></th>
            </tr>
          </thead>
          <tbody>
            {applicants.map((a) => (
              <tr key={a.id} className="border-t border-line">
                <td className="px-4 py-3">{names[a.user_id] ?? ('User ' + a.user_id)}</td>
                <td className="px-4 py-3 text-muted">{emails[a.user_id] ?? '—'}</td>
                <td className="px-4 py-3 text-muted">
                  {formatDate(a.created_at)}
                </td>
                <td className="px-4 py-3 tabular-nums text-muted">
                  {a.readiness_at_apply ?? '—'}
                </td>
                <td className="px-4 py-3">{APPLICATION_LABELS[a.status] ?? a.status}</td>
                <td className="px-4 py-3">
                  <select
                    aria-label={'Decision for ' + (names[a.user_id] ?? a.user_id)}
                    value={a.status}
                    disabled={pending}
                    onChange={(e) => decide(a.id, e.target.value)}
                    className="rounded-lg border border-slate-300 px-2 py-1 text-sm"
                  >
                    {['applied', 'shortlisted', 'interviewing', 'offered', 'hired', 'rejected']
                      .map((s) => (
                        <option key={s} value={s}>{APPLICATION_LABELS[s]}</option>
                      ))}
                  </select>
                </td>
              </tr>
            ))}
            {applicants.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-muted">
                  Nobody has applied yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted">
        Withdrawing is the candidate&rsquo;s to do, not yours. Job {jobId}.
      </p>
    </div>
  );
}

/** CAR-01 -- forming or joining a team. */
export function OnyxContestTeams({ contestId, teams, inTeam, teamSize }: {
  contestId: number;
  teams: { id: number; name: string }[];
  inTeam: boolean;
  teamSize: number;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const call = (path: string, body?: unknown) => start(async () => {
    setError(null);
    const res = await fetch('/api/proxy/onyx/' + path, {
      method: 'POST',
      ...(body === undefined ? {} : {
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    });
    const payload = await res.json().catch(() => ({}));
    if (!payload.ok) { setError(payload.message ?? 'That did not work.'); return; }
    router.refresh();
  });

  if (inTeam) {
    return <p className="text-sm text-muted">You are in a team for this contest.</p>;
  }

  return (
    <div className="space-y-3">
      {error ? <p role="alert" className="text-sm text-rose-600">{error}</p> : null}
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const form = e.currentTarget;
          const name = String(new FormData(form).get('name') ?? '').trim();
          if (!name) return;
          call('contests/' + contestId + '/teams', { name });
          form.reset();
        }}
      >
        <label className="sr-only" htmlFor="teamname">Team name</label>
        <input id="teamname" name="name" placeholder="Team name" maxLength={255}
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm" />
        <button type="submit" disabled={pending}
          className="rounded-lg bg-brand-600 px-4 py-1.5 text-sm font-medium text-white
                     hover:bg-brand-700 disabled:opacity-50">
          Start a team
        </button>
      </form>

      {teams.length ? (
        <div>
          <div className="text-xs uppercase tracking-wide text-muted">
            Or join one (up to {teamSize})
          </div>
          <ul className="mt-1 space-y-1 text-sm">
            {teams.map((t) => (
              <li key={t.id} className="flex items-center gap-2">
                <span className="flex-1">{t.name}</span>
                <button type="button" disabled={pending}
                  onClick={() => call('teams/' + t.id + '/join')}
                  className="text-xs text-brand-600 hover:underline disabled:opacity-50">
                  join
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

/** CAR-02 -- the interviewer's form. Writing and releasing are separate. */
export function OnyxInterviewFeedback({ interviewId, existing }: {
  interviewId: number;
  existing: { criterion: string; score: number; of: number; comment?: string | null }[] | null;
}) {
  const router = useRouter();
  const criteria = existing?.length
    ? existing
    : [
      { criterion: 'Communication', score: 0, of: 5, comment: '' },
      { criterion: 'Technical depth', score: 0, of: 5, comment: '' },
      { criterion: 'Problem solving', score: 0, of: 5, comment: '' },
    ];
  const [scores, setScores] = useState<Record<string, string>>(
    () => Object.fromEntries(criteria.map((c) => [c.criterion, String(c.score)])));
  const [comments, setComments] = useState<Record<string, string>>(
    () => Object.fromEntries(criteria.map((c) => [c.criterion, c.comment ?? ''])));
  const [overall, setOverall] = useState('3');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const save = (release: boolean) => start(async () => {
    setError(null); setNotice(null);
    const res = await fetch('/api/proxy/onyx/interviews/' + interviewId + '/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        feedback: criteria.map((c) => ({
          criterion: c.criterion,
          score: Number(scores[c.criterion]) || 0,
          of: c.of,
          comment: comments[c.criterion] || null,
        })),
        overall: Number(overall),
        notes: notes || null,
        release,
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (!body.ok) { setError(body.message ?? 'Could not save.'); return; }
    setNotice(release ? 'Saved and released to the learner.' : 'Saved. Not yet released.');
    router.refresh();
  });

  return (
    <div className="space-y-4">
      <ul className="space-y-3">
        {criteria.map((c) => (
          <li key={c.criterion} className="grid gap-2 sm:grid-cols-[200px_90px_1fr]">
            <span className="text-sm">{c.criterion}</span>
            <input
              type="number" min={0} max={c.of} step="0.5"
              aria-label={c.criterion + ' out of ' + c.of}
              value={scores[c.criterion] ?? ''}
              onChange={(e) => setScores((s) => ({ ...s, [c.criterion]: e.target.value }))}
              className="w-20 rounded-lg border border-slate-300 px-2 py-1 text-sm"
            />
            <input
              aria-label={'Comment on ' + c.criterion}
              value={comments[c.criterion] ?? ''}
              onChange={(e) => setComments((m) => ({ ...m, [c.criterion]: e.target.value }))}
              className="rounded-lg border border-slate-300 px-2 py-1 text-sm"
            />
          </li>
        ))}
      </ul>

      <div className="flex flex-wrap items-center gap-3">
        <label className="text-sm">
          Overall out of 5{' '}
          <input type="number" min={1} max={5} value={overall}
            onChange={(e) => setOverall(e.target.value)}
            className="ml-2 w-20 rounded-lg border border-slate-300 px-2 py-1 text-sm" />
        </label>
      </div>

      <div>
        <label className="block text-sm font-medium text-slate-700" htmlFor="notes">
          Private notes
        </label>
        <textarea id="notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)}
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        {/* Said out loud, because a box that looks private and is not would be
            the worst possible surprise. */}
        <p className="mt-1 text-xs text-muted">
          Never shown to the learner, released or not.
        </p>
      </div>

      {error ? <p role="alert" className="text-sm text-rose-600">{error}</p> : null}
      {notice ? <p role="status" className="text-sm text-emerald-700">{notice}</p> : null}

      <div className="flex flex-wrap gap-3">
        <button type="button" disabled={pending} onClick={() => save(false)}
          className="rounded-lg border border-slate-300 px-4 py-2 text-sm hover:bg-slate-50
                     disabled:opacity-50">
          Save without releasing
        </button>
        <button type="button" disabled={pending} onClick={() => save(true)}
          className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white
                     hover:bg-brand-700 disabled:opacity-50">
          Save and release
        </button>
      </div>
    </div>
  );
}

/**
 * CAR-03 -- revoking a credential.
 *
 * Not an ActionButton with a confirm dialog, because revoking asks for a
 * reason and the API requires one. The reason is not decoration: a credential
 * is never deleted, so what a verifier is eventually told rests on what is
 * typed here.
 */
export function RevokeCertificate({ certificateId }: { certificateId: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (!open) {
    return (
      <button
        type="button" onClick={() => setOpen(true)}
        className="rounded-xl border border-rose-600 px-3 py-1.5 text-[13px] font-semibold
                   text-rose-700 hover:bg-rose-50"
      >
        Revoke
      </button>
    );
  }

  return (
    <form
      className="flex flex-wrap items-start gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (!reason.trim()) { setError('A revocation needs a reason.'); return; }
        start(async () => {
          setError(null);
          const res = await fetch('/api/proxy/onyx/certificates/' + certificateId + '/revoke', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ reason: reason.trim() }),
          });
          const body = await res.json().catch(() => ({ ok: false }));
          if (!body.ok) { setError(body.message ?? 'That did not work.'); return; }
          setOpen(false);
          setReason('');
          router.refresh();
        });
      }}
    >
      <div>
        <label htmlFor={'reason-' + certificateId} className="sr-only">Reason for revoking</label>
        <input
          id={'reason-' + certificateId} value={reason} maxLength={500}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Why it is being revoked"
          className="w-56 rounded-xl border border-slate-300 px-3 py-1.5 text-sm
                     focus:border-brand-600 focus:outline-none"
        />
        {error ? <p role="alert" className="mt-1 text-xs text-rose-700">{error}</p> : null}
      </div>
      <button type="submit" disabled={pending}
        className="rounded-xl bg-rose-600 px-3 py-1.5 text-[13px] font-semibold text-white
                   hover:bg-rose-700 disabled:opacity-60">
        {pending ? 'Revoking…' : 'Confirm'}
      </button>
      <button type="button" onClick={() => { setOpen(false); setError(null); }}
        className="rounded-xl border border-line px-3 py-1.5 text-[13px] font-medium
                   text-slate-700 hover:bg-brand-50">
        Cancel
      </button>
    </form>
  );
}
