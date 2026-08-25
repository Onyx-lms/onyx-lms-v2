import type { Metadata } from 'next';
import { requirePlatformSession, platformApi } from '@/lib/onyx-platform-session';
import { type TenantDetail } from '@/lib/onyx-platform-tenant';
import { SuspendToggle, TenantEditForm, DeleteTenantButton } from '@/components/onyx-platform-forms';
import { Card } from '@/components/onyx-ui';

export const metadata: Metadata = { title: 'Settings' };

/**
 * One institution's settings -- and the only page in this console that can end
 * it.
 *
 * Suspend and delete used to live in the tenant LAYOUT, which meant they were
 * rendered under every tab: an operator reading the fee ledger, the timetable
 * or the grade book found "Delete institution" waiting at the bottom of each
 * one. Nine pages, nine chances to destroy a customer while doing something
 * else. That is the thing this reorganisation exists to remove.
 *
 * They are here now, once, on a page an operator has to choose to open, and
 * ordered by what they cost: rename it, switch its sign-in off (reversible in
 * a click, and nearly always the thing actually wanted), then -- last, behind
 * typing the institution's own name -- delete it.
 */
export default async function OnyxPlatformTenantSettingsPage(
  { params }: { params: Promise<{ id: string }> },
) {
  await requirePlatformSession();
  const { id } = await params;
  const tenant = await platformApi<TenantDetail>(
    '/api/onyx/platform/tenants/' + encodeURIComponent(id));
  const live = tenant.status === 1;

  return (
    <div className="min-w-0 max-w-3xl space-y-4">

      <Card className="p-4">
        <h2 className="text-[15px] font-bold">Institution details</h2>
        <p className="mt-1 max-w-prose text-[13px] text-muted">
          The name shown to everyone here, the address they sign in at, and the plan label this
          console files them under.
        </p>
        <dl className="mt-3 grid gap-x-6 gap-y-2 border-t border-line pt-3 text-[13.5px]
                       sm:grid-cols-3">
          <div>
            <dt className="text-[11px] font-bold uppercase tracking-[.06em] text-muted">Name</dt>
            <dd className="mt-0.5 break-words font-semibold">{tenant.name}</dd>
          </div>
          <div>
            <dt className="text-[11px] font-bold uppercase tracking-[.06em] text-muted">Address</dt>
            <dd className="mt-0.5 break-all font-mono text-[12.5px]">{tenant.slug}</dd>
          </div>
          <div>
            <dt className="text-[11px] font-bold uppercase tracking-[.06em] text-muted">Plan</dt>
            <dd className="mt-0.5">
              {tenant.plan ?? <span className="text-muted">Not set</span>}
            </dd>
          </div>
          <div className="sm:col-span-3">
            <dt className="text-[11px] font-bold uppercase tracking-[.06em] text-muted">
              Community link
            </dt>
            <dd className="mt-0.5 break-all">
              {tenant.community_url
                ? <span className="font-mono text-[12.5px]">{tenant.community_url}</span>
                : <span className="text-muted">
                    Not set — no button on their Jobs page
                  </span>}
            </dd>
          </div>
        </dl>
        <div className="mt-3">
          <TenantEditForm
            tenant={{
              id: tenant.id, name: tenant.name, slug: tenant.slug, plan: tenant.plan,
              community_url: tenant.community_url ?? null,
              community_label: tenant.community_label ?? null,
            }}
          />
        </div>
      </Card>

      <Card className={'p-4 ' + (live ? '' : 'border-amber-300 bg-amber-50/50')}>
        <h2 className="text-[15px] font-bold">Sign-in</h2>
        <p className="mt-1 max-w-prose text-[13px] text-muted">
          {live
            ? 'Everyone at this institution can sign in. Suspending stops all of them at the door — their data is untouched, and it reverses in a click.'
            : 'Nobody here can sign in at the moment. Their data is untouched; reactivating restores access immediately.'}
        </p>
        <div className="mt-3 border-t border-line pt-3">
          <SuspendToggle tenantId={tenant.id} suspended={!live} />
        </div>
      </Card>

      {/* Last on the page, and the only place in the console it appears at all.
          DangerPanel supplies its own heading and its own red frame, so this
          section is the panel rather than a box around one. */}
      <Card className="p-4">
        <h2 className="text-[15px] font-bold">Danger zone</h2>
        <p className="mt-1 max-w-prose text-[13px] text-muted">
          {tenant.member_count === 1 ? 'One person' : tenant.member_count + ' people'} and
          everything they have done here depend on this institution existing.
        </p>
        <DeleteTenantButton tenantId={tenant.id} tenantName={tenant.name} />
      </Card>
    </div>
  );
}
