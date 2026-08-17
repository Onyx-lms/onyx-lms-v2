/**
 * B-04 / B-05 -- the eleven lesson types the Laravel views actually branch on,
 * and what each one requires.
 *
 * Taken from the Blade templates rather than invented: video, youtube, vimeo,
 * google_drive, google_drive_video, academy_cloud, document, document_type,
 * image, text, iframe, scorm, quiz.
 */
export const LESSON_TYPES = [
  'video', 'youtube', 'vimeo', 'google_drive', 'google_drive_video',
  'academy_cloud', 'document', 'document_type', 'image', 'text',
  'iframe', 'scorm', 'quiz',
] as const;
export type LessonType = (typeof LESSON_TYPES)[number];

export const VIDEO_TYPES = ['html5', 'youtube', 'vimeo'] as const;
export type VideoType = (typeof VIDEO_TYPES)[number];

/** Types whose lesson_src is a video and therefore carry a duration. */
export const VIDEO_LESSON_TYPES: readonly LessonType[] = [
  'video', 'youtube', 'vimeo', 'google_drive_video', 'academy_cloud',
];

export function isVideoLesson(type: string | null | undefined): boolean {
  return VIDEO_LESSON_TYPES.includes(type as LessonType);
}

export function isLessonType(value: unknown): value is LessonType {
  return typeof value === 'string' && (LESSON_TYPES as readonly string[]).includes(value);
}

/**
 * duration_to_seconds() -- accepts "hh:mm:ss" and the shorter "mm:ss".
 * Returns 0 for anything unparseable, because Laravel treated a bad duration
 * as zero rather than failing the save.
 */
export function durationToSeconds(duration: string | null | undefined): number {
  if (!duration) return 0;
  const parts = String(duration).split(':').map((p) => Number(p.trim()));
  if (parts.some((n) => !Number.isFinite(n))) return 0;
  if (parts.length === 3) return parts[0]! * 3600 + parts[1]! * 60 + parts[2]!;
  if (parts.length === 2) return parts[0]! * 60 + parts[1]!;
  if (parts.length === 1) return parts[0]!;
  return 0;
}

/** seconds_to_time_format() -- always zero-padded hh:mm:ss. */
export function secondsToTimeFormat(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(hh)}:${pad(mm)}:${pad(ss)}`;
}

/**
 * Extracts the provider id from a pasted URL so lesson_src stores the id, not
 * the full link -- which is what the player expects.
 */
export function extractVideoId(type: LessonType, src: string): string {
  const value = (src ?? '').trim();
  if (type === 'youtube') {
    const m = value.match(/(?:youtu\.be\/|v=|embed\/|shorts\/)([A-Za-z0-9_-]{6,})/);
    return m?.[1] ?? value;
  }
  if (type === 'vimeo') {
    const m = value.match(/vimeo\.com\/(?:video\/)?(\d+)/);
    return m?.[1] ?? value;
  }
  if (type === 'google_drive' || type === 'google_drive_video') {
    const m = value.match(/\/d\/([A-Za-z0-9_-]+)|[?&]id=([A-Za-z0-9_-]+)/);
    return m?.[1] ?? m?.[2] ?? value;
  }
  return value;
}

/** Per-type validation. Returns field-keyed messages, empty when valid. */
export function validateLesson(input: {
  lesson_type: string; lesson_src?: string | null; duration?: string | null;
}): Record<string, string[]> {
  const errors: Record<string, string[]> = {};
  if (!isLessonType(input.lesson_type)) {
    errors['lesson_type'] = ['Unsupported lesson type.'];
    return errors;
  }
  const type = input.lesson_type;
  const needsSrc: LessonType[] = [
    'video', 'youtube', 'vimeo', 'google_drive', 'google_drive_video',
    'academy_cloud', 'document', 'document_type', 'image', 'iframe', 'scorm',
  ];
  if (needsSrc.includes(type) && !(input.lesson_src ?? '').trim()) {
    errors['lesson_src'] = ['A source is required for this lesson type.'];
  }
  if (isVideoLesson(type) && input.duration && durationToSeconds(input.duration) <= 0) {
    errors['duration'] = ['Duration must look like hh:mm:ss.'];
  }
  return errors;
}
