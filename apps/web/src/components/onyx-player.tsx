'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { LessonDetail } from '@/lib/onyx-learn';
import { Icon } from '@/components/onyx-ui';

/**
 * LRN-02a -- the lesson player, with resumable playback.
 *
 * Two things make "resumable" actually work:
 *
 *   * The video seeks to the saved position once it knows how long it is. Doing
 *     it earlier is a no-op the browser silently discards.
 *   * Progress is posted on a timer AND on the way out. A learner who closes
 *     the tab mid-lesson is the normal case, not the exceptional one, so
 *     `visibilitychange` uses sendBeacon -- a fetch started during unload is
 *     usually cancelled before it leaves.
 */
const SAVE_EVERY_MS = 10_000;

export function OnyxPlayer({ lesson }: { lesson: LessonDetail }) {
  const video = useRef<HTMLVideoElement>(null);
  const position = useRef(lesson.position_seconds);
  const saved = useRef(lesson.position_seconds);
  const [completed, setCompleted] = useState(Boolean(lesson.completed_at));
  const [resumedFrom] = useState(lesson.position_seconds);

  const save = useCallback((done = false, beacon = false) => {
    const at = Math.floor(position.current);
    if (!done && Math.abs(at - saved.current) < 5) return;
    saved.current = at;
    const url = '/api/proxy/onyx/lessons/' + lesson.id + '/progress';
    const payload = JSON.stringify({ position_seconds: at, completed: done });
    if (beacon && typeof navigator.sendBeacon === 'function') {
      navigator.sendBeacon(url, new Blob([payload], { type: 'application/json' }));
      return;
    }
    void fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload,
    });
  }, [lesson.id]);

  useEffect(() => {
    const timer = setInterval(() => save(), SAVE_EVERY_MS);
    const onHide = () => { if (document.visibilityState === 'hidden') save(false, true); };
    document.addEventListener('visibilitychange', onHide);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onHide);
      save();
    };
  }, [save]);

  if (lesson.type === 'text') {
    return (
      <article className="prose max-w-none whitespace-pre-wrap text-sm text-slate-700">
        {lesson.body}
      </article>
    );
  }

  if (lesson.type !== 'video') {
    return lesson.url ? (
      <a href={lesson.url} target="_blank" rel="noreferrer"
        className="inline-block rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white">
        Open {lesson.type === 'document' ? 'the document' : 'the link'}
      </a>
    ) : <p className="text-sm text-muted">This lesson has nothing attached.</p>;
  }

  return (
    <div className="space-y-3">
      <video
        ref={video}
        src={lesson.url ?? undefined}
        controls
        className="aspect-video w-full rounded-xl bg-black"
        onLoadedMetadata={() => {
          // Only now does the browser accept a seek.
          if (video.current && resumedFrom > 0) video.current.currentTime = resumedFrom;
        }}
        onTimeUpdate={() => { position.current = video.current?.currentTime ?? 0; }}
        onEnded={() => { setCompleted(true); save(true); }}
      />
      {/* This row lives on the dark theatre frame the page wraps around a
          video lesson, so it is styled light-on-dark rather than assuming
          a white background under it. */}
      <div className="flex flex-wrap items-center gap-3 px-1 pb-1 text-[13px]">
        {completed
          ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-400/15
                             px-3 py-1.5 font-bold text-emerald-300">
              <Icon name="check" className="h-3.5 w-3.5" />
              Completed
            </span>
          )
          : (
            <button
              type="button"
              onClick={() => { setCompleted(true); save(true); }}
              className="inline-flex items-center gap-1.5 rounded-full border border-white/25
                         px-3.5 py-1.5 font-semibold text-white/90 transition hover:border-white/50
                         hover:bg-white/10"
            >
              <Icon name="check" className="h-3.5 w-3.5" />
              Mark as complete
            </button>
          )}
        {resumedFrom > 0 && !completed ? (
          <span className="text-white/50">
            Resumed from {Math.floor(resumedFrom / 60)}m {resumedFrom % 60}s
          </span>
        ) : null}
      </div>
    </div>
  );
}

/** LRN-02b -- fetches a fresh signed link at the moment of the click. */
export function ResourceLink({ resource }: { resource: { id: number; title: string } }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <>
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true); setError(null);
          const res = await fetch('/api/proxy/onyx/resources/' + resource.id + '/url');
          const body = await res.json().catch(() => ({}));
          setBusy(false);
          // The link is short-lived, so it is fetched on click rather than
          // rendered into the page where it would expire before use.
          if (body.ok && body.data?.url) window.open(body.data.url, '_blank', 'noopener');
          else setError(body.message ?? 'That download is not available.');
        }}
        className="text-sm text-brand-600 hover:underline disabled:opacity-50"
      >
        {busy ? 'Preparing…' : resource.title}
      </button>
      {error ? <span className="ml-2 text-xs text-rose-600">{error}</span> : null}
    </>
  );
}
