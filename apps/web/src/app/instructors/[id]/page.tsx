import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { apiSafe, type CourseCard as Course, type SiteSettings } from '@/lib/api';
import { CourseCard } from '@/components/course-card';

export const revalidate = 60;

interface InstructorDetail {
  id: number; name: string | null; photo: string | null; about: string | null;
  skills: string[]; educations: { degree?: string; institute?: string; year?: string }[];
  courses: Course[]; course_count: number; rating: { average: number; count: number };
}

const load = (id: string) => apiSafe<InstructorDetail>(`/api/instructors/${encodeURIComponent(id)}`);

export async function generateMetadata(
  { params }: { params: Promise<{ id: string }> },
): Promise<Metadata> {
  const { id } = await params;
  const i = await load(id);
  if (!i) return { title: 'Instructor not found' };
  return {
    title: i.name ?? 'Instructor',
    description: i.about ?? `Courses taught by ${i.name}.`,
  };
}

export default async function InstructorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [instructor, settings] = await Promise.all([load(id), apiSafe<SiteSettings>('/api/settings')]);
  if (!instructor) notFound();

  return (
    <div className="container-page py-10">
      <nav className="text-sm text-slate-500">
        <Link href="/instructors" className="hover:text-brand-600">Instructors</Link>
        <span className="mx-2">/</span>
        <span>{instructor.name}</span>
      </nav>

      <header className="mt-4">
        <h1 className="text-3xl font-semibold">{instructor.name}</h1>
        <p className="mt-1 text-sm text-slate-500">
          {instructor.course_count} {instructor.course_count === 1 ? 'course' : 'courses'}
          {instructor.rating.count > 0 &&
            ` · ${instructor.rating.average}/5 from ${instructor.rating.count} reviews`}
        </p>
        {instructor.about && <p className="mt-4 max-w-3xl text-slate-700">{instructor.about}</p>}
      </header>

      {instructor.educations.length > 0 && (
        <section className="mt-8">
          <h2 className="text-lg font-semibold">Education</h2>
          <ul className="mt-3 space-y-2">
            {instructor.educations.map((e, i) => (
              <li key={i} className="text-sm text-slate-700">
                <span className="font-medium">{e.degree}</span>
                {e.institute && ` — ${e.institute}`}
                {e.year && <span className="text-slate-500"> ({e.year})</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-10">
        <h2 className="text-lg font-semibold">Courses</h2>
        {instructor.courses.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">No published courses yet.</p>
        ) : (
          <div className="mt-4 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {instructor.courses.map((c) => (
              <CourseCard key={c.id} course={c}
                currencyPosition={settings?.currency_position ?? 'left'} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
