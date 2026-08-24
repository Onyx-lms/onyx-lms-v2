import Link from 'next/link';
import type { Metadata } from 'next';
import { requirePlatformSession } from '@/lib/onyx-platform-session';
import { attempt, Unavailable } from '@/lib/onyx-platform-tenant';
import { LessonEditForm } from '@/components/onyx-platform-forms';
import { Card, Icon, Pill, SectionHead } from '@/components/onyx-ui';

export const metadata: Metadata = { title: 'Lesson' };

interface LessonView {
  id: number; course_id: number; module_id: number; title: string; type: string;
  path: string | null; body: string | null; duration_seconds: number | null;
  is_preview: number; url: string | null;
  resources?: { id: number; title: string; mime: string | null }[];
}

/**
 * One lesson, opened from the console.
 *
 * An operator could upload a file and had no way to confirm the right one had
 * gone up: the only evidence was a row in a list saying "document". So this
 * plays what plays, shows what shows, and says plainly when a file cannot be
 * rendered in a browser rather than pretending.
 *
 * The URL is signed and lasts an hour. The bucket is not public, which is why
 * the file cannot simply be linked and why this page is worth having at all --
 * there is no address an operator could paste into a tab themselves.
 */
export default async function OnyxPlatformLessonPage(
  { params }: { params: Promise<{ id: string; lessonId: string }> },
) {
  await requirePlatformSession();
  const { id, lessonId } = await params;
  const tenantId = Number(id);
  const lesson = await attempt<LessonView>(
    '/api/onyx/platform/tenants/' + encodeURIComponent(id)
    + '/lessons/' + encodeURIComponent(lessonId));

  if (lesson === null) return <Unavailable what="lesson" />;

  return (
    <div className="min-w-0 space-y-5">
      <Link href={'/onyx/platform/tenants/' + tenantId + '/courses/' + lesson.course_id}
        className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-brand-700
                   hover:underline">
        <Icon name="chevron" className="h-4 w-4 rotate-180" />
        Back to the course
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-[19px] font-bold text-ink">{lesson.title}</h2>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-[12.5px] text-muted">
            <span>{lesson.type}</span>
            {lesson.duration_seconds
              ? <><span>·</span><span className="tabular-nums">
                {Math.round(lesson.duration_seconds / 60)} min
              </span></>
              : null}
            {lesson.is_preview ? <Pill tone="neutral">Open before enrolment</Pill> : null}
          </div>
        </div>
      </div>

      {/*
        * What a learner would get, as far as a browser can give it.
        *
        * Each kind is handled on its own rather than falling through to a
        * download link: an operator checking that the right video went up
        * needs to watch a second of it, and "download this to find out" is
        * not checking.
        */}
      <Card className="p-4">
        {lesson.type === 'video' && lesson.url ? (
          // eslint-disable-next-line jsx-a11y/media-has-caption -- captions are the institution's to add; this is an operator's preview of their own upload.
          <video src={lesson.url} controls preload="metadata"
            className="max-h-[70vh] w-full rounded-xl bg-black" />
        ) : lesson.type === 'image' && lesson.url ? (
          // A plain img: the storage host is not in next.config's remote
          // patterns, and a signed URL is not a stable one to add.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={lesson.url} alt={lesson.title}
            className="mx-auto max-h-[70vh] max-w-full rounded-xl" />
        ) : lesson.type === 'document' && lesson.url ? (
          <div className="space-y-3">
            {/* A PDF renders here; a Word file cannot, and the browser will
                offer it for download instead. Both are handled by the same
                frame, and the link underneath is the way out either way. */}
            <iframe src={lesson.url} title={lesson.title}
              className="h-[70vh] w-full rounded-xl border border-line bg-white" />
            <a href={lesson.url} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-[13px] font-semibold
                         text-brand-700 hover:underline">
              <Icon name="external" className="h-4 w-4" />
              Open the file in a new tab
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
          </div>
        ) : lesson.type === 'link' && lesson.url ? (
          <div className="space-y-2">
            <p className="text-[13px] text-muted">This lesson points somewhere else.</p>
            <a href={lesson.url} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 break-all text-[14px] font-semibold
                         text-brand-700 hover:underline">
              <Icon name="external" className="h-4 w-4 shrink-0" />
              {lesson.url}
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
          </div>
        ) : lesson.type === 'text' ? (
          <div className="whitespace-pre-wrap text-[14px] leading-relaxed text-ink">
            {lesson.body || <span className="text-muted">This lesson has no text in it.</span>}
          </div>
        ) : (
          <p className="text-[13px] text-muted">
            There is nothing attached to this lesson.
          </p>
        )}
      </Card>

      {lesson.resources?.length ? (
        <section>
          <SectionHead title="Attached files" />
          <ul className="divide-y divide-line rounded-xl border border-line">
            {lesson.resources.map((r) => (
              <li key={r.id} className="flex items-center gap-2.5 px-3.5 py-2.5 text-[13px]">
                <Icon name="file" className="h-4 w-4 shrink-0 text-muted" />
                <span className="min-w-0 flex-1 truncate">{r.title}</span>
                <span className="shrink-0 text-[12px] text-muted">{r.mime ?? ''}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section>
        <SectionHead title="Edit" />
        <LessonEditForm tenantId={tenantId} lesson={lesson} />
      </section>
    </div>
  );
}
