import type { Metadata } from 'next';
import Link from 'next/link';
import { OnyxShell } from '@/components/onyx-shell';
import { DomainComposer } from '@/components/onyx-domain-composer';
import { navFor } from '@/lib/onyx-nav';
import { onyxApi, onyxApiSafe, requireOnyxSession, type Me } from '@/lib/onyx-session';
import { Card, CardGrid, Empty, Icon, Pill } from '@/components/onyx-ui';
import type { OnyxDomainRow } from '@/lib/onyx-domains';
import { domainPrice } from '@/lib/onyx-domains';

export const metadata: Metadata = { title: 'Live Classes' };

/**
 * Live Classes -- the domains this institution advertises.
 *
 * Empty on day one, and that is the point rather than a bug: an institution has
 * not said what it offers until somebody says it. The empty state says so in
 * different words depending on whether the reader is the person who can fix it.
 *
 * Every member sees this page. There is no role guard here because there is no
 * role rule to enforce -- the API is the control, and it lets any member read.
 * What varies is the "+", which appears only for somebody holding
 * `domains.manage`.
 */
export default async function OnyxDomainsPage() {
  await requireOnyxSession();

  const [me, domains, perms] = await Promise.all([
    onyxApi<Me>('/api/onyx/me'),
    // `?all=1` is safe to send always: the route honours it only for the roles
    // that could hide a domain in the first place, the same trick /courses uses.
    onyxApi<OnyxDomainRow[]>('/api/onyx/domains?all=1'),
    onyxApiSafe<{ mine: string[] }>('/api/onyx/permissions'),
  ]);

  // Asked of the API rather than worked out here. The permissions endpoint
  // already returns what THIS caller may do, so the screen has no second,
  // drifting copy of the rules.
  const mayManage = (perms?.mine ?? []).includes('domains.manage');

  return (
    <OnyxShell
      me={me}
      nav={navFor(me.role)}
      title="Live Classes"
      subtitle={domains.length
        ? domains.length + (domains.length === 1 ? ' domain' : ' domains') + ' at '
          + me.tenant.name
        : 'What ' + me.tenant.name + ' offers, and what each one covers.'}
      action={mayManage ? <DomainComposer /> : undefined}
    >
      {domains.length === 0 ? (
        <Card className="p-2">
          <Empty icon="video">
            {mayManage
              ? 'No domains yet. Add the first one and it appears here straight away.'
              : 'Your institution has not published any domains yet.'}
          </Empty>
        </Card>
      ) : (
        <CardGrid>
          {domains.map((d) => (
            <Card key={d.id}
              className="group relative flex min-w-0 flex-col gap-2.5 overflow-hidden p-0
                         transition hover:-translate-y-0.5 hover:border-brand-200
                         hover:shadow-lift">
              {/* The whole tile is one click target: this sits over the card and
                  under everything else, so any real control inside stays
                  independently clickable while the space around it still opens
                  the domain. */}
              <Link href={'/onyx/domains/' + d.id} aria-label={'Open ' + d.title}
                className="absolute inset-0 z-0" />

              {/* A plain <img>: the thumbnail comes from Supabase Storage, which
                  is not in next.config's remotePatterns, and adding a host there
                  to gain optimisation of one marketing image is not the trade. */}
              {d.image_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={d.image_url} alt="" aria-hidden="true"
                  className="h-36 w-full bg-slate-100 object-cover" />
              ) : (
                <div aria-hidden="true"
                  className="grid h-36 w-full place-items-center bg-gradient-to-br
                             from-brand-50 to-brand-100 text-brand-600">
                  <Icon name="video" className="h-8 w-8 opacity-70" />
                </div>
              )}

              <div className="relative z-10 flex min-w-0 flex-col gap-2 p-4 pt-1">
                <div className="flex flex-wrap items-center gap-2">
                  {d.duration_label
                    ? <Pill tone="neutral">{d.duration_label}</Pill> : null}
                  {/* Only staff ever see a hidden one -- ?all=1 is a no-op for
                      anyone else -- so the pill has nobody but them to confuse. */}
                  {d.status !== 1 ? <Pill tone="late">Hidden</Pill> : null}
                </div>

                <h2 className="min-w-0 text-[15.5px] font-bold leading-snug">{d.title}</h2>

                {d.summary ? (
                  <p className="line-clamp-3 text-[13px] leading-relaxed text-muted">
                    {d.summary}
                  </p>
                ) : null}

                <div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-1">
                  <span className="text-[15px] font-extrabold tabular-nums">
                    {domainPrice(d)}
                  </span>
                  {d.certificate ? (
                    <span className="inline-flex items-center gap-1 text-[12px] text-muted">
                      <Icon name="award" className="h-3.5 w-3.5" />
                      Certificate
                    </span>
                  ) : null}
                </div>
              </div>
            </Card>
          ))}
        </CardGrid>
      )}
    </OnyxShell>
  );
}
