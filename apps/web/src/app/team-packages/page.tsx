import Link from 'next/link';
import type { Metadata } from 'next';
import { api, apiSafe, type Paginated, type SiteSettings } from '@/lib/api';
import { currency } from '@/lib/format';

export const revalidate = 60;
export const metadata: Metadata = {
  title: 'Classroom packages',
  description: 'Buy a block of seats on a course for your team.',
};

interface PackageCard {
  id: number; title: string | null; slug: string | null; thumbnail: string | null;
  allocation: number | null; pricing_type: number | null; price: number | null;
  expiry_type: string | null; features: string[];
  course: { id: number; title: string | null; slug: string | null } | null;
}

export default async function TeamPackagesPage(
  { searchParams }: { searchParams: Promise<Record<string, string | undefined>> },
) {
  const params = await searchParams;
  const query = new URLSearchParams();
  for (const key of ['search', 'page']) if (params[key]) query.set(key, params[key]!);

  const [list, settings] = await Promise.all([
    api<Paginated<PackageCard>>('/api/team-packages' + (query.toString() ? '?' + query : '')),
    apiSafe<SiteSettings>('/api/settings'),
  ]);
  const position = settings?.currency_position ?? 'left';

  return (
    <div className="container-page py-10">
      <h1 className="text-2xl font-bold">Classroom packages</h1>
      <p className="mt-2 max-w-2xl text-sm text-slate-600">
        Buy a block of seats on a course and add your team. Each seat enrols one
        person for as long as the package lasts.
      </p>

      <form action="/team-packages" className="mt-5 flex max-w-md gap-2">
        <input name="search" defaultValue={params['search'] ?? ''} placeholder="Search packages"
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
        <button className="btn-primary" type="submit">Search</button>
      </form>

      {list.data.length === 0 ? (
        <p className="mt-8 text-sm text-slate-500">No packages published yet.</p>
      ) : (
        <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {list.data.map((p) => (
            <article key={p.id} className="card overflow-hidden">
              {p.thumbnail && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={p.thumbnail} alt="" className="h-36 w-full object-cover" />
              )}
              <div className="p-4">
                <h2 className="font-semibold leading-snug">
                  <Link href={'/team-package/' + p.slug} className="hover:text-brand-600">
                    {p.title}
                  </Link>
                </h2>
                {p.course && (
                  <p className="mt-1 text-xs text-slate-500">for {p.course.title}</p>
                )}
                <p className="mt-2 text-sm text-slate-600">
                  {p.allocation} {p.allocation === 1 ? 'seat' : 'seats'}
                  {p.expiry_type === 'lifetime' ? ' - lifetime' : ' - limited term'}
                </p>
                <p className="mt-3 font-medium text-brand-700">
                  {p.pricing_type ? currency(p.price, position) : 'Free'}
                </p>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
