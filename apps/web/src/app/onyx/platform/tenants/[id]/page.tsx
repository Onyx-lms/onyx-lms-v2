import type { Metadata } from 'next';
import { requirePlatformSession, platformApi } from '@/lib/onyx-platform-session';
import {
  attempt, ago, plural, type TenantDetail, type AdminRow,
} from '@/lib/onyx-platform-tenant';
import { Card, Empty, StatTile } from '@/components/onyx-ui';

export const metadata: Metadata = { title: 'Institution' };

/** The overview: the headline numbers and the facts that do not belong to
 * any one section -- everything else is one click away on its own tab. */
export default async function OnyxPlatformTenantOverviewPage(
  { params }: { params: Promise<{ id: string }> },
) {
  await requirePlatformSession();
  const { id } = await params;
  const base = '/api/onyx/platform/tenants/' + encodeURIComponent(id);

  const tenant = await platformApi<TenantDetail>(base);
  const admins = await attempt<AdminRow[]>('/api/onyx/platform/admins');

  const studentCount = tenant.members_by_role.student ?? 0;
  const facultyCount = tenant.members_by_role.faculty ?? 0;

  return (
    <div className="min-w-0 space-y-6">
      <div className="grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Students" value={studentCount}
          note={plural(tenant.counts.enrollments, 'enrolment')} />
        <StatTile label="Faculty" value={facultyCount}
          note={plural(tenant.counts.programmes, 'programme')} />
        <StatTile label="Courses" value={tenant.counts.courses}
          note={plural(tenant.counts.batches, 'batch', 'batches')} />
        <StatTile label="Assessments" value={tenant.counts.assessments}
          note={plural(tenant.counts.assignments, 'assignment')} />
      </div>

      <div className="grid min-w-0 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card className="p-4">
          <h2 className="text-[11px] font-bold uppercase tracking-[.08em] text-muted">
            Institution
          </h2>
          {/* Address and plan used to be here too. They are in the strip at
              the top of every section now, and a fact stated twice on one
              screen is a screen that has not decided where it lives. */}
          <dl className="mt-3 space-y-3">
            <div>
              <dt className="text-[11px] font-bold uppercase tracking-[.08em] text-muted">Id</dt>
              <dd className="mt-0.5 font-mono text-[13px]">#{tenant.id}</dd>
            </div>
            <div>
              <dt className="text-[11px] font-bold uppercase tracking-[.08em] text-muted">
                Created
              </dt>
              <dd className="mt-0.5 text-[13px]">{ago(tenant.created_at)}</dd>
            </div>
          </dl>
        </Card>

        <Card className="p-4">
          <h2 className="text-[11px] font-bold uppercase tracking-[.08em] text-muted">
            Members &middot; {tenant.member_count}
          </h2>
          {tenant.member_count === 0 ? (
            <div className="mt-2"><Empty icon="users">Nobody has joined yet.</Empty></div>
          ) : (
            <ul className="mt-3 space-y-1.5">
              {Object.entries(tenant.members_by_role)
                .sort((a, b) => b[1] - a[1])
                .map(([role, count]) => (
                  <li key={role}
                    className="flex min-w-0 items-center justify-between gap-2 text-[13px]">
                    <span className="min-w-0 truncate capitalize">{role}</span>
                    <span className="shrink-0 font-semibold tabular-nums">{count}</span>
                  </li>
                ))}
            </ul>
          )}
        </Card>

        <Card className="p-4">
          <h2 className="text-[11px] font-bold uppercase tracking-[.08em] text-muted">
            Records
          </h2>
          <dl className="mt-3 space-y-3">
            <div>
              <dt className="text-[11px] font-bold uppercase tracking-[.08em] text-muted">
                Enrolments
              </dt>
              <dd className="mt-0.5 text-[13px]">{tenant.counts.enrollments}</dd>
            </div>
            <div>
              <dt className="text-[11px] font-bold uppercase tracking-[.08em] text-muted">
                Submissions
              </dt>
              <dd className="mt-0.5 text-[13px]">{tenant.counts.submissions}</dd>
            </div>
            <div>
              <dt className="text-[11px] font-bold uppercase tracking-[.08em] text-muted">
                Exams
              </dt>
              <dd className="mt-0.5 text-[13px]">
                {tenant.counts.exams} scheduled &middot; {tenant.counts.exam_marks} marks
              </dd>
            </div>
            <div>
              <dt className="text-[11px] font-bold uppercase tracking-[.08em] text-muted">
                Attempts
              </dt>
              <dd className="mt-0.5 text-[13px]">{tenant.counts.attempts}</dd>
            </div>
          </dl>
        </Card>
      </div>

      <Card className="p-4">
        <h2 className="text-[11px] font-bold uppercase tracking-[.08em] text-muted">
          Platform admins who can reach this institution
        </h2>
        {admins === null || admins.length === 0 ? (
          <div className="mt-2"><Empty icon="shield">Not reachable from here.</Empty></div>
        ) : (
          <ul className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {admins.map((a) => (
              <li key={a.id} className="min-w-0 text-[13px]">
                <div className="truncate font-semibold">
                  {a.user?.name ?? 'Account #' + a.user_id}
                </div>
                <div className="break-all text-[12.5px] text-muted">{a.user?.email ?? '—'}</div>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 border-t border-line pt-3 text-[12.5px] text-muted">
          Everyone listed can read this institution and suspend it.
        </p>
      </Card>
    </div>
  );
}
