'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Card, DataTable, Icon, SectionHead } from '@/components/onyx-ui';

/**
 * People who have asked to join, and the decision somebody has to make.
 *
 * This exists because of what the other registration mode is. When an
 * institution identifies students by their email domain, the address is the
 * evidence and nobody has to approve anything. When it lets a student PICK it
 * from a list, the pick is a claim -- so the membership is created pending and
 * this is where a human turns that claim into a member.
 *
 * Without this screen the second mode would be unusable: requests would
 * accumulate in a table nobody could see, and every applicant would be told
 * their details do not belong to an institution when they tried to sign in.
 *
 * Deliberately at the TOP of the roster and only when there is something
 * waiting. A queue nobody looks at is the same as no queue, and an empty panel
 * on every visit trains people to scroll past the place it will appear.
 */

export interface JoinRequest {
  id: number;
  roll_number: string | null;
  created_at: string;
  user: { name: string; email: string; phone: string | null } | null;
}

/** A date somebody can act on, not an ISO string. */
function when(value: string): string {
  const t = Date.parse(value);
  if (Number.isNaN(t)) return '—';
  return new Date(t).toLocaleDateString('en-IN',
    { day: 'numeric', month: 'short', year: 'numeric' });
}

export function JoinRequests({ requests }: { requests: JoinRequest[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<number | null>(null);

  if (!requests.length) return null;

  const decide = (id: number, approve: boolean, name: string) => {
    // Declining removes the request, so it asks. Approving does not: letting
    // somebody in is the expected outcome and is undone by removing them.
    if (!approve && !window.confirm('Decline ' + name + '? They can ask again.')) return;
    setBusy(id);
    start(async () => {
      setError(null);
      const res = await fetch('/api/proxy/onyx/members/' + id + '/decide', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approve }),
      });
      const body = await res.json().catch(() => ({ ok: false }));
      setBusy(null);
      if (!body.ok) { setError(body.message ?? 'That did not work.'); return; }
      router.refresh();
    });
  };

  return (
    <section className="mb-6">
      <SectionHead title={'Waiting to join · ' + requests.length} />
      <Card className="p-0">
        <p className="border-b border-line px-4 py-3 text-[13px] leading-relaxed text-muted">
          These people chose your institution when they registered. Their email address did
          not prove it, so nobody is in until you say so — they cannot sign in meanwhile.
        </p>

        {error ? (
          <p role="alert" className="border-b border-line bg-red-50 px-4 py-2.5 text-[13px]
                                     text-red-700">
            {error}
          </p>
        ) : null}

        <DataTable
          caption="People waiting to be admitted to this institution"
          head={
            <>
              <th scope="col">Name</th>
              <th scope="col">Email</th>
              <th scope="col">Roll number</th>
              <th scope="col">Asked</th>
              <th scope="col">Decision</th>
            </>
          }
        >
          {requests.map((r) => (
            <tr key={r.id}>
              <td className="font-semibold text-ink">{r.user?.name ?? 'Unknown'}</td>
              <td>
                {/* The address they registered with. It is the one thing here
                    worth reading carefully -- it is what an institution
                    recognises somebody by when the domain did not. */}
                {r.user?.email ? (
                  <a href={'mailto:' + r.user.email} className="text-brand-700 hover:underline">
                    {r.user.email}
                  </a>
                ) : <span className="text-muted">—</span>}
              </td>
              <td>{r.roll_number ?? <span className="text-muted">Not given</span>}</td>
              <td className="whitespace-nowrap">{when(r.created_at)}</td>
              <td>
                <div className="flex flex-wrap justify-end gap-2">
                  <button type="button" disabled={pending && busy === r.id}
                    onClick={() => decide(r.id, true, r.user?.name ?? 'them')}
                    className="inline-flex min-h-[34px] items-center gap-1.5 rounded-xl
                               bg-brand-600 px-3 text-[12.5px] font-bold text-white
                               hover:bg-brand-700 disabled:opacity-50">
                    <Icon name="check" className="h-[15px] w-[15px]" />
                    Let them in
                  </button>
                  <button type="button" disabled={pending && busy === r.id}
                    onClick={() => decide(r.id, false, r.user?.name ?? 'them')}
                    className="min-h-[34px] rounded-xl border border-line px-3 text-[12.5px]
                               font-semibold text-slate-700 hover:bg-red-50 hover:text-red-700
                               disabled:opacity-50">
                    Decline
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </DataTable>
      </Card>
    </section>
  );
}
