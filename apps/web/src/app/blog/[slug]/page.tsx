import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { apiSafe, type PageMetadata } from '@/lib/api';
import { formatDate, type BlogPost } from '@/components/blog-card';
import { BlogEngagement, type Comment } from '@/components/blog-engagement';
import { getSession, apiAuthSafe } from '@/lib/session';

export const revalidate = 60;

interface PostDetail extends BlogPost {
  description: string | null;
}

interface Payload {
  post: PostDetail;
  comments: Comment[];
  likes: { count: number; liked: boolean };
  related: BlogPost[];
  seo: PageMetadata;
}

export async function generateMetadata(
  { params }: { params: Promise<{ slug: string }> },
): Promise<Metadata> {
  const { slug } = await params;
  const result = await apiSafe<Payload>(`/api/blogs/${encodeURIComponent(slug)}`);
  if (!result) return { title: 'Post not found' };
  const { seo } = result;
  return {
    title: seo.title,
    description: seo.description,
    keywords: seo.keywords,
    robots: seo.robots,
    alternates: seo.canonical ? { canonical: seo.canonical } : undefined,
    openGraph: {
      title: seo.og.title,
      description: seo.og.description,
      images: seo.og.image ? [seo.og.image] : undefined,
    },
  };
}

export default async function BlogDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const session = await getSession();

  // Signed-in readers need their own like state and their unapproved comments,
  // so their request carries the token and skips the shared cache.
  const result = session
    ? await apiAuthSafe<Payload>(`/api/blogs/${encodeURIComponent(slug)}`)
    : await apiSafe<Payload>(`/api/blogs/${encodeURIComponent(slug)}`);
  if (!result) notFound();

  const { post, comments, likes, related, seo } = result;

  return (
    <>
      {seo.jsonLd != null && (
        <script type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(seo.jsonLd) }} />
      )}

      <article className="container-page max-w-3xl py-10">
        <nav className="text-sm text-slate-500">
          <Link href="/blogs" className="hover:text-brand-600">Blog</Link>
          {post.category && (
            <>
              {' / '}
              <Link href={`/blogs?category=${post.category.slug}`} className="hover:text-brand-600">
                {post.category.title}
              </Link>
            </>
          )}
        </nav>

        <h1 className="mt-3 text-3xl font-bold leading-tight">{post.title}</h1>
        <p className="mt-2 text-sm text-slate-500">
          {post.author?.name && <span>{post.author.name} &middot; </span>}
          {formatDate(post.created_at)}
        </p>

        {post.banner && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={post.banner} alt="" className="mt-6 w-full rounded-lg object-cover" />
        )}

        {post.description && (
          <div className="prose mt-6 max-w-none text-slate-700"
            dangerouslySetInnerHTML={{ __html: post.description }} />
        )}

        {post.keywords && (
          <ul className="mt-6 flex flex-wrap gap-2">
            {post.keywords.split(',').map((k) => k.trim()).filter(Boolean).map((k) => (
              <li key={k} className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-600">
                {k}
              </li>
            ))}
          </ul>
        )}

        <BlogEngagement
          blogId={post.id}
          comments={comments}
          likes={likes.count}
          liked={likes.liked}
          viewerId={session?.user_id ?? null}
          isAdmin={session?.app_role === 'admin'}
        />

        {related.filter((r) => r.id !== post.id).length > 0 && (
          <section className="mt-10 border-t border-slate-200 pt-6">
            <h2 className="text-lg font-semibold">More reading</h2>
            <ul className="mt-3 space-y-2 text-sm">
              {related.filter((r) => r.id !== post.id).map((r) => (
                <li key={r.id}>
                  <Link href={`/blog/${r.slug}`} className="text-brand-700 hover:underline">
                    {r.title}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
      </article>
    </>
  );
}
