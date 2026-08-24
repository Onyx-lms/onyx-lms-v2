import Link from 'next/link';
import type { Metadata } from 'next';
import { OnyxShell } from '@/components/onyx-shell';
import { OnyxPlayer, ResourceLink } from '@/components/onyx-player';
import { navFor } from '@/lib/onyx-nav';
import { requireOnyxSession, onyxApi, type Me, onyxApiRecord } from '@/lib/onyx-session';
import { formatDuration, type LessonDetail, type Outline } from '@/lib/onyx-learn';
import {
  Card, Icon, Meter, Pill, RowList, SectionHead, Theatre, type IconName,
} from '@/components/onyx-ui';

export const metadata: Metadata = { title: 'Lesson' };

/** Which icon a lesson gets. Mirrors the same mapping on the course page. */
const lessonIcon = (type: string): IconName =>
  type === 'video' ? 'play' : type === 'link' ? 'chevron' : type === 'document' ? 'save' : 'book';

const TYPE_LABEL: Record<string, string> = {
  video: 'Video', text: 'Reading', document: 'Document', link: 'Link',
};

/** "640 KB", not "655360". Nobody has ever sized a download in bytes. */
function fileSize(bytes: number | null): string | null {
  if (!bytes || bytes < 0) return null;
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

/**
 * LRN-02a -- one lesson, resuming where the learner left off.
 *
 * A lesson used to be an orphan page: a video and a "back" link, no sense of
 * where it sat in the course or what came next. It is now the same screen a
 * learner would recognise from any video course -- a theatre-dark player,
 * the curriculum beside it so the next click never needs the back button,
 * and prev/next at the foot so finishing one lesson flows straight into the
 * next instead of dead-ending.
 */
export default async function OnyxLessonPage(
  { params }: { params: Promise<{ id: string; lessonId: string }> },
) {
  await requireOnyxSession();
  const { id, lessonId } = await params;
  const [me, lesson, outline] = await Promise.all([
    onyxApi<Me>('/api/onyx/me'),
    onyxApiRecord<LessonDetail>('/api/onyx/lessons/' + lessonId),
    onyxApiRecord<Outline>('/api/onyx/courses/' + id + '/outline'),
  ]);

  const flat = outline.modules.flatMap((m) => m.lessons);
  const index = flat.findIndex((l) => l.id === lesson.id);
  const prev = index > 0 ? flat[index - 1] : null;
  const next = index >= 0 && index < flat.length - 1 ? flat[index + 1] : null;
  const currentModule = outline.modules.find((m) => m.id === lesson.module_id);
  const isVideo = lesson.type === 'video';

  return (
    <OnyxShell
      me={me}
      nav={navFor(me.role)}
      title={lesson.title}
      subtitle={outline.course.title + (index >= 0 ? ` · Lesson ${index + 1} of ${flat.length}` : '')}
    >
      <Link href={'/onyx/courses/' + id}
        className="inline-flex items-center gap-1.5 text-[13.5px] font-semibold text-muted
                   hover:text-brand-700">
        <Icon name="chevron" className="h-3.5 w-3.5 rotate-180" />
        Back to {outline.course.title}
      </Link>

      <div className="mt-4 grid gap-6 lg:grid-cols-[1fr_300px] lg:items-start">
        <div className="min-w-0 space-y-5">
          {/* The player. Video gets a theatre-dark frame -- content wants
              black behind it, not a white card -- everything else (reading,
              a document, a link) gets the same white card as the rest of
              the product. */}
          {isVideo ? (
            /* The bar carries the three things you need while the picture is
               playing: which module this is, how long it runs, and whether it
               is open to people who have not enrolled. */
            <Theatre
              label={
                <>
                  <Icon name="play" className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{currentModule?.title ?? 'Lesson'}</span>
                </>
              }
              meta={
                <>
                  {lesson.duration_seconds ? (
                    <span className="tabular-nums text-white/55">
                      {formatDuration(lesson.duration_seconds)}
                    </span>
                  ) : null}
                  {lesson.is_preview ? <Pill tone="brand">Preview</Pill> : null}
                </>
              }
              actions={
                <>
                  {index >= 0 ? (
                    <span className="rounded-full bg-white/10 px-3 py-1.5 font-semibold
                                     text-white/80">
                      Lesson {index + 1} of {flat.length}
                    </span>
                  ) : null}
                  <Link href={'/onyx/courses/' + id}
                    className="ml-auto inline-flex min-h-[36px] items-center gap-1.5 rounded-full
                               border border-white/25 px-3.5 font-semibold text-white/90
                               hover:border-white/50 hover:bg-white/10">
                    <Icon name="list" className="h-3.5 w-3.5" />
                    Course outline
                  </Link>
                </>
              }
            >
              <OnyxPlayer lesson={lesson} />
            </Theatre>
          ) : (
            <Card className="p-5 sm:p-6">
              <div className="mb-4 flex items-center justify-between gap-3">
                <span className="flex items-center gap-2 text-[12.5px] font-bold uppercase
                                 tracking-[.08em] text-muted">
                  <Icon name={lessonIcon(lesson.type)} className="h-4 w-4" />
                  {TYPE_LABEL[lesson.type] ?? 'Lesson'}
                </span>
                {lesson.is_preview ? <Pill tone="brand">Preview</Pill> : null}
              </div>
              <OnyxPlayer lesson={lesson} />
            </Card>
          )}

          <div>
            <h2 className="text-xl font-extrabold leading-snug">{lesson.title}</h2>
            {outline.progress.total > 0 ? (
              <div className="mt-3 max-w-sm">
                <Meter percent={outline.progress.percent} label={outline.course.title + ' progress'} />
                <p className="mt-1.5 text-[12.5px] text-muted">
                  <span className="font-bold text-ink">{outline.progress.percent}%</span> of the
                  course complete &middot; {outline.progress.completed} of {outline.progress.total} lessons
                </p>
              </div>
            ) : null}
          </div>

          {lesson.resources.length ? (
            <section>
              <SectionHead title="For this lesson" />
              <RowList label="Lesson resources">
                {lesson.resources.map((r) => {
                  const size = fileSize(r.size_bytes);
                  const meta = [size, r.mime].filter(Boolean).join(' · ');
                  return (
                    <li key={r.id} className="flex items-center gap-3 px-4 py-3">
                      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl
                                       bg-brand-50 text-brand-700">
                        <Icon name="file" className="h-[18px] w-[18px]" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <ResourceLink resource={r} />
                        {meta ? (
                          <span className="mt-0.5 block text-[12.5px] text-muted">{meta}</span>
                        ) : null}
                      </span>
                    </li>
                  );
                })}
              </RowList>
              <p className="mt-2 text-xs text-muted">
                Download links are issued when you click and expire in five minutes.
              </p>
            </section>
          ) : null}

          {/* Prev / next -- finishing a lesson should flow into the next
              one, not strand a learner back at the "back" link. */}
          <div className="flex items-center justify-between gap-3 border-t border-line pt-5">
            {prev ? (
              <Link href={'/onyx/courses/' + id + '/lessons/' + prev.id}
                className="inline-flex min-h-[42px] items-center gap-1.5 rounded-2xl border
                           border-line px-3.5 text-[13.5px] font-semibold text-slate-700
                           hover:bg-brand-50">
                <Icon name="chevron" className="h-3.5 w-3.5 shrink-0 rotate-180" />
                <span className="max-w-[12ch] truncate sm:max-w-[24ch]">{prev.title}</span>
              </Link>
            ) : <span aria-hidden />}

            {next ? (
              <Link href={'/onyx/courses/' + id + '/lessons/' + next.id}
                className="inline-flex min-h-[42px] items-center gap-1.5 rounded-2xl bg-brand-600
                           px-3.5 text-[13.5px] font-bold text-white hover:bg-brand-700">
                <span className="max-w-[12ch] truncate sm:max-w-[24ch]">{next.title}</span>
                <Icon name="chevron" className="h-3.5 w-3.5 shrink-0" />
              </Link>
            ) : (
              <Link href={'/onyx/courses/' + id}
                className="inline-flex min-h-[42px] items-center gap-1.5 rounded-2xl bg-brand-600
                           px-3.5 text-[13.5px] font-bold text-white hover:bg-brand-700">
                <Icon name="check" className="h-3.5 w-3.5" />
                Back to course
              </Link>
            )}
          </div>
        </div>

        {/* Curriculum -- the whole reason a video course feels professional
            rather than like a single orphaned clip: you can always see
            where this lesson sits and jump to any other one. */}
        <aside className="lg:sticky lg:top-[84px]">
          <Card className="overflow-hidden">
            <div className="border-b border-line px-4 py-3.5">
              <p className="text-[11.5px] font-bold uppercase tracking-[.085em] text-muted">
                Course content
              </p>
              <p className="mt-0.5 truncate text-[14.5px] font-bold">{outline.course.title}</p>
              {outline.progress.total > 0 ? (
                <p className="mt-1 text-[12px] tabular-nums text-muted">
                  {outline.progress.percent}% complete
                </p>
              ) : null}
            </div>
            <div className="max-h-[65vh] overflow-y-auto">
              {outline.modules.map((m) => (
                <div key={m.id}>
                  <p className="sticky top-0 bg-slate-50 px-4 py-2 text-[11px] font-bold
                                uppercase tracking-[.07em] text-muted">
                    {m.title}
                  </p>
                  <ul className="divide-y divide-line">
                    {m.lessons.map((l) => {
                      const active = l.id === lesson.id;
                      const icon = l.completed_at ? 'check' : lessonIcon(l.type);
                      const badge = l.completed_at
                        ? 'bg-green-50 text-green-700'
                        : l.locked
                          ? 'bg-slate-100 text-muted'
                          : active
                            ? 'bg-brand-600 text-white'
                            : 'bg-brand-50 text-brand-700';
                      return (
                        <li key={l.id}>
                          {l.locked ? (
                            <div className="flex items-center gap-2.5 px-4 py-2.5">
                              <span className={'grid h-8 w-8 shrink-0 place-items-center rounded-lg ' + badge}>
                                <Icon name={icon} className="h-[14px] w-[14px]" />
                              </span>
                              <span className="min-w-0 flex-1 truncate text-[13.5px] text-muted">
                                {l.title}
                              </span>
                              <Pill tone="neutral">Locked</Pill>
                            </div>
                          ) : (
                            <Link href={'/onyx/courses/' + id + '/lessons/' + l.id}
                              aria-current={active ? 'true' : undefined}
                              className={'flex items-center gap-2.5 px-4 py-2.5 transition-colors '
                                + (active ? 'bg-brand-50' : 'hover:bg-brand-50/40')}>
                              <span className={'grid h-8 w-8 shrink-0 place-items-center rounded-lg ' + badge}>
                                <Icon name={icon} className="h-[14px] w-[14px]" />
                              </span>
                              <span className="min-w-0 flex-1">
                                <span className={'block truncate text-[13.5px] '
                                  + (active ? 'font-bold text-brand-800' : 'font-medium text-ink')}>
                                  {l.title}
                                </span>
                                {l.duration_seconds ? (
                                  <span className="text-[11.5px] tabular-nums text-muted">
                                    {formatDuration(l.duration_seconds)}
                                  </span>
                                ) : null}
                              </span>
                              {active ? <Pill tone="brand">Now</Pill> : null}
                            </Link>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>
          </Card>
        </aside>
      </div>
    </OnyxShell>
  );
}
