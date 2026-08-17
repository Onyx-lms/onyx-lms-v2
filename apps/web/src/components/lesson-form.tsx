'use client';

import { useState } from 'react';

/** B-04: every lesson type the Laravel views branch on. */
const LESSON_TYPES = [
  'video', 'youtube', 'vimeo', 'google_drive', 'google_drive_video',
  'academy_cloud', 'document', 'document_type', 'image', 'text',
  'iframe', 'scorm', 'quiz',
] as const;

const NEEDS_SOURCE = new Set([
  'video', 'youtube', 'vimeo', 'google_drive', 'google_drive_video',
  'academy_cloud', 'document', 'document_type', 'image', 'iframe', 'scorm',
]);
const IS_VIDEO = new Set(['video', 'youtube', 'vimeo', 'google_drive_video', 'academy_cloud']);

export function LessonForm({ courseId, sectionId, onDone }: {
  courseId: number; sectionId: number; onDone: () => void;
}) {
  const [type, setType] = useState<string>('youtube');
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [message, setMessage] = useState('');

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true); setErrors({}); setMessage('');
    const f = new FormData(e.currentTarget);
    const payload: Record<string, unknown> = {
      title: String(f.get('title') ?? ''),
      lesson_type: type,
      section_id: sectionId,
      is_free: f.get('is_free') ? 1 : 0,
    };
    if (NEEDS_SOURCE.has(type)) payload.lesson_src = String(f.get('lesson_src') ?? '');
    if (IS_VIDEO.has(type)) payload.duration = String(f.get('duration') ?? '00:00:00');
    if (type === 'text') payload.description = String(f.get('description') ?? '');
    if (type === 'quiz') {
      payload.total_mark = Number(f.get('total_mark') ?? 0);
      payload.pass_mark = Number(f.get('pass_mark') ?? 0);
      payload.retake = Number(f.get('retake') ?? 0);
    }

    const res = await fetch(`/api/proxy/authoring/courses/${courseId}/lessons`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setErrors(body.errors ?? {});
      setMessage(body.message ?? 'Could not add the lesson.');
      return;
    }
    onDone();
  }

  const err = (name: string) =>
    errors[name] ? <p className="mt-1 text-xs text-red-600">{errors[name]![0]}</p> : null;

  return (
    <form onSubmit={submit} className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="block text-sm font-medium">Lesson title</label>
          <input name="title" required className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          {err('title')}
        </div>
        <div>
          <label className="block text-sm font-medium">Type</label>
          <select value={type} onChange={(e) => setType(e.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
            {LESSON_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          {err('lesson_type')}
        </div>
      </div>

      {NEEDS_SOURCE.has(type) && (
        <div>
          <label className="block text-sm font-medium">
            Source {IS_VIDEO.has(type) ? '(paste the full URL, the id is extracted)' : '(file path)'}
          </label>
          <input name="lesson_src" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          {err('lesson_src')}
        </div>
      )}

      {IS_VIDEO.has(type) && (
        <div>
          <label className="block text-sm font-medium">Duration (hh:mm:ss)</label>
          <input name="duration" defaultValue="00:00:00" placeholder="00:10:00"
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          {err('duration')}
        </div>
      )}

      {type === 'text' && (
        <div>
          <label className="block text-sm font-medium">Content</label>
          <textarea name="description" rows={4}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        </div>
      )}

      {type === 'quiz' && (
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <label className="block text-sm font-medium">Total mark</label>
            <input name="total_mark" type="number" defaultValue={10}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-sm font-medium">Pass mark</label>
            <input name="pass_mark" type="number" defaultValue={6}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-sm font-medium">Retakes</label>
            {/* 0 retakes still allows one attempt, matching Laravel. */}
            <input name="retake" type="number" defaultValue={0}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          </div>
        </div>
      )}

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="is_free" /> Free preview
      </label>

      <div className="flex gap-2">
        <button className="btn-primary" disabled={busy}>{busy ? 'Adding' : 'Add lesson'}</button>
      </div>
      {message && <p className="text-sm text-red-600">{message}</p>}
    </form>
  );
}
