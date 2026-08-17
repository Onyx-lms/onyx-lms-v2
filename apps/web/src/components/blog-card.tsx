import Link from 'next/link';

export interface BlogPost {
  id: number;
  title: string | null;
  slug: string | null;
  keywords: string | null;
  thumbnail: string | null;
  banner?: string | null;
  is_popular: number | null;
  created_at: string | null;
  author?: { id: number; name: string | null } | null;
  category?: { id: number; title: string; slug: string } | null;
}

export function formatDate(value: string | null): string {
  if (!value) return '';
  const d = new Date(value);
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function BlogCard({ post }: { post: BlogPost }) {
  return (
    <article className="card overflow-hidden">
      {post.thumbnail && (
        // Thumbnails are operator-uploaded paths of unknown size, so a plain
        // <img> avoids next/image's remote-host allowlist entirely.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={post.thumbnail} alt="" className="h-40 w-full object-cover" />
      )}
      <div className="p-4">
        {post.category && (
          <Link href={`/blogs?category=${post.category.slug}`}
            className="text-xs font-medium uppercase tracking-wide text-brand-700">
            {post.category.title}
          </Link>
        )}
        <h2 className="mt-1 font-semibold leading-snug">
          <Link href={`/blog/${post.slug}`} className="hover:text-brand-600">{post.title}</Link>
        </h2>
        <p className="mt-2 text-xs text-slate-500">
          {post.author?.name && <span>{post.author.name} &middot; </span>}
          {formatDate(post.created_at)}
        </p>
      </div>
    </article>
  );
}
