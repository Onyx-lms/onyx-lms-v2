'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { LessonView } from './lesson-view';
import type { PlayerPayload } from '@/app/play-course/[slug]/page';

/** PL-01 / PL-04 / PL-09 -- shell, progress ping and navigation. */
export function PlayerClient({ payload, slug, viewerLabel }: {
  payload: PlayerPayload; slug: string; viewerLabel?: string;
}) {
  const router = useRouter();
  const [progress, setProgress] = useState(payload.progress);
  const [certificate, setCertificate] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const current = payload.current!;

  // The ping is fire-and-forget: a dropped tick must never interrupt playback.
  const lastTick = useRef<number>(-1);
  async function ping(seconds: number) {
    const marker = Math.floor(seconds / 5) * 5;
    if (marker === lastTick.current) return;
    lastTick.current = marker;
    try {
      const res = await fetch('/api/proxy/player/ping', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          course_id: payload.course.id, lesson_id: current.id, current_duration: marker,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (body?.data?.course_progress != null) setProgress(body.data.course_progress);
      if (body?.data?.certificate) setCertificate(body.data.certificate);
      if (body?.data?.is_completed) router.refresh();
    } catch { /* offline or slow: the next tick will carry it */ }
  }

  async function toggleComplete() {
    setBusy(true);
    const res = await fetch('/api/proxy/player/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ course_id: payload.course.id, lesson_id: current.id }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (body?.data?.progress != null) setProgress(body.data.progress);
    if (body?.data?.certificate) setCertificate(body.data.certificate);
    router.refresh();
  }

  const go = (lessonId: number | null) => {
    if (lessonId) router.push('/play-course/' + slug + '?lesson=' + lessonId);
  };

  const isComplete = payload.curriculum
    .flatMap((s) => s.lessons).find((l) => l.id === current.id)?.completed ?? false;

  return (
    <div className="container-page grid gap-6 py-6 lg:grid-cols-[1fr_320px]">
      <section>
        <nav className="mb-3 text-sm text-slate-500">
          <Link href={'/course/' + slug} className="hover:text-brand-600">
            {payload.course.title}
          </Link>
        </nav>

        <LessonView lesson={current} onProgress={ping}
          player={payload.player} viewerLabel={viewerLabel}
          onEnded={() => {
          // PL-09 auto-advance: finishing a video moves to the next lesson.
          void toggleComplete().then(() => go(payload.next_lesson_id));
        }} />

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-lg font-semibold">{current.title}</h1>
          <div className="flex gap-2">
            <button className="btn-ghost" disabled={!payload.previous_lesson_id}
              onClick={() => go(payload.previous_lesson_id)}>Previous</button>
            <button className="btn-ghost" disabled={!payload.next_lesson_id}
              onClick={() => go(payload.next_lesson_id)}>Next</button>
            <button className={isComplete ? 'btn-ghost' : 'btn-primary'}
              disabled={busy} onClick={toggleComplete}>
              {isComplete ? 'Mark incomplete' : 'Mark complete'}
            </button>
          </div>
        </div>

        {current.summary && (
          <section className="mt-6">
            <h2 className="text-sm font-semibold">Summary</h2>
            <p className="mt-2 text-sm text-slate-700">{current.summary}</p>
          </section>
        )}

        {current.attachment && (
          <a href={current.attachment} className="btn-ghost mt-4 inline-flex" download>
            Download attachment
          </a>
        )}
      </section>

      <aside>
        <div className="card p-4">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium">Progress</span>
            <span>{progress}%</span>
          </div>
          <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-slate-100">
            <div className="h-full rounded-full bg-brand-600"
              style={{ width: Math.min(100, progress) + '%' }} />
          </div>
          {certificate && (
            <Link href={'/certificate/' + certificate} className="btn-primary mt-3 w-full">
              Get your certificate
            </Link>
          )}
        </div>

        <div className="mt-4 space-y-3">
          {payload.curriculum.map((section) => (
            <div key={section.id} className="card overflow-hidden">
              <div className="border-b border-slate-100 bg-slate-50 px-3 py-2 text-sm font-medium">
                {section.title}
              </div>
              <ul className="divide-y divide-slate-100">
                {section.lessons.map((lesson) => (
                  <li key={lesson.id}>
                    <button
                      disabled={lesson.locked}
                      onClick={() => go(lesson.id)}
                      title={lesson.locked ? 'Finish the previous lesson first' : undefined}
                      className={'flex w-full items-center justify-between px-3 py-2 text-left text-sm '
                        + (lesson.id === current.id ? 'bg-brand-50 font-medium text-brand-700 ' : '')
                        + (lesson.locked ? 'cursor-not-allowed text-slate-400' : 'hover:bg-slate-50')}
                    >
                      <span className="flex items-center gap-2">
                        <span aria-hidden>
                          {lesson.locked ? '\u{1F512}' : lesson.completed ? '✓' : '○'}
                        </span>
                        {lesson.title}
                      </span>
                      <span className="text-xs text-slate-500">{lesson.duration}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </aside>
    </div>
  );
}
