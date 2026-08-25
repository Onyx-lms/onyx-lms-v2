import Link from 'next/link';
import type { Metadata } from 'next';
import { OnyxShell } from '@/components/onyx-shell';
import { navFor } from '@/lib/onyx-nav';
import { requireOnyxPageRole, onyxApi, onyxApiSafe, type Me } from '@/lib/onyx-session';
import type { Certificate } from '@/lib/onyx-career';
import type { Course } from '@/lib/onyx-learn';
import { CreatePanel } from '@/components/onyx-create';
import { RevokeCertificate } from '@/components/onyx-career';
import { DataTable, EmptyRow, Icon, Pill, StatTile } from '@/components/onyx-ui';
import { dayNumber } from '@/lib/onyx-time';

export const metadata: Metadata = { title: 'Certificates' };

/**
 * "2 days ago", not "8/9/2026".
 *
 * A register is scanned for what happened recently, and a locale date string
 * makes that a subtraction the reader has to do in their head.
 */
function ago(iso: string, now: number): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '—';
  // Midnight in the institution's zone, not the runtime's -- see
  // `dayNumber` in lib/onyx-time.ts for what that fixed.
  const startOf = (ms: number) => dayNumber(ms) * 86_400_000;
  const d = Math.round((startOf(now) - startOf(t)) / 86_400_000);
  if (d <= 0) return 'Today';
  if (d === 1) return 'Yesterday';
  if (d <= 13) return d + ' days ago';
  if (d <= 60) return Math.round(d / 7) + ' weeks ago';
  if (d <= 730) return Math.round(d / 30) + ' months ago';
  return Math.round(d / 365) + ' years ago';
}

/**
 * CAR-03 -- the institution's register of credentials.
 *
 * "Verifiable, shareable skill certificates." Issuing one was a staff endpoint
 * with no caller anywhere in the product, so the only way to give a learner a
 * credential was to POST it by hand -- and because nothing listed what had been
 * issued, revoking one meant already knowing the row. Both halves live here.
 *
 * Revoked rows stay in the list rather than disappearing. Somebody out there is
 * holding the credential, and the register is the thing that has to explain
 * what happened to it.
 */
