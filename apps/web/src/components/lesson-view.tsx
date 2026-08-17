'use client';

import { useEffect, useRef, useState } from 'react';
import { WatermarkOverlay, type WatermarkConfig } from './watermark-overlay';

interface Lesson {
  id: number; title: string | null; lesson_type: string | null;
  video_type: string | null; lesson_src: string | null; duration: string | null;
}

/**
 * PL-02 / PL-03 -- renders whichever of the thirteen lesson types this is.
 *
 * Only HTML5 video can report playback position to us. YouTube, Vimeo and Drive
 * play inside their own iframes, so progress there is driven by a wall-clock
 * timer while the lesson is open -- the same approximation Laravel made.
 */
export function LessonView({ lesson, onProgress, onEnded, player, viewerLabel }: {
  lesson: Lesson;
  onProgress: (seconds: number) => void;
  onEnded: () => void;
  player?: { disable_download: boolean; watermark: WatermarkConfig };
  viewerLabel?: string;
}) {
  const type = lesson.lesson_type ?? '';
  const src = lesson.lesson_src ?? '';

  if (type === 'video' || type === 'academy_cloud' || lesson.video_type === 'html5') {
    return (
      <Html5Video src={src} onProgress={onProgress} onEnded={onEnded}
        disableDownload={player?.disable_download ?? true}
        watermark={player?.watermark} viewerLabel={viewerLabel} />
    );
  }
  if (type === 'youtube') {
    return <EmbeddedPlayer title={lesson.title} onProgress={onProgress}
      src={'https://www.youtube.com/embed/' + encodeURIComponent(src)} />;
  }
  if (type === 'vimeo') {
    return <EmbeddedPlayer title={lesson.title} onProgress={onProgress}
      src={'https://player.vimeo.com/video/' + encodeURIComponent(src)} />;
  }
  if (type === 'google_drive' || type === 'google_drive_video') {
    return <EmbeddedPlayer title={lesson.title} onProgress={onProgress}
      src={'https://drive.google.com/file/d/' + encodeURIComponent(src) + '/preview'} />;
  }
  if (type === 'document' || type === 'document_type') {
    return <DocumentView src={src} title={lesson.title} />;
  }
  if (type === 'image') {
    return (
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
        <img src={src} alt={lesson.title ?? ''} className="mx-auto max-h-[70vh]" />
      </div>
    );
  }
  if (type === 'iframe' || type === 'scorm') {
    return (
      <div className="aspect-video overflow-hidden rounded-xl border border-slate-200">
        <iframe src={src} title={lesson.title ?? 'Lesson'} className="h-full w-full"
          allowFullScreen sandbox="allow-scripts allow-same-origin allow-forms" />
      </div>
    );
  }
  if (type === 'quiz') {
    return (
      <div className="rounded-xl border border-slate-200 p-10 text-center">
        <p className="text-sm text-slate-600">This lesson is a quiz.</p>
        <a href={'/quiz/' + lesson.id} className="btn-primary mt-4">Start the quiz</a>
      </div>
    );
  }
  return (
    <div className="rounded-xl border border-slate-200 p-6">
      <p className="text-sm text-slate-600">This lesson has no media to play.</p>
    </div>
  );
}

function Html5Video({ src, onProgress, onEnded, disableDownload, watermark, viewerLabel }: {
  src: string; onProgress: (s: number) => void; onEnded: () => void;
  disableDownload: boolean; watermark?: WatermarkConfig; viewerLabel?: string;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  return (
    <div className="relative aspect-video w-full overflow-hidden rounded-xl bg-black">
      <video
        ref={ref}
        src={src}
        controls
        controlsList={disableDownload ? 'nodownload' : undefined}
        onContextMenu={(e) => { if (disableDownload) e.preventDefault(); }}
        onTimeUpdate={() => onProgress(ref.current?.currentTime ?? 0)}
        onEnded={onEnded}
        className="h-full w-full"
      />
      {watermark && <WatermarkOverlay config={watermark} label={viewerLabel} />}
    </div>
  );
}

/**
 * Third-party iframes do not expose playback position across origins, so the
 * ping is driven by elapsed wall-clock time while the lesson is open. It is an
 * approximation, and it is the one the original made too.
 */
function EmbeddedPlayer({ src, title, onProgress }: {
  src: string; title: string | null; onProgress: (s: number) => void;
}) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const started = Date.now();
    const timer = setInterval(() => {
      const seconds = Math.floor((Date.now() - started) / 1000);
      setElapsed(seconds);
      onProgress(seconds);
    }, 5000);
    return () => clearInterval(timer);
  }, [src, onProgress]);

  return (
    <div>
      <div className="aspect-video overflow-hidden rounded-xl bg-black">
        <iframe src={src} title={title ?? 'Lesson'} className="h-full w-full"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; picture-in-picture"
          allowFullScreen />
      </div>
      <p className="mt-1 text-right text-xs text-slate-400">
        watched about {Math.floor(elapsed / 60)}m {elapsed % 60}s
      </p>
    </div>
  );
}

/** PL-03 -- PDFs render in the browser's own viewer; other files download. */
function DocumentView({ src, title }: { src: string; title: string | null }) {
  const isPdf = /\.pdf($|\?)/i.test(src);
  if (isPdf) {
    return (
      <object data={src} type="application/pdf"
        className="h-[75vh] w-full rounded-xl border border-slate-200">
        <p className="p-6 text-sm text-slate-600">
          Your browser cannot display this PDF.{' '}
          <a href={src} className="text-brand-600 underline" download>Download it instead</a>.
        </p>
      </object>
    );
  }
  return (
    <div className="rounded-xl border border-slate-200 p-10 text-center">
      <p className="text-sm text-slate-600">{title}</p>
      <a href={src} className="btn-primary mt-4 inline-flex" download>Download the file</a>
    </div>
  );
}
