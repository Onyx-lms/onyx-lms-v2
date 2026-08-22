import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { OnyxShell } from '@/components/onyx-shell';
import { navFor } from '@/lib/onyx-nav';
import { onyxApi, onyxApiSafe, requireOnyxSession, type Me } from '@/lib/onyx-session';
import { BackLink, Banner, Card, Icon, SectionHead } from '@/components/onyx-ui';
import { RegisterForDomain } from '@/components/onyx-domain-register';
import { DomainRegistrations, type DomainRegistration }
  from '@/components/onyx-domain-registrations';
import { ConfirmPayment } from '@/components/onyx-pay-return';
import { DomainAdmin } from '@/components/onyx-domain-admin';
import type { OnyxDomainRow } from '@/lib/onyx-domains';
import { domainPrice, isExternalHttp } from '@/lib/onyx-domains';

export const metadata: Metadata = { title: 'Domain' };

/**
 * One domain: everything the person who added it typed, and the way out to the
 * curriculum on the Onyx EduTech site.
 *
 * The price is shown AND it sells now. What it sells is deliberately modest: a
 * domain has no outline to unlock, so registering puts a name on a list an
 * administrator reads and acts on off-product. Migration 0030's header makes
 * that argument, and the button's own wording commits to being contacted rather
 * than to being let in -- the second would be a promise the product cannot
 * keep.
 *
 * Which is why `domains.manage` holders get the registrations table below.
 * Taking money and producing a row nobody looks at would be worse than having
 * no button at all: the learner has been charged and, as far as they can tell,
 * nothing happened.
 */
export default async function OnyxDomainPage(
  { params, searchParams }: {
    params: Promise<{ id: string }>;
    // Where a redirect-flow gateway sends a payer back to. Without this the
    // payment is made and nothing on our side ever asks the provider whether
    // it was -- the registration would wait on a webhook that some providers
    // never send at all.
    searchParams?: Promise<{ ref?: string; cancelled?: string }>;
  },
) {
  await requireOnyxSession();
  const { id } = await params;
  const { ref: paymentRef, cancelled } = (await searchParams) ?? {};

  const [me, domain, perms, mine, gateways] = await Promise.all([
    onyxApi<Me>('/api/onyx/me'),
    onyxApiSafe<OnyxDomainRow>('/api/onyx/domains/' + id),
    onyxApiSafe<{ mine: string[] }>('/api/onyx/permissions'),
    onyxApiSafe<number[]>('/api/onyx/my/domains'),
    // Asked HERE, on the server. A client that could choose between the mock
    // and a real gateway would be a client that could choose to pay nothing.
    onyxApiSafe<{ identifier: string }[]>('/api/onyx/gateways'),
  ]);
  if (!domain) notFound();

  const mayManage = (perms?.mine ?? []).includes('domains.manage');
  const registered = (mine ?? []).map(Number).includes(Number(domain.id));
  const gateway = gateways?.[0]?.identifier ?? null;

  // Only for the people who can act on it. Fetched here rather than in the
  // component so it is one request on a page that already makes several, and
  // so that nobody else's browser ever holds the roster.
  const registrations = mayManage
    ? await onyxApiSafe<DomainRegistration[]>('/api/onyx/domains/' + id + '/registrations')
    : null;

  return (
    <OnyxShell
      me={me}
      nav={navFor(me.role)}
      title={domain.title}
      subtitle={[domain.duration_label, domainPrice(domain)].filter(Boolean).join(' · ')}
    >
      <div className="min-w-0 max-w-4xl space-y-5">
        <BackLink href="/onyx/domains" label="Live Classes" />

        {/* What the query string says happened is not evidence. The provider is
            asked; the registration state below is what answers it. */}
        {paymentRef ? <ConfirmPayment reference={paymentRef} /> : null}
        {!paymentRef && cancelled ? (
          <Banner tone="info" icon="x">
            That payment was cancelled. Nothing has been charged, and this is still here
            when you want it.
          </Banner>
        ) : null}

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

            {/* Staff do not get a Register button. Somebody who manages the
                catalogue signing up through it would put their own name on the
                list they are supposed to be reading. */}
            {domain.status === 1 && !mayManage ? (
              <div className="mt-4 flex justify-end border-t border-line pt-4">
                <RegisterForDomain
                  domainId={Number(domain.id)}
                  title={domain.title}
                  price={Number(domain.price_minor ?? 0)}
                  currency={String(domain.currency ?? 'INR')}
                  gateway={gateway}
                  registered={registered}
                />
              </div>
            ) : null}
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

        {registrations ? <DomainRegistrations rows={registrations} /> : null}

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