export default async function OnyxCertificatesPage() {
  const claims = await requireOnyxPageRole('admin', 'exams', 'placement');

  const [me, certificates, members, courses] = await Promise.all([
    onyxApi<Me>('/api/onyx/me'),
    onyxApi<Certificate[]>('/api/onyx/certificates'),
    onyxApiSafe<{ user_id: string; role: string; user: { name: string; email: string } | null }[]>(
      '/api/onyx/members'),
    onyxApiSafe<Course[]>('/api/onyx/courses'),
  ]);

  const learners = (members ?? []).filter((m) => m.role === 'student');
  const names = new Map((members ?? []).map((m) => [m.user_id, m.user]));
  const live = certificates.filter((c) => !c.revoked_at).length;

  const now = Date.now();
  const revoked = certificates.filter((c) => c.revoked_at).length;
  const lapsed = certificates.filter((c) => !c.revoked_at && c.expires_at
    && Date.parse(c.expires_at) < now).length;
  const inForce = certificates.length - revoked - lapsed;

  return (
    <OnyxShell
      me={me}
      nav={navFor(me.role)}
      title="Certificates"
      subtitle={
        certificates.length === 0
          ? 'Nothing has been issued yet.'
          : live + ' in force of ' + certificates.length + ' issued'
      }
      action={
        <CreatePanel
          title="Issue a certificate" cta="Issue a certificate" icon="award"
          endpoint="certificates"
          fields={[
            { name: 'user_id', label: 'Holder', type: 'select', required: true,
              // A uuid, so NOT numeric: CreatePanel runs Number() over a
              // numeric field and a uuid becomes NaN, which JSON sends as null and
              // the route refuses. Left over from when user ids were bigints.
              wide: true,
              options: learners.map((m) => ({
                value: String(m.user_id),
                label: (m.user?.name ?? 'User ' + m.user_id) + (m.user?.email ? ' — ' + m.user.email : ''),
              })) },
            { name: 'title', label: 'What it certifies', required: true, wide: true,
              placeholder: 'Introduction to Programming',
              help: 'This appears on the public verification page, so write it for a stranger.' },
            { name: 'kind', label: 'Kind', type: 'select', fallback: 'course',
              options: ['course', 'assessment', 'contest', 'program']
                .map((k) => ({ value: k, label: k })) },
            { name: 'course_id', label: 'Course', type: 'select', numeric: true,
              options: (courses ?? []).map((c) => ({
                value: String(c.id), label: c.code + ' — ' + c.title,
              })),
              help: 'Optional. Ties the credential to a course on the register.' },
            { name: 'expires_at', label: 'Expires', type: 'date',
              help: 'Leave blank for a credential that does not expire.' },
          ]}
        />
      }
    >
      {certificates.length > 0 ? (
        <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile label="Issued" value={certificates.length} note="since this register opened" />
          <StatTile label="In force" value={inForce} note="verifiable by anyone with the id" />
          <StatTile label="Expired" value={lapsed} note="lapsed, never deleted" />
          <StatTile label="Revoked" value={revoked} note="still answer on the public page" />
        </div>
      ) : null}

      {/* tabIndex makes the horizontal scroll reachable by keyboard: a region
          that only scrolls with a wheel strands anyone on a keyboard at
          whatever columns happen to fit. */}
      <div tabIndex={0} role="region" aria-label="Certificate register">
        <DataTable
          caption="Certificates issued by this institution"
          head={
            <>
              <th scope="col">Certifies</th>
              <th scope="col">Holder</th>
              <th scope="col">Credential id</th>
              <th scope="col">Issued</th>
              <th scope="col">State</th>
              <th scope="col"><span className="sr-only">Actions</span></th>
            </>
          }
        >
          {certificates.map((c) => {
            const who = c.user_id ? names.get(c.user_id) : null;
            const expired = Boolean(c.expires_at) && Date.parse(c.expires_at!) < now;
            return (
              <tr key={c.id} className={'align-top ' + (c.revoked_at ? 'bg-slate-50' : '')}>
                <td>
                  <div className="font-semibold">{c.title}</div>
                  <div className="text-[12.5px] capitalize text-muted">{c.kind} certificate</div>
                </td>
                <td>
                  <div className="font-medium">{who?.name ?? 'User ' + c.user_id}</div>
                  <div className="text-[12.5px] text-muted">{who?.email ?? ''}</div>
                </td>
                <td>
                  {/* The verification page is the deliverable, so the id is a
                      link to it rather than a string to copy by hand. */}
                  <Link
                    href={'/onyx/verify/' + c.credential_id}
                    className="font-mono text-xs font-semibold text-brand-700 underline
                               [overflow-wrap:anywhere]"
                  >
                    {c.credential_id}
                  </Link>
                </td>
                <td className="whitespace-nowrap">
                  <div className="text-[13px]">{ago(c.issued_at, now)}</div>
                  <div className="text-[12.5px] text-muted">
                    {c.expires_at
                      ? (expired ? 'lapsed ' + ago(c.expires_at, now)
                        : 'expires ' + new Date(c.expires_at).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' }))
                      : 'does not expire'}
                  </div>
                </td>
                <td>
                  {c.revoked_at ? (
                    <Pill tone="late">
                      <span className="inline-flex items-center gap-1.5">
                        <Icon name="x" className="h-3.5 w-3.5" /> Revoked
                      </span>
                    </Pill>
                  ) : expired ? (
                    <Pill tone="neutral">
                      <span className="inline-flex items-center gap-1.5">
                        <Icon name="clock" className="h-3.5 w-3.5" /> Expired
                      </span>
                    </Pill>
                  ) : (
                    <Pill tone="good">
                      <span className="inline-flex items-center gap-1.5">
                        <Icon name="check" className="h-3.5 w-3.5" /> In force
                      </span>
                    </Pill>
                  )}
                  {c.revoked_reason
                    ? <div className="mt-1 max-w-[22ch] text-[12.5px] text-muted">
                      {c.revoked_reason}
                    </div>
                    : null}
                </td>
                <td>
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    <a
                      href={'/api/proxy/onyx/certificates/' + c.id + '/document.pdf'}
                      download
                      className="inline-flex min-h-[38px] items-center gap-1.5 rounded-2xl border
                                 border-line px-3 text-[13px] font-semibold text-slate-700
                                 hover:bg-brand-50"
                    >
                      <Icon name="download" className="h-4 w-4" />
                      PDF
                    </a>
                    {c.revoked_at ? null : <RevokeCertificate certificateId={c.id} />}
                  </div>
                </td>
              </tr>
            );
          })}
          {certificates.length === 0 ? (
            <EmptyRow colSpan={6} icon="award">
              No credentials have been issued by this institution yet. Issuing one gives the
              holder a credential id and a public page anyone can check without an account.
            </EmptyRow>
          ) : null}
        </DataTable>
      </div>

      <p className="mt-4 max-w-[70ch] text-xs text-muted">
        A credential is never deleted. Revoking records who did it and why, and the public
        page keeps answering — it says the credential was revoked rather than that it was
        never issued, which is the only answer useful to whoever is holding it.
        {claims.tenant_role === 'admin'
          ? ' Both issuing and revoking are written to the audit log.'
          : ''}
      </p>
    </OnyxShell>
  );
}
