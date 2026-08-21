import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { OnyxShell } from '@/components/onyx-shell';
import { navFor } from '@/lib/onyx-nav';
import { onyxApi, onyxApiSafe, requireOnyxSession, type Me } from '@/lib/onyx-session';
import { BackLink, Card, Icon, SectionHead } from '@/components/onyx-ui';
import { DomainAdmin } from '@/components/onyx-domain-admin';
import type { OnyxDomainRow } from '@/lib/onyx-domains';
import { domainPrice, isExternalHttp } from '@/lib/onyx-domains';

export const metadata: Metadata = { title: 'Domain' };

/**
 * One domain: everything the person who added it typed, and the way out to the
 * curriculum on the Onyx EduTech site.
 *
 * The price is shown and nothing sells it. That is this release: buying a domain
 * waits for the Razorpay work, and a button that took money before the payment
 * path was finished would be the worst possible order to build these in.
 */
export default async function OnyxDomainPage(
  { params }: { params: Promise<{ id: string }> },
) {
  await requireOnyxSession();
  const { id } = await params;

  const [me, domain, perms] = await Promise.all([
    onyxApi<Me>('/api/onyx/me'),
    onyxApiSafe<OnyxDomainRow>('/api/onyx/domains/' + id),
    onyxApiSafe<{ mine: string[] }>('/api/onyx/permissions'),
  ]);
  if (!domain) notFound();

  const mayManage = (perms?.mine ?? []).includes('domains.manage');

  return (
    <OnyxShell
      me={me}
      nav={navFor(me.role)}
      title={domain.title}
      subtitle={[domain.duration_label, domainPrice(domain)].filter(Boolean).join(' · ')}
    >
      <div className="min-w-0 max-w-4xl space-y-5">
        <BackLink href="/onyx/domains" label="Live Classes" />

        {domain.status !== 1 ? (
          <Card className="border-amber-300 bg-amber-50/60 p-3.5 text-[13px]">
            This domain is hidden. Nobody but staff can see it on Live Classes.
          </Card>
        ) : null}

        {domain.image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={domain.image_url} alt=""
            className="h-56 w-full rounded-2xl border border-line bg-slate-100 object-cover" />
        ) : null}

        {domain.summary ? (
          <section>
            <SectionHead title="About this domain" />
            <Card className="p-4">
              <p className="max-w-prose whitespace-pre-line text-[14.5px] leading-relaxed">
                {domain.summary}
              </p>
            </Card>
          </section>
        ) : null}

        <section>
          <SectionHead title="What you get" />
          <Card className="p-4">
            <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-3">
              <Fact term="Duration" value={domain.duration_label || 'Not stated'} />
              <Fact term="Certificate" value={domain.certificate || 'None awarded'} />
              <Fact term="Price" value={domainPrice(domain)} />
            </dl>
          </Card>
        </section>

        {/*
          * The way out to the curriculum.
          *
          * A new tab, because it leaves the product for the marketing site and
          * somebody mid-browse should not lose the domain they were reading.
          * `noopener` because target="_blank" otherwise hands the destination a
          * live window.opener handle; `noreferrer` because the internal path is
          * nobody else's business. The sr-only suffix is there because a new tab
          * opening unannounced is a WCAG 3.2.5 failure.
          *
          * `isExternalHttp` re-checks what the service already checked on write:
          * a row written before that check existed must not render as an href.
          */}
        {isExternalHttp(domain.curriculum_url) ? (
          <section>
            <SectionHead title="Curriculum" />
            <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
              <p className="max-w-prose text-[13.5px] text-muted">
                The full curriculum for this domain is published on the Onyx EduTech site.
              </p>
              <a href={domain.curriculum_url} target="_blank" rel="noopener noreferrer"
                className="inline-flex min-h-[42px] shrink-0 items-center gap-2 rounded-xl
                           bg-brand-600 px-4 text-[14px] font-bold text-white
                           hover:bg-brand-700">
                <Icon name="external" className="h-4 w-4" />
                View the curriculum
                <span className="sr-only"> (opens the Onyx EduTech site in a new tab)</span>
              </a>
            </Card>
          </section>
        ) : null}

        {mayManage ? <DomainAdmin domain={domain} /> : null}
      </div>
    </OnyxShell>
  );
}

function Fact({ term, value }: { term: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-bold uppercase tracking-[.06em] text-muted">{term}</dt>
      <dd className="mt-0.5 break-words text-[14px] font-semibold">{value}</dd>
    </div>
  );
}
