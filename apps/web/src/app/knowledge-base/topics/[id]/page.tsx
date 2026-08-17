import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { apiSafe } from '@/lib/api';

export const revalidate = 60;

interface Article { id: number; topic_name: string | null }
interface Topic { id: number; title: string | null; articles: Article[] }

async function load(id: string) {
  return apiSafe<Topic>(`/api/knowledge-base/topics/${encodeURIComponent(id)}`);
}

export async function generateMetadata(
  { params }: { params: Promise<{ id: string }> },
): Promise<Metadata> {
  const { id } = await params;
  const topic = await load(id);
  return { title: topic?.title ?? 'Topic not found' };
}

export default async function TopicPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const topic = await load(id);
  if (!topic) notFound();

  return (
    <div className="container-page max-w-3xl py-10">
      <nav className="text-sm text-slate-500">
        <Link href="/knowledge-base" className="hover:text-brand-600">Knowledge base</Link>
      </nav>
      <h1 className="mt-3 text-2xl font-bold">{topic.title}</h1>

      {topic.articles.length === 0 ? (
        <p className="mt-4 text-sm text-slate-500">No articles in this topic yet.</p>
      ) : (
        <ul className="mt-6 divide-y divide-slate-200 rounded-lg border border-slate-200">
          {topic.articles.map((a) => (
            <li key={a.id}>
              <Link href={`/knowledge-base/articles/${a.id}`}
                className="block px-4 py-3 text-sm hover:bg-slate-50">
                {a.topic_name}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
