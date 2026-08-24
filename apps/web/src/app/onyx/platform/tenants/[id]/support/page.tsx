import type { Metadata } from 'next';
import { requirePlatformSession } from '@/lib/onyx-platform-session';
import { attempt, SCROLLER, Unavailable, ago } from '@/lib/onyx-platform-tenant';
import { TicketReply } from '@/components/onyx-platform-forms';
import { Card, DataTable, EmptyRow, Icon, Pill, SectionHead } from '@/components/onyx-ui';

export const metadata: Metadata = { title: 'Help' };

export interface ConsoleTicket {
  id: number;
  subject: string;
  body: string;
  status: string;
  priority: string;
  raised_by: string;
  raised_by_name?: string | null;
  owner_id: string | null;
  owner_name?: string | null;
  course_id: number | null;
  created_at: string;
  updated_at?: string | null;
  responded_at?: string | null;
  resolved_at?: string | null;
}

/** Waiting reads as waiting; answered and resolved read as done. */
const TONE: Record<string, 'good' | 'late' | 'brand' | 'neutral'> = {
  open: 'late', assigned: 'brand', answered: 'good', resolved: 'good', closed: 'neutral',
};

/**
 * The institution's support queue, from the platform console.
 *
 * A learner raises a question from Help and it lands in this queue. The
 * console had no view of it at all — so an operator could be told "nobody has
 * answered my ticket" and had no way to look, let alone answer.
 *
 * The whole institution's queue rather than one person's: an operator reads it
 * as an administrator of that institution, which is what they are with respect
 * to it. A learner asking the same endpoint gets only their own, and that
 * filter comes from the token's role rather than from anything in the request.
 *
 * Unanswered ones are counted and led with, because a queue is read to find
 * what nobody has dealt with, not to admire what has been.
 */
export default async function OnyxPlatformSupportPage(
  { params }: { params: Promise<{ id: string }> },
) {
  await requirePlatformSession();
  const { id } = await params;
  const tenantId = Number(id);
  const tickets = await attempt<ConsoleTicket[]>(
    '/api/onyx/platform/tenants/' + encodeURIComponent(id) + '/tickets');

  if (tickets === null) return <Unavailable what="support queue" />;

  const waiting = tickets.filter((t) => t.status === 'open' || t.status === 'assigned');
  const done = tickets.filter((t) => !waiting.includes(t));

  return (
    <div className="min-w-0 space-y-5">
      <div className="grid gap-3 sm:grid-cols-3">
        <Card className="p-3.5">
          <div className="text-[22px] font-bold tabular-nums">{tickets.length}</div>
          <div className="text-[12.5px] text-muted">questions raised</div>
        </Card>
        <Card className="p-3.5">
          <div className="text-[22px] font-bold tabular-nums">{waiting.length}</div>
          <div className="text-[12.5px] text-muted">still waiting on an answer</div>
        </Card>
        <Card className="p-3.5">
          <div className="text-[22px] font-bold tabular-nums">
            {tickets.filter((t) => !t.owner_id).length}
          </div>
          <div className="text-[12.5px] text-muted">nobody has claimed</div>
        </Card>
      </div>

      {tickets.length === 0 ? (
        <Card className="p-8 text-center">
          <Icon name="help" className="mx-auto h-6 w-6 text-muted" />
          <p className="mt-2 text-[14px] font-semibold text-ink">Nothing has been asked yet.</p>
          <p className="mx-auto mt-1 max-w-sm text-[13px] leading-relaxed text-muted">
            Learners raise questions from Help, and they arrive here.
          </p>
        </Card>
      ) : (
        <>
          <section>
            <SectionHead title="Waiting" />
            <div tabIndex={0} role="region" aria-label="Open questions" className={SCROLLER}>
              <DataTable
                caption="Questions raised by learners that nobody has answered yet."
                head={
                  <>
                    <th scope="col">Question</th>
                    <th scope="col">Raised by</th>
                    <th scope="col">State</th>
                    <th scope="col">When</th>
                    <th scope="col">&nbsp;</th>
                  </>
                }
              >
                {waiting.length === 0 ? (
                  <EmptyRow colSpan={5} icon="check">
                    Everything raised has been answered.
                  </EmptyRow>
                ) : waiting.map((t) => (
                  <tr key={t.id} className="align-top">
                    <td>
                      <div className="font-semibold">{t.subject}</div>
                      {/* The question itself, not only its title: an operator
                          deciding whether they can answer needs to read it,
                          and a second click to find out is a second click on
                          every row. */}
                      <div className="mt-0.5 line-clamp-3 max-w-xl text-[12.5px]
                                      leading-relaxed text-muted">
                        {t.body}
                      </div>
                    </td>
                    <td className="text-[13px]">
                      {t.raised_by_name ?? <span className="text-muted">Unknown</span>}
                      {t.owner_name ? (
                        <div className="text-[12px] text-muted">with {t.owner_name}</div>
                      ) : (
                        <div className="text-[12px] text-muted">unclaimed</div>
                      )}
                    </td>
                    <td>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Pill tone={TONE[t.status] ?? 'neutral'}>{t.status}</Pill>
                        {t.priority !== 'normal'
                          ? <Pill tone="neutral">{t.priority}</Pill> : null}
                      </div>
                    </td>
                    <td className="whitespace-nowrap text-[12.5px] text-muted">
                      {ago(t.created_at)}
                    </td>
                    <td className="text-right">
                      <TicketReply tenantId={tenantId} ticket={t} />
                    </td>
                  </tr>
                ))}
              </DataTable>
            </div>
          </section>

          {done.length ? (
            <section>
              <SectionHead title="Answered" />
              <div tabIndex={0} role="region" aria-label="Answered questions" className={SCROLLER}>
                <DataTable
                  caption="Questions that have had an answer or been resolved."
                  head={
                    <>
                      <th scope="col">Question</th>
                      <th scope="col">Raised by</th>
                      <th scope="col">State</th>
                      <th scope="col">When</th>
                      <th scope="col">&nbsp;</th>
                    </>
                  }
                >
                  {done.map((t) => (
                    <tr key={t.id} className="align-top">
                      <td>
                        <div className="font-semibold">{t.subject}</div>
                        <div className="mt-0.5 line-clamp-2 max-w-xl text-[12.5px] text-muted">
                          {t.body}
                        </div>
                      </td>
                      <td className="text-[13px]">
                        {t.raised_by_name ?? <span className="text-muted">Unknown</span>}
                      </td>
                      <td><Pill tone={TONE[t.status] ?? 'neutral'}>{t.status}</Pill></td>
                      <td className="whitespace-nowrap text-[12.5px] text-muted">
                        {ago(t.responded_at ?? t.updated_at ?? t.created_at)}
                      </td>
                      <td className="text-right">
                        <TicketReply tenantId={tenantId} ticket={t} />
                      </td>
                    </tr>
                  ))}
                </DataTable>
              </div>
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}
