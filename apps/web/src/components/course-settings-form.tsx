'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/** B-01 / B-06: course details, pricing and drip configuration. */
export function CourseSettingsForm({ courseId, course }: {
  courseId: number; course: Record<string, unknown>;
}) {
  const router = useRouter();
  const [isPaid, setIsPaid] = useState(Number(course.is_paid ?? 0) === 1);
  const [drip, setDrip] = useState(Number(course.enable_drip_content ?? 0) === 1);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [level, setLevel] = useState<'error' | 'success'>('success');

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true); setMessage('');
    const f = new FormData(e.currentTarget);
    const listOf = (key: string) => String(f.get(key) ?? '')
      .split('\n').map((s) => s.trim()).filter(Boolean);

    const payload: Record<string, unknown> = {
      title: String(f.get('title') ?? ''),
      short_description: String(f.get('short_description') ?? ''),
      description: String(f.get('description') ?? ''),
      level: String(f.get('level') ?? ''),
      language: String(f.get('language') ?? ''),
      requirements: listOf('requirements'),
      outcomes: listOf('outcomes'),
      is_paid: isPaid ? 1 : 0,
      price: isPaid ? Number(f.get('price') ?? 0) : null,
      enable_drip_content: drip ? 1 : 0,
    };
    if (drip) {
      payload.drip_content_settings = {
        lesson_completion_role: String(f.get('completion_role') ?? 'percentage'),
        minimum_percentage: Number(f.get('minimum_percentage') ?? 80),
        minimum_duration: Number(f.get('minimum_duration') ?? 0),
      };
    }

    const res = await fetch(`/api/proxy/authoring/courses/${courseId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    setLevel(res.ok ? 'success' : 'error');
    setMessage(body.message ?? (res.ok ? 'Saved.' : 'Could not save.'));
    if (res.ok) router.refresh();
  }

  const text = (name: string, label: string, opts: { rows?: number; value?: string } = {}) => (
    <div>
      <label className="block text-sm font-medium">{label}</label>
      {opts.rows ? (
        <textarea name={name} rows={opts.rows} defaultValue={opts.value ?? ''}
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
      ) : (
        <input name={name} defaultValue={opts.value ?? ''}
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
      )}
    </div>
  );

  const asLines = (v: unknown) => Array.isArray(v) ? v.join('\n') : '';

  return (
    <form onSubmit={submit} className="space-y-4">
      {text('title', 'Title', { value: String(course.title ?? '') })}
      {text('short_description', 'Short description', { value: String(course.short_description ?? '') })}
      {text('description', 'Description', { rows: 5, value: String(course.description ?? '') })}

      <div className="grid gap-3 sm:grid-cols-2">
        {text('level', 'Level', { value: String(course.level ?? '') })}
        {text('language', 'Language', { value: String(course.language ?? '') })}
      </div>

      {text('outcomes', 'What students will learn (one per line)', { rows: 4, value: asLines(course.outcomes) })}
      {text('requirements', 'Requirements (one per line)', { rows: 3, value: asLines(course.requirements) })}

      <div className="rounded-lg border border-slate-200 p-4">
        <label className="flex items-center gap-2 text-sm font-medium">
          <input type="checkbox" checked={isPaid} onChange={(e) => setIsPaid(e.target.checked)} />
          Paid course
        </label>
        {isPaid && (
          <div className="mt-3">
            <label className="block text-sm font-medium">Price</label>
            <input name="price" type="number" step="0.01" defaultValue={Number(course.price ?? 0)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          </div>
        )}
      </div>

      <div className="rounded-lg border border-slate-200 p-4">
        <label className="flex items-center gap-2 text-sm font-medium">
          <input type="checkbox" checked={drip} onChange={(e) => setDrip(e.target.checked)} />
          Drip content (lessons unlock as the student progresses)
        </label>
        {drip && (
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <div>
              <label className="block text-sm font-medium">Completion rule</label>
              <select name="completion_role" defaultValue="percentage"
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
                <option value="percentage">Percentage watched</option>
                <option value="duration">Minimum duration</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium">Minimum %</label>
              <input name="minimum_percentage" type="number" defaultValue={80}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium">Minimum seconds</label>
              <input name="minimum_duration" type="number" defaultValue={0}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            </div>
          </div>
        )}
      </div>

      <button className="btn-primary" disabled={busy}>{busy ? 'Saving' : 'Save course'}</button>
      {message && (
        <p className={`text-sm ${level === 'error' ? 'text-red-600' : 'text-green-700'}`}>{message}</p>
      )}
    </form>
  );
}
