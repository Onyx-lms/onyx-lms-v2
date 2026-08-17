import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { api, apiSafe, type PageMetadata, type Paginated } from '@/lib/api';
import { BlogCard, type BlogPost } from '@/components/blog-card';

export const revalidate = 60;

type Search = Record<string, string | undefined>;

interface BlogCategory { id: number; title: string; slug: string; post_count: number }

export async function generateMetadata(): Promise<Metadata> {
  const seo = await apiSafe<PageMetadata>('/api/seo/blog');
  return {
    title: seo?.title ?? 'Blog',
    description: seo?.description ?? '',
    keywords: seo?.keywords ?? '',
    robots: seo?.robots ?? 'index, follow',
  };
}

function qs(params: Search, override: Search): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...params, ...override })) if (v) sp.set(k, v);
  const s = sp.toString();
  return s ? `?${s}` : '';
}

export default async function BlogsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const params = await searchParams;

  // The module can be switched off entirely (R-07); the API 404s when it is.
  const posts = await apiSafe<Paginated<BlogPost>>('/api/blogs' + qs(params, {}));
  if (!posts) notFound();
  const [categories, popular] = await Promise.all([
    apiSafe<BlogCategory[]>('/api/blogs/categories'),
    apiSafe<BlogPost[]>('/api/blogs/popular'),
  ]);

  const active = params['category'];

  return (
    <div className="container-page grid gap-8 py-10 lg:grid-cols-[1fr_260px]">
      <div>
        <h1 className="text-2xl font-bold">Blog</h1>

        <form action="/blogs" className="mt-4 flex gap-2">
          <input name="search" defaultValue={params['search'] ?? ''} placeholder="Search posts"
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
          {active && <input type="hidden" name="category" value={active} />}
          <button className="btn-primary" type="submit">Search</button>
        </form>

        {posts.data.length === 0 ? (
          <p className="mt-8 text-sm text-slate-500">No posts yet.</p>
        ) : (
          <div className="mt-6 grid gap-5 sm:grid-cols-2">
            {posts.data.map((p) => <BlogCard key={p.id} post={p} />)}
          </div>
        )}

        {posts.last_page > 1 && (
          <nav className="mt-8 flex gap-2 text-sm">
            {Array.from({ length: posts.last_page }, (_, i) => i + 1).map((n) => (
              <Link key={n} href={`/blogs${qs(params, { page: String(n) })}`}
                className={n === posts.current_page
                  ? 'rounded bg-brand-600 px-3 py-1 text-white'
                  : 'rounded border border-slate-300 px-3 py-1 hover:bg-slate-50'}>
                {n}
              </Link>
            ))}
          </nav>
        )}
      </div>

      <aside className="space-y-6">
        <section className="card p-4">
          <h2 className="text-sm font-semibold">Categories</h2>
          <ul className="mt-3 space-y-1 text-sm">
            <li>
              <Link href="/blogs" className={!active ? 'font-medium text-brand-700' : 'text-slate-600 hover:text-brand-600'}>
                All posts
              </Link>
            </li>
            {(categories ?? []).map((c) => (
              <li key={c.id}>
                <Link href={`/blogs?category=${c.slug}`}
                  className={active === c.slug ? 'font-medium text-brand-700' : 'text-slate-600 hover:text-brand-600'}>
                  {c.title} <span className="text-slate-400">({c.post_count})</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>

        {(popular ?? []).length > 0 && (
          <section className="card p-4">
            <h2 className="text-sm font-semibold">Popular</h2>
            <ul className="mt-3 space-y-2 text-sm">
              {(popular ?? []).map((p) => (
                <li key={p.id}>
                  <Link href={`/blog/${p.slug}`} className="text-slate-700 hover:text-brand-600">
                    {p.title}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
      </aside>
    </div>
  );
}
