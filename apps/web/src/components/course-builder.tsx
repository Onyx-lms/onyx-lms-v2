'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { LessonForm } from './lesson-form';
import { CourseSettingsForm } from './course-settings-form';

interface Lesson {
  id: number; title: string | null; lesson_type: string | null;
  duration: string | null; is_free: number | null;
}
interface Section { id: number; title: string; sort: string; lessons: Lesson[] }

/** B-01 to B-06: the curriculum builder. */
export function CourseBuilder({ courseId, course, curriculum }: {
  courseId: number;
  course: Record<string, unknown>;
  curriculum: Section[];
}) {
  const router = useRouter();
  const [tab, setTab] = useState<'curriculum' | 'settings'>('curriculum');
  const [addingTo, setAddingTo] = useState<number | null>(null);
  const [sectionTitle, setSectionTitle] = useState('');
  const [busy, setBusy] = useState(false);

  async function call(path: string, method: string, body?: unknown) {
    setBusy(true);
    const res = await fetch('/api/proxy' + path, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    setBusy(false);
    if (!res.ok) {
      const b = await res.json().catch(() => ({}));
      alert(b.message ?? 'Action failed.');
      return false;
    }
    router.refresh();
    return true;
  }

  return (
    <div>
      <div className="flex gap-2 border-b border-slate-200">
        {(['curriculum', 'settings'] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm capitalize ${
              tab === t ? 'border-b-2 border-brand-600 font-medium text-brand-700' : 'text-slate-600'}`}>
            {t}
          </button>
        ))}
      </div>

      {tab === 'settings' ? (
        <div className="mt-6 max-w-2xl">
          <CourseSettingsForm courseId={courseId} course={course} />
        </div>
      ) : (
        <div className="mt-6 space-y-4">
          {curriculum.length === 0 && (
            <p className="rounded-lg border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">
              No sections yet. Add one below to start building the curriculum.
            </p>
          )}

          {curriculum.map((section) => (
            <div key={section.id} className="card p-4">
              <div className="flex items-center justify-between">
                <h3 className="font-medium">{section.title}</h3>
                <div className="flex gap-2 text-xs">
                  <button className="btn-ghost px-2 py-1" disabled={busy}
                    onClick={() => setAddingTo(addingTo === section.id ? null : section.id)}>
                    {addingTo === section.id ? 'Close' : 'Add lesson'}
                  </button>
                  <button className="btn-ghost px-2 py-1 text-red-600" disabled={busy}
                    onClick={() => {
                      // Deleting a section removes its lessons as well.
                      if (confirm('Delete this section and all its lessons?')) {
                        call(`/authoring/sections/${section.id}`, 'DELETE');
                      }
                    }}>
                    Delete
                  </button>
                </div>
              </div>

              {section.lessons.length > 0 && (
                <ul className="mt-3 divide-y divide-slate-100 rounded border border-slate-100">
                  {section.lessons.map((l) => (
                    <li key={l.id} className="flex items-center justify-between px-3 py-2 text-sm">
                      <span>
                        {l.title}
                        <span className="ml-2 text-xs text-slate-500">{l.lesson_type}</span>
                        {l.is_free ? <span className="ml-2 chip border-green-200 bg-green-50 text-green-700">Preview</span> : null}
                      </span>
                      <span className="flex items-center gap-3">
                        <span className="text-xs text-slate-500">{l.duration}</span>
                        <button className="text-xs text-red-600 hover:underline" disabled={busy}
                          onClick={() => confirm('Delete this lesson?')
                            && call(`/authoring/lessons/${l.id}`, 'DELETE')}>
                          Delete
                        </button>
                      </span>
                    </li>
                  ))}
                </ul>
              )}

              {addingTo === section.id && (
                <div className="mt-3">
                  <LessonForm courseId={courseId} sectionId={section.id}
                    onDone={() => { setAddingTo(null); router.refresh(); }} />
                </div>
              )}
            </div>
          ))}

          <form className="flex gap-2"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!sectionTitle.trim()) return;
              if (await call(`/authoring/courses/${courseId}/sections`, 'POST',
                { title: sectionTitle })) setSectionTitle('');
            }}>
            <input value={sectionTitle} onChange={(e) => setSectionTitle(e.target.value)}
              placeholder="New section title"
              className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            <button className="btn-primary" disabled={busy}>Add section</button>
          </form>
        </div>
      )}
    </div>
  );
}
