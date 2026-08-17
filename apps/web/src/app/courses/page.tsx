import Link from 'next/link';
import type { Metadata } from 'next';
import { api, apiSafe, type CategoryNode, type CourseCard as Course, type PageMetadata, type Paginated, type SiteSettings } from '@/lib/api';
import { CourseCard } from '@/components/course-card';

export const revalidate = 60;

type Search = Record<string, string | undefined>;

export async function generateMetadata(): Promise<Metadata> {
  const seo = await apiSafe<PageMetadata>('/api/seo/courses');
  return {
    title: seo?.title ?? 'Courses',
    description: seo?.description ?? '',
    keywords: seo?.keywords ?? '',
    robots: seo?.robots ?? 'index, follow',
  };
}

function qs(params: Search, override: Search): string {
  const merged: Search = { ...params, ...override };
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(merged)) if (v) sp.set(k, v);
  const s = sp.toString();
  return s ? `?${s}` : '';
}

export default async function CoursesPage({ searchParams }: { searchParams: Promise<Search> }) {
  const params = await searchParams;
  const query = qs(params, {});

  const [settings, categories, facets, courses] = await Promise.all([
    apiSafe<SiteSettings>('/api/settings'),
    apiSafe<CategoryNode[]>('/api/categories'),
    apiSafe<{ levels: string[]; languages: string[] }>('/api/courses/facets'),
    api<Paginated<Course>>('/api/courses' + query),
  ]);

  const active = (key: string, value: string) => params[key] === value;
  const filterLink = (key: string, value: string) =>
    `/courses${qs(params, { [key]: active(key, value) ? undefined : value, page: undefined })}`;

  return (
    <div className="container-page grid gap-8 py-10 lg:grid-cols-[240px_1fr]">
      <aside className="space-y-6">
        <FilterGroup title="Category">
          {(categories ?? []).map((c) => (
            <FilterLink key={c.id} href={filterLink('category', c.slug ?? '')}
              active={active('category', c.slug ?? '')}>
              {c.title} <span className="text-slate-400">({c.course_count})</span>
            </FilterLink>
          ))}
        </FilterGroup>

        <FilterGroup title="Price">
          {['free', 'paid', 'discount'].map((p) => (
            <FilterLink key={p} href={filterLink('price', p)} active={active('price', p)}>
              {p[0].toUpperCase() + p.slice(1)}
            </FilterLink>
          ))}
        </FilterGroup>

        {(facets?.levels.length ?? 0) > 0 && (
          <FilterGroup title="Level">
            {facets!.levels.map((l) => (
              <FilterLink key={l} href={filterLink('level', l)} active={active('level', l)}>{l}</FilterLink>
            ))}
          </FilterGroup>
        )}

        {(facets?.languages.length ?? 0) > 0 && (
          <FilterGroup title="Language">
            {facets!.languages.map((l) => (
              <FilterLink key={l} href={filterLink('language', l)} active={active('language', l)}>{l}</FilterLink>
            ))}
          </FilterGroup>
        )}
      </aside>

      <section>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h1 className="text-2xl font-semibold">
            {params.search ? `Results for "${params.search}"` : 'All courses'}
          </h1>
          <p className="text-sm text-slate-500">
            {courses.total} {courses.total === 1 ? 'course' : 'courses'}
          </p>
        </div>

        {courses.data.length === 0 ? (
          <p className="mt-8 rounded-lg border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">
            Nothing matches those filters yet.
          </p>
        ) : (
          <div className="mt-6 grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
            {courses.data.map((c) => (
              <CourseCard key={c.id} course={c} currencyPosition={settings?.currency_position ?? 'left'} />
            ))}
          </div>
        )}

        {courses.last_page > 1 && (
          <nav className="mt-8 flex justify-center gap-2" aria-label="Pagination">
            {Array.from({ length: courses.last_page }, (_, i) => i + 1).map((p) => (
              <Link key={p} href={`/courses${qs(params, { page: String(p) })}`}
                className={`btn ${p === courses.current_page ? 'bg-brand-600 text-white' : 'btn-ghost'}`}>
                {p}
              </Link>
            ))}
          </nav>
        )}
      </section>
    </div>
  );
}

function FilterGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
      <div className="mt-2 space-y-1">{children}</div>
    </div>
  );
}

function FilterLink({ href, active, children }: {
  href: string; active: boolean; children: React.ReactNode;
}) {
  return (
    <Link href={href}
      className={`block rounded px-2 py-1 text-sm ${active ? 'bg-brand-50 font-medium text-brand-700' : 'text-slate-600 hover:bg-slate-50'}`}>
      {children}
    </Link>
  );
}
