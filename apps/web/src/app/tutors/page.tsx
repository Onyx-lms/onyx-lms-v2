import Link from 'next/link';
import type { Metadata } from 'next';
import { api, apiSafe, type SiteSettings } from '@/lib/api';
import { currency } from '@/lib/format';

export const revalidate = 60;
export const metadata: Metadata = {
  title: 'Find a tutor',
  description: 'Book a one-to-one session with a tutor.',
};

interface Offer {
  id: number; price: number | null; description: string | null; thumbnail: string | null;
  tutor: { id: number; name: string | null; photo: string | null; about: string | null } | null;
  category: { id: number; name: string; slug: string } | null;
  subject: { id: number; name: string; slug: string } | null;
}
interface Term { id: number; name: string; slug: string }

export default async function TutorsPage(
  { searchParams }: { searchParams: Promise<Record<string, string | undefined>> },
) {
  const params = await searchParams;
  const query = new URLSearchParams();
  for (const k of ['category', 'subject', 'search']) if (params[k]) query.set(k, params[k]!);

  const [offers, categories, subjects, settings] = await Promise.all([
    api<Offer[]>('/api/tutors' + (query.toString() ? '?' + query : '')),
    apiSafe<Term[]>('/api/tutor/categories'),
    apiSafe<Term[]>('/api/tutor/subjects'),
    apiSafe<SiteSettings>('/api/settings'),
  ]);
  const position = settings?.currency_position ?? 'left';

  return (
    <div className="container-page grid gap-8 py-10 lg:grid-cols-[240px_1fr]">
      <aside className="space-y-6">
        <section>
          <h2 className="text-sm font-semibold">Category</h2>
          <ul className="mt-3 space-y-1 text-sm">
            <li>
              <Link href="/tutors" className={!params['category']
                ? 'font-medium text-brand-700' : 'text-slate-600 hover:text-brand-600'}>
                All
              </Link>
            </li>
            {(categories ?? []).map((c) => (
              <li key={c.id}>
                <Link href={'/tutors?category=' + c.id}
                  className={params['category'] === String(c.id)
                    ? 'font-medium text-brand-700' : 'text-slate-600 hover:text-brand-600'}>
                  {c.name}
                </Link>
              </li>
            ))}
          </ul>
        </section>
        {(subjects ?? []).length > 0 && (
          <section>
            <h2 className="text-sm font-semibold">Subject</h2>
            <ul className="mt-3 space-y-1 text-sm">
              {(subjects ?? []).map((s) => (
                <li key={s.id}>
                  <Link href={'/tutors?subject=' + s.id}
                    className={params['subject'] === String(s.id)
                      ? 'font-medium text-brand-700' : 'text-slate-600 hover:text-brand-600'}>
                    {s.name}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
      </aside>

      <div>
        <h1 className="text-2xl font-bold">Find a tutor</h1>
        <form action="/tutors" className="mt-4 flex max-w-md gap-2">
          <input name="search" defaultValue={params['search'] ?? ''} placeholder="Search by name"
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
          <button className="btn-primary" type="submit">Search</button>
        </form>

        {offers.length === 0 ? (
          <p className="mt-8 text-sm text-slate-500">No tutors match that yet.</p>
        ) : (
          <div className="mt-6 grid gap-5 sm:grid-cols-2">
            {offers.map((o) => (
              <article key={o.id} className="card p-4">
                <h2 className="font-semibold">
                  <Link href={'/tutors/' + o.tutor?.id} className="hover:text-brand-600">
                    {o.tutor?.name ?? 'Tutor'}
                  </Link>
                </h2>
                <p className="mt-1 text-xs text-slate-500">
                  {o.subject?.name}{o.category ? ' - ' + o.category.name : ''}
                </p>
                {o.description && (
                  <p className="mt-2 line-clamp-3 text-sm text-slate-600">{o.description}</p>
                )}
                <p className="mt-3 font-medium text-brand-700">
                  {currency(o.price, position)} per session
                </p>
              </article>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
