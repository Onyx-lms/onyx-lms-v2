import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { requireSession, apiAuth } from '@/lib/session';
import { PlayerClient } from '@/components/player-client';
import { apiAuthSafe } from '@/lib/session';
import type { LiveClass } from '@/components/live-class-admin';

export const metadata: Metadata = { title: 'Course player' };

export interface PlayerLesson {
  id: number; title: string | null; lesson_type: string | null;
  duration: string | null; is_free: number | null;
  completed: boolean; locked: boolean; watched_seconds: number;
}
export interface PlayerPayload {
  player: { disable_download: boolean;
            watermark: { type: 'js' | 'ffmpeg' | 'none'; logo: string | null;
                         text: string | null; top: number; left: number;
                         width: number; height: number; opacity: number } };
  course: { id: number; title: string | null; slug: string | null; enable_drip_content: number | null };
  curriculum: { id: number; title: string | null; lessons: PlayerLesson[] }[];
  current: { id: number; title: string | null; lesson_type: string | null;
             video_type: string | null; lesson_src: string | null; duration: string | null;
             summary: string | null; attachment: string | null; attachment_type: string | null } | null;
  progress: number;
  total_lesson: number;
  next_lesson_id: number | null;
  previous_lesson_id: number | null;
  can_bypass_drip: boolean;
}

/** PL-01 -- the player shell. */
export default async function PlayerPage(
  { params, searchParams }: {
    params: Promise<{ slug: string }>;
    searchParams: Promise<{ lesson?: string }>;
  },
) {
  const session = await requireSession();
  const { slug } = await params;
  const { lesson } = await searchParams;

  let payload: PlayerPayload;
  try {
    payload = await apiAuth<PlayerPayload>(
      '/api/player/' + encodeURIComponent(slug) + (lesson ? '?lesson=' + lesson : ''));
  } catch (e) {
    // Access failures are expected here: not enrolled, expired, or drip-locked.
    const message = e instanceof Error ? e.message : 'You cannot open this course.';
    return (
      <div className="container-page py-20 text-center">
        <h1 className="text-2xl font-semibold">This course is not available</h1>
        <p className="mt-3 text-slate-600">{message}</p>
        <div className="mt-6 flex justify-center gap-3">
          <Link href={'/course/' + slug} className="btn-primary">View the course page</Link>
          <Link href="/my-courses" className="btn-ghost">My courses</Link>
        </div>
      </div>
    );
  }

  if (!payload.current) redirect('/course/' + slug);

  // LC-01/LC-06: the schedule, so an enrolled student sees the next class and
  // the join button appears only inside its window.
  const liveClasses = (await apiAuthSafe<LiveClass[]>(
    '/api/courses/' + payload.course.id + '/live-classes')) ?? [];
  const upcoming = liveClasses
    .filter((c) => c.class_date_and_time
      && new Date(c.class_date_and_time).getTime() > Date.now() - 3 * 60 * 60 * 1000)
    .slice(0, 3);
  // The watermark carries the viewer's own address, so a leaked recording
  // points at whoever recorded it.
  return (
    <>
      {upcoming.length > 0 && (
        <section className="border-b border-slate-200 bg-slate-50">
          <div className="container-page flex flex-wrap items-center gap-4 py-3 text-sm">
            <span className="font-medium">Live classes</span>
            {upcoming.map((c) => (
              <span key={c.id} className="flex items-center gap-2 text-slate-600">
                <span>{c.class_topic}</span>
                <span className="text-xs text-slate-500">
                  {c.class_date_and_time
                    ? new Date(c.class_date_and_time).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })
                    : ''}
                </span>
                {c.join_window.open ? (
                  <Link href={'/live-class/' + c.id} className="btn-primary px-3 py-1 text-xs">
                    Join now
                  </Link>
                ) : (
                  <span className="chip border-slate-200 bg-white text-xs">Not open yet</span>
                )}
              </span>
            ))}
          </div>
        </section>
      )}
      <PlayerClient payload={payload} slug={slug} viewerLabel={session.email} />
    </>
  );
}
