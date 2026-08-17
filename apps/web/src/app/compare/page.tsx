import Link from 'next/link';
import type { Metadata } from 'next';
import { apiSafe, type SiteSettings } from '@/lib/api';
import { coursePrice } from '@/lib/format';

export const revalidate = 60;
export const metadata: Metadata = {
  title: 'Compare courses',
  description: 'Put courses side by side and compare price, length, level and outcomes.',
};

interface CompareCourse {
  id: number; title: string | null; slug: string | null; short_description: string | null;
  thumbnail: string | null; level: string | null; language: string | null;
  is_paid: number | null; price: number | null;
  discount_flag: number | null; discounted_price: number | null;
  course_type: string | null; expiry_period: number | null;
  outcomes: string[]; requirements: string[];
  instructor: { id: number; name: string | null } | null;
  category: { id: number; title: string } | null;
  total_lesson: number; total_enrollment: number;
  total_duration: { seconds: number; label: string };
  rating: { average: number; count: number };
}

interface Suggestion { id: number; title: string | null; slug: string | null }

/** A row of the feature matrix. */
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <tr className="border-t border-slate-200 align-top">
      <th className="w-40 py-3 pr-4 text-left text-sm font-medium text-slate-600">{label}</th>
      {children}
    </tr>
  );
}

export default async function ComparePage(
  { searchParams }: { searchParams: Promise<Record<string, string | undefined>> },
) {
  const params = await searchParams;
  const selected = String(params['courses'] ?? '').split(',').filter(Boolean);
  const search = params['search'] ?? '';
  const query = new URLSearchParams();
  if (selected.length) query.set('courses', selected.join(','));
  if (search) query.set('search', search);

  const [payload, settings] = await Promise.all([
    apiSafe<{ courses: CompareCourse[]; suggestions: Suggestion[]; max: number }>(
      '/api/courses/compare' + (query.toString() ? '?' + query.toString() : '')),
    apiSafe<SiteSettings>('/api/settings'),
  ]);

  const courses = payload?.courses ?? [];
  const max = payload?.max ?? 3;
  const position = settings?.currency_position ?? 'left';
  const without = (slug: string) =>
    '/compare?courses=' + courses.filter((c) => c.slug !== slug).map((c) => c.slug).join(',');
  const withAdded = (slug: string) =>
    '/compare?courses=' + [...courses.map((c) => c.slug), slug].join(',');

  return (
    <div className="container-page py-10">
      <h1 className="text-2xl font-bold">Compare courses</h1>
      <p className="mt-2 text-sm text-slate-600">Put up to {max} courses side by side.</p>

      {courses.length === 0 ? (
        <p className="mt-8 rounded-lg border border-dashed border-slate-300 p-10 text-center text-sm text-slate-500">
          Nothing selected yet. Pick a course below to start.
        </p>
      ) : (
        <div className="mt-6 overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse">
            <thead>
              <tr>
                <th />
                {courses.map((c) => (
                  <th key={c.id} className="w-1/3 p-3 text-left align-top">
                    {c.thumbnail && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={c.thumbnail} alt="" className="mb-2 h-28 w-full rounded object-cover" />
                    )}
                    <Link href={'/course/' + c.slug} className="font-semibold hover:text-brand-600">
                      {c.title}
                    </Link>
                    <p className="mt-1 text-xs font-normal text-slate-500">{c.short_description}</p>
                    <Link href={without(String(c.slug))}
                      className="mt-2 inline-block text-xs text-red-600 hover:underline">
                      Remove
                    </Link>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <Row label="Price">
                {courses.map((c) => {
                  const p = coursePrice(c, position);
                  return (
                    <td key={c.id} className="py-3 pr-4 text-sm font-medium text-brand-700">
                      {p.was && <s className="mr-2 font-normal text-slate-400">{p.was}</s>}
                      {p.label}
                    </td>
                  );
                })}
              </Row>
              <Row label="Rating">
                {courses.map((c) => (
                  <td key={c.id} className="py-3 pr-4 text-sm text-slate-700">
                    {c.rating.count > 0
                      ? c.rating.average + ' / 5 (' + c.rating.count + ')'
                      : 'No reviews yet'}
                  </td>
                ))}
              </Row>
              <Row label="Lessons">
                {courses.map((c) => (
                  <td key={c.id} className="py-3 pr-4 text-sm text-slate-700">{c.total_lesson}</td>
                ))}
              </Row>
              <Row label="Length">
                {courses.map((c) => (
                  <td key={c.id} className="py-3 pr-4 text-sm text-slate-700">
                    {c.total_duration.seconds ? c.total_duration.label : '-'}
                  </td>
                ))}
              </Row>
              <Row label="Level">
                {courses.map((c) => (
                  <td key={c.id} className="py-3 pr-4 text-sm capitalize text-slate-700">
                    {c.level ?? '-'}
                  </td>
                ))}
              </Row>
              <Row label="Language">
                {courses.map((c) => (
                  <td key={c.id} className="py-3 pr-4 text-sm text-slate-700">{c.language ?? '-'}</td>
                ))}
              </Row>
              <Row label="Category">
                {courses.map((c) => (
                  <td key={c.id} className="py-3 pr-4 text-sm text-slate-700">
                    {c.category?.title ?? '-'}
                  </td>
                ))}
              </Row>
              <Row label="Instructor">
                {courses.map((c) => (
                  <td key={c.id} className="py-3 pr-4 text-sm text-slate-700">
                    {c.instructor?.name ?? '-'}
                  </td>
                ))}
              </Row>
              <Row label="Enrolled">
                {courses.map((c) => (
                  <td key={c.id} className="py-3 pr-4 text-sm text-slate-700">{c.total_enrollment}</td>
                ))}
              </Row>
              <Row label="Access">
                {courses.map((c) => (
                  <td key={c.id} className="py-3 pr-4 text-sm text-slate-700">
                    {c.expiry_period ? c.expiry_period + ' days' : 'Lifetime'}
                  </td>
                ))}
              </Row>
              <Row label="What you learn">
                {courses.map((c) => (
                  <td key={c.id} className="py-3 pr-4 text-sm text-slate-700">
                    {c.outcomes.length === 0 ? '-' : (
                      <ul className="list-disc space-y-1 pl-4">
                        {c.outcomes.slice(0, 5).map((o, i) => <li key={i}>{o}</li>)}
                      </ul>
                    )}
                  </td>
                ))}
              </Row>
              <Row label="">
                {courses.map((c) => (
                  <td key={c.id} className="py-3 pr-4">
                    <Link href={'/course/' + c.slug} className="btn-primary text-sm">View course</Link>
                  </td>
                ))}
              </Row>
            </tbody>
          </table>
        </div>
      )}

      {courses.length < max && (
        <section className="mt-10">
          <h2 className="text-lg font-semibold">Add a course</h2>
          <form action="/compare" className="mt-3 flex max-w-md gap-2">
            <input type="hidden" name="courses" value={selected.join(',')} />
            <input name="search" defaultValue={search} placeholder="Search courses"
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
            <button className="btn-primary" type="submit">Search</button>
          </form>
          {(payload?.suggestions ?? []).length === 0 ? (
            <p className="mt-4 text-sm text-slate-500">No other published courses match.</p>
          ) : (
            <ul className="mt-4 flex flex-wrap gap-2">
              {(payload?.suggestions ?? []).map((s) => (
                <li key={s.id}>
                  <Link href={withAdded(String(s.slug))}
                    className="chip border-slate-200 bg-white hover:border-brand-300">
                    + {s.title}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
