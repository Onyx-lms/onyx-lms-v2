import Link from 'next/link';
import type { Metadata } from 'next';
import { OnyxShell } from '@/components/onyx-shell';
import { OnyxIntegrityTimeline } from '@/components/onyx-marking';
import { navFor } from '@/lib/onyx-nav';
import { requireOnyxPageRole, onyxApi, type Me, onyxApiRecord } from '@/lib/onyx-session';
import { formatClock, type ProctorTimeline } from '@/lib/onyx-assess';
import {
  Banner, Buckets, Card, CardGrid, Icon, SectionHead, StackBar, State, StatTile,
} from '@/components/onyx-ui';

export const metadata: Metadata = { title: 'Integrity' };

/** A label/value line, at the one size the rail uses everywhere. */
function Fact({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-line py-2
                    first:pt-0 last:border-0 last:pb-0">
      <dt className="text-[13px] text-muted">{k}</dt>
      <dd className="min-w-0 text-right text-[13.5px] font-semibold">{v}</dd>
    </div>
  );
}

/** Status as a dot AND a word — a colour on its own decides nothing here. */
function statusTone(status: string): 'on' | 'off' | 'idle' {
  const s = status.toLowerCase();
  if (s === 'clean' || s === 'cleared' || s === 'dismissed') return 'on';
  if (s === 'upheld') return 'off';
  return 'idle';
}

/**
 * ASS-02b -- one attempt's integrity timeline, and the decisions on it.
 *
 * The banner is not decoration. A flag is what a browser noticed, not proof
 * of anything, and a screen that implies otherwise is how proctoring gets a
 * deserved bad name -- so the caveat is the first thing read, above the score.
 */
