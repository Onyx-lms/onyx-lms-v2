import Link from 'next/link';
import type { Metadata } from 'next';
import { apiSafe, type PageMetadata } from '@/lib/api';

export const revalidate = 60;

interface Topic { id: number; title: string | null; article_count: number }
interface Hit { id: number; knowledge_base_id: number; topic_name: string | null }

export async function generateMetadata(): Promise<Metadata> {
  const seo = await apiSafe<PageMetadata>('/api/seo/knowledge-base');
  return {
    title: seo?.title ?? 'Knowledge base',
    description: seo?.description ?? 'Guides and answers to common questions.',
    robots: seo?.robots ?? 'index, follow',
  };
}

export default async function KnowledgeBasePage(
  { searchParams }: { searchParams: Promise<Record<string, string | undefined>> },
) {
  const params = await searchParams;
  const term = params['q'] ?? '';

  const [topics, hits] = await Promise.all([
    apiSafe<Topic[]>('/api/knowledge-base'),
    term ? apiSafe<Hit[]>(`/api/knowledge-base/search?q=${encodeURIComponent(term)}`)
         : Promise.resolve(null),
  ]);

  return (
    <div className="container-page max-w-4xl py-10">
      <h1 className="text-2xl font-bold">Knowledge base</h1>
      <p className="mt-2 text-sm text-slate-600">Browse by topic, or search for an answer.</p>

      <form action="/knowledge-base" className="mt-5 flex gap-2">
        <input name="q" defaultValue={term} placeholder="Search articles"
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
        <button className="btn-primary" type="submit">Search</button>
      </form>

      {hits !== null && (
        <section className="mt-8">
          <h2 className="text-sm font-semibold text-slate-700">
            {hits.length} {hits.length === 1 ? 'result' : 'results'} for &ldquo;{term}&rdquo;
          </h2>
          {hits.length > 0 && (
            <ul className="mt-3 space-y-2 text-sm">
              {hits.map((h) => (
                <li key={h.id}>
                  <Link href={`/knowledge-base/articles/${h.id}`}
                    className="text-brand-700 hover:underline">
                    {h.topic_name}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <section className="mt-10">
        <h2 className="text-lg font-semibold">Topics</h2>
        {(topics ?? []).length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">No topics have been published yet.</p>
        ) : (
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {(topics ?? []).map((t) => (
              <Link key={t.id} href={`/knowledge-base/topics/${t.id}`}
                className="card p-4 transition hover:border-brand-300">
                <h3 className="font-medium">{t.title}</h3>
                <p className="mt-1 text-xs text-slate-500">
                  {t.article_count} {t.article_count === 1 ? 'article' : 'articles'}
                </p>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
