import type { Metadata } from 'next';
import { requirePlatformSession } from '@/lib/onyx-platform-session';
import {
  attempt, RosterHeader, SCROLLER, Unavailable,
  type AcademicsPayload, type PeoplePayload,
} from '@/lib/onyx-platform-tenant';
import {
  IssueCertificateForm, RevokeCertificateButton, type HolderOption,
} from '@/components/onyx-platform-forms';
import { DataTable, EmptyRow, Pill } from '@/components/onyx-ui';

export const metadata: Metadata = { title: 'Certificates' };

interface CertificateRow {
  id: number;
  credential_id: string;
  title: string;
  kind: string;
  user_id: string;
  issued_at: string;
  expires_at: string | null;
  revoked_at: string | null;
  revoked_reason: string | null;
}

/** The day it happened, in the institution's timezone. */
const day = (iso: string) => new Date(iso).toLocaleDateString('en-IN',
  { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric' });

/** The four values the column stores, in words a person would use. */
const KIND: Record<string, string> = {
  course: 'Course',
  assessment: 'Assessment',
  contest: 'Contest',
  program: 'Programme',
};

/**
 * CAR-03 from the console -- the institution's register of credentials.
 *
 * WHY THIS PAGE EXISTS. The console could stand an institution up end to end:
 * enrol its people, build its courses, author its question banks, schedule and
 * mark its examinations, publish its results. The one act it could not perform
 * was the one at the end of all that -- issuing the certificate. An operator
 * who had just published a cohort's marks had to be handed that institution's
 * own administrator password to hand out a single credential, which is exactly
 * the handover the console exists to remove.
 *
 * Under Records rather than Academics, beside Grades. A credential is not
 * something the institution teaches; it is something it has said, permanently,
 * about somebody -- and the two screens are read on the same afternoon.
 */
export default async function OnyxPlatformCertificatesPage(
  { params }: { params: Promise<{ id: string }> },
) {
  await requirePlatformSession();
  const { id } = await params;
  const tenantId = Number(id);
  const base = '/api/onyx/platform/tenants/' + encodeURIComponent(id);

  const [certificates, people, academics] = await Promise.all([
    attempt<CertificateRow[]>(base + '/certificates'),
    /*
     * Everybody, not just students: an institution certifies a lecturer's
     * completion of a training programme as readily as a learner's course.
     *
     * 200 is the ceiling for every console list -- the route refuses more and
     * PlatformService clamps to ROW_CAP anyway. Do not raise it here hoping
     * for a longer picker: the route 422s, `attempt` turns that into a null,
     * and the page renders an Issue button that is disabled with nothing on
     * screen saying why. The form says when the list ran out instead, and the
     * institution's own Certificates screen offers the whole roster.
     */
    attempt<PeoplePayload>(base + '/people?limit=200'),
    attempt<AcademicsPayload>(base + '/academics?limit=200'),
  ]);

  const rows = certificates ?? [];
  const roster = people?.people ?? [];
  const holders: HolderOption[] = roster
    .map((p) => ({ user_id: p.user_id, name: p.name, roll_number: p.roll_number }));
  /**
   * Whether somebody is missing from the picker. Read off the payload's own
   * `capped`, which the route already computes by asking for one more row
   * than it returns -- a fact rather than a guess from a full-looking page.
   */
  const holdersCapped = Boolean(people?.capped);
  /*
   * Names for the register. `issuedCertificates` returns the certificate rows
   * as stored -- a credential carries a `user_id` and nothing else about its
   * holder, deliberately, because the public page must never be able to leak
   * more than a name. So the join happens here, against the roster this page
   * has already fetched for the issue form, rather than by widening what the
   * service returns.
   */
  const holderOf = new Map(roster.map((p) => [p.user_id, p]));
  const courses = academics?.courses ?? [];
  const live = rows.filter((c) => !c.revoked_at).length;

  return (
    <div className="min-w-0 space-y-4">
      <RosterHeader count={rows.length} noun="credential"
        action={
          <IssueCertificateForm tenantId={tenantId} holders={holders} courses={courses}
            capped={holdersCapped} />
        } />

      <p className="max-w-prose text-[13px] text-muted">
        {rows.length
          ? live + ' of ' + rows.length + ' still stand. '
          : ''}
        A credential is never deleted. Revoking one records who did it and why, and
        its public page keeps answering &mdash; it says the credential was revoked
        rather than that it was never issued, which is the only answer useful to
        whoever is holding it. Issuing and revoking are both written to the platform
        audit log against your name.
      </p>

      {certificates === null ? <Unavailable what="credential register" /> : (
        <div tabIndex={0} role="region" aria-label="Certificates" className={SCROLLER}>
          <DataTable
            caption="Credentials issued by this institution, and whether each still stands."
            head={
              <>
                <th scope="col">Certifies</th>
                <th scope="col">Holder</th>
                <th scope="col">Credential id</th>
                <th scope="col">Issued</th>
                <th scope="col">State</th>
                <th scope="col">&nbsp;</th>
              </>
            }
          >
            {rows.length === 0 ? (
              <EmptyRow colSpan={6} icon="award">
                Nothing has been issued. A credential gives its holder an id and a
                public page anyone can check without an account.
              </EmptyRow>
            ) : rows.map((c) => (
              <tr key={c.id} className="align-top">
                <td>
                  <span className="font-semibold">{c.title}</span>
                  <span className="mt-0.5 block text-[12.5px] text-muted">
                    {KIND[c.kind] ?? c.kind}
                  </span>
                </td>
                <td>
                  {/* A holder who has since left the institution is no longer
                      on the roster, and their credential still stands -- so
                      the id is shown rather than an empty cell that reads as
                      a bug. */}
                  {holderOf.get(c.user_id)?.name
                    ?? <span className="font-mono text-[12px] text-muted">{c.user_id}</span>}
                  {holderOf.get(c.user_id)?.email ? (
                    <span className="mt-0.5 block text-[12.5px] text-muted">
                      {holderOf.get(c.user_id)!.email}
                    </span>
                  ) : null}
                </td>
                {/* Monospaced and unwrapped: this is the string somebody reads
                    off a printed certificate and types into the checker. */}
                <td className="whitespace-nowrap font-mono text-[12px]">{c.credential_id}</td>
                {/* A plain date, not WhenCell: that one reasons about
                    scheduled-versus-settled records, and an issue date is
                    neither -- it has already happened and cannot move. */}
                <td className="whitespace-nowrap">{day(c.issued_at)}</td>
                <td>
                  {c.revoked_at ? (
                    <>
                      <Pill tone="late">Revoked</Pill>
                      {c.revoked_reason ? (
                        <span className="mt-1 block max-w-[24ch] text-[12.5px] text-muted">
                          {c.revoked_reason}
                        </span>
                      ) : null}
                    </>
                  ) : c.expires_at && Date.parse(c.expires_at) < Date.now()
                    ? <Pill tone="soon">Expired</Pill>
                    : <Pill tone="good">In force</Pill>}
                </td>
                <td className="text-right">
                  <div className="flex flex-col items-end gap-1.5">
                    {/* The public page, opened as a stranger would see it --
                        the only way to check that what was issued is what a
                        verifier actually gets. */}
                    <a href={'/onyx/verify/' + c.credential_id}
                      target="_blank" rel="noreferrer"
                      className="text-[13px] font-semibold text-brand-600 hover:underline">
                      Public page
                    </a>
                    {c.revoked_at ? null : (
                      <RevokeCertificateButton tenantId={tenantId} certificateId={c.id} />
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </DataTable>
        </div>
      )}
    </div>
  );
}
