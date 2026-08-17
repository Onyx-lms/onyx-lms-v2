import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { apiSafe, type SiteSettings } from '@/lib/api';
import { currency } from '@/lib/format';
import { getSession, apiAuthSafe } from '@/lib/session';
import { TeamPackageActions } from '@/components/team-package-actions';

export const revalidate = 60;

interface Payload {
  package: {
    id: number; title: string | null; slug: string | null; thumbnail: string | null;
    allocation: number | null; pricing_type: number | null; price: number | null;
    expiry_type: string | null; start_date: number | null; expiry_date: number | null;
    features: string[];
    course: { id: number; title: string | null; slug: string | null } | null;
  };
  purchased: boolean;
}

const load = (slug: string) => apiSafe<Payload>('/api/team-packages/' + encodeURIComponent(slug));

export async function generateMetadata(
  { params }: { params: Promise<{ slug: string }> },
): Promise<Metadata> {
  const { slug } = await params;
  const result = await load(slug);
  return { title: result?.package.title ?? 'Package not found' };
}

const when = (seconds: number | null) =>
  seconds ? new Date(Number(seconds) * 1000).toLocaleDateString() : '';

export default async function TeamPackagePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const session = await getSession();
  const result = session
    ? await apiAuthSafe<Payload>('/api/team-packages/' + encodeURIComponent(slug))
    : await load(slug);
  if (!result) notFound();

  const { package: pkg, purchased } = result;
  const settings = await apiSafe<SiteSettings>('/api/settings');
  const position = settings?.currency_position ?? 'left';

  return (
    <div className="container-page grid max-w-5xl gap-8 py-10 lg:grid-cols-[1fr_320px]">
      <div>
        <h1 className="text-2xl font-bold">{pkg.title}</h1>
        {pkg.course && (
          <p className="mt-2 text-sm text-slate-600">
            Seats on{' '}
            <Link href={'/course/' + pkg.course.slug} className="text-brand-700 hover:underline">
              {pkg.course.title}
            </Link>
          </p>
        )}

        <dl className="mt-6 grid gap-3 sm:grid-cols-2">
          <div className="card p-4">
            <dt className="text-xs uppercase tracking-wide text-slate-500">Seats</dt>
            <dd className="mt-1 text-lg font-medium">{pkg.allocation}</dd>
          </div>
          <div className="card p-4">
            <dt className="text-xs uppercase tracking-wide text-slate-500">Access</dt>
            <dd className="mt-1 text-lg font-medium">
              {pkg.expiry_type === 'lifetime' ? 'Lifetime' : when(pkg.expiry_date) || 'Limited'}
            </dd>
          </div>
        </dl>

        {pkg.features.length > 0 && (
          <section className="mt-8">
            <h2 className="text-lg font-semibold">What is included</h2>
            <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-slate-700">
              {pkg.features.map((f, i) => <li key={i}>{f}</li>)}
            </ul>
          </section>
        )}
      </div>

      <aside className="card h-fit p-5">
        <div className="text-2xl font-bold text-brand-700">
          {pkg.pricing_type ? currency(pkg.price, position) : 'Free'}
        </div>
        <p className="mt-1 text-xs text-slate-500">
          for {pkg.allocation} {pkg.allocation === 1 ? 'person' : 'people'}
        </p>
        <div className="mt-4">
          <TeamPackageActions
            packageId={pkg.id}
            isPaid={pkg.pricing_type === 1}
            isSignedIn={Boolean(session)}
            purchased={purchased}
          />
        </div>
      </aside>
    </div>
  );
}
