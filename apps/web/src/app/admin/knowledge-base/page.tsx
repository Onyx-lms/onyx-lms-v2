import Link from 'next/link';
import type { Metadata } from 'next';
import { requireRole, apiAuthSafe } from '@/lib/session';
import { DashboardShell } from '@/components/dashboard-shell';
import { ADMIN_NAV } from '@/lib/nav';
import { KnowledgeBaseAdmin } from '@/components/knowledge-base-admin';

export const metadata: Metadata = { title: 'Knowledge base' };

interface Topic { id: number; title: string | null; article_count: number }
interface Article { id: number; topic_name: string | null }
interface TopicDetail { id: number; title: string | null; articles: Article[] }

/** R-08: topics with their articles, plus the create forms. */
export default async function AdminKnowledgeBase() {
  const session = await requireRole('admin');
  const topics = (await apiAuthSafe<Topic[]>('/api/knowledge-base')) ?? [];
  // One request per topic; the list is short and this keeps the API surface
  // identical to what the public pages already use.
  const details = await Promise.all(topics.map((t) =>
    apiAuthSafe<TopicDetail>(`/api/knowledge-base/topics/${t.id}`)));

  return (
    <DashboardShell role={session.app_role} email={session.email}
      nav={ADMIN_NAV} title="Knowledge base">
      <div className="grid gap-4 lg:grid-cols-2">
        <KnowledgeBaseAdmin mode="topic-create" />
        {topics.length > 0 && <KnowledgeBaseAdmin mode="article-create" topics={topics} />}
      </div>

      {topics.length === 0 ? (
        <p className="mt-6 rounded-lg border border-dashed border-slate-300 p-10 text-center text-sm text-slate-500">
          No topics yet. Add one to get started.
        </p>
      ) : (
        <div className="mt-6 space-y-4">
          {details.filter(Boolean).map((t) => (
            <section key={t!.id} className="card p-4">
              <header className="flex items-center justify-between">
                <h2 className="font-medium">
                  <Link href={`/knowledge-base/topics/${t!.id}`} className="hover:text-brand-600">
                    {t!.title}
                  </Link>
                  <span className="ml-2 text-xs font-normal text-slate-500">
                    {t!.articles.length} {t!.articles.length === 1 ? 'article' : 'articles'}
                  </span>
                </h2>
                <KnowledgeBaseAdmin mode="topic-row" topicId={t!.id} />
              </header>
              {t!.articles.length > 0 && (
                <ul className="mt-3 divide-y divide-slate-100 text-sm">
                  {t!.articles.map((a) => (
                    <li key={a.id} className="flex items-center justify-between py-2">
                      <Link href={`/knowledge-base/articles/${a.id}`}
                        className="text-slate-700 hover:text-brand-600">
                        {a.topic_name}
                      </Link>
                      <KnowledgeBaseAdmin mode="article-row" articleId={a.id} />
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))}
        </div>
      )}
    </DashboardShell>
  );
}
