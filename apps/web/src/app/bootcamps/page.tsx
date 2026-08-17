import Link from 'next/link';
import type { Metadata } from 'next';
import { api, apiSafe, type Paginated, type SiteSettings } from '@/lib/api';
import { workshopPrice, type BootcampCard } from '@/lib/bootcamp';

export const revalidate = 60;
export const metadata: Metadata = {
  title: 'Workshops',
  description: 'Live, cohort-based workshops with modules, sessions and resources.',
};

interface Category { id: number; title: string; slug: string; bootcamp_count: number }

export default async function BootcampsPage(
  { searchParams }: { searchParams: Promise<Record<string, string | undefined>> },
) {
  const params = await searchParams;
  const query = new URLSearchParams();
  for (const key of ['category', 'search', 'page']) {
    if (params[key]) query.set(key, params[key]!);
  }

  const [list, categories, settings] = await Promise.all([
    api<Paginated<BootcampCard>>('/api/bootcamps' + (query.toString() ? '?' + query : '')),
    apiSafe<Category[]>('/api/bootcamps/categories'),
    apiSafe<SiteSettings>('/api/settings'),
  ]);
  const position = settings?.currency_position ?? 'left';
  const active = params['category'];

  return (
    <div className="container-page grid gap-8 py-10 lg:grid-cols-[240px_1fr]">
      <aside>
        <h2 className="text-sm font-semibold">Categories</h2>
        <ul className="mt-3 space-y-1 text-sm">
          <li>
            <Link href="/bootcamps"
              className={!active ? 'font-medium text-brand-700' : 'text-slate-600 hover:text-brand-600'}>
              All workshops
            </Link>
          </li>
          {(categories ?? []).map((c) => (
            <li key={c.id}>
              <Link href={'/bootcamps?category=' + c.slug}
                className={active === c.slug ? 'font-medium text-brand-700' : 'text-slate-600 hover:text-brand-600'}>
                {c.title} <span className="text-slate-400">({c.bootcamp_count})</span>
              </Link>
            </li>
          ))}
        </ul>
      </aside>

      <div>
        <h1 className="text-2xl font-bold">Workshops</h1>
        <form action="/bootcamps" className="mt-4 flex max-w-md gap-2">
          {active && <input type="hidden" name="category" value={active} />}
          <input name="search" defaultValue={params['search'] ?? ''} placeholder="Search workshops"
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
          <button className="btn-primary" type="submit">Search</button>
        </form>

        {list.data.length === 0 ? (
          <p className="mt-8 text-sm text-slate-500">No workshops published yet.</p>
        ) : (
          <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {list.data.map((b) => {
              const p = workshopPrice(b, position);
              return (
                <article key={b.id} className="card overflow-hidden">
                  {b.thumbnail && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={b.thumbnail} alt="" className="h-36 w-full object-cover" />
                  )}
                  <div className="p-4">
                    {b.category && (
                      <span className="text-xs font-medium uppercase tracking-wide text-brand-700">
                        {b.category.title}
                      </span>
                    )}
                    <h2 className="mt-1 font-semibold leading-snug">
                      <Link href={'/bootcamp/' + b.slug} className="hover:text-brand-600">
                        {b.title}
                      </Link>
                    </h2>
                    <p className="mt-1 text-xs text-slate-500">{b.short_description}</p>
                    <p className="mt-3 font-medium text-brand-700">
                      {p.was && <s className="mr-2 font-normal text-slate-400">{p.was}</s>}
                      {p.label}
                    </p>
                  </div>
                </article>
              );
            })}
          </div>
        )}

        {list.last_page > 1 && (
          <nav className="mt-8 flex gap-2 text-sm">
            {Array.from({ length: list.last_page }, (_, i) => i + 1).map((n) => {
              const q = new URLSearchParams(query);
              q.set('page', String(n));
              return (
                <Link key={n} href={'/bootcamps?' + q.toString()}
                  className={n === list.current_page
                    ? 'rounded bg-brand-600 px-3 py-1 text-white'
                    : 'rounded border border-slate-300 px-3 py-1 hover:bg-slate-50'}>
                  {n}
                </Link>
              );
            })}
          </nav>
        )}
      </div>
    </div>
  );
}
