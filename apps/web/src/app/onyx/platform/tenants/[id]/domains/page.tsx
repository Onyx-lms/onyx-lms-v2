import type { Metadata } from 'next';
import Link from 'next/link';
import { requirePlatformSession } from '@/lib/onyx-platform-session';
import { attempt, RosterHeader, Unavailable, money } from '@/lib/onyx-platform-tenant';
import {
  CreateDomainForm, DomainRowActions, type ConsoleDomain,
} from '@/components/onyx-platform-forms';
import { Card, CardGrid, Empty, Icon, Pill } from '@/components/onyx-ui';

export const metadata: Metadata = { title: 'Live Classes' };

/**
 * Live Classes, from the platform console.
 *
 * Laid out as the institution's own administrator sees them — a grid of tiles
 * with the banner on each — rather than as a dense table. A Live Class is a
 * thing somebody chose a picture for, and the console was reducing that to a
 * fourteen-pixel thumbnail in a row: an operator could not see what a learner
 * sees, which is most of the reason to look at all.
 *
 * Drafts are shown alongside published ones and marked. The learner-facing
 * list hides them, which is right there and wrong here: an operator asking
 * "what has this institution got" needs the half-finished included.
 *
 * Publish and Remove stay on the tile rather than moving behind the detail
 * page, because the common operator act is triage across the whole catalogue
 * rather than a visit to one of them.
 */
export default async function OnyxPlatformDomainsPage(
  { params }: { params: Promise<{ id: string }> },
) {
  await requirePlatformSession();
  const { id } = await params;
  const tenantId = Number(id);
  const domains = await attempt<ConsoleDomain[]>(
    '/api/onyx/platform/tenants/' + encodeURIComponent(id) + '/domains');
  const rows = domains ?? [];
  const published = rows.filter((d) => d.status === 1).length;

  return (
    <div className="min-w-0 space-y-4">
      <RosterHeader
        count={rows.length} noun="Live Class" plural="Live Classes"
        aside={rows.length ? (
          <span className="text-[13px] text-muted">
            {published} published · {rows.length - published} draft
          </span>
        ) : undefined}
        action={<CreateDomainForm tenantId={tenantId} />}
      />

      {domains === null ? <Unavailable what="Live Classes" /> : rows.length === 0 ? (
        <Card className="p-2">
          <Empty icon="video">
            No Live Classes yet. These are the cohort-based programmes an institution runs
            alongside its courses — each with its own curriculum, duration and price.
          </Empty>
        </Card>
      ) : (
        <CardGrid>
          {rows.map((d) => (
            <Card key={d.id}
              className="group relative flex min-w-0 flex-col overflow-hidden p-0 transition
                         hover:-translate-y-0.5 hover:border-brand-200 hover:shadow-lift">
              {/* The whole tile opens the Live Class. It sits UNDER the
                  controls below, so Publish and Remove stay independently
                  clickable while the space around them still navigates. */}
              <Link href={'/onyx/platform/tenants/' + tenantId + '/domains/' + d.id}
                aria-label={'Open ' + d.title} className="absolute inset-0 z-0" />

              {/* A plain <img>: the banner lives in Supabase Storage, which is
                  not in next.config's remotePatterns, and adding a host there
                  for one marketing image is not the trade. */}
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

              <div className="relative z-10 flex min-w-0 flex-1 flex-col gap-2 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  {d.duration_label ? <Pill tone="neutral">{d.duration_label}</Pill> : null}
                  {d.status === 1
                    ? <Pill tone="good">Published</Pill>
                    : <Pill tone="late">Draft</Pill>}
                </div>

                <h2 className="min-w-0 text-[15.5px] font-bold leading-snug">{d.title}</h2>

                {d.summary ? (
                  <p className="line-clamp-2 text-[13px] leading-relaxed text-muted">
                    {d.summary}
                  </p>
                ) : null}

                <div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-1">
                  <span className="text-[15px] font-extrabold tabular-nums">
                    {d.price_minor ? money(d.price_minor, d.currency) : 'Free'}
                  </span>
                  {d.certificate ? (
                    <span className="inline-flex items-center gap-1 text-[12px] text-muted">
                      <Icon name="award" className="h-3.5 w-3.5" />
                      Certificate
                    </span>
                  ) : null}
                </div>

                <div className="border-t border-line pt-2.5">
                  <DomainRowActions tenantId={tenantId} domain={d} />
                </div>
              </div>
            </Card>
          ))}
        </CardGrid>
      )}
    </div>
  );
}
