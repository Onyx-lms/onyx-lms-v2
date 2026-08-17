import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { apiSafe, type PageMetadata, type SiteSettings } from '@/lib/api';
import { currency } from '@/lib/format';
import { getSession, apiAuthSafe } from '@/lib/session';
import { BootcampActions } from '@/components/bootcamp-actions';

export const revalidate = 60;

interface Resource { id: number; title: string | null; upload_type: string | null }
interface LiveClass {
  id: number; title: string | null; start_time: number | null; end_time: number | null;
  provider: string | null; startable?: boolean;
}
interface Module {
  id: number; title: string | null; open: boolean;
  live_classes: LiveClass[]; resources: Resource[]; resource_count?: number;
}
interface Payload {
  bootcamp: Record<string, unknown> & { effective_price: number };
  modules: Module[];
  purchased: boolean;
  owner: boolean;
  seo: PageMetadata;
}

const load = (slug: string) =>
  apiSafe<Payload>('/api/bootcamps/' + encodeURIComponent(slug));

export async function generateMetadata(
  { params }: { params: Promise<{ slug: string }> },
): Promise<Metadata> {
  const { slug } = await params;
  const result = await load(slug);
  if (!result) return { title: 'Workshop not found' };
  const { seo } = result;
  return {
    title: seo.title,
    description: seo.description,
    keywords: seo.keywords,
    robots: seo.robots,
    openGraph: { title: seo.og.title, description: seo.og.description,
      images: seo.og.image ? [seo.og.image] : undefined },
  };
}

function when(seconds: number | null): string {
  if (!seconds) return '';
  return new Date(Number(seconds) * 1000).toLocaleString();
}

export default async function BootcampPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const session = await getSession();
  // A signed-in visitor may already own it, which changes the whole page.
  const result = session
    ? await apiAuthSafe<Payload>('/api/bootcamps/' + encodeURIComponent(slug))
    : await load(slug);
  if (!result) notFound();

  const { bootcamp, modules, purchased, owner, seo } = result;
  const settings = await apiSafe<SiteSettings>('/api/settings');
  const position = settings?.currency_position ?? 'left';
  const price = Number(bootcamp['effective_price'] ?? 0);
  const list = Number(bootcamp['price'] ?? 0);

  return (
    <>
      {seo.jsonLd != null && (
        <script type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(seo.jsonLd) }} />
      )}

      <section className="border-b border-slate-200 bg-slate-900 text-white">
        <div className="container-page grid gap-8 py-12 lg:grid-cols-[1fr_320px]">
          <div>
            <h1 className="text-3xl font-bold leading-tight">{String(bootcamp['title'] ?? '')}</h1>
            {bootcamp['short_description'] != null && (
              <p className="mt-3 max-w-2xl text-slate-300">
                {String(bootcamp['short_description'])}
              </p>
            )}
            <p className="mt-4 text-sm text-slate-300">
              {modules.length} {modules.length === 1 ? 'module' : 'modules'}
            </p>
          </div>

          <aside className="card self-start bg-white p-5 text-slate-800">
            <div className="text-2xl font-bold text-brand-700">
              {bootcamp['is_paid'] ? (
                <>
                  {Number(bootcamp['discount_flag']) === 1 && (
                    <s className="mr-2 text-base font-normal text-slate-400">
                      {currency(list, position)}
                    </s>
                  )}
                  {currency(price, position)}
                </>
              ) : 'Free'}
            </div>
            <div className="mt-4">
              <BootcampActions
                bootcampId={Number(bootcamp['id'])}
                slug={String(bootcamp['slug'] ?? '')}
                isPaid={Boolean(bootcamp['is_paid'])}
                isSignedIn={Boolean(session)}
                purchased={purchased}
                owner={owner}
              />
            </div>
          </aside>
        </div>
      </section>

      <div className="container-page py-10">
        {bootcamp['description'] != null && String(bootcamp['description']) !== '' && (
          <section className="mb-10">
            <h2 className="text-lg font-semibold">About this workshop</h2>
            <div className="mt-3 text-sm leading-relaxed text-slate-700"
              dangerouslySetInnerHTML={{ __html: String(bootcamp['description']) }} />
          </section>
        )}

        <h2 className="text-lg font-semibold">Programme</h2>
        {modules.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">The programme is being prepared.</p>
        ) : (
          <div className="mt-4 divide-y divide-slate-200 rounded-lg border border-slate-200">
            {modules.map((m) => (
              <details key={m.id} open>
                <summary className="cursor-pointer px-4 py-3 text-sm font-medium">
                  {m.title}
                  {!m.open && (
                    <span className="ml-2 text-xs font-normal text-slate-500">Not open yet</span>
                  )}
                </summary>
                <div className="border-t border-slate-100 bg-slate-50 px-4 py-3 text-sm">
                  {m.live_classes.length > 0 && (
                    <ul className="space-y-1">
                      {m.live_classes.map((c) => (
                        <li key={c.id} className="flex justify-between text-slate-600">
                          <span>{c.title}</span>
                          <span className="text-xs">{when(c.start_time)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {purchased || owner ? (
                    m.resources.length > 0 && (
                      <ul className="mt-2 space-y-1">
                        {m.resources.map((r) => (
                          <li key={r.id}>
                            <Link href={'/my-bootcamps/' + slug}
                              className="text-brand-700 hover:underline">
                              {r.title}
                            </Link>
                          </li>
                        ))}
                      </ul>
                    )
                  ) : (
                    (m.resource_count ?? 0) > 0 && (
                      <p className="mt-2 text-xs text-slate-500">
                        {m.resource_count} {m.resource_count === 1 ? 'resource' : 'resources'} for
                        {' '}enrolled participants
                      </p>
                    )
                  )}
                </div>
              </details>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