export default async function OnyxIntegrityPage({ params }: { params: Promise<{ id: string }> }) {
  await requireOnyxPageRole('admin', 'faculty', 'exams');
  const { id } = await params;
  const [me, timeline] = await Promise.all([
    onyxApi<Me>('/api/onyx/me'),
    onyxApiRecord<ProctorTimeline>('/api/onyx/attempts/' + id + '/proctor'),
  ]);

  // Severity comes off the weight the recorder assigned, not off a colour a
  // page picked. Every bucket carries its event count and its points.
  const weighted = timeline.events.filter((e) => e.weight > 0);
  const open = weighted.filter((e) => e.review === 'open');
  const bucket = (lo: number, hi: number) =>
    weighted.filter((e) => e.weight >= lo && e.weight <= hi);
  const high = bucket(4, Infinity);
  const medium = bucket(2, 3);
  const low = bucket(1, 1);
  const points = (list: typeof weighted) => list.reduce((n, e) => n + Number(e.weight), 0);

  const stamp = (iso: string | null) => iso
    ? new Date(iso).toLocaleString(undefined,
      { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
    : null;
  // Elapsed wall-clock, capped at the time the paper actually allowed.
  //
  // `submitted_at` is stamped when the attempt is finalised, which for an
  // attempt nobody swept is whenever that finally happened -- so a ten-minute
  // paper reported "4:00:39" and looked like an exam that had run for four
  // hours. It never did: answers are refused past `expires_at`, and a
  // late hand-in is now recorded as an expiry. This is the display half of
  // the same finding. Overrun is kept visible rather than hidden, because an
  // invigilator reviewing an attempt should be able to see that it was
  // finalised late.
  const allowed = timeline.expires_at
    ? Math.max(0, Math.round(
      (Date.parse(timeline.expires_at) - Date.parse(timeline.started_at)) / 1000))
    : null;
  const elapsed = timeline.submitted_at
    ? Math.max(0, Math.round(
      (Date.parse(timeline.submitted_at) - Date.parse(timeline.started_at)) / 1000))
    : null;
  const sat = elapsed === null ? null
    : allowed === null ? elapsed
      : Math.min(elapsed, allowed);
  const overran = elapsed !== null && allowed !== null && elapsed > allowed + 60;

  return (
    <OnyxShell
      me={me}
      nav={navFor(me.role)}
      title="Integrity review"
      subtitle={'Attempt ' + timeline.attempt_id + ' · candidate ' + timeline.user_id}
    >
      <nav aria-label="Breadcrumb" className="mb-3 flex flex-wrap items-center gap-1.5 text-sm text-muted">
        <Link href="/onyx/invigilate" className="font-semibold text-brand-600 hover:underline">
          Invigilate
        </Link>
        <Icon name="chevron" className="h-3.5 w-3.5 text-faint" />
        <span>Attempt {timeline.attempt_id}</span>
      </nav>

      {/* This sentence is the screen's whole posture, and it is read first. */}
      <Banner tone="info" icon="shield">
        A flag is evidence, not a verdict. Nothing here fails anybody on its own — the decision
        is yours, it is recorded against your name, and the candidate can see the outcome.
      </Banner>

      <div className="mt-4 grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
        <div className="min-w-0 space-y-6">
          <CardGrid min="11rem">
            <StatTile label="Integrity points" value={timeline.integrity_flags}
              note={weighted.length + ' weighted '
                + (weighted.length === 1 ? 'event' : 'events')} />
            <StatTile label="Still open" value={open.length}
              note={'of ' + weighted.length + ' to decide'} />
            <StatTile label="Recorded" value={timeline.events.length}
              note="events in the timeline" />
            <StatTile label="Consent"
              value={timeline.consented_at ? 'Given' : 'None'}
              note={timeline.consented_at
                ? 'before the paper started' : 'no consent was recorded'} />
          </CardGrid>

          {weighted.length ? (
            <section>
              <SectionHead title={'What the ' + timeline.integrity_flags + ' points are made of'} />
              <Card className="p-4">
                <StackBar parts={[
                  { value: points(high), className: 'bg-red-600' },
                  { value: points(medium), className: 'bg-accent-500' },
                  { value: points(low), className: 'bg-brand-400' },
                ]} />
                <Buckets rows={[
                  { label: 'High — weight 4 and above', dotClass: 'bg-red-600',
                    count: high.length + (high.length === 1 ? ' event' : ' events'),
                    amount: points(high) + ' pts' },
                  { label: 'Medium — weight 2 to 3', dotClass: 'bg-accent-500',
                    count: medium.length + (medium.length === 1 ? ' event' : ' events'),
                    amount: points(medium) + ' pts' },
                  { label: 'Low — weight 1', dotClass: 'bg-brand-400',
                    count: low.length + (low.length === 1 ? ' event' : ' events'),
                    amount: points(low) + ' pts' },
                ]} />
              </Card>
            </section>
          ) : null}

          {/* Offsets from the start of the paper, not wall-clock stamps: what
              decides a case is how far apart two events are, and a column of
              "14:38:55" makes that a subtraction. */}
          <section>
            <SectionHead title="Timeline" />
            <OnyxIntegrityTimeline timeline={timeline} />
          </section>
        </div>

        <aside className="min-w-0 space-y-6">
          <section>
            <SectionHead title="Decision" />
            <Card className="p-4">
              <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <State tone={statusTone(timeline.integrity_status)}>
                  <span className="capitalize">{timeline.integrity_status}</span>
                </State>
                <span className="text-[13px] text-muted">
                  {open.length
                    ? open.length + (open.length === 1 ? ' event still open' : ' events still open')
                    : 'every event has been decided'}
                </span>
              </p>
              <p className="mt-3 text-[13px] leading-relaxed text-muted">
                Dismissing releases the score into the cohort as normal. Upholding holds it and
                opens a case — it does not change the marks. Both decisions are made on the
                timeline, and both are recorded against your name.
              </p>
            </Card>
          </section>

          <section>
            <SectionHead title="The attempt" />
            <Card className="p-4">
              <dl>
                <Fact k="Attempt" v={<span className="tabular-nums">{timeline.attempt_id}</span>} />
                <Fact k="Candidate" v={<span className="tabular-nums">{timeline.user_id}</span>} />
                <Fact k="Started" v={stamp(timeline.started_at) ?? '—'} />
                <Fact k="Handed in" v={stamp(timeline.submitted_at) ?? 'Not handed in'} />
                <Fact k="Time taken"
                  v={sat === null
                    ? '—'
                    : (
                      <span className="tabular-nums">
                        {formatClock(sat)}
                        {overran ? (
                          <span className="ml-1.5 text-[12px] tabular-nums text-muted">
                            (finalised {formatClock(elapsed! - allowed!)} late)
                          </span>
                        ) : null}
                      </span>
                    )} />
                <Fact k="Consent" v={stamp(timeline.consented_at) ?? 'None recorded'} />
              </dl>
              <div className="mt-3.5 border-t border-line pt-3.5">
                <Link href={'/onyx/attempts/' + id + '/mark'}
                  className="inline-flex min-h-[38px] items-center gap-1.5 rounded-2xl border
                             border-line px-3.5 text-[13px] font-bold text-slate-700
                             hover:bg-brand-50">
                  <Icon name="file" className="h-4 w-4" /> See the script
                </Link>
              </div>
            </Card>
          </section>
        </aside>
      </div>
    </OnyxShell>
  );
}
