import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { apiSafe } from '@/lib/api';

export const revalidate = 60;

interface Article {
  id: number;
  knowledge_base_id: number;
  topic_name: string | null;
  description: string | null;
  topic: { id: number; title: string | null } | null;
  siblings: { id: number; topic_name: string | null }[];
}

async function load(id: string) {
  return apiSafe<Article>(`/api/knowledge-base/articles/${encodeURIComponent(id)}`);
}

export async function generateMetadata(
  { params }: { params: Promise<{ id: string }> },
): Promise<Metadata> {
  const { id } = await params;
  const article = await load(id);
  return { title: article?.topic_name ?? 'Article not found' };
}

export default async function ArticlePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const article = await load(id);
  if (!article) notFound();

  const others = article.siblings.filter((s) => s.id !== article.id);

  return (
    <div className="container-page grid max-w-5xl gap-8 py-10 lg:grid-cols-[1fr_240px]">
      <article>
        <nav className="text-sm text-slate-500">
          <Link href="/knowledge-base" className="hover:text-brand-600">Knowledge base</Link>
          {article.topic && (
            <>
              {' / '}
              <Link href={`/knowledge-base/topics/${article.topic.id}`}
                className="hover:text-brand-600">
                {article.topic.title}
              </Link>
            </>
          )}
        </nav>

        <h1 className="mt-3 text-2xl font-bold">{article.topic_name}</h1>
        {article.description && (
          <div className="prose mt-5 max-w-none text-slate-700"
            dangerouslySetInnerHTML={{ __html: article.description }} />
        )}
      </article>

      {others.length > 0 && (
        <aside className="card h-fit p-4">
          <h2 className="text-sm font-semibold">More in this topic</h2>
          <ul className="mt-3 space-y-2 text-sm">
            {others.map((s) => (
              <li key={s.id}>
                <Link href={`/knowledge-base/articles/${s.id}`}
                  className="text-slate-700 hover:text-brand-600">
                  {s.topic_name}
                </Link>
              </li>
            ))}
          </ul>
        </aside>
      )}
    </div>
  );
}
