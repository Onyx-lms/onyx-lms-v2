import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { apiSafe, type SiteSettings } from '@/lib/api';
import { currency } from '@/lib/format';
import { getSession } from '@/lib/session';
import { BookSlot } from '@/components/book-slot';

export const dynamic = 'force-dynamic';

interface Slot {
  id: number; start_time: number | null; end_time: number | null;
  duration: number | null; price: number | null; description: string | null;
  booking_id: number | null;
}
interface Offer {
  id: number; price: number | null; description: string | null;
  tutor: { id: number; name: string | null; about: string | null } | null;
  category: { name: string } | null; subject: { name: string } | null;
}
interface Payload {
  schedules: Slot[];
  subjects: Offer[];
  reviews: { total: number; average: number;
             reviews: { id: number; rating: number | null; review: string | null;
                        student: { name: string | null } | null }[] };
}

export async function generateMetadata(
  { params }: { params: Promise<{ id: string }> },
): Promise<Metadata> {
  const { id } = await params;
  const data = await apiSafe<Payload>('/api/tutors/' + encodeURIComponent(id) + '/schedules');
  return { title: data?.subjects[0]?.tutor?.name ?? 'Tutor' };
}

const when = (seconds: number | null) =>
  seconds ? new Date(Number(seconds) * 1000).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : '';

export default async function TutorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [data, settings, session] = await Promise.all([
    apiSafe<Payload>('/api/tutors/' + encodeURIComponent(id) + '/schedules'),
    apiSafe<SiteSettings>('/api/settings'),
    getSession(),
  ]);
  if (!data) notFound();

  const position = settings?.currency_position ?? 'left';
  const tutor = data.subjects[0]?.tutor ?? null;

  return (
    <div className="container-page grid max-w-5xl gap-8 py-10 lg:grid-cols-[1fr_320px]">
      <div>
        <h1 className="text-2xl font-bold">{tutor?.name ?? 'Tutor'}</h1>
        {tutor?.about && <p className="mt-2 text-sm text-slate-600">{tutor.about}</p>}

        <section className="mt-8">
          <h2 className="text-lg font-semibold">Available sessions</h2>
          {data.schedules.length === 0 ? (
            <p className="mt-3 text-sm text-slate-500">
              Nothing free right now. Check back soon.
            </p>
          ) : (
            <ul className="mt-4 divide-y divide-slate-200 rounded-lg border border-slate-200">
              {data.schedules.map((s) => (
                <li key={s.id} className="flex items-center justify-between px-4 py-3 text-sm">
                  <div>
                    <div className="font-medium">{when(s.start_time)}</div>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {s.duration} minutes - {currency(s.price, position)}
                    </p>
                  </div>
                  <BookSlot scheduleId={s.id} isSignedIn={Boolean(session)} />
                </li>
              ))}
            </ul>
          )}
        </section>

        {data.reviews.total > 0 && (
          <section className="mt-10">
            <h2 className="text-lg font-semibold">
              Reviews
              <span className="ml-2 text-sm font-normal text-slate-500">
                {data.reviews.average} / 5 from {data.reviews.total}
              </span>
            </h2>
            <ul className="mt-3 space-y-3">
              {data.reviews.reviews.map((r) => (
                <li key={r.id} className="card p-4 text-sm">
                  <p className="font-medium">{r.student?.name ?? 'A student'} - {r.rating} / 5</p>
                  {r.review && <p className="mt-1 text-slate-600">{r.review}</p>}
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      <aside className="card h-fit p-5">
        <h2 className="text-sm font-semibold">Teaches</h2>
        <ul className="mt-3 space-y-3 text-sm">
          {data.subjects.map((o) => (
            <li key={o.id}>
              <div className="font-medium">{o.subject?.name}</div>
              <p className="text-xs text-slate-500">{o.category?.name}</p>
              <p className="mt-1 text-brand-700">{currency(o.price, position)}</p>
            </li>
          ))}
        </ul>
        <Link href="/tutors" className="mt-5 block text-sm text-brand-700 hover:underline">
          Back to all tutors
        </Link>
      </aside>
    </div>
  );
}
