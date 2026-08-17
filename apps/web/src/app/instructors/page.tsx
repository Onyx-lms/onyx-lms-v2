import Link from 'next/link';
import type { Metadata } from 'next';
import { api, type Paginated } from '@/lib/api';

export const revalidate = 60;

interface Instructor {
  id: number; name: string | null; photo: string | null; about: string | null;
  skills: string[]; course_count: number; rating: { average: number; count: number };
}

export const metadata: Metadata = {
  title: 'Instructors',
  description: 'Meet the instructors teaching on our platform.',
};

export default async function InstructorsPage() {
  const page = await api<Paginated<Instructor>>('/api/instructors');
  return (
    <div className="container-page py-10">
      <h1 className="text-2xl font-semibold">Instructors</h1>
      <p className="mt-1 text-sm text-slate-500">{page.total} teaching right now</p>

      {page.data.length === 0 ? (
        <p className="mt-8 text-sm text-slate-500">No instructors yet.</p>
      ) : (
        <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {page.data.map((i) => (
            <Link key={i.id} href={`/instructors/${i.id}`} className="card p-5">
              <div className="font-medium text-slate-900">{i.name}</div>
              <div className="mt-1 text-xs text-slate-500">
                {i.course_count} {i.course_count === 1 ? 'course' : 'courses'}
                {i.rating.count > 0 && ` · ${i.rating.average}/5`}
              </div>
              {i.about && <p className="mt-2 line-clamp-3 text-sm text-slate-600">{i.about}</p>}
              {i.skills.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {i.skills.slice(0, 4).map((s) => (
                    <span key={s} className="chip border-slate-200 bg-slate-50 text-slate-600">{s}</span>
                  ))}
                </div>
              )}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
